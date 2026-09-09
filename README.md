# P99 Mobile

An early native Android/iOS chat viewer built with Tauri 2, React, and the
[reusable Rust P99 client](https://github.com/rm-you/p99-logger-client).
The phone connects directly to the login, world, and zone servers; no relay
service or graphical EverQuest client is required.

## Using the app

Select **P99 Green** or **P99 Blue**, enter your login server account and
password, and provide the name of an existing character. The character joins
the zone where you last left them. Log out of the graphical game client first.

The chat view receives all communication channels and lets you filter by
channel or search the most recent 1,500 messages. Item link labels, IDs, and
original link bodies remain available in the received records. Messages render
as text, never HTML. Clearing the view removes its retained messages.

Server, character, channel filter, and follow-latest preferences are saved on
this device. Account credentials are saved only when you choose **Save login
securely**. Otherwise they stay in memory for the current session. A saved
login appears locked after restarting the app; **Unlock and connect** asks for
your device authentication and passes the credentials directly to the Rust
worker. The account and password are not filled back into the webview.

- Android uses an AES-256-GCM key in Android Keystore, with authentication
  required for each encryption or decryption. Android 11+ supports a strong
  biometric or device PIN/pattern/password; Android 7–10 requires an enrolled
  strong biometric. Encrypted data stays in the app's no-backup directory.
- iOS uses a device-only Keychain item requiring user presence (Face ID,
  Touch ID, or device passcode). A device passcode must be configured.
- Without suitable device authentication, you can connect by entering your
  credentials each time. There is no plaintext storage fallback. Native desktop
  development also uses manual login.

Use **Forget saved login** to remove the stored secret, or **Use different
login** to enter another account. If a key becomes unavailable after changing
your device security settings, forget the old login and save it again. Credentials
remain in the active worker's memory for retries without repeated unlock prompts.
**Disconnect** stops that worker before another session can start. Chat stays in
memory; chat export and message sending are not implemented.

Background connections are best effort. Switching apps, locking the screen, or
losing window focus does not deliberately disconnect the session or cancel a
connection attempt. The existing network worker and retry loop keep running
while the OS permits execution. Use **Disconnect** to end a session; explicit
app exit also requests shutdown.

The OS may suspend networking or terminate the app. If the process survives,
the same worker can resume and retry a lost connection when allowed to run.
After process termination, reopen the app and unlock the saved login or enter
your credentials again.
This version does not register an Android foreground service or request extra
iOS background execution time. Background duration and lifecycle behavior still
need testing on both platforms; continuous logging is not guaranteed. See the
[Android process lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle)
and [iOS background execution documentation](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time).

See the [roadmap](ROADMAP.md) for platform validation, chat UI improvements, and
background connection work.

## Development

Install Node.js 24, Rust stable, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```sh
npm ci
npm run dev
```

The browser preview renders the UI with connection disabled. Use
`npm run tauri dev` for a native desktop development window with networking.

### Android

With the Android SDK, NDK, and Java configured, enable Windows Developer Mode
if building on Windows so Tauri can create its native library symbolic links.
Then run:

```sh
npm run tauri -- android init
npm run tauri -- android dev
# Build a release package:
npm run tauri -- android build
```

### iOS

On a Mac with Xcode and the iOS prerequisites configured:

```sh
npm run tauri -- ios init
npm run tauri -- ios dev
# Build a release package:
npm run tauri -- ios build
```

Platform project generation, device signing, and store distribution are separate
from this initial source implementation. Do not commit signing keys or local
credential files.

## Architecture and checks

- `src/`: configuration screen, channel filters, bounded chat history, and typed
  events received over a Tauri IPC channel.
- `src-tauri/src/session.rs`: one cancellable network worker, configuration
  validation, and serial session shutdown.
- `src-tauri/src/lib.rs`: native commands and application lifecycle callbacks.
- `src-tauri/src/settings.rs`: validated, atomic writes of nonsecret preferences.
- `src-tauri/secure-login/`: native Keystore/Keychain integration. Its Rust API
  exposes no credential-reading command to the webview. Android key use is bound
  to the authenticated `CryptoObject`; iOS access is enforced by Keychain ACLs.
- `p99-logger-client`: protocol handling, authentication, decoding, retries, and
  the bundled asset checksum inventory. These stay in the library repository.

The Rust manifest depends on the library's `main` branch with its CLI feature
disabled. `Cargo.lock` records the exact resolved commit. To adopt a newer
library revision deliberately, run `cargo update -p p99-logger-client` inside
`src-tauri`, then review and commit the lockfile change.

```sh
npm run build
npm test
npm run format:check
cd src-tauri
cargo fmt --all --check
cargo test --workspace --lib
cargo clippy --workspace --all-targets -- -D warnings
```

Rust desktop checks require the platform's Tauri system libraries even though
the unit tests do not launch a webview. Tests contain synthetic examples only.
The frontend and Rust checks do not establish successful mobile packaging or
an actual phone-to-P99 connection; those require device testing.

Secure storage implementation references:
[Android authentication-bound keys](https://developer.android.com/identity/sign-in/biometric-auth#auth-per-use-keys)
and [Apple Keychain access control](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id).
The iOS implementation still requires an Xcode build and device validation.
