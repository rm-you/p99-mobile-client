# Background chat sessions

The Android service in this plugin keeps an explicitly started chat session running with
an ongoing notification. The Rust client still owns the UDP sockets, credentials,
and retry loop. Only a random session ID and generic connection state reach the
Android service. The ongoing connection notification contains no character names, account details, or
chat text. Separate opt-in chat alerts can include a sender and preview.

The Android plugin also initializes keyboard insets when the WebView loads.
The activity uses `adjustResize`; the native content container consumes the
keyboard's bottom inset so the composer stays above it in the edge-to-edge
layout. System-bar insets remain available to the WebView's CSS safe areas.
This layout setup runs while logged out too and does not start the service or
acquire a wake lock. It adds no native iOS behavior.

## Lifecycle

- Login validates the request and checks that no other worker is active before
  starting the service. Android 13+ requests notification permission at this point.
  Denying that permission still allows the foreground service; Android shows it
  in Active apps, and the app explains the missing notification.
- The service enters the foreground before the worker starts network activity.
  Its notification displays connecting, connected, reconnecting, or disconnecting.
  Starting another session cannot silently replace the existing one.
- The notification's Stop action sends a native Tauri channel event directly to
  the Rust cancellation token. It does not need JavaScript to run. A session ID
  prevents stale actions from stopping a newer connection.
- The worker closes its sockets before releasing the service and its partial
  wake lock. Explicit app exit and removal from Recents request shutdown too.
  Android force-stop can terminate the whole process without a cleanup callback.
- `START_NOT_STICKY` prevents automatic login after process death. Reopen the app
  and unlock a saved character or enter credentials to start again.
- While the webview is hidden, Rust retains at most 1,500 chat records and the
  latest status events. Resume replays that buffer. Transport diagnostics are
  discarded instead of queued for the UI. This is bounded in-memory history;
  it does not survive process termination.
  One background dispatcher delivers events without holding the queue lock, so
  a slow webview cannot block the network worker or native visibility callbacks.

## Platform limits

The service declares Android's `specialUse` type with a manifest explanation for
live chat and heartbeats over a legacy UDP protocol without push support. Google
Play distribution requires declaring that use case and having it reviewed.
See [foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

A foreground service and wake lock improve ordinary background execution but
do not exempt the app from Doze. Android can still suspend network access,
terminate the process, or apply manufacturer-specific battery restrictions.
Users can adjust battery optimization in Android settings when longer sessions
are needed. The app does not change those settings automatically. Maintaining a
live game connection uses more battery than push messaging. See
[Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby).

iOS has no general-purpose equivalent for an indefinitely running chat socket.
The iOS native implementation provides visibility events, local notifications,
clipboard and sharing, without requesting persistent background execution.
The existing iOS best-effort connection and retry behavior remain, with
bounded retention during webview suspension. iOS can suspend the whole process,
so packets cannot be collected continuously after that point. Background tasks
and silent notifications do not provide an always-on socket. Reliable delivery
while suspended would require a separately running client and push delivery.
See [Apple's background execution guidance](https://developer.apple.com/forums/thread/685525).

## Validation

Rust tests exercise stale Stop actions, bounded hidden-message retention, status
coalescing, and ordered replay. UI tests cover missing background support,
notification denial messaging, and visibility transitions. Android testing should
also cover a live session while switching apps and locking the screen, notification
Stop with the app hidden, service/wake-lock cleanup, and process termination.

The API 36 emulator retained the same live P99 session through two minutes with
the screen locked (771 additional packets and two communication records). Notification
Stop while hidden ended the service, released its wake lock, and replayed the
finished state on return. Both ARM64 and x86_64 APKs build; only x86_64 was run
in the emulator. CI also builds the ARM64 APK to compile native Kotlin changes.

Test Doze on an emulator or test device with `adb shell dumpsys deviceidle force-idle`;
restore it with `adb shell dumpsys deviceidle unforce` and
`adb shell dumpsys battery reset`. Verify recovery instead of assuming the service
bypasses idle restrictions. Physical-device battery behavior and an iOS/Xcode
build require separate validation.

For keyboard layout, check the actual device display with the soft keyboard
visible, including a multiline draft and a tell recipient. The composer must
remain above the keyboard; dismissing and reopening it must restore the original
viewport without accumulating padding. A WebView-only screenshot can hide an
overlap with the native keyboard and is not sufficient for this check.

## Chat utilities

Android applies a dark activity theme and light status/navigation icons. Both
mobile platforms expose bounded copy/share operations. Android exports only files
under the dedicated `shared-chat` cache directory through a non-exported
FileProvider with temporary URI grants; iOS presents a UIActivityViewController.
No arbitrary path or credential-reading command is exposed. Exports use unique temporary
cache files, with at most ten retained. Files older than a day are removed at the
next export; the OS can also clear its cache. Externally shared copies
are not affected by clearing chat history.

Rust evaluates optional incoming-tell, guild, and keyword alerts before WebView
buffering. Android posts them on the separate **Chat messages** notification
channel, with a generic lock-screen public version. Alert generation does not
start a service, wake up a disconnected client, or reconnect a character. Only an
explicit login starts the existing foreground service. iOS does not implement
a persistent background service; local alerts can be delivered only while the
process is executing. Permission is requested on explicit opt-in or testing.
