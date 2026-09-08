mod session;

use session::{AppEvent, ConnectRequest, SessionController};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager, State};

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
        .manage(Arc::new(SessionController::default()))
        .invoke_handler(tauri::generate_handler![connect, disconnect])
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
