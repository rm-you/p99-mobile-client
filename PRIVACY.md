# Privacy

P99 Mobile Chat is a community client maintained at
[rm-you/p99-mobile-client](https://github.com/rm-you/p99-mobile-client).
It connects directly to the EverQuest login service and the selected Project 1999
world and zone servers. The project does not operate a relay, account service,
analytics service, advertising service, or automatic crash-reporting endpoint.

## Login and saved characters

Your account and password are used to authenticate with the game login service.
Character selection and game traffic go to the selected server using the game's
existing protocol. This app does not add end-to-end encryption to game chat.
The active network worker keeps login credentials in memory to reconnect. A
clean disconnect ends that worker; reopening the app requires another login.

Saving a character is optional. On Android, each saved login is encrypted with an
authentication-bound Android Keystore key. Unlocking it requires a supported
biometric or device credential. Encrypted credential files are stored in Android's
no-backup directory. The app does not return saved account/password values to the
webview. Character names and server labels remain visible in the saved list.

Changing device security settings, uninstalling, or moving to a different phone
can make saved keys unavailable. Enter and save the login again in that case.
Deleting a saved character removes its saved credentials and profile entry.

## Preferences and messages

Preferences such as channel filters, text size, and notification choices are saved
locally. The current chat view keeps up to 1,500 records in memory.

**Save chat on this device** is off by default. If enabled, a separate SQLite
database retains messages, sender and character names, server identity,
timestamps, and complete item-link data. It is protected by the app sandbox and
device storage protection, not by the credential vault's biometric prompt.
Configured age/count limits apply when the store is used. **Clear saved history**
deletes the database's messages; clearing the current view only clears memory.

Credentials are excluded from system backup. Nonsecret preferences, profile
labels, and saved chat may be included in Android system backup or device
transfer depending on OS/device settings. Copies outside the running app's
storage are not removed by its history-retention controls.

## Notifications, clipboard, and exports

Chat alerts are optional local Android notifications produced while the active
session receives messages in the background. Previews are off by default; public
lock-screen notices contain neither sender nor chat text. Android's notification
settings ultimately control presentation.

Copy and Share run only when requested. Copy puts the selected message on the
system clipboard. Share grants the chosen app access to an export file; the
recipient app's handling is outside this project's control. Temporary share
files use unique names; old files expire on the next export, with at most ten
retained in the app cache. Android may also clear the cache. Copies made by other
apps remain until deleted there.

Diagnostics are exported only on request. Their fixed field list contains app
and networking versions, platform information, counters, and storage status.
It excludes passwords, accounts, character names, chat text, keywords, raw
packets, and local filesystem paths. Review anything you choose to share publicly.

## Item details and external links

Item lookup uses the bundled offline database. It does not scrape the Wiki or
contact the database publisher at runtime. Tapping Wiki, source, or support links
opens your browser, where the destination's privacy practices apply. Downloading
an APK from GitHub is also subject to GitHub's policies.

The app does not create a separate P99 Mobile Chat account. Game account and
message handling on the login/game servers is controlled by their operators.
For app privacy questions, open a [GitHub issue](https://github.com/rm-you/p99-mobile-client/issues)
without including credentials or private chat.
