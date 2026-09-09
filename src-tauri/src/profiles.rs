use serde::Deserialize;
use std::sync::Mutex;
use tauri_plugin_secure_login::{ProfileLogin, SavedProfile, Server};

/// Serialize edits/imports across their unlock and save steps.
#[derive(Default)]
pub struct ProfileOperations(pub Mutex<()>);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveProfile {
    pub id: Option<String>,
    pub character: String,
    pub server: Server,
    pub user: String,
    pub pass: String,
}

pub fn validate_id(id: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) {
        Ok(())
    } else {
        Err("Invalid saved character.".into())
    }
}

/// Only explicit edits may retain credentials, and account/password updates stay paired.
impl SaveProfile {
    pub fn validate(&self, profiles: &[SavedProfile], legacy_saved: bool) -> Result<(), String> {
        if self.character.is_empty()
            || self.character.len() > 63
            || !self.character.bytes().all(|c| c.is_ascii_alphabetic())
        {
            return Err("Enter a valid character name.".into());
        }
        if let Some(id) = &self.id {
            if id == "legacy" {
                if !legacy_saved {
                    return Err("The previous saved login is no longer available.".into());
                }
            } else {
                validate_id(id)?;
                if !profiles.iter().any(|p| &p.id == id) {
                    return Err("This saved character no longer exists.".into());
                }
            }
        }
        if profiles.iter().any(|p| {
            p.server == self.server
                && p.character.eq_ignore_ascii_case(&self.character)
                && Some(&p.id) != self.id.as_ref()
        }) {
            return Err(
                "This character is already saved on that server. Edit its existing entry.".into(),
            );
        }
        let keeping = self.id.is_some() && self.user.is_empty() && self.pass.is_empty();
        if !keeping
            && (self.user.trim().is_empty()
                || self.pass.is_empty()
                || self.user.len() > 1024
                || self.pass.len() > 1024
                || self.user.contains('\0')
                || self.pass.contains('\0'))
        {
            return Err(
                "Enter both the login account and password, or leave both blank when editing."
                    .into(),
            );
        }
        Ok(())
    }

    pub fn metadata(&self) -> SavedProfile {
        SavedProfile {
            id: self
                .id
                .as_ref()
                .filter(|id| id.as_str() != "legacy")
                .cloned()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            character: self.character.clone(),
            server: self.server,
        }
    }
}

/// Check the authenticated tuple against its visible label before starting any network work.
pub fn validate_unlocked(login: &ProfileLogin, expected: &SavedProfile) -> Result<(), String> {
    if login.profile.id != expected.id
        || login.profile.server != expected.server
        || login.profile.character != expected.character
    {
        return Err(
            "Saved character details do not match the protected login. Edit or replace this entry."
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn existing() -> SavedProfile {
        SavedProfile {
            id: uuid::Uuid::new_v4().to_string(),
            character: "ExampleCharacter".into(),
            server: Server::Green,
        }
    }
    #[test]
    fn edits_keep_credentials_only_as_a_pair_and_do_not_collide() {
        let profile = existing();
        let mut request = SaveProfile {
            id: Some(profile.id.clone()),
            character: profile.character.clone(),
            server: profile.server,
            user: String::new(),
            pass: String::new(),
        };
        assert!(request
            .validate(std::slice::from_ref(&profile), false)
            .is_ok());
        request.user = "EXAMPLE_ACCOUNT".into();
        assert!(request
            .validate(std::slice::from_ref(&profile), false)
            .is_err());
        request.pass = "EXAMPLE_PASSWORD".into();
        request.id = None;
        assert!(request
            .validate(std::slice::from_ref(&profile), false)
            .is_err());
        request.server = Server::Blue;
        assert!(request
            .validate(std::slice::from_ref(&profile), false)
            .is_ok());
        request.character = "../invalid".into();
        assert!(request.validate(&[], false).is_err());
        assert!(validate_id("../invalid").is_err());
    }
    #[test]
    fn protected_tuple_roundtrips_but_labels_have_no_credentials() {
        let login = ProfileLogin {
            profile: existing(),
            user: "EXAMPLE_ACCOUNT".into(),
            pass: "EXAMPLE_PASSWORD".into(),
        };
        let wire = serde_json::to_value(&login).unwrap();
        let decoded: ProfileLogin = serde_json::from_value(wire).unwrap();
        assert!(validate_unlocked(&decoded, &login.profile).is_ok());
        assert_eq!(decoded.user, login.user);
        assert_eq!(decoded.pass, login.pass);
        let label = serde_json::to_value(&decoded.profile).unwrap();
        assert_eq!(label.as_object().unwrap().len(), 3);
        assert!(label.get("user").is_none() && label.get("pass").is_none());
    }
    #[test]
    fn changed_metadata_cannot_redirect_a_protected_profile() {
        let profile = existing();
        let mut login = ProfileLogin {
            profile: profile.clone(),
            user: "EXAMPLE_ACCOUNT".into(),
            pass: "EXAMPLE_PASSWORD".into(),
        };
        assert!(validate_unlocked(&login, &profile).is_ok());
        login.profile.server = Server::Blue;
        assert!(validate_unlocked(&login, &profile).is_err());
        login.profile = profile.clone();
        login.profile.character = "AnotherCharacter".into();
        assert!(validate_unlocked(&login, &profile).is_err());
    }
}
