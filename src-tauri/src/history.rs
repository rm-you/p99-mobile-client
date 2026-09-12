use crate::experience::Experience;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const ERROR: &str = "Chat history is unavailable. Check free space or clear saved history.";
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryOwner {
    pub server: String,
    pub character: String,
}
impl HistoryOwner {
    pub fn validate(&self) -> Result<(), String> {
        if !["green", "blue", "quarm"].contains(&self.server.as_str())
            || self.character.is_empty()
            || self.character.len() > 63
            || !self.character.bytes().all(|b| b.is_ascii_alphabetic())
        {
            return Err("Choose a valid character and server.".into());
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct HistoryProfile {
    pub server: String,
    pub character: String,
    pub messages: u32,
}
#[derive(Clone, Serialize)]
pub struct Alert {
    pub title: String,
    pub body: String,
}
struct Inner {
    connection: Option<Connection>,
    options: Experience,
    last_alert: Option<Instant>,
    storage_error: bool,
    received: u64,
    reconnects: u64,
}
pub struct Recorded {
    pub alert: Option<Alert>,
    pub history_failed: bool,
}
pub struct ChatStore {
    path: PathBuf,
    inner: Mutex<Inner>,
}
fn seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
impl ChatStore {
    pub fn new(path: PathBuf, options: Experience) -> Self {
        Self {
            path,
            inner: Mutex::new(Inner {
                connection: None,
                options,
                last_alert: None,
                storage_error: false,
                received: 0,
                reconnects: 0,
            }),
        }
    }
    fn open<'a>(&self, inner: &'a mut Inner) -> Result<&'a mut Connection, String> {
        if inner.connection.is_none() {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent).map_err(|_| ERROR)?;
            }
            let conn = Connection::open(&self.path).map_err(|_| ERROR)?;
            conn.execute_batch("PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE;
            CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,server TEXT NOT NULL,character TEXT NOT NULL COLLATE NOCASE,received INTEGER NOT NULL,session TEXT NOT NULL,message_id INTEGER NOT NULL,record TEXT NOT NULL,UNIQUE(server,character,session,message_id));
            CREATE INDEX IF NOT EXISTS history_owner ON messages(server,character,id);").map_err(|_|ERROR)?;
            inner.connection = Some(conn);
        }
        inner.connection.as_mut().ok_or_else(|| ERROR.into())
    }
    fn prune(conn: &Connection, options: &Experience, now: i64) -> rusqlite::Result<()> {
        conn.execute(
            "DELETE FROM messages WHERE received < ?1",
            [now - i64::from(options.history_days) * 86400],
        )?;
        conn.execute("DELETE FROM messages WHERE id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY server,character ORDER BY id DESC) AS row FROM messages) WHERE row>?1)",[options.history_limit])?;
        // A device-wide ceiling also bounds retention across many characters.
        conn.execute("DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT 20000)",[])?;
        Ok(())
    }
    pub fn configure(&self, options: Experience) -> Result<(), String> {
        options.validate()?;
        let mut inner = self.inner.lock().map_err(|_| ERROR)?;
        inner.options = options.clone();
        if self.path.exists() {
            Self::prune(self.open(&mut inner)?, &options, seconds()).map_err(|_| ERROR)?;
        }
        Ok(())
    }
    /// Persist on the worker before UI buffering, retaining the complete structured chat record.
    pub fn record(
        &self,
        owner: &HistoryOwner,
        value: &Value,
        hidden: bool,
    ) -> Result<Recorded, String> {
        owner.validate()?;
        let mut inner = self.inner.lock().map_err(|_| ERROR)?;
        if value["type"] != "chat"
            || (value["channel_name"] == "guild_motd" && record_text(value).trim().is_empty())
        {
            return Ok(Recorded {
                alert: None,
                history_failed: false,
            });
        }
        inner.received = inner.received.saturating_add(1);
        let alert = notification(&inner.options, value, hidden);
        let alert = if alert.is_some()
            && inner
                .last_alert
                .is_none_or(|t| t.elapsed() >= Duration::from_secs(2))
        {
            inner.last_alert = Some(Instant::now());
            alert
        } else {
            None
        };
        if inner.options.history_enabled {
            let options = inner.options.clone();
            let bytes = serde_json::to_string(value).map_err(|_| ERROR)?;
            let message_id = value["message_id"].as_i64().ok_or(ERROR)?;
            if bytes.len() > 65536 {
                return Err(ERROR.into());
            }
            let result = (|| {
                let conn = self.open(&mut inner)?;
                let tx = conn.transaction().map_err(|_| ERROR)?;
                tx.execute("INSERT OR IGNORE INTO messages(server,character,received,session,message_id,record) VALUES(?1,?2,?3,?4,?5,?6)",params![owner.server,owner.character,seconds(),value["session_id"].as_str().unwrap_or_default(),message_id,bytes]).map_err(|_|ERROR)?;
                Self::prune(&tx, &options, seconds()).map_err(|_| ERROR)?;
                tx.commit().map_err(|_| ERROR)?;
                Ok::<_, String>(())
            })();
            inner.storage_error = result.is_err();
            return Ok(Recorded {
                alert,
                history_failed: result.is_err(),
            });
        }
        Ok(Recorded {
            alert,
            history_failed: false,
        })
    }
    pub fn reconnect(&self) {
        if let Ok(mut s) = self.inner.lock() {
            s.reconnects = s.reconnects.saturating_add(1);
        }
    }
    pub fn profiles(&self) -> Result<Vec<HistoryProfile>, String> {
        let mut inner = self.inner.lock().map_err(|_| ERROR)?;
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let options = inner.options.clone();
        let conn = self.open(&mut inner)?;
        Self::prune(conn, &options, seconds()).map_err(|_| ERROR)?;
        let mut stmt=conn.prepare("SELECT server,character,COUNT(*) FROM messages GROUP BY server,character ORDER BY MAX(id) DESC").map_err(|_|ERROR)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(HistoryProfile {
                    server: r.get(0)?,
                    character: r.get(1)?,
                    messages: r.get(2)?,
                })
            })
            .map_err(|_| ERROR)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| ERROR.into())
    }
    pub fn load(&self, owner: &HistoryOwner, limit: u32) -> Result<Vec<Value>, String> {
        owner.validate()?;
        let mut inner = self.inner.lock().map_err(|_| ERROR)?;
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let options = inner.options.clone();
        let conn = self.open(&mut inner)?;
        Self::prune(conn, &options, seconds()).map_err(|_| ERROR)?;
        let mut stmt=conn.prepare("SELECT record FROM (SELECT id,record FROM messages WHERE server=?1 AND character=?2 ORDER BY id DESC LIMIT ?3) ORDER BY id").map_err(|_|ERROR)?;
        let rows = stmt
            .query_map(
                params![owner.server, owner.character, limit.min(10000)],
                |r| r.get::<_, String>(0),
            )
            .map_err(|_| ERROR)?;
        let mut output = vec![];
        let mut total = 0;
        for row in rows {
            let row = row.map_err(|_| ERROR)?;
            total += row.len();
            if total > 20_000_000 {
                return Err(
                    "History is too large to export. Reduce retention and try again.".into(),
                );
            }
            output.push(serde_json::from_str(&row).map_err(|_| ERROR)?);
        }
        Ok(output)
    }
    pub fn clear(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| ERROR)?;
        if !self.path.exists() {
            return Ok(());
        }
        self.open(&mut inner)?
            .execute_batch("DELETE FROM messages; VACUUM;")
            .map_err(|_| ERROR)?;
        inner.storage_error = false;
        Ok(())
    }
    /// Diagnostics are a fixed allowlist, excluding names, messages, paths and raw errors.
    pub fn diagnostics(&self) -> Value {
        let Ok(s) = self.inner.lock() else {
            return serde_json::json!({"storage_available":false});
        };
        serde_json::json!({"history_enabled":s.options.history_enabled,"history_days":s.options.history_days,"history_limit":s.options.history_limit,"storage_error":s.storage_error,"messages_received":s.received,"reconnects":s.reconnects,"tell_alerts":s.options.notify_tells,"guild_alerts":s.options.notify_guild,"keyword_alert_count":s.options.notify_keywords.len()})
    }
}
/// Text exports retain formatted-message arguments; JSONL retains their structured links.
pub fn record_text(value: &Value) -> String {
    if let Some(text) = value["text"].as_str() {
        return text.into();
    }
    let arguments = value["arguments"]
        .as_array()
        .map(|args| {
            args.iter()
                .filter_map(|arg| arg["text"].as_str())
                .collect::<Vec<_>>()
                .join(" · ")
        })
        .unwrap_or_default();
    match value["string_id"].as_u64() {
        Some(id) => format!("Game message #{id}: {arguments}"),
        None => arguments,
    }
}
/// Match only incoming authored messages while hidden; muted authors never alert.
fn notification(options: &Experience, record: &Value, hidden: bool) -> Option<Alert> {
    let sender = record["sender"].as_str()?;
    let text = record_text(record);
    if !hidden
        || sender.is_empty()
        || text.is_empty()
        || record["character"]
            .as_str()
            .is_some_and(|s| s.eq_ignore_ascii_case(sender))
        || options
            .muted_authors
            .iter()
            .any(|s| s.eq_ignore_ascii_case(sender))
    {
        return None;
    }
    let channel = record["channel_name"].as_str().unwrap_or_default();
    let tell = record["channel"].as_u64() == Some(7) || channel == "tell";
    let guild = channel == "guild";
    let keyword = options
        .notify_keywords
        .iter()
        .any(|k| text.to_lowercase().contains(&k.to_lowercase()));
    if !(tell && options.notify_tells || guild && options.notify_guild || keyword) {
        return None;
    }
    Some(Alert {
        title: if options.notification_previews {
            format!(
                "{} · {}",
                sender,
                if tell {
                    "Tell"
                } else if guild {
                    "Guild"
                } else {
                    "Chat"
                }
            )
        } else if tell {
            "New tell".into()
        } else {
            "New chat message".into()
        },
        body: if options.notification_previews {
            text.chars().take(240).collect()
        } else {
            "Open P99 Mobile Chat to read it.".into()
        },
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn owner(server: &str) -> HistoryOwner {
        HistoryOwner {
            server: server.into(),
            character: "ExampleCharacter".into(),
        }
    }
    fn record(id: u64) -> Value {
        serde_json::json!({"type":"chat","session_id":"synthetic","message_id":id,"character":"ExampleCharacter","sender":"ExampleFriend","channel":7,"channel_name":"tell","text":"Example message","item_links":[{"body":"synthetic","item_id":123}]})
    }
    #[test]
    fn retention_is_opt_in_deduplicated_and_isolated() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("history.sqlite");
        let s = ChatStore::new(p.clone(), Experience::default());
        s.record(&owner("green"), &record(1), false).unwrap();
        assert!(!p.exists());
        s.configure(Experience {
            history_enabled: true,
            ..Experience::default()
        })
        .unwrap();
        s.record(&owner("green"), &record(1), false).unwrap();
        s.record(&owner("green"), &record(1), false).unwrap();
        s.record(&owner("blue"), &record(2), false).unwrap();
        let mut quarm = record(1);
        quarm["text"] = "Quarm message".into();
        quarm["item_links"][0]["body"] = "0000123".into();
        s.record(&owner("quarm"), &quarm, false).unwrap();
        let reopened = ChatStore::new(p, Experience::default());
        let rows = reopened.load(&owner("green"), 1500).unwrap();
        assert_eq!(rows, vec![record(1)]);
        assert_eq!(reopened.load(&owner("quarm"), 1500).unwrap(), vec![quarm]);
        assert_eq!(reopened.profiles().unwrap().len(), 3);
        reopened.clear().unwrap();
        assert!(reopened.profiles().unwrap().is_empty());
    }
    #[test]
    fn failed_history_write_does_not_suppress_an_incoming_alert() {
        let dir = tempfile::tempdir().unwrap();
        let store = ChatStore::new(
            dir.path().to_path_buf(),
            Experience {
                history_enabled: true,
                notify_tells: true,
                ..Default::default()
            },
        );
        let outcome = store.record(&owner("green"), &record(1), true).unwrap();
        assert!(outcome.history_failed);
        assert!(outcome.alert.is_some());
    }
    #[test]
    fn limits_and_age_are_applied() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(id INTEGER PRIMARY KEY,server TEXT,character TEXT,received INTEGER);").unwrap();
        for id in 1..=6 {
            conn.execute(
                "INSERT INTO messages VALUES(?1,'green','Example',?2)",
                params![id, if id == 6 { 0 } else { 1000000 }],
            )
            .unwrap();
        }
        let options = Experience {
            history_limit: 2,
            history_days: 1,
            ..Experience::default()
        };
        ChatStore::prune(&conn, &options, 1000000).unwrap();
        let ids = conn
            .prepare("SELECT id FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids, vec![4, 5]);
    }
    #[test]
    fn alerts_exclude_own_muted_foreground_and_unselected_chat() {
        let r = record(1);
        let mut opts = Experience {
            notify_tells: true,
            ..Experience::default()
        };
        assert!(notification(&opts, &r, true).is_some());
        assert!(notification(&opts, &r, false).is_none());
        let alert = notification(&opts, &r, true).unwrap();
        assert!(!alert.title.contains("Example"));
        opts.muted_authors.push("examplefriend".into());
        assert!(notification(&opts, &r, true).is_none());
        opts.muted_authors.clear();
        let mut own = r.clone();
        own["sender"] = "ExampleCharacter".into();
        assert!(notification(&opts, &own, true).is_none());
        assert!(notification(&Experience::default(), &r, true).is_none());
    }
}
