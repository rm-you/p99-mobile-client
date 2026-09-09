# Roadmap

## 1. Persist settings and protect saved credentials

Implemented: persistent server, channel filter, and follow-latest
preferences; independent OS-protected character/server/account/password profiles;
offer to save when a manual connection starts; tap a saved character to unlock
and connect; edit/delete controls and swipe-to-delete confirmation; migration from
the previous single-login entry; reconnect without repeated unlock prompts.
Confirmed credential rejections stop retries and show an actionable error. Manual
character names are not restored or persisted outside saved profiles.
No plaintext credential storage or decrypted password return to the webview.

Validation:
- Android APKs build for ARM64 and x86_64. Emulator checks cover device PIN storage,
  two independent profiles surviving restart, cancelled unlock/replacement,
  authenticated edits that retain credentials, tamper rejection, and isolated
  deletion. Existing saved entries were preserved during these checks.
- Remaining: physical Android biometric testing, including older Android devices.
- Remaining: Xcode build and real iOS Keychain / Face ID / Touch ID validation.

## 2. Improve chat presentation and item links

Implemented: channel colors, tappable item links, and an offline item detail modal
with a bundled catalog, unavailable-item state, and optional Wiki browser button.
The mobile lockfile includes the published decoder offsets for inline links.
The UI uses a compact neutral layout, collapsible search and colored channel pills,
Titanium channel colors, full zone names, and text navigation. Filters start
collapsed, empty guild MOTDs are hidden, and disconnect asks for confirmation. Connection progress
and health use plain language without transport diagnostics or counters. A subtle
sign-in bar and percentage track completed connection steps and reset on retries.
The catalog contains 12,122 entries derived from P99 Gear Planner's public
Wiki/PEQ reference data. Item matching checks both names and reference IDs, and
refuses conflicting variants. Runtime Wiki requests and HTML parsing are removed.
Earlier Android emulator validation covered inline and legacy item buttons,
modal dismissal/focus restoration, and opening the source browser.

Remaining:
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
