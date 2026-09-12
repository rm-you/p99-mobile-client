# P99 Mobile Chat

A native Android chat app built with Tauri 2, React, and the
[reusable Rust P99 client](https://github.com/rm-you/p99-logger-client).
The phone connects directly to the login, world, and zone servers; no relay
service or graphical EverQuest client is required.

Download the ARM64 APK from [GitHub Releases](https://github.com/rm-you/p99-mobile-client/releases).
See [installation and updates](INSTALLING.md), including the one-time migration
from development-signed APKs. Distribution is direct; no Play Store account is
needed. The repository also includes iOS source, which requires separate platform
validation and is not part of the Android release.

[Privacy](PRIVACY.md) · [Changes](CHANGELOG.md) · [Release process](RELEASING.md)

The app's own code is [MIT licensed](LICENSE). Dependencies and the bundled item
snapshot retain their original terms; see [component and data notices](DEPENDENCIES.md).

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
The app reads the original SQLite snapshot and formats matching rows on demand,
without retaining the whole catalog as formatted text. This works offline with
no Wiki request. Matching uses the linked name and a
reference item ID; missing or conflicting entries show an unavailable message.
**View on P99 Wiki** opens the item page in your browser only when tapped.
The catalog contains community reference data and can have gaps; see its
[source and update notes](src-tauri/data/README.md). Item link IDs and original
link bodies remain available in the received records. Clearing the view removes its in-memory messages; saved history is cleared separately in Settings.

Choose Say, Tell, Guild, Auction, OOC, or Shout in the composer to send a message.
The text box starts at one line and grows to four before scrolling. Tap the
paper-plane icon to send; Enter adds a line, and Ctrl/Cmd+Enter also submits.
Line breaks become spaces in one game message. For tells, enter a character name
or swipe any message with an identified author left or right to select that author.
Replies always use Tell, regardless of
the original channel. Sent-tell echoes display and filter as Tell as well.
On Android, the chat view resizes above the on-screen keyboard so the message
field and send button remain visible while typing.

Sending is enabled only while the current character is connected. Drafts survive
tab changes and failed submissions, but are cleared when starting a new login.
They are held only in memory. Pending commands are discarded when the connection
ends, so reconnecting cannot unexpectedly replay unsent chat. Submission means
the local network queue accepted the message; the app displays server messages
without adding a synthetic delivered echo. Group, Raid, emotes, and slash-command
parsing are not offered by the composer.

Server, selected channels, and follow-latest preferences save on this
device. After a manual connection starts, the app asks whether to save the
character, server, account, and password together. Choose **Save** or
**Not now**; either choice leaves the connection running. Saved characters appear above the **New connection** form;
tap a character/server entry to unlock it with device authentication and connect.
The account and password pass directly to the Rust worker and are never filled
back into the webview. Each saved character has independent protected storage.
Character/server labels are visible while credentials remain locked. The manual
character field starts blank; the manual form never restores a previous character name. Optional chat history is also organized by character and server.

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
session can start.

Background connections are best effort. Switching apps, locking the screen, or
losing window focus does not deliberately disconnect the session or cancel a
connection attempt. Android starts a foreground service with an ongoing connection
notification when you log in. Its **Stop** action disconnects directly through
Rust, even with the chat screen hidden. The service and wake lock end after the
network worker closes. Android 13+ asks for notification permission; denying it
still allows the service, but hides the notification and its Stop action. Use
the app's **Disconnect** button or the notification's **Stop** for a clean logout;
explicit app exit or removing it from Recents also requests shutdown.
Android's Active apps Stop control terminates the process without a clean logout.

Rust buffers up to 1,500 chat records while the webview is hidden, then delivers
them when you return. Android battery restrictions can still interrupt networking.
iOS keeps the existing best-effort behavior; it has no equivalent service for an
indefinitely running chat connection. See the
[platform details and testing notes](src-tauri/session-service/README.md).

The OS may suspend networking or terminate the app. If the process survives,
the same worker can resume and retry a lost connection when allowed to run.
After process termination, reopen the app and unlock the saved login or enter
your credentials again.
This version does not request extra iOS background execution time.
Physical-device background duration and lifecycle behavior still need testing on
both platforms; continuous logging is not guaranteed. See the
[Android process lifecycle](https://developer.android.com/guide/components/activities/process-lifecycle)
and [iOS background execution documentation](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time).

See the [roadmap](ROADMAP.md) for platform validation, chat UI improvements, and
background connection work.

## Reading, history, and alerts

The Settings tab contains text sizes from 12–22, compact spacing (on by default), and an optional
higher-contrast palette. Classic EQ colors remain the default. Item details use
a bottom sheet on phones and a centered dialog on larger screens. Android system
bars use light icons on a dark background; layout respects the keyboard and safe areas.

Unread incoming messages appear in the Chat badge, with a separate shortcut for
unread tells. Scrolling away from the bottom stops automatic following; **Latest
messages** shows a count when new messages arrive. A divider marks the new-message
boundary. Filters do not mark hidden messages read. Unread counts are session-only
and are not restored with saved history.

Swipe an authored message in either direction to compose a tell. Long-press it
to copy, share, reply, or mute the author. Tapping outside the popup dismisses it.
Screen readers can use the message action control; keyboard focus reveals that
control without adding buttons to every visible row. Muted messages are hidden
and cannot trigger alerts, but are still kept in enabled history. Unmute authors
in Settings. Your own messages are labeled **You**, and the composer identifies a
tell's recipient explicitly.

Send feedback distinguishes **Submitting**, **Submitted**, **Server echo received**,
and failure. An echo is evidence of a server response, not a read receipt. After
15 seconds without a matching echo, the status says **Submitted · no echo received**;
this does not imply that sending failed. Failed submissions retain the draft.
Connection interruptions and resumptions insert timeline notices about possible
message gaps. These UI markers are separate from the game's chat records.

**Save chat on this device** is off by default. When enabled, Rust writes structured
chat to a separate SQLite database before buffering it for the UI, including while
Android's WebView is hidden. Choose 1, 7, or 30 days and 1,000, 5,000, or 10,000 messages
per character/server; an additional 20,000-message device limit applies. Retention
is enforced when the store is used, not by waking an inactive app. Turning saving
off stops new writes without deleting existing history. **Clear saved history**
removes it for every character after confirmation. Live chat continues if storage fails.

History contains player names and message content; it is not protected by the
credential vault's biometric lock. Credentials never enter the history database.
Saved history can be viewed while disconnected and loads before a new login when
saving is enabled. The chat view keeps the latest 1,500 records; exports include
all retained records for the selected character. Text export is readable; JSONL
preserves original item-link bodies, IDs, decoded ranges, and formatted-message
arguments. Both use the Android/iOS share sheet. Exports are capped at 20 MB;
reduce retention if that limit is reached. Shared copies are outside the app's
history retention controls.

Optional Android alerts cover incoming tells, guild messages, or up to 20
comma-separated keywords. They run only while the app is backgrounded and the
native session receives a matching message. Muted authors and your own messages
are excluded; alerts are rate-limited to one every two seconds. Previews are off
by default. Lock-screen public notices omit sender and text. Android notification
permissions, channel settings, and device policy still control presentation.
Use **Test notification** while disconnected to check permission and presentation
without starting a game session.
These are local notifications, not push delivery: they cannot receive messages
after Android kills or suspends networking. The Notifications section appears only on supported platforms.

About includes the version, build identifier, networking revision, source and issue
links, [component notices](DEPENDENCIES.md), and data credits. **Export diagnostics**
uses an explicit allowlist of versions, platform, counters, and storage status.
It excludes credentials, character names, chat text, keywords, raw packets, and
local file paths. Sharing chat and sharing diagnostics are separate actions.

## Development

Install Node.js 24, the Rust toolchain pinned in `rust-toolchain.toml`, and the
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

Production Android signing and tag-triggered GitHub distribution are described in
[RELEASING.md](RELEASING.md). Do not commit signing keys or local credential files.

## Architecture and checks

The app's gold P99 speech-bubble icon is shared across platforms. Source artwork,
the generation prompt, and regeneration instructions are in
[`src-tauri/icons/source/`](src-tauri/icons/source/README.md). Run
`npm run icons:generate` after changing the artwork. Normal Tauri development and
build commands sync the committed icons into initialized Android/iOS projects.

- `src/`: configuration screen, channel filters, bounded chat history, and typed
  events received over a Tauri IPC channel.
- `src-tauri/src/session.rs`: one cancellable network worker, configuration
  validation, and serial session shutdown.
- `src-tauri/src/outgoing.rs`: typed chat requests, input validation, and a bounded
  command queue scoped to the current connected session.
- `src/ChatComposer.tsx` and `src/SwipeToReply.tsx`: expandable composition and tell
  reply gestures, with recipient selection and failed-draft retention.
- `src-tauri/src/lib.rs`: native commands and application lifecycle callbacks.
- `src-tauri/src/background.rs` and `delivery.rs`: session lifetime and bounded
  event delivery while the webview is hidden.
- `src-tauri/session-service/`: Android foreground service, private connection
  notification, and native Stop control; Android/iOS copy and share controls.
  Background-service methods remain no-ops on iOS/desktop.
- `src-tauri/src/settings.rs` and `experience.rs`: validated, atomic writes of nonsecret preferences.
- `src-tauri/src/history.rs`: opt-in SQLite retention and native alert matching.
- `src-tauri/src/support.rs`: bounded history exports, sharing, and sanitized diagnostics.
- `src/Preferences.tsx`, `MessageActions.tsx`, and `useUnread.ts`: appearance, history, alerts, message actions, and unread state.
- `src-tauri/src/items.rs`: offline item lookup and safe Wiki browser URLs.
- `src-tauri/src/items/`: indexed SQLite lookup and formatting of classic item stats.
- `src-tauri/data/`: original SQLite snapshot, source metadata, and update instructions.
- `scripts/import_items.py`: verifies and copies the source snapshot without changing it.
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
CI additionally builds an Android APK so Kotlin service and manifest changes are
compiled as well as Rust. A successful APK build still requires device validation.

Secure storage implementation references:
[Android authentication-bound keys](https://developer.android.com/identity/sign-in/biometric-auth#auth-per-use-keys)
and [Apple Keychain access control](https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id).
The iOS implementation still requires an Xcode build and device validation.
