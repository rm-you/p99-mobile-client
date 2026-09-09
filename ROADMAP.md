# Follow-up priorities

## 1. Persist settings and protect saved credentials

Save the selected server, character, and display preferences between app runs.
Store EQ account credentials in OS-backed secure storage, separate from ordinary
settings. Support Face ID / Touch ID on iOS and Android biometric or device
credential unlock, with appropriate handling for devices without biometrics.

Unlock saved credentials when starting a session; keep the active session able
to reconnect without repeatedly prompting. Provide a clear way to forget saved
credentials. Never persist passwords in plaintext files or webview storage.

## 2. Improve chat presentation and item links

Add clearer formatting and channel colors. Make item links tappable and open
an item detail modal populated from the P99 Wiki, with loading/error states,
caching, and a link to the source page.

These are planned features. The current app keeps settings and credentials in
memory and shows item labels without a detail modal.
