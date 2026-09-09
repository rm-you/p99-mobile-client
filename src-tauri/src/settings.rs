use crate::session::Server;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatChannel {
    Auction,
    Ooc,
    Guild,
    Tell,
    // Retired choices remain readable when migrating saved preferences.
    Group,
    Say,
    Shout,
    Raid,
    Emote,
    System,
}
impl ChatChannel {
    const ALL: [Self; 8] = [
        Self::Auction,
        Self::Ooc,
        Self::Guild,
        Self::Tell,
        Self::Say,
        Self::Shout,
        Self::Emote,
        Self::System,
    ];
}

/// Only nonsecret preferences may be persisted in this file.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub version: u8,
    pub server: Server,
    pub character: String,
    pub channels: Vec<ChatChannel>,
    // Accept the retired field in old settings, but never persist UI expansion.
    #[serde(default, rename = "filters_open", skip_serializing)]
    _legacy_filters_open: bool,
    pub follow: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 2,
            server: Server::Green,
            character: String::new(),
            channels: ChatChannel::ALL.to_vec(),
            _legacy_filters_open: false,
            follow: true,
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<(), String> {
        if self.version != 2
            || self.character.len() >= 64
            || self.character.contains('\0')
            || self
                .channels
                .iter()
                .any(|channel| !ChatChannel::ALL.contains(channel))
            || self
                .channels
                .iter()
                .enumerate()
                .any(|(index, channel)| self.channels[..index].contains(channel))
        {
            return Err("Saved settings are invalid or from an unsupported version.".into());
        }
        Ok(())
    }
}

/// Read the old single-channel preference without losing other saved settings.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySettings {
    version: u8,
    server: Server,
    character: String,
    channel: String,
    follow: bool,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredSettings {
    Current(Settings),
    Legacy(LegacySettings),
}
impl StoredSettings {
    fn current(self) -> Result<Settings, String> {
        let mut settings = match self {
            Self::Current(settings) => settings,
            Self::Legacy(old) => {
                if old.version != 1 {
                    return Err("Saved settings are from an unsupported version.".into());
                }
                let channels = if old.channel == "all" {
                    ChatChannel::ALL.to_vec()
                } else {
                    vec![
                        serde_json::from_value(serde_json::Value::String(old.channel))
                            .map_err(|_| "Saved channel preference is invalid.")?,
                    ]
                };
                Settings {
                    server: old.server,
                    character: old.character,
                    channels,
                    follow: old.follow,
                    ..Settings::default()
                }
            }
        };
        settings
            .channels
            .retain(|channel| ChatChannel::ALL.contains(channel));
        settings.validate()?;
        Ok(settings)
    }
}

pub struct SettingsStore {
    path: PathBuf,
    lock: Mutex<()>,
}
impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// Missing settings are normal; corrupt or future files must not be silently reset.
    pub fn load(&self) -> Result<Settings, String> {
        let _guard = self.lock.lock().map_err(|_| "Settings unavailable")?;
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Settings::default())
            }
            Err(_) => return Err("Could not read saved settings.".into()),
        };
        let settings: StoredSettings =
            serde_json::from_slice(&bytes).map_err(|_| "Could not read saved settings.")?;
        settings.current()
    }

    /// Serialize writes and atomically replace the file, including on Windows.
    pub fn save(&self, settings: Settings) -> Result<(), String> {
        settings.validate()?;
        let _guard = self.lock.lock().map_err(|_| "Settings unavailable")?;
        let parent = self.path.parent().ok_or("Settings directory unavailable")?;
        fs::create_dir_all(parent).map_err(|_| "Could not create settings directory")?;
        let mut pending =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not save settings")?;
        let bytes = serde_json::to_vec(&settings).map_err(|_| "Could not encode settings")?;
        pending
            .write_all(&bytes)
            .map_err(|_| "Could not save settings")?;
        pending
            .as_file()
            .sync_all()
            .map_err(|_| "Could not save settings")?;
        pending
            .persist(&self.path)
            .map_err(|_| "Could not replace settings")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_survive_restart_and_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = SettingsStore::new(path.clone());
        assert_eq!(store.load().unwrap().channels.len(), ChatChannel::ALL.len());
        let mut settings = Settings {
            character: "ExampleCharacter".into(),
            channels: vec![ChatChannel::Guild, ChatChannel::Tell],
            _legacy_filters_open: true,
            ..Settings::default()
        };
        store.save(settings.clone()).unwrap();
        settings.channels = vec![ChatChannel::Auction, ChatChannel::Ooc];
        store.save(settings).unwrap();
        let reloaded = SettingsStore::new(path).load().unwrap();
        assert!(reloaded.channels == [ChatChannel::Auction, ChatChannel::Ooc]);
        assert!(!reloaded._legacy_filters_open);
        assert_eq!(reloaded.character, "ExampleCharacter");
    }
    #[test]
    fn secret_fields_and_invalid_values_are_rejected() {
        let value = serde_json::to_value(Settings::default()).unwrap();
        for key in ["user", "pass", "password"] {
            let mut secret = value.clone();
            secret[key] = "SYNTHETIC_SECRET".into();
            assert!(serde_json::from_value::<Settings>(secret).is_err());
        }
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        let settings = Settings {
            version: 3,
            ..Settings::default()
        };
        assert!(store.save(settings).is_err());
        assert!(!store.path.exists());
    }

    #[test]
    fn legacy_filters_migrate_and_empty_selection_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        for channel in ["guild", "all"] {
            let old = serde_json::json!({"version": 1, "server": "blue", "character": "ExampleCharacter", "channel": channel, "follow": false});
            fs::write(&store.path, serde_json::to_vec(&old).unwrap()).unwrap();
            let settings = store.load().unwrap();
            assert_eq!(settings.version, 2);
            assert!(matches!(settings.server, Server::Blue));
            assert_eq!(settings.character, "ExampleCharacter");
            assert!(!settings.follow);
            assert!(!settings._legacy_filters_open);
            assert!(
                settings.channels
                    == if channel == "all" {
                        ChatChannel::ALL.to_vec()
                    } else {
                        vec![ChatChannel::Guild]
                    }
            );
        }
        store
            .save(Settings {
                channels: vec![],
                ..Settings::default()
            })
            .unwrap();
        assert!(store.load().unwrap().channels.is_empty());
    }

    #[test]
    fn corrupt_or_future_filters_are_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        let current = serde_json::to_value(Settings::default()).unwrap();
        for (key, value) in [
            ("version", serde_json::json!(3)),
            ("channels", serde_json::json!(["unknown"])),
            ("channels", serde_json::json!(["guild", "guild"])),
            ("password", serde_json::json!("SYNTHETIC_SECRET")),
        ] {
            let mut invalid = current.clone();
            invalid[key] = value;
            let bytes = serde_json::to_vec(&invalid).unwrap();
            fs::write(&store.path, &bytes).unwrap();
            assert!(store.load().is_err());
            assert_eq!(fs::read(&store.path).unwrap(), bytes);
        }
    }

    #[test]
    fn retired_channels_are_removed_without_losing_other_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().join("settings.json"));
        let old = serde_json::json!({
            "version": 2, "server": "blue", "character": "ExampleCharacter",
            "channels": ["group", "guild", "raid", "ooc"],
            "filters_open": true, "follow": false
        });
        fs::write(&store.path, serde_json::to_vec(&old).unwrap()).unwrap();
        let migrated = store.load().unwrap();
        assert!(migrated.channels == [ChatChannel::Guild, ChatChannel::Ooc]);
        assert!(matches!(migrated.server, Server::Blue));
        assert_eq!(migrated.character, "ExampleCharacter");
        assert!(migrated._legacy_filters_open);
        assert!(!migrated.follow);
        store.save(migrated).unwrap();
        let saved = fs::read_to_string(&store.path).unwrap();
        assert!(!saved.contains("group") && !saved.contains("raid"));
        assert!(!saved.contains("filters_open"));
        for channel in [ChatChannel::Group, ChatChannel::Raid] {
            assert!(store
                .save(Settings {
                    channels: vec![channel],
                    ..Settings::default()
                })
                .is_err());
        }
    }
}
