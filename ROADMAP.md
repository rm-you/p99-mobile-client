# Roadmap

## 1. Persist settings and protect saved credentials

Implemented: persistent server, character, channel filter, and follow-latest
preferences; optional OS-protected account/password storage; unlock when starting
a saved session; reconnect without repeated unlock prompts; forget saved login.
No plaintext credential storage or decrypted password return to the webview.

Validation:
- Android APKs build for ARM64 and x86_64. Emulator checks cover device PIN storage,
  restart, cancelled unlock/replacement, authenticated decryption, tamper rejection,
  and forgetting the login.
- Remaining: physical Android biometric testing, including older Android devices.
- Remaining: Xcode build and real iOS Keychain / Face ID / Touch ID validation.

## 2. Improve chat presentation and item links

Implemented: channel colors, tappable item links, and a P99 Wiki detail modal
with loading/error states, retry, a bounded cache, and a source-page button.
The mobile lockfile includes the published decoder offsets for inline links.
The UI uses a compact neutral layout, collapsible search and channel checkboxes,
Titanium channel colors, full zone names, and text navigation. Connection progress
and health use plain language without transport diagnostics or counters.
Wiki HTML is reduced to item-card text by Rust before reaching the UI.
Android emulator validation covers real Wiki lookup, caching, inline and legacy
item buttons, modal dismissal/focus restoration, and opening the source browser.

Remaining:
- Replace runtime Wiki lookups with a bundled item database.
- Validate the item flow on physical Android and iOS devices.

## 3. Improve background connection reliability

The Android emulator connected to P99 and received MOTD, guild MOTD, and auction
messages, including item links. A two-minute foreground test of the new build
stayed connected and disconnected cleanly. A brief switch to the background left the process alive but produced
an OS `Operation not permitted` networking error, followed by the normal retry
path. Disconnect then completed cleanly.

Investigate an Android foreground service with a persistent connection
notification and explicit stop action. Preserve best-effort background execution
on iOS within its platform limits. Verify reconnects, screen locking, and process
termination on real devices. Do not deliberately disconnect on focus changes.
