# Roadmap

## Project Quarm integration

Implemented: Quarm server selection, TAKP login configuration through the shared
networking crate, saved Quarm profiles, server-separated history, and
protocol-specific outbound message limits. Item details use the existing P99
reference catalog and identify possible differences on Quarm.

Validation: synthetic tests cover server/protocol routing, manual and saved Quarm
selection, profile serialization, history isolation, message limits, delivery
indicators, and self-tell display. Emulator updates preserve both saved profiles,
leave the manual credentials blank, and start offline. Manual testing has
exercised Quarm login, zone entry, received chat, and outbound tells. The selected
world is `The Project Quarm Server Server`, including TAKP's appended suffix.

The networking crate fixes the zone port's byte order and now announces DLL
version 7 before zone admission completes. Exact version packets and requests
before/after admission pass a synthetic localhost-zone regression. A live retest
confirmed that Quarm connects without the outdated-client warning. Broader
item-link, long-duration connection, and reconnect coverage remain outstanding.
The networking dependency uses the library's `main` branch.

## 1. Persist settings and protect saved credentials

Implemented: persistent server, channel filter, and follow-latest
preferences; independent OS-protected character/server/account/password profiles;
offer to save when a manual connection starts; tap a saved character to unlock
and connect; edit/delete controls and swipe-to-delete confirmation; migration from
the previous single-login entry; reconnect without repeated unlock prompts.
Confirmed credential rejections stop retries and show an actionable error. Manual
character names are not restored into the form. Configurable chat history is also indexed by character and server.
No plaintext credential storage or decrypted password return to the webview.

Validation:
- Android APKs build for ARM64 and x86_64. Emulator checks cover device PIN storage,
  two independent profiles surviving restart, cancelled credential-retaining
  edits, and isolated deletion. The current vault upgrades AES-only entries
  with one unlock; subsequent edits also use one fresh unlock. Altered labels
  and keys copied from another profile are rejected. Saving newly entered
  credentials needs no extra authentication. Existing saved entries were
  preserved during these checks.
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
The catalog contains 12,122 entries in P99 Gear Planner's original SQLite snapshot
of public Wiki/PEQ reference data. Read-only lookups format matching rows on demand,
with a small temporary name index instead of retaining all formatted items in memory.
Item matching checks both names and reference IDs, and
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

Implemented: an Android foreground service with an ongoing connection notification,
native Stop action, session-scoped wake lock, and bounded native chat buffering
while the webview is hidden. Permission denial does not prevent login; the app
explains when notification controls or foreground support are unavailable.
The foreground service is Android-only and preserves iOS best-effort behavior without adding
unsupported background modes. See the [implementation notes](src-tauri/session-service/README.md).

An Android emulator test kept the same P99 session connected for two minutes
with the screen locked, receiving 771 packets and two additional communication records.
The notification's Stop action worked while the app was hidden, released the
service and wake lock, and delivered the final state when the UI resumed.

Remaining: physical-device battery/Doze testing, reconnect and process-termination
validation, and iOS/Xcode validation. iOS has no equivalent always-on socket service.

## 4. Send chat and reply to tells

Implemented: a channel selector, a one-to-four-line text box, and an icon Send
button. Say, Tell, Guild, Auction, OOC, and Shout use the networking crate's typed
outbound commands. A swipe in either direction selects the
message author for a Tell, regardless of its original channel, without sending. Drafts persist across tab switches and failed
submissions, and clear for a new login. Multiline input sends as one message with
spaces replacing line breaks.

Sent-tell echoes on P99 channel 14 display and filter as Tell, including records
from networking crate versions that label that channel unknown.

Native input validation checks message byte limits, recipient names, connection
health, and session identity. The bounded command queue drops pending messages
on disconnect and never replays them after reconnect. Unit tests cover the native
queue, UI submission, draft retention, and swipe-versus-scroll behavior. No new
iOS-specific APIs are required; iOS packaging still needs Xcode validation.

Android emulator validation includes the native keyboard staying below a
four-line tell draft, a real swipe selecting the reply recipient, and one Say
message echoed by P99 through the normal connection. The app disconnects cleanly
after testing. Other outbound channels have typed-command tests but have not
been sent from the mobile app in live testing.

## 5. Reading, history, and support polish

Implemented: adjustable text size, compact spacing, higher-contrast colors,
quieter metadata, native dark system bars, phone bottom sheets, and larger action
targets. Incoming unread counts, unread tells, new-message dividers, and a counted
Latest control complement the existing channel filters. Long-press opens the message menu, with a keyboard/screen-reader action control.
The menu supports copy, native sharing, reply, and mute; own messages read **You**
and offer copy/share without self-reply gestures or actions.

Implemented: explicit tell destinations; per-message pending, sent, failed, and
unconfirmed icons; self-tell receive/confirmation pairing for display; reconnect timeline notices; configurable per-character SQLite history with
age/count limits; restart loading, clear confirmation, and text/JSONL exports.
The complete structured item-link data is preserved. Muting does not destroy history.

Implemented: optional native Android tell, guild, and keyword alerts with private
lock-screen notices and optional previews. iOS provides copy/share controls, but
local alerts and native visibility events; it has no persistent background service. About provides version/build
information, credits, source links, and sanitized diagnostic exports.

Validation: synthetic frontend and Rust tests cover history isolation/retention,
settings migration, notification matching/privacy, export structure, message
actions, unread filtering, and send-echo correlation. Platform packaging and
emulator checks are recorded separately from live P99 or physical-device tests.
Remaining: physical Android notification/lock-screen and accessibility checks;
Xcode build and real iOS sharing, appearance, and device-lifecycle validation.

## 6. Direct Android 1.0 release

Prepared: synchronized app versions and Android versionCode; permanent production
signing identity; new-tag-only GitHub release workflow with checks, signing,
certificate/packaging verification, and public checksums/build metadata. The
release is an ARM64 APK and does not use Google Play. Installation, migration,
privacy, license, and maintainer release instructions are included.

The user reports that another tester confirmed basic functionality on a prior
physical-phone build. The current candidate's physical-device testing is being
handled separately. No 1.0 tag is created as part of preparation. Remaining before
broad publication: current-candidate device results and an independent signing-key
backup. The maintainer has resolved the licensing review and accepted item-data
redistribution with attribution.
