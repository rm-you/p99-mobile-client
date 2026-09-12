use serde::{Deserialize, Serialize};
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
}

#[derive(Serialize)]
struct ProfileKey<'a> {
    id: &'a str,
}

pub struct SecureLogin<R: Runtime> {
    #[cfg(mobile)]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(mobile))]
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> SecureLogin<R> {
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
        return self
            .handle
            .run_mobile_plugin("status", ())
            .map_err(|_| "Could not read saved characters.".into());
        #[cfg(not(mobile))]
        Ok(VaultStatus {
            available: false,
            profiles: vec![],
            legacy_saved: false,
        })
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
                #[cfg(mobile)]
                handle,
                #[cfg(not(mobile))]
                marker: std::marker::PhantomData,
            });
            Ok(())
        })
        .build()
}
