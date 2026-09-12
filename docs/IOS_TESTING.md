# Building and testing iOS without a personal Mac

Development can happen on Windows/WSL. The `iOS checks` workflow uses a standard
GitHub-hosted Mac for Xcode and Simulator. No game credentials or real game
connections are used in CI. The first physical test target is an iPhone 15 Pro Max.

## Checks and candidates

The workflow builds the full release app, including both Swift plugins, with
bundled web assets. It launches a disposable iPhone simulator, checks settings
persistence and resume through XCTest, and captures screenshots/results. It then
builds a device IPA and checks its identity, Face ID metadata, and privacy manifest.
Device packaging still runs after a UI-test failure to collect both results;
the overall workflow and TestFlight gate require all checks to pass. Restart tests
allow the shared UI's debounced autosave to finish before terminating the process.

On `codex/ios-parity`, only a commit message containing `[ios-ci]` opts into the
Mac job. Ordinary development commits skip it. Main and pull-request checks run
normally. Remove this temporary branch trigger before opening a PR to avoid
duplicate branch/PR builds. The job also supports manual dispatch once the
workflow is on the default branch. Rust dependencies/build products are cached;
artifacts expire after seven days.

The `ios-unsigned-device-<commit>` artifact is an **unsigned IPA**, not a TestFlight
or directly installable distribution build. It is a candidate for local re-signing
with AltStore Classic; that installation path requires separate device validation.
The Simulator embeds a disposable test identity for Keychain metadata access,
separate from its ad-hoc Mac host signature. Simulator-only linker settings keep
that identity out of device candidates.

On a Mac, the equivalent build steps are:

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run tauri -- ios init --ci
python3 scripts/prepare_ios.py --simulator
python3 scripts/resolve_ios.py
npm run tauri -- ios build --ci --target aarch64-sim --no-sign
python3 scripts/ios_smoke.py
npm run tauri -- ios build --ci --target aarch64 --no-sign
```

Xcode and `xcodegen` must be installed. App and native plugin deployment minimums
are iOS 15. Builds use an iOS 26 SDK on the hosted runner.

### Verified checkpoint

[Commit 74be230's successful hosted run](https://github.com/rm-you/p99-mobile-client/actions/runs/34696183202)
compiled the full app and both Swift plugins. Its iPhone 15 Pro Max Simulator
on iOS 26.5 passed the packaged-app XCTest: startup without a saved-login error,
default-on history, an opt-out retained across termination/relaunch, and resume
from the home screen. Screenshots and the XCTest result are attached to the run.
No game credentials were entered and no game connection was attempted.

The same run built a 4.6 MB unsigned ARM64 device IPA with iOS 15 minimum,
the correct app identity, Face ID purpose text, and the app privacy manifest.
The device executable contains no Simulator test identity. AltStore re-signing,
physical-device behavior, and TestFlight signing/upload remain unverified.

Local checks also passed: 64 frontend tests, 37 Rust tests, Android Clippy with
warnings denied, production frontend build, formatting, and 10 packaging-script
tests. These are separate from the real-device checks below.

## One-time TestFlight setup

This stage requires paid Apple Developer Program membership. It is independent
of Android signing and does not require a public App Store release.

1. Register `io.github.rmyou.p99mobile` in the developer portal and create its iOS
   app record in App Store Connect. Keep this identifier stable for updates and
   saved Keychain data.
2. Create an Apple Distribution certificate and an App Store provisioning profile
   for that identifier. A local OpenSSL-generated private key/CSR can be used with
   Apple's web portal; a personal Mac is not required. Export the certificate and
   matching private key as a password-protected PKCS#12 file. Keep an independent
   encrypted backup of the signing material.
3. Create an App Store Connect API key with upload access. Download its `.p8` key
   once and retain it privately. Record its key ID and issuer ID.
4. Answer Apple's encryption questions for this app. It uses OS secure storage
   and legacy login cryptography in the Rust networking dependency, so do not
   assume that it uses only OS-provided encryption. Set the configuration below
   to the result of that assessment and provide any documentation Apple requests.
5. Create the protected GitHub environment **ios-testflight**. Restrict allowed
   branches/tags to reviewed release sources and require approval if desired.

| Environment value | Kind | Contents |
| --- | --- | --- |
| `APPLE_DEVELOPMENT_TEAM` | Variable | Apple team identifier |
| `APPLE_API_ISSUER` | Variable | App Store Connect issuer identifier |
| `APPLE_API_KEY` | Variable | API key identifier |
| `IOS_USES_NON_EXEMPT_ENCRYPTION` | Variable | Explicit `true` or `false` from the encryption assessment |
| `APPLE_API_KEY_CONTENT` | Secret | Entire `.p8` private key |
| `IOS_CERTIFICATE` | Secret | Base64-encoded signing PKCS#12 file |
| `IOS_CERTIFICATE_PASSWORD` | Secret | PKCS#12 password |
| `IOS_MOBILE_PROVISION` | Secret | Base64-encoded App Store provisioning profile |

Use GitHub's secret UI or `gh secret set` with stdin, not secret values in shell
arguments. No Apple account password is needed by the workflow. Signing credentials
are scoped to the build/upload step; temporary files are removed afterward.

## Upload a beta

After the workflows are merged onto the default branch, run `iOS TestFlight`
manually for a commit with successful **Checks** and **iOS
checks** runs. Supply an unused iOS build number from 1 to 9999. This changes the
iOS bundle build number only; it does not publish an Android release or move a tag.

The workflow validates the environment, builds with distribution signing, checks
the IPA's identity/resources/entitlements, validates it with Apple, and uploads it.
It intentionally stops if signing or encryption configuration is incomplete.
After Apple processes the upload, assign it to an internal TestFlight group and
install it on the iPhone. External testers may require beta review. TestFlight
builds expire after 90 days.

Sources: [Tauri iOS signing](https://v2.tauri.app/distribute/sign/ios/),
[Apple certificate requests](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request),
[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/),
and [Apple encryption information](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

## Native behavior and remaining device checks

The iOS plugin forwards native visibility to Rust without starting a background
task. Delivery waits until both the native app and WebView are visible. Existing
connection health aging and the networking crate's retry loop handle interrupted
sessions; in-memory credentials and buffers do not survive process termination.
Opening the app after termination never automatically unlocks a saved account.

Local tell/guild/keyword alerts ask permission on explicit opt-in or a test action.
Receiving a message never requests permission. Notifications cannot receive chat
after iOS suspends the process. The app keeps best effort while executable and does
not deliberately disconnect merely because it enters the background.

Saved-character edits that keep the account/password use one native Keychain
operation and one authentication context, then invalidate it. Simulator startup
and UI tests do not establish real Face ID/passcode behavior. Use the device matrix
in [IOS_PARITY.md](IOS_PARITY.md) for saved-login authentication, real-server chat,
keyboard/reply gestures, item links, notifications, screen lock, network changes,
sharing, and clean logout.

The app privacy manifest declares file metadata access within its own container
and elapsed-time measurement for timers. The app does not send analytics or
tracking to its developers; direct game-server traffic and user-requested exports
are described in [PRIVACY.md](../PRIVACY.md). Validate Apple's final bundle report
and any additional dependency declarations before distribution.
