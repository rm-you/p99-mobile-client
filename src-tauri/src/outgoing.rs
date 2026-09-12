use p99_logger_client::{
    chat::OutboundChat,
    client::{CancellationToken, ClientCommand, ClientEvent, ConnectionState},
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};

// Match Titanium's message/recipient limits in the networking crate. Its encoder
// is private, so validate here to return useful errors before enqueueing a command.
const MAX_MESSAGE_BYTES: usize = 4095;
const QUEUE_SIZE: usize = 8;

/// Only channels supported by this app are accepted across the UI boundary.
#[derive(Deserialize)]
#[serde(tag = "channel", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatMessage {
    Say { text: String },
    Tell { recipient: String, text: String },
    Guild { text: String },
    Auction { text: String },
    Ooc { text: String },
    Shout { text: String },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendChatRequest {
    pub session_id: String,
    pub message: ChatMessage,
}

/// Stable error codes never echo message contents or transport diagnostics.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SendFailure {
    NotConnected,
    InvalidMessage,
    MessageTooLong,
    InvalidRecipient,
    QueueFull,
}

impl ChatMessage {
    /// Multiline composition produces one chat message, with line breaks replaced by spaces.
    fn into_outbound(self) -> Result<OutboundChat, SendFailure> {
        fn text(value: String) -> Result<String, SendFailure> {
            let value = value.replace("\r\n", " ").replace(['\r', '\n'], " ");
            let value = value.trim();
            if value.is_empty() || value.chars().any(char::is_control) {
                return Err(SendFailure::InvalidMessage);
            }
            if value.len() > MAX_MESSAGE_BYTES {
                return Err(SendFailure::MessageTooLong);
            }
            Ok(value.into())
        }
        Ok(match self {
            Self::Say { text: value } => OutboundChat::Say(text(value)?),
            Self::Guild { text: value } => OutboundChat::Guild(text(value)?),
            Self::Auction { text: value } => OutboundChat::Auction(text(value)?),
            Self::Ooc { text: value } => OutboundChat::Ooc(text(value)?),
            Self::Shout { text: value } => OutboundChat::Shout(text(value)?),
            Self::Tell {
                recipient,
                text: value,
            } => {
                let recipient = recipient.trim();
                if recipient.is_empty()
                    || recipient.len() >= 64
                    || !recipient.bytes().all(|c| c.is_ascii_alphabetic())
                {
                    return Err(SendFailure::InvalidRecipient);
                }
                OutboundChat::Tell {
                    recipient: recipient.into(),
                    message: text(value)?,
                }
            }
        })
    }
}

struct InputState {
    sender: mpsc::SyncSender<ClientCommand>,
    cancel: CancellationToken,
    session_id: Option<String>,
    last_status: Option<(Instant, Duration)>,
}

/// Bounded, session-bound input. Sending never waits for the network worker's lifecycle lock.
#[derive(Default)]
pub struct ChatOutbox(Mutex<Option<InputState>>);

pub struct CommandInbox {
    outbox: Arc<ChatOutbox>,
    pub receiver: mpsc::Receiver<ClientCommand>,
}

impl ChatOutbox {
    /// Called only after the previous worker has joined; a new session gets a fresh queue.
    pub fn open(self: &Arc<Self>, cancel: CancellationToken) -> CommandInbox {
        let (sender, receiver) = mpsc::sync_channel(QUEUE_SIZE);
        *self.0.lock().expect("chat input lock poisoned") = Some(InputState {
            sender,
            cancel,
            session_id: None,
            last_status: None,
        });
        CommandInbox {
            outbox: self.clone(),
            receiver,
        }
    }

    /// Success means accepted by the local queue, not acknowledged by the game server.
    pub fn send(&self, request: SendChatRequest) -> Result<(), SendFailure> {
        let message = request.message.into_outbound()?;
        let state = self.0.lock().map_err(|_| SendFailure::NotConnected)?;
        let input = state.as_ref().ok_or(SendFailure::NotConnected)?;
        if input.cancel.is_cancelled()
            || input.session_id.as_deref() != Some(request.session_id.as_str())
            || !input
                .last_status
                .is_some_and(|(at, silence)| at.elapsed() + silence < Duration::from_secs(60))
        {
            return Err(SendFailure::NotConnected);
        }
        input
            .sender
            .try_send(ClientCommand::SendChat(message))
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => SendFailure::QueueFull,
                mpsc::TrySendError::Disconnected(_) => SendFailure::NotConnected,
            })
    }
}

impl CommandInbox {
    /// Discard pending messages as soon as a connection ends; never replay them after reconnect.
    pub fn observe(&self, event: &ClientEvent) {
        let (session_id, silence) = match event {
            ClientEvent::Status(status) if status.state == ConnectionState::Connected => (
                Some(status.session_id.clone()),
                status.last_received_seconds.map(Duration::from_secs),
            ),
            ClientEvent::Status(_) | ClientEvent::Reconnecting { .. } => (None, None),
            _ => return,
        };
        if let Ok(mut state) = self.outbox.0.lock() {
            if let Some(input) = state.as_mut() {
                if session_id.is_none() || session_id != input.session_id {
                    // The consumer and this callback run serially on the same worker.
                    self.receiver.try_iter().for_each(drop);
                }
                input.session_id = session_id;
                input.last_status = silence.map(|seconds| (Instant::now(), seconds));
            }
        }
    }
}

impl Drop for CommandInbox {
    fn drop(&mut self) {
        if let Ok(mut input) = self.outbox.0.lock() {
            *input = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p99_logger_client::client::SessionStatus;

    fn status(state: ConnectionState, id: &str) -> ClientEvent {
        ClientEvent::Status(SessionStatus {
            state,
            timestamp: 0,
            session_id: id.into(),
            zone: "example".into(),
            messages: 0,
            packets: 1,
            last_received_seconds: Some(0),
        })
    }
    fn request(id: &str) -> SendChatRequest {
        SendChatRequest {
            session_id: id.into(),
            message: ChatMessage::Say {
                text: "example message".into(),
            },
        }
    }

    #[test]
    fn ui_messages_map_to_typed_commands_and_reject_unsupported_channels() {
        let examples = [
            ("say", OutboundChat::Say("example".into())),
            ("guild", OutboundChat::Guild("example".into())),
            ("auction", OutboundChat::Auction("example".into())),
            ("ooc", OutboundChat::Ooc("example".into())),
            ("shout", OutboundChat::Shout("example".into())),
        ];
        for (channel, expected) in examples {
            let message: ChatMessage =
                serde_json::from_value(serde_json::json!({"channel": channel, "text": "example"}))
                    .unwrap();
            assert_eq!(message.into_outbound().unwrap(), expected);
        }
        let message: ChatMessage = serde_json::from_value(serde_json::json!({"channel": "tell", "recipient": " ExampleFriend ", "text": "one\r\ntwo\nthree"})).unwrap();
        assert_eq!(
            message.into_outbound().unwrap(),
            OutboundChat::Tell {
                recipient: "ExampleFriend".into(),
                message: "one two three".into()
            }
        );
        for channel in ["group", "raid", "emote", "system"] {
            assert!(serde_json::from_value::<ChatMessage>(
                serde_json::json!({"channel": channel, "text": "example"})
            )
            .is_err());
        }
    }

    #[test]
    fn validates_utf8_byte_limits_and_never_echoes_rejected_text() {
        for value in ["", " \n ", "example\0private", "example\tprivate"] {
            assert_eq!(
                ChatMessage::Say { text: value.into() }.into_outbound(),
                Err(SendFailure::InvalidMessage)
            );
        }
        assert_eq!(
            ChatMessage::Say {
                text: "é".repeat(2048)
            }
            .into_outbound(),
            Err(SendFailure::MessageTooLong)
        );
        assert!(ChatMessage::Say {
            text: "x".repeat(4095)
        }
        .into_outbound()
        .is_ok());
        for name in [
            "",
            " ",
            "Example Friend",
            "Friend\0",
            "Friend2",
            &"x".repeat(64),
        ] {
            assert_eq!(
                ChatMessage::Tell {
                    recipient: name.into(),
                    text: "example".into()
                }
                .into_outbound(),
                Err(SendFailure::InvalidRecipient)
            );
        }
        assert_eq!(
            serde_json::to_string(&SendFailure::InvalidMessage).unwrap(),
            "\"invalid_message\""
        );
    }

    #[test]
    fn accepts_only_the_current_connected_session_and_drops_pending_on_disconnect() {
        let outbox = Arc::new(ChatOutbox::default());
        assert_eq!(
            outbox.send(request("first")),
            Err(SendFailure::NotConnected)
        );
        let inbox = outbox.open(CancellationToken::default());
        assert_eq!(
            outbox.send(request("first")),
            Err(SendFailure::NotConnected)
        );
        inbox.observe(&status(ConnectionState::Connected, "first"));
        outbox.send(request("first")).unwrap();
        assert_eq!(
            inbox.receiver.try_recv().unwrap(),
            ClientCommand::SendChat(OutboundChat::Say("example message".into()))
        );
        outbox.send(request("first")).unwrap();
        inbox.observe(&status(ConnectionState::Disconnected, "first"));
        assert!(inbox.receiver.try_recv().is_err());
        assert_eq!(
            outbox.send(request("first")),
            Err(SendFailure::NotConnected)
        );
        inbox.observe(&status(ConnectionState::Connected, "second"));
        assert_eq!(
            outbox.send(request("first")),
            Err(SendFailure::NotConnected)
        );
        assert!(inbox.receiver.try_recv().is_err());
        outbox.send(request("second")).unwrap();
        drop(inbox);
        assert_eq!(
            outbox.send(request("second")),
            Err(SendFailure::NotConnected)
        );
    }

    #[test]
    fn rejects_full_queues_cancelled_sessions_and_stale_health_without_blocking() {
        let outbox = Arc::new(ChatOutbox::default());
        let cancel = CancellationToken::default();
        let inbox = outbox.open(cancel.clone());
        inbox.observe(&status(ConnectionState::Connected, "first"));
        for _ in 0..QUEUE_SIZE {
            outbox.send(request("first")).unwrap();
        }
        assert_eq!(outbox.send(request("first")), Err(SendFailure::QueueFull));
        inbox.receiver.try_iter().for_each(drop);
        outbox.0.lock().unwrap().as_mut().unwrap().last_status =
            Some((Instant::now(), Duration::from_secs(60)));
        assert_eq!(
            outbox.send(request("first")),
            Err(SendFailure::NotConnected)
        );
        inbox.observe(&status(ConnectionState::Connected, "first"));
        cancel.cancel();
        assert_eq!(
            outbox.send(request("first")),
            Err(SendFailure::NotConnected)
        );
    }
}
