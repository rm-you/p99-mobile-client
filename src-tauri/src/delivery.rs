use crate::session::AppEvent;
use p99_logger_client::client::ClientEvent;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tauri::ipc::Channel;

const MAX_RECORDS: usize = 1500;

/// Retain chat while the webview is suspended, coalescing transient status updates.
#[derive(Default)]
struct PendingEvents(VecDeque<AppEvent>);

impl PendingEvents {
    fn same_kind(a: &AppEvent, b: &AppEvent) -> bool {
        match (a, b) {
            (AppEvent::Client(a), AppEvent::Client(b)) => {
                std::mem::discriminant(a) == std::mem::discriminant(b)
            }
            _ => std::mem::discriminant(a) == std::mem::discriminant(b),
        }
    }

    /// A failed in-flight event is older than everything enqueued while it was sending.
    fn restore(&mut self, event: AppEvent) {
        let superseded = match &event {
            AppEvent::Client(ClientEvent::Record(_)) => {
                self.0
                    .iter()
                    .filter(|e| matches!(e, AppEvent::Client(ClientEvent::Record(_))))
                    .count()
                    >= MAX_RECORDS
            }
            _ => self.0.iter().any(|newer| Self::same_kind(newer, &event)),
        };
        if !superseded {
            self.0.push_front(event);
        }
    }

    fn push(&mut self, event: AppEvent) {
        match &event {
            AppEvent::Client(ClientEvent::Diagnostic(_)) => return,
            AppEvent::Client(ClientEvent::Record(_)) => {
                let records = self
                    .0
                    .iter()
                    .filter(|e| matches!(e, AppEvent::Client(ClientEvent::Record(_))))
                    .count();
                if records >= MAX_RECORDS {
                    if let Some(index) = self
                        .0
                        .iter()
                        .position(|e| matches!(e, AppEvent::Client(ClientEvent::Record(_))))
                    {
                        self.0.remove(index);
                    }
                }
            }
            _ => self.0.retain(|old| !Self::same_kind(old, &event)),
        }
        self.0.push_back(event);
    }
}

#[derive(Default)]
struct DeliveryState {
    hidden: bool,
    draining: bool,
    generation: u64,
    channel: Option<Channel<AppEvent>>,
    pending: PendingEvents,
}

/// One sink shared by the worker and native visibility callbacks; never grows with time hidden.
#[derive(Default)]
pub struct EventDelivery(Mutex<DeliveryState>);

impl EventDelivery {
    pub fn is_hidden(&self) -> bool {
        self.0.lock().map(|s| s.hidden).unwrap_or(true)
    }
    /// Replace the UI subscription only after the previous network worker has finished.
    pub fn attach(&self, channel: Channel<AppEvent>) {
        if let Ok(mut state) = self.0.lock() {
            state.generation = state.generation.wrapping_add(1);
            state.channel = Some(channel);
            state.pending.0.clear();
        }
    }

    /// Background retention must not depend on JavaScript receiving or acknowledging events.
    pub fn publish(self: &Arc<Self>, event: AppEvent) {
        if matches!(event, AppEvent::Client(ClientEvent::Diagnostic(_))) {
            return;
        }
        if let Ok(mut state) = self.0.lock() {
            state.pending.push(event);
            self.schedule(&mut state);
        }
    }

    /// Replay bounded pending events in order when the app becomes visible again.
    pub fn set_visible(self: &Arc<Self>, visible: bool) {
        if let Ok(mut state) = self.0.lock() {
            state.hidden = !visible;
            self.schedule(&mut state);
        }
    }

    fn schedule(self: &Arc<Self>, state: &mut DeliveryState) {
        if !state.hidden
            && !state.draining
            && state.channel.is_some()
            && !state.pending.0.is_empty()
        {
            state.draining = true;
            let delivery = self.clone();
            tauri::async_runtime::spawn_blocking(move || delivery.drain());
        }
    }

    /// Serialize IPC on a worker; never hold the queue lock while calling the webview.
    fn drain(&self) {
        loop {
            let (channel, event, generation) = {
                let Ok(mut state) = self.0.lock() else {
                    return;
                };
                if state.hidden || state.pending.0.is_empty() || state.channel.is_none() {
                    state.draining = false;
                    return;
                }
                (
                    state.channel.as_ref().unwrap().clone(),
                    state.pending.0.pop_front().unwrap(),
                    state.generation,
                )
            };
            if channel.send(event.clone()).is_err() {
                let Ok(mut state) = self.0.lock() else {
                    return;
                };
                if generation == state.generation {
                    state.pending.restore(event);
                    state.hidden = true;
                    state.draining = false;
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p99_logger_client::client::ConnectionStage;
    use std::{sync::mpsc, time::Duration};

    fn record(id: u64) -> AppEvent {
        use p99_logger_client::{
            chat,
            client::{Record, RecordEvent},
        };
        AppEvent::Client(ClientEvent::Record(Box::new(Record {
            timestamp: "2026-01-01T00:00:00Z".into(),
            server: "Example server".into(),
            character: "ExampleCharacter".into(),
            zone: "example".into(),
            session_id: "synthetic".into(),
            message_id: id,
            event: RecordEvent::Chat(
                chat::parse(0x024d, b"Example message\0", false)
                    .unwrap()
                    .unwrap(),
            ),
        })))
    }

    #[test]
    fn suspended_view_receives_only_the_latest_bounded_history_on_resume() {
        let (output, received) = mpsc::channel();
        let delivery = Arc::new(EventDelivery::default());
        delivery.attach(Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(body) = body else {
                panic!("expected JSON")
            };
            output
                .send(serde_json::from_str::<serde_json::Value>(&body).unwrap())
                .unwrap();
            Ok(())
        }));
        delivery.set_visible(false);
        for id in 0..1510 {
            delivery.publish(record(id));
        }
        delivery.publish(AppEvent::Finished { error: None });
        assert!(received.try_recv().is_err());
        assert_eq!(delivery.0.lock().unwrap().pending.0.len(), MAX_RECORDS + 1);
        delivery.set_visible(true);
        let received: Vec<_> = (0..=MAX_RECORDS)
            .map(|_| received.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect();
        assert_eq!(received.len(), MAX_RECORDS + 1);
        assert_eq!(received[0]["data"]["data"]["message_id"], 10);
        assert_eq!(
            received[MAX_RECORDS - 1]["data"]["data"]["message_id"],
            1509
        );
        assert_eq!(received[MAX_RECORDS]["type"], "finished");
        assert!(delivery.0.lock().unwrap().pending.0.is_empty());
    }

    #[test]
    fn a_slow_view_cannot_block_network_publishers_or_visibility_changes() {
        let delivery = Arc::new(EventDelivery::default());
        let (entered, waiting) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let gate = Mutex::new(gate);
        delivery.attach(Channel::new(move |_| {
            entered.send(()).unwrap();
            let _ = gate.lock().unwrap().recv_timeout(Duration::from_secs(3));
            Ok(())
        }));
        delivery.publish(record(1));
        waiting.recv_timeout(Duration::from_secs(3)).unwrap();
        let (done, check) = mpsc::channel();
        let worker = delivery.clone();
        let publisher = std::thread::spawn(move || {
            worker.set_visible(false);
            worker.publish(record(2));
            done.send(()).unwrap();
        });
        let responsive = check.recv_timeout(Duration::from_secs(1)).is_ok();
        release.send(()).unwrap();
        publisher.join().unwrap();
        assert!(
            responsive,
            "IPC held the queue lock or ran on the publisher"
        );
        assert_eq!(delivery.0.lock().unwrap().pending.0.len(), 1);
    }

    #[test]
    fn hidden_status_is_coalesced_and_finished_is_retained() {
        let mut pending = PendingEvents::default();
        for _ in 0..10000 {
            pending.push(AppEvent::Client(ClientEvent::Progress(
                ConnectionStage::ConnectingLogin,
            )));
            pending.push(AppEvent::Client(ClientEvent::Reconnecting {
                error: "example".into(),
                delay_seconds: 1,
            }));
            pending.push(AppEvent::Client(ClientEvent::Diagnostic(
                "not retained".into(),
            )));
        }
        pending.push(AppEvent::Client(ClientEvent::Progress(
            ConnectionStage::Ready,
        )));
        pending.push(AppEvent::Finished { error: None });
        assert_eq!(pending.0.len(), 3);
        assert!(matches!(
            pending.0.back(),
            Some(AppEvent::Finished { error: None })
        ));
        assert!(matches!(
            pending.0.get(1),
            Some(AppEvent::Client(ClientEvent::Progress(
                ConnectionStage::Ready
            )))
        ));
    }
}
