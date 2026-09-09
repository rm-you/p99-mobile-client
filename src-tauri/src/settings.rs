use crate::session::Server;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};

/// Only nonsecret preferences may be persisted in this file.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub version: u8,
    pub server: Server,
    pub character: String,
    pub channel: String,
    pub follow: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            server: Server::Green,
            character: String::new(),
            channel: "all".into(),
            follow: true,
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.character.len() >= 64
            || self.character.contains('\0')
            || ![
                "all", "auction", "ooc", "guild", "tell", "group", "say", "shout", "raid", "system",
            ]
            .contains(&self.channel.as_str())
        {
            return Err("Saved settings are invalid or from an unsupported version.".into());
        }
        Ok(())
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
        let settings: Settings =
            serde_json::from_slice(&bytes).map_err(|_| "Could not read saved settings.")?;
        settings.validate()?;
        Ok(settings)
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
        assert_eq!(store.load().unwrap().channel, "all");
        let mut settings = Settings {
            character: "ExampleCharacter".into(),
            channel: "guild".into(),
            ..Settings::default()
        };
        store.save(settings.clone()).unwrap();
        settings.channel = "ooc".into();
        store.save(settings).unwrap();
        let reloaded = SettingsStore::new(path).load().unwrap();
        assert_eq!(reloaded.channel, "ooc");
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
            version: 2,
            ..Settings::default()
        };
        assert!(store.save(settings).is_err());
        assert!(!store.path.exists());
    }
}
