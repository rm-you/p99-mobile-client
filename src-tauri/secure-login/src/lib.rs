use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Server {
    Green,
    Blue,
    Quarm,
}

/// These labels may be shown while the account credentials remain locked.
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SavedProfile {
    pub id: String,
    pub character: String,
    pub server: Server,
}

/// Deliberately has no Debug implementation: secret values must never be logged.
#[derive(Deserialize, Serialize)]
pub struct ProfileLogin {
    #[serde(flatten)]
    pub profile: SavedProfile,
    pub user: String,
    pub pass: String,
}

#[derive(Deserialize)]
pub struct Credentials {
    pub user: String,
    pub pass: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub available: bool,
    pub profiles: Vec<SavedProfile>,
    pub legacy_saved: bool,
    pub recovery_available: bool,
}

#[derive(Serialize)]
struct ProfileKey<'a> {
    id: &'a str,
}

/// Allowlisted diagnostic only: native error messages can contain private values.
#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
pub struct VaultDiagnostic {
    pub operation: &'static str,
    pub os_status: Option<i32>,
}

impl VaultDiagnostic {
    #[cfg(any(mobile, test))]
    fn from_code(code: Option<&str>) -> Self {
        let fallback = Self {
            operation: "bridge",
            os_status: None,
        };
        let Some(code) = code.and_then(|value| value.strip_prefix("keychain.")) else {
            return fallback;
        };
        let Some((operation, status)) = code.split_once('.') else {
            return fallback;
        };
        let operation = match operation {
            "list" => "list",
            "list_format" => "list_format",
            "profile_metadata" => "profile_metadata",
            "legacy_lookup" => "legacy_lookup",
            "index_read" => "index_read",
            "index_format" => "index_format",
            "index_write" => "index_write",
            _ => return fallback,
        };
        match status.parse() {
            Ok(status) => Self {
                operation,
                os_status: Some(status),
            },
            Err(_) => fallback,
        }
    }
}

pub struct SecureLogin<R: Runtime> {
    diagnostic: Mutex<Option<VaultDiagnostic>>,
    #[cfg(mobile)]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(mobile))]
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> SecureLogin<R> {
    /// Include the last lookup failure in a user-requested export, without Keychain contents.
    pub fn diagnostic(&self) -> Option<VaultDiagnostic> {
        self.diagnostic.lock().ok().and_then(|value| *value)
    }

    #[cfg(mobile)]
    fn remember_result<T>(&self, result: &Result<T, tauri::plugin::mobile::PluginInvokeError>) {
        use tauri::plugin::mobile::PluginInvokeError;
        if let Ok(mut diagnostic) = self.diagnostic.lock() {
            *diagnostic = result.as_ref().err().map(|error| {
                let code = match error {
                    PluginInvokeError::InvokeRejected(response) => response.code.as_deref(),
                    _ => None,
                };
                VaultDiagnostic::from_code(code)
            });
        }
    }
    /// Retain an existing login while updating its label under one authorization.
    pub fn update_profile(
        &self,
        expected: &SavedProfile,
        profile: SavedProfile,
    ) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            #[derive(Serialize)]
            struct Edit<'a> {
                expected: &'a SavedProfile,
                profile: SavedProfile,
            }
            self.handle
                .run_mobile_plugin("updateProfile", Edit { expected, profile })
                .map_err(|_| "Character was not saved. Unlock your device and try again.".into())
        }
        #[cfg(not(target_os = "ios"))]
        {
            let login = self.unlock(&expected.id)?;
            if &login.profile != expected || profile.id != expected.id {
                return Err("Saved character details do not match the protected login.".into());
            }
            self.save(ProfileLogin {
                profile,
                user: login.user,
                pass: login.pass,
            })
        }
    }

    /// List character/server labels without unlocking any stored credentials.
    pub fn status(&self) -> Result<VaultStatus, String> {
        #[cfg(mobile)]
        {
            let result = self.handle.run_mobile_plugin("status", ());
            self.remember_result(&result);
            result.map_err(|_| "Could not read saved characters.".into())
        }
        #[cfg(not(mobile))]
        Ok(VaultStatus {
            available: false,
            profiles: vec![],
            legacy_saved: false,
            recovery_available: false,
        })
    }

    /// Rebuild nonsecret iOS labels under explicit user authorization.
    pub fn recover_profiles(&self) -> Result<VaultStatus, String> {
        #[cfg(target_os = "ios")]
        {
            let result = self.handle.run_mobile_plugin::<()>("recoverProfiles", ());
            self.remember_result(&result);
            result.map_err(|_| {
                "Saved characters were not restored. Unlock your device and try again."
            })?;
        }
        self.status()
    }

    /// Atomically replace one protected profile, leaving the others untouched.
    pub fn save(&self, login: ProfileLogin) -> Result<(), String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("save", login)
            .map_err(|_| "Character was not saved. Unlock your device and try again.".into());
        #[cfg(not(mobile))]
        {
            let _ = login;
            Err("Secure storage is available on Android and iOS.".into())
        }
    }

    /// Unlock into Rust only; no webview command returns decrypted credentials.
    pub fn unlock(&self, id: &str) -> Result<ProfileLogin, String> {
        let key = ProfileKey { id };
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("unlock", key)
            .map_err(|_| "Character was not unlocked. Try again or edit its saved login.".into());
        #[cfg(not(mobile))]
        {
            let _ = key;
            Err("Secure storage is available on Android and iOS.".into())
        }
    }

    pub fn forget(&self, id: &str) -> Result<(), String> {
        let key = ProfileKey { id };
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("forget", key)
            .map_err(|_| "Could not delete the saved character.".into());
        #[cfg(not(mobile))]
        {
            let _ = key;
            Ok(())
        }
    }

    /// Read the previous single-login format only during explicit profile import.
    pub fn unlock_legacy(&self) -> Result<Credentials, String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("unlockLegacy", ())
            .map_err(|_| "Previous login was not unlocked.".into());
        #[cfg(not(mobile))]
        Err("Secure storage is available on Android and iOS.".into())
    }

    pub fn forget_legacy(&self) -> Result<(), String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("forgetLegacy", ())
            .map_err(|_| "Could not delete the previous login.".into());
        #[cfg(not(mobile))]
        Ok(())
    }
}

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_secure_login);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-login")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle =
                _api.register_android_plugin("io.github.rmyou.securelogin", "SecureLoginPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_secure_login)?;
            app.manage(SecureLogin::<R> {
                diagnostic: Mutex::new(None),
                #[cfg(mobile)]
                handle,
                #[cfg(not(mobile))]
                marker: std::marker::PhantomData,
            });
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_accepts_only_known_operations_and_numeric_statuses() {
        assert_eq!(
            VaultDiagnostic::from_code(Some("keychain.profile_metadata.-26275")),
            VaultDiagnostic {
                operation: "profile_metadata",
                os_status: Some(-26275)
            }
        );
        for code in [
            None,
            Some("EXAMPLE_ACCOUNT"),
            Some("keychain.EXAMPLE_ACCOUNT.-1"),
            Some("keychain.list.EXAMPLE_PASSWORD"),
            Some("keychain.list.1.extra"),
        ] {
            assert_eq!(
                VaultDiagnostic::from_code(code),
                VaultDiagnostic {
                    operation: "bridge",
                    os_status: None
                }
            );
        }
    }
}
