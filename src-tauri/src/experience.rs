use serde::{Deserialize, Serialize};

/// Device preferences contain no login secrets. History and alerts are opt-in.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Experience {
    pub text_size: u8,
    pub compact: bool,
    pub high_contrast: bool,
    pub history_enabled: bool,
    pub history_days: u16,
    pub history_limit: u32,
    pub notify_tells: bool,
    pub notify_guild: bool,
    pub notify_keywords: Vec<String>,
    pub notification_previews: bool,
    pub muted_authors: Vec<String>,
}
impl Default for Experience {
    fn default() -> Self {
        Self {
            text_size: 16,
            compact: true,
            high_contrast: false,
            history_enabled: false,
            history_days: 7,
            history_limit: 5000,
            notify_tells: false,
            notify_guild: false,
            notify_keywords: vec![],
            notification_previews: false,
            muted_authors: vec![],
        }
    }
}
impl Experience {
    pub fn validate(&self) -> Result<(), String> {
        if ![12, 14, 16, 18, 20, 22].contains(&self.text_size)
            || ![1, 7, 30].contains(&self.history_days)
            || ![1000, 5000, 10000].contains(&self.history_limit)
            || self.notify_keywords.len() > 20
            || self.muted_authors.len() > 200
            || self
                .notify_keywords
                .iter()
                .any(|s| s.trim().is_empty() || s.len() > 80 || s.chars().any(char::is_control))
            || self.muted_authors.iter().any(|s| {
                s.is_empty() || s.len() > 63 || !s.bytes().all(|b| b.is_ascii_alphabetic())
            })
        {
            return Err("Chat preferences are invalid.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrated_preferences_do_not_enable_storage_or_notifications() {
        let old: Experience = serde_json::from_str("{}").unwrap();
        old.validate().unwrap();
        assert!(old.compact);
        assert!(
            !old.history_enabled
                && !old.notify_tells
                && !old.notify_guild
                && !old.notification_previews
        );
        assert!(old.notify_keywords.is_empty());
    }
    #[test]
    fn small_text_is_a_supported_saved_preference() {
        Experience {
            text_size: 12,
            ..Default::default()
        }
        .validate()
        .unwrap();
    }
    #[test]
    fn reject_unbounded_retention_and_secret_fields() {
        for value in [
            serde_json::json!({"history_days":365}),
            serde_json::json!({"history_limit":1000000}),
            serde_json::json!({"notify_keywords":["\n"]}),
            serde_json::json!({"text_size":255}),
        ] {
            assert!(serde_json::from_value::<Experience>(value)
                .unwrap()
                .validate()
                .is_err());
        }
        assert!(serde_json::from_str::<Experience>(r#"{"password":"SYNTHETIC_SECRET"}"#).is_err());
    }
}
