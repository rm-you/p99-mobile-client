# iOS parity audit and first-beta plan

Audit date: September 12, 2026. Source reviewed: `96590168fe63a7b0bb0388000ecbd9c161541273`
on `codex/default-chat-history`, including the next-version default for saving chat.
The proposed physical test device is an iPhone 15 Pro Max, reported running iOS 26.6.1.

Most foreground functionality already has shared code or an iOS implementation.
The largest immediate gap is validation: the mobile repository has no iOS build
job, and its Swift plugins and packaged application have not been verified on iOS.
Source coverage is not evidence of a working iPhone build.

## Feature catalog

| Feature | Android implementation | iOS implementation and remaining work |
| --- | --- | --- |
| P99 Green/Blue and Quarm login; receive/send chat | Shared Rust session and protocol crates | Same code path. Validate native linking, DNS, UDP, character entry, authentication failures, sent-message confirmation, and clean logout on iPhone. |
| Channel filters, search, item links, reply gestures, message actions | Shared React UI | Present. Validate WKWebView behavior, keyboard visibility, safe areas, scrolling, text selection, and VoiceOver. Android's keyboard-inset workaround does not validate iOS behavior. |
| Saved characters and protected credentials | Android Keystore and device authentication | Swift Keychain implementation exists with user-presence access control, device-only storage, and Face ID usage text. Validate save, list, unlock, cancel, passcode fallback, edit, and delete. Potential repeated-authentication issue described below. |
| Settings and SQLite chat history | Shared Rust persistence and retention | Same code, including default-on history on this branch. Validate sandbox paths, restart persistence, opt-out, retention, and behavior while the device is locked. No separate app-level encryption is implemented for chat history. |
| Offline item database and item details | Shared SQLite lookup and UI | Present. Verify database packaging and an actual lookup in the built app, plus opening a wiki link. |
| Copy, exports, diagnostics, and sharing | Native clipboard/share bridge | Native `UIPasteboard` and `UIActivityViewController` implementations already exist. Validate the share sheet, Files export, cancel, and exported contents. |
| Tell, guild, and keyword notifications | Native Android alerts; shared matching rules | Missing. Rust dispatch is Android-only and the Swift plugin has no notification methods. Settings correctly hide the unsupported section. Implement permission handling and local notifications before enabling it. |
| Visibility and connection recovery | Native pause/resume events feed Rust; shared event buffering | Only WebView visibility events currently feed the shared code on iOS. Add native lifecycle events and validate stale-connection detection, buffered delivery, and recovery after suspension or network changes. |
| Keeping the connection alive in the background | Foreground service, connection notification, and native Stop control | No corresponding implementation. iOS has no general-purpose equivalent guaranteeing indefinite UDP execution. Preserve best effort and make recovery reliable; do not deliberately disconnect merely because the app loses focus. |
| Native builds and distribution | CI builds APKs; release workflow signs Android artifacts | Missing iOS CI, signed archive/upload workflow, and verified provisioning. iOS icons and Swift package definitions exist but have not been validated in a complete build. |

Evidence: [session](../src-tauri/src/session.rs), [UI](../src/App.tsx),
[Keychain plugin](../src-tauri/secure-login/ios/Sources/SecureLoginPlugin.swift),
[history](../src-tauri/src/history.rs), [preferences](../src-tauri/src/experience.rs),
[sharing plugin](../src-tauri/session-service/ios/Sources/SessionServicePlugin.swift),
[platform dispatch](../src-tauri/session-service/src/lib.rs),
[capability reporting](../src-tauri/src/support.rs), [delivery](../src-tauri/src/delivery.rs),
[checks](../.github/workflows/checks.yml), and [release workflow](../.github/workflows/release.yml).

## Concrete issues to address or verify

### Saved-character edits may authenticate twice

In `save_profile` in [lib.rs](../src-tauri/src/lib.rs), an edit that retains the
stored account/password first calls `unlock`, then `save`. The Swift implementation
creates and invalidates separate `LAContext` instances for these operations; an
existing-entry save uses `SecItemUpdate` with the second context.

This is a code-level risk, not a reproduced iOS defect. Test it explicitly. A native
edit operation that reuses authorization within that one operation is a possible
fix without extending credential access across unrelated actions.

### Lifecycle support should not depend solely on JavaScript

The iOS session plugin currently implements only clipboard and sharing. Unlike
Android, it does not attach native visibility callbacks to the Rust control channel.
Add application/scene lifecycle handling, preserving the shared single-worker and
outbox rules. On resume, refresh connection health and reconcile buffered events;
avoid duplicate connections or replaying an unconfirmed outgoing message.

Distinguish a suspended process from a terminated process: in-memory buffering
survives only the former. After termination, recover saved history and require the
normal authenticated login flow. Messages sent by the game while disconnected
cannot be recovered by adding a mobile buffer.

### Notifications need an iOS implementation, not just a UI flag

Reuse existing Rust filtering and privacy preferences, implement
`UNUserNotificationCenter` authorization/status and local alerts, and replace
Android-specific permission wording when enabling the capability. Continue hiding
the section until the platform implementation exists. Apple's
[notification API](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
provides the native foundation.

Local notifications do not keep the socket alive. They can announce newly received
chat only while our process is executing. A service that remains connected elsewhere
and sends push notifications would be a separate architecture, not phone-only parity.

### Background execution has a platform ceiling

Apple documents default suspension and the lack of a general continuous-background
mechanism. Bounded background time can finish an in-flight save or other finite work;
it cannot guarantee an always-connected chat session. See
[Apple's background execution guidance](https://developer.apple.com/forums/thread/685525).

iOS 26 adds `BGContinuedProcessingTask`, including network-capable work. Apple describes
user-started tasks with measurable progress and a clear completion condition.
An indefinite chat listener does not fit that model; this is our assessment of its
applicability, not a device test. See
[Apple's iOS 26 session](https://developer.apple.com/videos/play/wwdc2025/227/).

## Development without a personal Mac

Use Windows/WSL for source changes and a GitHub-hosted Mac for Xcode, Swift compilation,
linking, Simulator, and signing. Standard hosted-runner compute is free for public
repositories; use normal runners and bounded artifact retention.
[GitHub billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

1. **Build and launch the complete app in CI.** Add a macOS job, install the Apple
   Rust targets, initialize the Tauri iOS project, and compile both native plugins
   into a Simulator app. Capture launch logs, screenshots, and test results. A Rust
   cross-check alone does not exercise Swift or app packaging. This phase needs no
   paid distribution account.
2. **Resolve the native integration gaps.** Start with lifecycle handling and
   credential flows, then notifications. Use synthetic data and local test endpoints
   for repeatable CI checks, keeping fixture configuration out of release builds.
3. **Prepare a device archive.** Select a supported minimum iOS version consistently
   across the generated project and plugins. Verify icons, Face ID metadata, native
   dependencies, privacy manifests, and encryption declarations in the actual bundle.
   Current configuration has no explicit iOS build-number/signing setup; add a unique
   upload build number without coupling every beta to an Android release.
4. **Add a separate, manually triggered TestFlight workflow.** Configure the app record,
   signing identity/provisioning, and App Store Connect API credentials. Keep signing
   secrets in the protected release environment and out of PR jobs. Start with an
   internal tester build for the owner, then expand testing when useful.
5. **Validate on the iPhone.** Use the matrix below and retain build IDs with each
   report. Fix issues here, rebuild on the hosted Mac, and install the next beta.

Tauri supports CI signing and iOS archive/export workflows:
[iOS signing](https://v2.tauri.app/distribute/sign/ios/) and
[iOS distribution](https://v2.tauri.app/distribute/app-store/#ios).
Apple currently requires Xcode 26 or later and an iOS 26 SDK for uploads; this is an
SDK requirement, not a requirement to set the deployment minimum to iOS 26.
[Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).

## Apple account and installation options

Installing AltStore Classic does not establish paid Developer Program membership.
It supports free accounts, and its Settings account view distinguishes free and paid
accounts. Free-account sideloaded apps require periodic refresh, normally within seven
days. [AltStore account and refresh documentation](https://faq.altstore.io/altstore-classic/your-altstore).

TestFlight distribution requires Apple Developer Program membership, currently
US$99/year. Check the Account tab in the Apple Developer app for membership status or
enrollment. The owner confirmed having only a free account; Simulator work can
proceed before deciding whether to enroll.
[Apple Developer Program](https://developer.apple.com/programs/) and
[Developer app account instructions](https://developer.apple.com/help/account/membership/enrolling-in-the-app).

TestFlight does not require publishing a public App Store release, but it does require
an App Store Connect app record and processed build. Internal and external testing
have different review paths, and beta builds expire after 90 days.
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

AltStore is also a possible early sideloading route for a CI-built device IPA if paid
membership is unavailable. That packaging/re-signing route remains untested here;
it still needs the hosted Mac build and does not validate TestFlight signing or
update behavior.

## First iPhone test matrix

| Test | Expected result |
| --- | --- |
| Fresh install, start, navigate | No crash, development server dependency, or sample messages. Correct icon, safe areas, and offline item data. |
| Manual login and wrong password | Correct server/character; useful progress; invalid credentials stop retries. |
| Saved-character lifecycle | List without exposing credentials; Face ID and passcode fallback; cancellation works; edits avoid unnecessary repeat prompts; delete affects only the chosen entry. |
| Receive, send, and reply | Correct channels and item links; composer stays above keyboard; one sent row and accurate confirmation; own messages cannot trigger self-reply. |
| Restart and saved history | Settings and history persist; explicit history opt-out remains off; clearing history removes it. |
| Copy and share | Text, JSONL, and diagnostics export through native UI with intended content; cancellation is harmless. |
| Short app switch and longer screen lock | Best effort while executable; honest state and bounded recovery on return; no false promise that missed chat was captured. |
| Wi-Fi/cellular change and airplane mode | No duplicate worker, uncontrolled retries, or replayed sends; clear recovery or login action. |
| Notifications, once implemented | Permission acceptance/denial, test alert, privacy previews, and filtering work while the process can receive chat. |
| Disconnect, force quit, relaunch | Clean explicit logout when possible; no autonomous login or secret exposure after termination. |

The first useful beta should prove foreground login/chat, protected saved characters,
items, history, sharing, and predictable resume behavior. Continuous background
reception remains a platform limitation, even after the implementation gaps are closed.
