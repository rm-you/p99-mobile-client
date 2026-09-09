mod items;
mod profiles;
mod session;
mod settings;
use tauri_plugin_opener::OpenerExt;

use profiles::{validate_id, validate_unlocked, ProfileOperations, SaveProfile};
use session::{AppEvent, ConnectRequest, SessionController};
use settings::{Settings, SettingsStore};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_secure_login::{
    Credentials, ProfileLogin, SavedProfile, SecureLogin, VaultStatus,
};

/// Validate settings and start the network worker without blocking the webview.
#[tauri::command]
async fn connect(
    request: ConnectRequest,
    on_event: Channel<AppEvent>,
    state: State<'_, Arc<SessionController>>,
) -> Result<(), String> {
    let controller = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        controller.start(request, move |event| {
            on_event
                .send(event)
                .map_err(|_| "The chat view is no longer available".into())
        })
    })
    .await
    .map_err(|_| "Unable to start session task")?
}

/// Unlock the selected character directly into the native worker.
#[tauri::command]
async fn connect_saved(
    id: String,
    on_event: Channel<AppEvent>,
    app: tauri::AppHandle,
) -> Result<SavedProfile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_id(&id)?;
        let operations = app.state::<ProfileOperations>();
        let _guard = operations
            .0
            .lock()
            .map_err(|_| "Saved characters unavailable")?;
        let vault = app.state::<SecureLogin<tauri::Wry>>();
        let expected = vault
            .status()?
            .profiles
            .into_iter()
            .find(|p| p.id == id)
            .ok_or("This saved character no longer exists.")?;
        let login = vault.unlock(&id)?;
        validate_unlocked(&login, &expected)?;
        app.state::<Arc<SessionController>>().start(
            ConnectRequest {
                user: login.user,
                pass: login.pass,
                server: login.profile.server,
                character: login.profile.character,
            },
            move |event| {
                on_event
                    .send(event)
                    .map_err(|_| "The chat view is no longer available".into())
            },
        )?;
        Ok(expected)
    })
    .await
    .map_err(|_| "Unable to unlock saved character")?
}

/// Read labels without prompting or reading protected account credentials.
#[tauri::command]
async fn credential_status(app: tauri::AppHandle) -> Result<VaultStatus, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<SecureLogin<tauri::Wry>>().status())
        .await
        .map_err(|_| "Unable to check saved characters")?
}

/// Save one complete tuple; edits can retain credentials without returning them to JavaScript.
#[tauri::command]
async fn save_profile(request: SaveProfile, app: tauri::AppHandle) -> Result<SavedProfile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let operations = app.state::<ProfileOperations>();
        let _guard = operations
            .0
            .lock()
            .map_err(|_| "Saved characters unavailable")?;
        let vault = app.state::<SecureLogin<tauri::Wry>>();
        let status = vault.status()?;
        request.validate(&status.profiles, status.legacy_saved)?;
        let profile = request.metadata();
        let legacy = request.id.as_deref() == Some("legacy");
        let credentials = if request.user.is_empty() && request.pass.is_empty() {
            if legacy {
                vault.unlock_legacy()?
            } else {
                let expected = status
                    .profiles
                    .iter()
                    .find(|p| Some(&p.id) == request.id.as_ref())
                    .ok_or("This saved character no longer exists.")?;
                let login = vault.unlock(&expected.id)?;
                validate_unlocked(&login, expected)?;
                Credentials {
                    user: login.user,
                    pass: login.pass,
                }
            }
        } else {
            Credentials {
                user: request.user,
                pass: request.pass,
            }
        };
        vault.save(ProfileLogin {
            profile: profile.clone(),
            user: credentials.user,
            pass: credentials.pass,
        })?;
        if legacy {
            // A cleanup failure must not turn a durable save into a reported failure.
            // The old entry remains visible and can be removed explicitly.
            let _ = vault.forget_legacy();
        }
        Ok(profile)
    })
    .await
    .map_err(|_| "Unable to save character")?
}

/// Remove only the selected profile, leaving other accounts and characters intact.
#[tauri::command]
async fn forget_profile(id: String, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_id(&id)?;
        let operations = app.state::<ProfileOperations>();
        let _guard = operations
            .0
            .lock()
            .map_err(|_| "Saved characters unavailable")?;
        app.state::<SecureLogin<tauri::Wry>>().forget(&id)
    })
    .await
    .map_err(|_| "Unable to delete saved character")?
}

/// Explicitly remove the old single-login entry after an upgrade.
#[tauri::command]
async fn forget_legacy(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let operations = app.state::<ProfileOperations>();
        let _guard = operations
            .0
            .lock()
            .map_err(|_| "Saved characters unavailable")?;
        app.state::<SecureLogin<tauri::Wry>>().forget_legacy()
    })
    .await
    .map_err(|_| "Unable to delete previous login")?
}

/// Load validated preferences without exposing the credential store.
#[tauri::command]
fn load_settings(store: State<'_, SettingsStore>) -> Result<Settings, String> {
    store.load()
}

/// Persist only the typed nonsecret settings fields.
#[tauri::command]
fn save_settings(settings: Settings, store: State<'_, SettingsStore>) -> Result<(), String> {
    store.save(settings)
}

/// Read bundled item facts without accessing the network or account context.
#[tauri::command]
fn item_details(item_id: u32, name: String) -> Result<items::ItemDetails, String> {
    items::lookup(item_id, &name)
}

/// Open only a Wiki article in the system browser, outside the privileged app view.
#[tauri::command]
async fn open_item_wiki(name: String, app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(items::page_url(&name)?, None::<&str>)
        .map_err(|_| "Could not open the Wiki in your browser.".into())
}

/// Wait for the old socket to close before the UI enables another connection.
#[tauri::command]
async fn disconnect(state: State<'_, Arc<SessionController>>) -> Result<(), String> {
    let controller = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || controller.stop())
        .await
        .map_err(|_| "Unable to stop session task")?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_secure_login::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(SessionController::default()))
        .manage(ProfileOperations::default())
        .setup(|app| {
            app.manage(SettingsStore::new(
                app.path().app_config_dir()?.join("settings.json"),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            connect_saved,
            disconnect,
            credential_status,
            save_profile,
            forget_profile,
            forget_legacy,
            load_settings,
            save_settings,
            item_details,
            open_item_wiki
        ])
        .build(tauri::generate_context!())
        .expect("Unable to initialize P99 Mobile")
        .run(|app, event| {
            // Focus and visibility changes leave the network worker running.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
                let controller = app.state::<Arc<SessionController>>().inner().clone();
                controller.cancel();
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = controller.stop();
                    app.exit(0);
                });
            }
        });
}
