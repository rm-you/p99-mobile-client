# Direct Android releases

Releases are APK downloads on GitHub. The workflow has no Play Store/AAB upload.
Normal main/PR checks remain in `checks.yml`; `release.yml` runs only on a **new
push of a `v*.*.*` tag**. Editing/deleting an existing tag does not create another
release. A rerun retains the original event and can retry a failed run.

## One-time signing setup

Keep one production keystore for the application's lifetime. The public identity
is pinned in `release-signing.json`; no private key belongs in the repository.
Back up both the encrypted keystore and its password in an independent encrypted
backup/password manager. Losing them can prevent updates for existing users.

For a new project/fork, generate a key with the JDK's `keytool` (it prompts for
passwords), then export its public DER certificate and record that certificate's
SHA-256 digest. Do not replace this project's existing production key.

```sh
keytool -genkeypair -keystore release.p12 -storetype PKCS12 \
  -alias p99-mobile-chat -keyalg RSA -keysize 3072 -validity 10000 \
  -dname "CN=P99 Mobile Chat"
keytool -exportcert -keystore release.p12 -alias p99-mobile-chat \
  -file signing-certificate.der
sha256sum signing-certificate.der
```

Create a GitHub environment named **android-release**, limited to deployment tags
matching `v*`. Store these two encrypted environment secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the production PKCS#12 keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password; the key uses the same password |

Use `gh secret set --repo rm-you/p99-mobile-client --env android-release NAME`
with stdin or its hidden prompt. Avoid passwords in command-line arguments or
shell history. Repository administrators should restrict release-tag creation to
maintainers. The validation job also requires the tagged commit to be in `main`.
Signing secrets are exposed only to the signing step, after the build/checks pass.

## Prepare a version

1. Update `package.json`, its root entries in `package-lock.json`, the app package
   in `src-tauri/Cargo.toml`/`Cargo.lock`, and `src-tauri/tauri.conf.json` to the
   same version. Keep native plugin versions independent.
2. Increment `bundle.android.versionCode` for every distributed build, including
   release candidates. Never reset or reuse a lower code. The initial production
   value is 1000000, above the older development builds.
3. Update `CHANGELOG.md`, including migration or compatibility changes. Tag formats
   are `vX.Y.Z` and `vX.Y.Z-rc.N`; the tag must exactly match the configured version.
   RC tags create GitHub prereleases.
4. Review dependencies and lockfiles deliberately; the release workflow does not
   run dependency-update commands. Rust 1.97.0, Node 24.13.0, Java 21, Android SDK 36,
   build-tools 36.0.0, and NDK 29.0.14206865 are the release build inputs.
   After dependency changes, regenerate `public/THIRD-PARTY-NOTICES.txt` using
   `cargo metadata --locked --format-version 1 --filter-platform aarch64-linux-android`
   from `src-tauri`, saving its output outside Git, then run
   `python3 scripts/collect_notices.py /path/to/metadata.json` after `npm ci`.
5. Run checks, review the diff for sensitive data, and merge the version to `main`.
   Complete the physical-device test before publishing. Preserve the component
   notices and item-data attribution documented in `DEPENDENCIES.md`.

```sh
python3 scripts/release.py check v1.0.0
python3 -m unittest discover -s scripts -p 'test_*.py'
```

The workflow runs the frontend, Rust, item-catalog, release-validation, and native
Android checks. It then builds an ARM64 release APK, rejects unexpected lockfile
changes, signs it with the production key, and verifies the certificate, app
identity, version/code, non-debuggable status, absence of private runtime/signing
files, and 16 KiB ZIP/ELF alignment. These artifact checks supplement local
credential-value scans; they cannot identify arbitrary unknown passwords.

## Publish

After the release commit is on `main`, create and push one new version tag:

```sh
git tag -a v1.0.0 -m "P99 Mobile Chat 1.0.0"
git push origin v1.0.0
```

This is the publication action. The workflow uploads the signed APK, checksum,
source/build metadata, changelog, privacy notice, license, and dependency notices
to a new GitHub Release. It does not overwrite an existing release or its APK.
For a failed run before publication, fix the cause and rerun where appropriate;
for a changed build, use a new version/tag and larger versionCode. Do not move a
published tag or replace an APK under an existing version.

The Android project is generated on the runner. Plugin manifests/resources and
the icon sync script are the source of native customizations; release signing is
performed with Android SDK tools after compilation, without a private Gradle file.

## Local production signing

Build the same ARM64 release target, then use an external keystore. Set
`ANDROID_KEYSTORE_PASSWORD` privately in the process environment, never in Git.
`ANDROID_HOME` must contain build-tools 36.0.0.

```sh
npm ci
npm run tauri -- android init --ci
npm run tauri -- android build --target aarch64 --apk --split-per-abi
python3 scripts/release.py sign \
  src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk \
  release-output/p99-mobile-chat-1.0.0-arm64.apk --keystore /private/path/release.p12
```

Never install a production APK over a differently signed development app by
deleting its data without planning the [one-time migration](INSTALLING.md).

## Final candidate checks

- Test the exact candidate on a physical ARM64 phone: login, authentication,
  messages/item links, notifications, disconnect/Stop, background/locked-screen
  behavior, network changes, and update/data retention.
- Check privacy/backup behavior and accessibility with device settings actually
  used by testers. Prior-version basic functionality is useful evidence, but does
  not establish the newest candidate's behavior.
- Confirm independent signing-key backups.
- Plan Android developer/app verification for broader direct distribution using
  the [Android Developer Console](https://developer.android.com/developer-verification/guides).
  This is separate from Play Store publication.
