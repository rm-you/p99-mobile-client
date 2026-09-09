use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Deliberately has no Debug implementation: these values must never be logged.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub user: String,
    pub pass: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub available: bool,
    pub saved: bool,
}

pub struct SecureLogin<R: Runtime> {
    #[cfg(mobile)]
    handle: tauri::plugin::PluginHandle<R>,
    // The desktop stub owns no runtime, so it must not inherit R's Send/Sync bounds.
    #[cfg(not(mobile))]
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> SecureLogin<R> {
    /// Inspect availability without retrieving a secret or prompting for unlock.
    pub fn status(&self) -> Result<VaultStatus, String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("status", ())
            .map_err(|_| "Could not check saved login.".into());
        #[cfg(not(mobile))]
        Ok(VaultStatus {
            available: false,
            saved: false,
        })
    }

    /// Encrypt the account and password using the device's protected storage.
    pub fn save(&self, credentials: Credentials) -> Result<(), String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("save", credentials)
            .map_err(|_| "Login was not saved. Unlock your device and try again.".into());
        #[cfg(not(mobile))]
        {
            let _ = credentials;
            Err("Secure login storage is available on Android and iOS.".into())
        }
    }

    /// Unlock directly into Rust; credentials are never returned to the webview.
    pub fn unlock(&self) -> Result<Credentials, String> {
        #[cfg(mobile)]
        return self.handle.run_mobile_plugin("unlock", ()).map_err(|_| {
            "Login was not unlocked. Try again, or forget it and enter your credentials.".into()
        });
        #[cfg(not(mobile))]
        Err("Secure login storage is available on Android and iOS.".into())
    }

    /// Forget the saved secret without disrupting an already-running session.
    pub fn forget(&self) -> Result<(), String> {
        #[cfg(mobile)]
        return self
            .handle
            .run_mobile_plugin("forget", ())
            .map_err(|_| "Could not forget the saved login.".into());
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
