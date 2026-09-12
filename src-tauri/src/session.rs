use crate::outgoing::ChatOutbox;
use p99_logger_client::client::{
    CancellationToken, Client, ClientConfig, ClientEvent, ClientIdentity, LoginError, RunOptions,
    ServerProtocol,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    thread::{self, JoinHandle},
};

pub use tauri_plugin_secure_login::Server;

/// Select both the wire protocol and its registered world name before starting a worker.
fn client_config(request: ConnectRequest) -> ClientConfig {
    let (protocol, world) = match request.server {
        Server::Green => (
            ServerProtocol::Project1999,
            "Project 1999: Green (Velious, PvE)",
        ),
        Server::Blue => (
            ServerProtocol::Project1999,
            "Project 1999: Blue (Velious, PvE)",
        ),
        // TAKP appends " Server" to the registered world name, which already ends in "Server".
        Server::Quarm => (ServerProtocol::Quarm, "The Project Quarm Server Server"),
    };
    ClientConfig::for_protocol(
        protocol,
        request.user,
        request.pass,
        world,
        request.character,
    )
}

// Manual credentials arrive over local IPC and are never logged.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectRequest {
    pub user: String,
    pub pass: String,
    pub character: String,
    pub server: Server,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum AppEvent {
    Client(ClientEvent),
    HistoryError,
    Background(tauri_plugin_session_service::BackgroundStatus),
    Finished { error: Option<SessionFailure> },
}

/// Stable UI failure codes; transport details and credentials stay out of the webview.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionFailure {
    InvalidCredentials,
    ConnectionLost,
}

impl SessionFailure {
    fn from_error(error: &anyhow::Error) -> Self {
        match error.downcast_ref::<LoginError>() {
            Some(LoginError::InvalidCredentials) => Self::InvalidCredentials,
            None => Self::ConnectionLost,
        }
    }
}

struct Worker {
    cancel: CancellationToken,
    thread: JoinHandle<()>,
}

/// Platform support lives exactly as long as the worker, including error unwinding.
pub trait SessionObserver: Send {
    fn observe(&mut self, event: &ClientEvent);
}

impl SessionObserver for () {
    fn observe(&mut self, _event: &ClientEvent) {}
}

/// Owns one network worker and stops it before another session can start.
#[derive(Default)]
pub struct SessionController {
    worker: Mutex<Option<Worker>>,
    cancellation: Mutex<Option<CancellationToken>>,
    pub outbox: Arc<ChatOutbox>,
}

impl SessionController {
    /// Start a single session; the event sink runs on the network worker.
    #[cfg(test)]
    pub fn start(
        &self,
        request: ConnectRequest,
        send: impl FnMut(AppEvent) -> Result<(), String> + Send + 'static,
    ) -> Result<(), String> {
        self.start_with(request, send, |_| ())
    }

    /// Validate and serialize before acquiring platform support, then release it on every exit.
    pub fn start_with<O: SessionObserver + 'static>(
        &self,
        request: ConnectRequest,
        mut send: impl FnMut(AppEvent) -> Result<(), String> + Send + 'static,
        begin: impl FnOnce(CancellationToken) -> O,
    ) -> Result<(), String> {
        let config = client_config(request);
        let protocol = config.protocol;
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
        let inbox = self.outbox.open(cancel.clone(), protocol);
        let mut observer = begin(cancel.clone());
        let worker = thread::Builder::new()
            .name("p99-session".into())
            .spawn(move || {
                let outcome = client.run_with_commands(
                    &worker_cancel,
                    RunOptions::default(),
                    &inbox.receiver,
                    |event| {
                        inbox.observe(&event);
                        observer.observe(&event);
                        send(AppEvent::Client(event)).map_err(anyhow::Error::msg)
                    },
                );
                drop(inbox);
                // The network has closed before the foreground service and wake lock end.
                drop(observer);
                let _ = send(AppEvent::Finished {
                    error: outcome.err().as_ref().map(SessionFailure::from_error),
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
        self.cancel();
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
    fn each_server_uses_its_own_protocol_and_login_endpoint() {
        for (server, protocol, host, port, world) in [
            (
                Server::Green,
                ServerProtocol::Project1999,
                "login.eqemulator.net",
                5998,
                "Project 1999: Green (Velious, PvE)",
            ),
            (
                Server::Blue,
                ServerProtocol::Project1999,
                "login.eqemulator.net",
                5998,
                "Project 1999: Blue (Velious, PvE)",
            ),
            (
                Server::Quarm,
                ServerProtocol::Quarm,
                "loginserver.takproject.net",
                6000,
                "The Project Quarm Server Server",
            ),
        ] {
            let mut request = request();
            request.server = server;
            let config = client_config(request);
            assert_eq!(config.protocol, protocol);
            assert_eq!(config.host, host);
            assert_eq!(config.port, port);
            assert_eq!(config.server, world);
            assert_eq!(config.character, "ExampleCharacter");
            assert!(!config.include_raw);
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
    fn credential_failure_is_typed_and_other_errors_stay_generic() {
        let rejected = anyhow::Error::new(LoginError::InvalidCredentials).context("login failed");
        assert_eq!(
            SessionFailure::from_error(&rejected),
            SessionFailure::InvalidCredentials
        );
        let wire = serde_json::to_value(AppEvent::Finished {
            error: Some(SessionFailure::from_error(&rejected)),
        })
        .unwrap();
        assert_eq!(wire["data"]["error"], "invalid_credentials");
        // An arbitrary diagnostic string must never be treated as a credential verdict.
        let unrelated = anyhow::anyhow!("invalid_credentials: SYNTHETIC_PASSWORD");
        let wire = serde_json::to_string(&AppEvent::Finished {
            error: Some(SessionFailure::from_error(&unrelated)),
        })
        .unwrap();
        assert!(wire.contains("connection_lost") && !wire.contains("SYNTHETIC_PASSWORD"));
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
