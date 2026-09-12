# User guide

[Back to the README](../README.md) · [Install or update](../INSTALLING.md)

- [Connecting and saved characters](#connecting-and-saved-characters)
- [Reading chat](#reading-chat)
- [Sending and replying](#sending-and-replying)
- [Item details](#item-details)
- [History and exports](#history-and-exports)
- [Background connections and alerts](#background-connections-and-alerts)
- [Troubleshooting](#troubleshooting)

## Connecting and saved characters

Log out of the graphical game client before connecting. In **Connection**, choose
**P99 Green**, **P99 Blue**, or **Quarm** and enter your account, password, and
existing character's name. Tap **Login** to join the zone where you left them.

P99 uses an **EQEmulator login-server account**. Quarm uses a **TAKP login-server
account**. The sign-in progress bar advances as connection steps finish; its
percentage is not a time estimate.

When saving is available, the app offers **Save** or **Not now** as the connection
starts. Saving keeps the character, server, and login together. Next time, tap the
saved character and authenticate with your device to connect. You can always use
**New connection** without saving; its character field starts blank.

- **Edit:** tap the pencil. Leave both account and password blank to keep the
  existing login, or enter both to replace it. Keeping the login requires one unlock.
- **Delete:** swipe left or tap the trash icon, then confirm.
- **Upgrade an older saved login:** **Previous saved login** lets you assign it a
  character and server. The old entry remains until the new one is saved successfully.

Saved credentials are encrypted and require supported device authentication to
unlock. Character and server labels remain visible while locked. See
[privacy](../PRIVACY.md#login-and-saved-characters) for storage and backup details.

## Reading chat

Expand **Filters** to search the latest 1,500 messages or toggle channel pills.
All selectable channels start enabled; **All** and **None** change them together.
Filters start collapsed and keep applying while collapsed. Group and Raid are
not offered in the filter list.

Chat uses classic EQ colors with yellow-orange OOC. In **Settings**, choose text
sizes from 12–22, compact spacing (on by default), or a higher-contrast palette.
The header shows the full zone name, and empty guild MOTDs are hidden.

Scroll up to pause automatic following. **Latest messages** takes you back to the
bottom and counts new arrivals. The Chat badge and unread-tell shortcut show
incoming unread messages; a divider marks where new messages begin. Filtered-out
messages stay unread. Unread counts reset with the session.

Long-press a message to copy, share, reply, or mute its author. Tap outside the
menu to close it. Screen readers have a message-action control, which also appears
on keyboard focus. Muting hides an author's messages and prevents alerts; enabled
history still saves them. Unmute authors in **Settings**.

**Clear** empties the current view. It does not erase saved history.

## Sending and replying

While connected, choose **Say**, **Tell**, **Guild**, **Auction**, **OOC**, or
**Shout**, then type and tap the paper-plane icon. The text box grows from one to
four lines. Enter adds a line; Ctrl/Cmd+Enter submits. Line breaks are sent as
spaces in one game message. Group, Raid, emotes, and slash commands are not offered.

To reply, swipe another player's message left or right. This always starts a
**Tell** to its author, whatever the original channel. You can also choose Tell
and enter a recipient. Your own messages are labeled **You** and cannot be swiped
to reply, but can still be copied or shared.

The small icon on an outgoing message shows its state:

| Icon | Meaning |
| --- | --- |
| Clock | Sending; waiting for confirmation. |
| Checkmark | The server confirmed the message. This is not a read receipt. |
| Amber clock | Unconfirmed after 15 seconds; the message may still have been sent. |
| Warning | Submission failed. Your draft remains available to retry. |

Drafts survive tab changes and failed submissions, but clear when starting a new
login. Unsent messages are not replayed on reconnect. Tells to yourself appear as
one row even if the server sends both a received tell and a sent confirmation.
Separate repeated sends remain separate. Only server-received records enter
history and exports.

## Item details

Tap an item link to open its details. Lookup works offline using the bundled
catalog; **View on P99 Wiki** opens your browser only when tapped.

The catalog is P99 reference data. Quarm stats may differ, and some items may be
missing or have conflicting identifiers. In those cases the app shows details
as unavailable. See the [catalog notes](../src-tauri/data/README.md) for its source.

## History and exports

**Save chat on this device** is off by default. Enable it in **Settings** to keep
messages by character and server, including messages received in the background.
You can view saved history while disconnected; when saving is enabled, it also
loads before a new login.

Choose a retention period of **1, 7, or 30 days** and a limit of **1,000, 5,000,
or 10,000 messages per character/server**. A 20,000-message device limit also
applies. Old messages are removed when history is used, without waking an inactive
app. Turning saving off stops new writes but keeps existing history.
**Clear saved history** deletes history for every character after confirmation.

History contains player names and chat text. It is separate from saved
credentials and is **not protected by the login's biometric prompt**. Credentials
are never included. Live chat continues if history storage fails.

Export the selected character's retained messages through the share sheet:

- **Text** is formatted for reading.
- **JSONL** preserves structured records, including item-link IDs and original
  link data, for other tools.

Exports include all retained messages, even though the chat view displays only
the latest 1,500. Exports are limited to 20 MB; reduce retention if needed.
Shared copies are not removed when you clear history. This version does not
import chat exports back into the app.

## Background connections and alerts

The app tries to stay connected when you switch apps or lock the screen. Android
shows an ongoing connection notification while a session is active. Use its
**Stop** action or the app's **Disconnect** button for a clean logout. Disconnect
asks for confirmation. The connection service stops when the session ends.

Android can still suspend networking or stop the app, especially under battery
restrictions. If the process survives, it can retry the connection. If Android
ends the process, reopen the app and log in again. Timeline notices identify
interruptions that may have left gaps in chat. Continuous logging is not guaranteed.

In **Settings**, optional alerts can match incoming tells, guild messages, or up
to 20 comma-separated keywords. They run while the app is in the background and
receiving messages. Your own messages and muted authors do not trigger alerts;
notifications are limited to one every two seconds.

Previews are off by default, and public lock-screen notices omit names and text.
Android's notification permissions and channel settings control what appears.
**Test notification** works while disconnected, so you can check these settings
without logging in. Alerts depend on the live connection; they cannot receive
new chat after Android stops networking.

## Troubleshooting

**The account or password was rejected.** Check the login details and that you
selected the right server. Authentication failures stop retries. Other connection
failures retry automatically while the session remains active.

**The character cannot log in after an abrupt disconnect.** Make sure the
graphical client is logged out, then allow the game's login timeout to expire.
Use Disconnect or the notification's Stop action when possible. Android's
force-stop controls can end the app without a clean game logout.

**Saving a login is unavailable.** Configure supported device authentication.
Android 11+ supports a strong biometric or device PIN, pattern, or password;
Android 7–10 requires an enrolled strong biometric. You can connect without saving.

**A saved login no longer unlocks.** Changing device security settings can make
its key unavailable. Edit the entry with both account and password, or delete it
and save it again. Uninstalling also removes saved credentials.

**Background chat or notifications stop.** Check Android's battery restrictions,
notification permission, and the app's notification channels. Denying notification
permission does not stop the connection service, but hides its notification and
Stop control. Reopen the app if Android has ended its process.

**Need to report an app problem?** **About** has version information and a link
to issues. **Export diagnostics** shares versions and status without credentials,
character names, chat text, keywords, raw packets, or local paths. Sharing chat
is a separate action. See [privacy](../PRIVACY.md) before sharing data.
