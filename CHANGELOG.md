# Changelog

## Unreleased

- Add iOS native lifecycle events, opt-in local chat notifications, and a single
  Keychain authorization for edits that retain account credentials.
- Add hosted iOS Simulator checks, unsigned device candidates, and a manually
  triggered TestFlight workflow. Physical iPhone validation remains required.

- Save chat on this device by default when no saved history preference exists,
  with the existing seven-day and 5,000-message per-character/server limits.
  Preserve saved on/off choices when upgrading; alerts remain off by default.

## P99 Mobile Chat 1.1.0

- Show pending/sent indicators on each outgoing message, combine self-tell
  receipt/confirmation pairs, and remove swipe/reply from your own messages.

- Reduce Android credential-retaining edits to one device unlock while keeping
  per-use protection and support for previously saved profiles.

- Add Project Quarm to manual connections, protected saved characters, and
  per-server chat history, using the shared crate's TAKP/EQMac protocol.
- Apply each server's outbound chat limits and label Quarm item details as P99
  reference data.
- Update the networking dependency with Quarm zone-port handling and DLL version
  announcements. Live Quarm login, chat, and the removal of the outdated-client
  warning have been confirmed.
- Preserve release SDK setup fixes and support manually retrying an existing
  release tag without moving it or replacing published assets.

## P99 Mobile Chat 1.0.0

- Direct P99 Green/Blue login with selectable saved characters and authenticated
  Android credential storage.
- Sending to Say, Tell, Guild, Auction, OOC, and Shout; swipe either direction to
  reply by tell, with an expanding composer and explicit recipient.
- Clear submitted, echoed, failed, and unconfirmed send states; failed drafts
  remain editable and are never automatically resent.
- Compact chat spacing by default, 12–22px text, optional higher-contrast colors,
  collapsible channel/search filters, and a dedicated app icon.
- Offline SQLite item details, full zone names, and phone-sized item sheets.
- Unread counts, a new-message divider, unread-tell navigation, and counted
  follow-latest controls.
- Long-press message actions for copy, share, reply, and mute, with accessible
  keyboard/screen-reader controls and outside-tap dismissal.
- Optional per-character SQLite history with age/count retention and text/JSONL
  exports preserving complete item links.
- User-started Android foreground connections and optional private tell, guild,
  and keyword notifications; disconnect and notification Stop end the session.
- Connection-gap notices, sanitized diagnostic exports, privacy documentation,
  and versioned production-signed ARM64 releases.

## Compatibility and limitations

The APK targets ARM64 Android phones, with Android 7/API 24 as the packaged
minimum. Android 11+ supports a strong biometric or device PIN/pattern/password
for saved credentials; Android 7–10 requires a supported strong biometric.
Networking in the background remains subject to device power and process limits.
Group/Raid sending, slash-command execution, and movement are not supported.
Item facts are a community reference snapshot and can contain gaps.

Existing APKs signed with the development certificate cannot receive this APK as
an ordinary update. See [installation and migration](https://github.com/rm-you/p99-mobile-client/blob/main/INSTALLING.md). Production
updates use the same application ID and release key to preserve app data.
