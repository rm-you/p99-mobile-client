mod background;
mod delivery;
mod experience;
mod history;
mod items;
mod outgoing;
mod profiles;
mod session;
mod settings;
mod support;
use tauri_plugin_opener::OpenerExt;

use background::{BackgroundControl, BackgroundSession};
use outgoing::{SendChatRequest, SendFailure};
use profiles::{validate_id, validate_unlocked, ProfileOperations, SaveProfile};
use session::{AppEvent, ConnectRequest, Server, SessionController};
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
    app: tauri::AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || start_session(&app, request, on_event))
        .await
        .map_err(|_| "Unable to start session task")?
}

/// Share worker lifetime and bounded event delivery between manual and saved logins.
fn start_session(
    app: &tauri::AppHandle,
    request: ConnectRequest,
    on_event: Channel<AppEvent>,
) -> Result<(), String> {
    let control = app.state::<Arc<BackgroundControl>>().inner().clone();
    let delivery = control.clone();
    let worker_app = app.clone();
    let history_app = app.clone();
    let owner = history::HistoryOwner {
        server: match request.server {
            Server::Green => "green",
            Server::Blue => "blue",
        }
        .into(),
        character: request.character.trim().into(),
    };
    app.state::<Arc<SessionController>>().start_with(
        request,
        move |event| {
            if let AppEvent::Client(ref message) = event {
                let store=history_app.state::<history::ChatStore>();
                match message {
                    p99_logger_client::client::ClientEvent::Record(record) => {
                        if let Ok(value)=serde_json::to_value(record) {
                            match store.record(&owner, &value, delivery.delivery.is_hidden()) {
                                Ok(recorded) => {
                                    if let Some(alert) = recorded.alert {
                                        history_app.state::<tauri_plugin_session_service::SessionService<tauri::Wry>>().alert_chat(&alert.title, &alert.body);
                                    }
                                    if recorded.history_failed { delivery.delivery.publish(AppEvent::HistoryError); }
                                }
                                Err(_) => delivery.delivery.publish(AppEvent::HistoryError),
                            }
                        }
                    }
                    p99_logger_client::client::ClientEvent::Reconnecting{..}=>store.reconnect(),
                    _=>{}
                }
            }
            delivery.delivery.publish(event);
            Ok(())
        },
        move |token| {
            control.delivery.attach(on_event);
            BackgroundSession::begin(worker_app, control, token)
        },
    )
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
        start_session(
            &app,
            ConnectRequest {
                user: login.user,
                pass: login.pass,
                server: login.profile.server,
                character: login.profile.character,
            },
            on_event,
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
fn save_settings(
    settings: Settings,
    store: State<'_, SettingsStore>,
    chat: State<'_, history::ChatStore>,
) -> Result<(), String> {
    store.save(settings.clone())?;
    chat.configure(settings.experience)
}

/// Read bundled item facts without accessing the network or account context.
#[tauri::command]
async fn item_details(item_id: u32, name: String) -> Result<items::ItemDetails, String> {
    tauri::async_runtime::spawn_blocking(move || items::lookup(item_id, &name))
        .await
        .map_err(|_| "Unable to read item details.".to_owned())?
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

/// Submit one validated message to the currently connected character's bounded queue.
#[tauri::command]
fn send_chat(
    request: SendChatRequest,
    state: State<'_, Arc<SessionController>>,
) -> Result<(), SendFailure> {
    state.outbox.send(request)
}

/// Complement native Android visibility callbacks and replay on iOS/webview resume.
#[tauri::command]
fn set_chat_visible(visible: bool, control: State<'_, Arc<BackgroundControl>>) {
    control.delivery.set_visible(visible);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let control = Arc::new(BackgroundControl::default());
    let callbacks = control.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_session_service::init(move |event| {
            callbacks.handle(event)
        }))
        .plugin(tauri_plugin_secure_login::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(SessionController::default()))
        .manage(control)
        .manage(ProfileOperations::default())
        .setup(|app| {
            let settings = SettingsStore::new(app.path().app_config_dir()?.join("settings.json"));
            let preferences = settings.load().unwrap_or_default();
            app.manage(history::ChatStore::new(
                app.path().app_local_data_dir()?.join("chat-history.sqlite"),
                preferences.experience,
            ));
            app.manage(settings);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            connect_saved,
            disconnect,
            send_chat,
            set_chat_visible,
            credential_status,
            save_profile,
            forget_profile,
            forget_legacy,
            load_settings,
            save_settings,
            item_details,
            open_item_wiki,
            support::history_profiles,
            support::load_history,
            support::clear_history,
            support::export_history,
            support::share_document,
            support::copy_message,
            support::app_info,
            support::test_notification,
            support::export_diagnostics,
            support::open_info_link
        ])
        .build(tauri::generate_context!())
        .expect("Unable to initialize P99 Mobile Chat")
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
