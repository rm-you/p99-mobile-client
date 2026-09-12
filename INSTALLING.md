# Install and update on Android

P99 Mobile Chat is distributed directly through
[GitHub Releases](https://github.com/rm-you/p99-mobile-client/releases).
No Play Store installation or project account is required.

1. Download `p99-mobile-chat-VERSION-arm64.apk` from the selected release.
   ARM64 is the phone build; x86 emulator APKs are not phone releases.
2. Open the download on your phone. If Android asks, allow your browser or file
   manager to install apps from this source. You can revoke that permission after
   installation. Device management and Android verification settings may impose
   additional installation requirements.
3. Log out of the graphical game client, open **P99 Mobile Chat**, and use
   **New connection** to enter your account, password, server, and character.
4. Choose whether to save the login when prompted. Android device authentication
   must be configured to use protected saved logins. Saving chat history and
   enabling message alerts are separate, optional Settings choices.

Use **Disconnect** or the connection notification's **Stop** action for a clean
logout. Force-stopping or losing the process can leave the game's login timeout
in effect temporarily.

## Updating a production installation

Download the newer APK from GitHub Releases and open it to update in place.
The production application ID and signing certificate remain the same; preferences,
saved credentials, and retained chat should survive the update. There is no
automatic updater or background release check. Release notes identify changes.

Each release includes `SHA256SUMS` and `build-info.json`. The former checks download
integrity; the latter identifies the source commit, dependency revision, and
public signing-certificate fingerprint. The repository's `release-signing.json`
records that production fingerprint. Android checks the signature during install.

## Moving from a development-signed APK

The earlier `0.1.0-test` APKs use a development certificate. An ordinary Android
update cannot switch to the production certificate under the same application ID.

Before a one-time reinstall, export any history you want to retain and make sure
you know the account, password, server, and character for each saved entry. The
app intentionally cannot export saved passwords. Then disconnect, uninstall the
development build, install the production APK, and save your characters again.
Uninstalling deletes the old app data and keys. Chat exports remain readable
files, but this version does not import them back into the app.

Do not uninstall a production installation just to apply a normal update. A
signature mismatch after the production transition should be investigated before
removing its data.

## Known device limits

The packaged minimum is Android 7/API 24; keep Android System WebView updated.
Physical-device background endurance and power policies vary. A previous build's
basic phone functionality was reported working; the current release candidate
still needs its own physical-device test. The repository contains iOS source,
but this release distributes Android APKs only.

See [privacy](PRIVACY.md) for saved data, backup, notifications, and exports.
