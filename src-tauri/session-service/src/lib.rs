use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct BackgroundStatus {
    pub supported: bool,
    pub active: bool,
    pub notifications_enabled: bool,
    pub battery_optimized: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlEvent {
    Stop { session_id: String },
    Visibility { visible: bool },
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionNotice {
    Connecting,
    Connected,
    Reconnecting,
}

pub struct SessionService<R: Runtime> {
    #[cfg(mobile)]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(target_os = "android")]
    events: tauri::ipc::Channel<serde_json::Value>,
    #[cfg(not(mobile))]
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> SessionService<R> {
    /// Present platform copy/share controls only for a user-selected document.
    pub fn document(&self, copy: bool, text: &str, format: &str) -> Result<(), String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin(
                if copy { "copyText" } else { "shareDocument" },
                serde_json::json!({"text":text,"format":format}),
            )
            .map_err(|_| "Could not open the device sharing controls.".into());
        #[cfg(not(mobile))]
        {
            let _ = (copy, text, format);
            Err("Device sharing is available in the mobile app.".into())
        }
    }
    /// Alerts originate on the native worker, independent of suspended JavaScript.
    pub fn alert_chat(&self, title: &str, body: &str) {
        #[cfg(target_os = "android")]
        let _: Result<(), _> = self
            .handle
            .run_mobile_plugin("alertChat", serde_json::json!({"title":title,"body":body}));
        #[cfg(not(target_os = "android"))]
        let _ = (title, body);
    }

    /// An explicit settings action tests notification permission without starting a session.
    pub fn test_alert(&self) -> Result<(), String> {
        #[cfg(target_os = "android")]
        return self.handle.run_mobile_plugin("testAlert", serde_json::json!({"title":"P99 Mobile Chat", "body":"Test notification. Chat alerts are ready."})).map_err(|_| "Allow notifications in Android settings to receive chat alerts.".into());
        #[cfg(not(target_os = "android"))]
        Err("Chat notifications are currently available on Android.".into())
    }

    /// Start only for an explicit login; no credentials or character labels cross this API.
    pub fn begin(&self, session_id: &str) -> Result<BackgroundStatus, String> {
        #[cfg(target_os = "android")]
        return self
            .handle
            .run_mobile_plugin(
                "begin",
                serde_json::json!({
                    "sessionId": session_id, "events": self.events
                }),
            )
            .map_err(|_| "Background connection support is unavailable.".into());
        #[cfg(not(target_os = "android"))]
        {
            let _ = session_id;
            Ok(BackgroundStatus::default())
        }
    }

    /// Update generic connection text without putting chat or account details in notifications.
    pub fn update(&self, session_id: &str, notice: ConnectionNotice) {
        #[cfg(target_os = "android")]
        let _: Result<(), _> = self.handle.run_mobile_plugin(
            "update",
            serde_json::json!({
                "sessionId": session_id, "notice": notice
            }),
        );
        #[cfg(not(target_os = "android"))]
        let _ = (session_id, notice);
    }

    /// Release the service after the matching Rust worker has closed its connection.
    pub fn end(&self, session_id: &str) {
        #[cfg(target_os = "android")]
        let _: Result<(), _> = self.handle.run_mobile_plugin(
            "end",
            serde_json::json!({
                "sessionId": session_id
            }),
        );
        #[cfg(not(target_os = "android"))]
        let _ = session_id;
    }
}

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_session_service);

/// A native control channel keeps notification Stop independent of the webview.
pub fn init<R: Runtime>(control: impl Fn(ControlEvent) + Send + Sync + 'static) -> TauriPlugin<R> {
    Builder::new("session-service")
        .setup(move |app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(
                "io.github.rmyou.sessionservice",
                "SessionServicePlugin",
            )?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_session_service)?;
            #[cfg(target_os = "android")]
            let events = tauri::ipc::Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                    if let Ok(event) = serde_json::from_str(&json) {
                        control(event);
                    }
                }
                Ok(())
            });
            #[cfg(not(target_os = "android"))]
            let _ = control;
            app.manage(SessionService::<R> {
                #[cfg(mobile)]
                handle,
                #[cfg(target_os = "android")]
                events,
                #[cfg(not(mobile))]
                marker: std::marker::PhantomData,
            });
            Ok(())
        })
        .build()
}
