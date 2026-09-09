# P99 Mobile Chat

An early native Android/iOS chat viewer built with Tauri 2, React, and the
[reusable Rust P99 client](https://github.com/rm-you/p99-logger-client).
The phone connects directly to the login, world, and zone servers; no relay
service or graphical EverQuest client is required.

## Using the app

Select **P99 Green** or **P99 Blue**, enter your login server account and
password, and provide the name of an existing character, then tap **Login**. The character joins
the zone where you last left them. Log out of the graphical game client first.

The chat view receives all communication channels and lets you filter by
channel or search the most recent 1,500 messages. Expand **Filters** and tap the colored pills to select any
combination of channels and search their messages, then collapse it to make room
for chat. All channels are selected initially; **All** and **None** make changing
selections quicker. Selected pills have a subtle colored background. Filters start collapsed each launch and keep applying while collapsed. Raid and Group are
excluded from the selectable channels. Chat uses Titanium's original colors
with yellow-orange OOC, and the header displays full zone names. Empty guild
MOTDs are hidden. During sign-in, a small progress bar shows the current step
and percentage. It advances when connection milestones complete; it does not
estimate remaining time.
Tap an item link to see stats from the bundled catalog of 12,122 item entries.
This works offline with no Wiki request. Matching uses the linked name and a
reference item ID; missing or conflicting entries show an unavailable message.
**View on P99 Wiki** opens the item page in your browser only when tapped.
The catalog contains community reference data and can have gaps; see its
[source and update notes](src-tauri/data/README.md). Item link IDs and original
link bodies remain available in the received records. Clearing the view removes
its retained messages.

Server, selected channels, and follow-latest preferences save on this
device. After a manual connection starts, the app asks whether to save the
character, server, account, and password together. Choose **Save** or
**Not now**; either choice leaves the connection running. Saved characters appear above the manual connection form;
tap a character/server entry to unlock it with device authentication and connect.
The account and password pass directly to the Rust worker and are never filled
back into the webview. Each saved character has independent protected storage.
Character/server labels are visible while credentials remain locked. The manual
character field starts blank; character names are retained only in saved profiles.

Use the pencil to edit a saved character. Leave both account and password blank
to keep its existing login, or enter both to replace it. Keeping the login during
an Android edit requires unlocking it and then confirming the replacement save.
Swipe left or tap the trash icon to delete an entry; both ask for confirmation. The manual form remains
available for connecting without saving.

After upgrading from the single-login version, **Previous saved login** lets you
assign that login a character and server. The old entry is kept until the new
profile is successfully saved. If cleanup fails, the previous entry remains
visible for explicit removal.

- Android uses an AES-256-GCM key in Android Keystore, with authentication
  required for each encryption or decryption. Android 11+ supports a strong
  biometric or device PIN/pattern/password; Android 7–10 requires an enrolled
  strong biometric. Encrypted data stays in the app's no-backup directory.
- iOS uses a device-only Keychain item requiring user presence (Face ID,
  Touch ID, or device passcode). A device passcode must be configured.
- Without suitable device authentication, you can connect by entering your
  credentials each time. There is no plaintext storage fallback. Native desktop
  development also uses manual login.

If a key becomes unavailable after changing device security settings, edit its
entry with both account and password, or delete it and save it again. Credentials
remain in the active worker's memory for retries without repeated unlock prompts.
If the login server rejects the account/password pair, retries stop and the app
asks you to check the login details. Other connection failures retain automatic
retries. **Disconnect** asks for confirmation, then stops that worker before another
session can start. Chat stays in memory; chat export and message sending are not
implemented.

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
- `src-tauri/src/items.rs`: offline item lookup and safe Wiki browser URLs.
- `src-tauri/data/`: bundled item cards, source metadata, and update instructions.
- `scripts/import_items.py`: deterministic conversion of the public source snapshot.
- `src/itemText.ts`: converts decoded UTF-8 item ranges for inline rendering.
  Records without these ranges retain separate tappable item buttons.
- `src-tauri/secure-login/`: native Keystore/Keychain integration. Its Rust API
  exposes no credential-reading command to the webview. Android key use is bound
  to the authenticated `CryptoObject`; iOS access is enforced by Keychain ACLs.
- `p99-logger-client`: protocol handling, authentication, decoding, retries, and
  the bundled asset checksum inventory. These stay in the library repository.

The Rust manifest depends on the library's `main` branch with its CLI feature
disabled. `Cargo.lock` records the exact resolved commit. To adopt a newer
library revision deliberately, run `cargo update -p p99-logger-client` inside
`src-tauri`, then review and commit the lockfile change. Inline links require the
logger's additive `text_start` / `text_end` fields; `start` / `end` describe the
original wire bytes and must not be used to slice decoded text. The locked library
supplies these fields; older records without them retain separate item buttons.

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
The previous single-channel preference is migrated automatically when loaded.
The frontend and Rust checks do not establish successful mobile packaging or
an actual phone-to-P99 connection; those require device testing.

Secure storage implementation references:
[Android authentication-bound keys](https://developer.android.com/identity/sign-in/biometric-auth#auth-per-use-keys)
and [Apple Keychain access control](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id).
The iOS implementation still requires an Xcode build and device validation.
