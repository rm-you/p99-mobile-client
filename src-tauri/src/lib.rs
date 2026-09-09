mod session;
mod settings;

use session::{AppEvent, ConnectRequest, SessionController};
use settings::{Settings, SettingsStore};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager, State};
use tauri_plugin_secure_login::{Credentials, SecureLogin, VaultStatus};

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

/// Unlock a saved login into the native worker without exposing it to JavaScript.
#[tauri::command]
async fn connect_saved(
    server: session::Server,
    character: String,
    on_event: Channel<AppEvent>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credentials = app.state::<SecureLogin<tauri::Wry>>().unlock()?;
        app.state::<Arc<SessionController>>().start(
            ConnectRequest {
                user: credentials.user,
                pass: credentials.pass,
                server,
                character,
            },
            move |event| {
                on_event
                    .send(event)
                    .map_err(|_| "The chat view is no longer available".into())
            },
        )
    })
    .await
    .map_err(|_| "Unable to unlock saved login")?
}

/// Check saved-login availability without prompting or reading credentials.
#[tauri::command]
async fn credential_status(app: tauri::AppHandle) -> Result<VaultStatus, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<SecureLogin<tauri::Wry>>().status())
        .await
        .map_err(|_| "Unable to check saved login")?
}

/// Validate and protect an explicitly saved login with device authentication.
#[tauri::command]
async fn save_credentials(credentials: Credentials, app: tauri::AppHandle) -> Result<(), String> {
    if credentials.user.trim().is_empty()
        || credentials.pass.is_empty()
        || credentials.user.contains('\0')
        || credentials.pass.contains('\0')
        || credentials.user.len() > 1024
        || credentials.pass.len() > 1024
    {
        return Err("Enter a valid login account and password.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<SecureLogin<tauri::Wry>>().save(credentials)
    })
    .await
    .map_err(|_| "Unable to save login")?
}

/// Delete the saved login; active workers retain their current in-memory copy.
#[tauri::command]
async fn forget_credentials(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<SecureLogin<tauri::Wry>>().forget())
        .await
        .map_err(|_| "Unable to forget login")?
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
        .manage(Arc::new(SessionController::default()))
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
            save_credentials,
            forget_credentials,
            load_settings,
            save_settings
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
