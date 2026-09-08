use p99_logger_client::client::{
    CancellationToken, Client, ClientConfig, ClientEvent, ClientIdentity, RunOptions,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    thread::{self, JoinHandle},
};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Server {
    Green,
    Blue,
}

impl Server {
    fn name(self) -> &'static str {
        match self {
            Self::Green => "Project 1999: Green (Velious, PvE)",
            Self::Blue => "Project 1999: Blue (Velious, PvE)",
        }
    }
}

// Credentials are accepted over local IPC and are never logged or persisted.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectRequest {
    pub user: String,
    pub pass: String,
    pub character: String,
    pub server: Server,
}

#[derive(Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum AppEvent {
    Client(ClientEvent),
    Finished { error: Option<String> },
}

struct Worker {
    cancel: CancellationToken,
    thread: JoinHandle<()>,
}

/// Owns one network worker and stops it before another session can start.
#[derive(Default)]
pub struct SessionController {
    worker: Mutex<Option<Worker>>,
    cancellation: Mutex<Option<CancellationToken>>,
}

impl SessionController {
    /// Start a single session; the event sink runs on the network worker.
    pub fn start(
        &self,
        request: ConnectRequest,
        mut send: impl FnMut(AppEvent) -> Result<(), String> + Send + 'static,
    ) -> Result<(), String> {
        let config = ClientConfig::new(
            request.user,
            request.pass,
            request.server.name(),
            request.character,
        );
        let identity = ClientIdentity {
            hostname: format!("P99-{}", std::env::consts::OS),
            username: "mobile".into(),
        };
        let client = Client::new(config, identity).map_err(|error| error.to_string())?;
        let mut slot = self
            .worker
            .lock()
            .map_err(|_| "Session state unavailable")?;
        if slot
            .as_ref()
            .is_some_and(|worker| !worker.thread.is_finished())
        {
            return Err("Disconnect the current session first.".into());
        }
        if let Some(previous) = slot.take() {
            previous
                .thread
                .join()
                .map_err(|_| "Previous session worker failed")?;
        }
        let cancel = CancellationToken::default();
        *self
            .cancellation
            .lock()
            .map_err(|_| "Session state unavailable")? = Some(cancel.clone());
        let worker_cancel = cancel.clone();
        let worker = thread::Builder::new()
            .name("p99-session".into())
            .spawn(move || {
                let outcome = client.run(&worker_cancel, RunOptions::default(), |event| {
                    send(AppEvent::Client(event)).map_err(anyhow::Error::msg)
                });
                let _ = send(AppEvent::Finished {
                    error: outcome.err().map(|error| error.to_string()),
                });
            })
            .map_err(|error| error.to_string())?;
        *slot = Some(Worker {
            cancel,
            thread: worker,
        });
        Ok(())
    }

    /// Signal shutdown without waiting for a worker that may still be closing.
    pub fn cancel(&self) {
        if let Ok(token) = self.cancellation.lock() {
            if let Some(token) = token.as_ref() {
                token.cancel();
            }
        }
    }

    /// Close and join the current worker before permitting another connection.
    /// Call from a blocking task, since platform DNS resolution can delay exit.
    pub fn stop(&self) -> Result<(), String> {
        let mut slot = self
            .worker
            .lock()
            .map_err(|_| "Session state unavailable")?;
        if let Some(worker) = slot.take() {
            worker.cancel.cancel();
            worker
                .thread
                .join()
                .map_err(|_| "Session worker failed during shutdown")?;
        }
        Ok(())
    }
}

impl Drop for SessionController {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ConnectRequest {
        ConnectRequest {
            user: "EXAMPLE_ACCOUNT".into(),
            pass: "EXAMPLE_PASSWORD".into(),
            character: "ExampleCharacter".into(),
            server: Server::Green,
        }
    }

    #[test]
    fn invalid_configuration_does_not_start_a_worker_or_disclose_credentials() {
        let controller = SessionController::default();
        let mut config = request();
        config.character = String::new();
        let error = controller
            .start(config, |_| panic!("no events before validation"))
            .unwrap_err();
        assert!(!error.contains("EXAMPLE_ACCOUNT") && !error.contains("EXAMPLE_PASSWORD"));
        assert!(controller.worker.lock().unwrap().is_none());
    }

    #[test]
    fn lifecycle_cancellation_does_not_wait_for_the_worker_lock() {
        let controller = SessionController::default();
        let token = CancellationToken::default();
        *controller.cancellation.lock().unwrap() = Some(token.clone());
        let _busy = controller.worker.lock().unwrap();
        controller.cancel();
        assert!(token.is_cancelled());
    }
}
