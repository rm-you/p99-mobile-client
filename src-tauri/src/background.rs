use crate::{
    delivery::EventDelivery,
    session::{AppEvent, SessionObserver},
};
use p99_logger_client::client::{CancellationToken, ClientEvent, ConnectionStage};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_session_service::{
    BackgroundStatus, ConnectionNotice, ControlEvent, SessionService,
};

/// Session IDs prevent an old notification action from cancelling a replacement worker.
#[derive(Default)]
pub struct BackgroundControl {
    current: Mutex<Option<(String, CancellationToken)>>,
    pub delivery: Arc<EventDelivery>,
}

impl BackgroundControl {
    pub fn handle(&self, event: ControlEvent) {
        match event {
            ControlEvent::Stop { session_id } => {
                if let Ok(current) = self.current.lock() {
                    if let Some((_, token)) = current.as_ref().filter(|(id, _)| *id == session_id) {
                        token.cancel();
                    }
                }
            }
            ControlEvent::Visibility { visible } => self.delivery.set_visible(visible),
        }
    }
}

pub struct BackgroundSession {
    app: tauri::AppHandle,
    control: Arc<BackgroundControl>,
    id: String,
    notice: ConnectionNotice,
}

impl BackgroundSession {
    /// Acquire platform support while login is user-initiated and the app is visible.
    pub fn begin(
        app: tauri::AppHandle,
        control: Arc<BackgroundControl>,
        token: CancellationToken,
    ) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        if let Ok(mut current) = control.current.lock() {
            *current = Some((id.clone(), token));
        }
        let status = app
            .state::<SessionService<tauri::Wry>>()
            .begin(&id)
            .unwrap_or(BackgroundStatus {
                supported: true,
                ..BackgroundStatus::default()
            });
        control.delivery.publish(AppEvent::Background(status));
        Self {
            app,
            control,
            id,
            notice: ConnectionNotice::Connecting,
        }
    }
}

impl SessionObserver for BackgroundSession {
    fn observe(&mut self, event: &ClientEvent) {
        let notice = match event {
            ClientEvent::Progress(ConnectionStage::Ready) => ConnectionNotice::Connected,
            ClientEvent::Progress(ConnectionStage::ConnectingLogin) => ConnectionNotice::Connecting,
            ClientEvent::Reconnecting { .. } => ConnectionNotice::Reconnecting,
            _ => return,
        };
        if notice != self.notice {
            self.app
                .state::<SessionService<tauri::Wry>>()
                .update(&self.id, notice);
            self.notice = notice;
        }
    }
}

impl Drop for BackgroundSession {
    fn drop(&mut self) {
        self.app.state::<SessionService<tauri::Wry>>().end(&self.id);
        if let Ok(mut current) = self.control.current.lock() {
            if current.as_ref().is_some_and(|(id, _)| id == &self.id) {
                *current = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_notification_cannot_cancel_a_new_session() {
        let control = BackgroundControl::default();
        let token = CancellationToken::default();
        *control.current.lock().unwrap() = Some(("new-session".into(), token.clone()));
        control.handle(ControlEvent::Stop {
            session_id: "old-session".into(),
        });
        assert!(!token.is_cancelled());
        control.handle(ControlEvent::Stop {
            session_id: "new-session".into(),
        });
        assert!(token.is_cancelled());
    }
}
