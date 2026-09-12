package io.github.rmyou.sessionservice

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.webkit.WebView
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StartSessionArgs {
    lateinit var sessionId: String
    lateinit var events: Channel
}

@InvokeArg
class SessionArgs {
    lateinit var sessionId: String
    var notice: String = "connecting"
}

/** Process-local state only. An OS restart cannot recover a login or resume a session. */
internal object SessionRuntime {
    var sessionId: String? = null
    var events: Channel? = null
    var pending: Invoke? = null
    var service: ChatConnectionService? = null

    fun stop(id: String) {
        if (sessionId == id) {
            events?.send(JSObject().put("type", "stop").put("session_id", id))
        }
    }

    fun visibility(visible: Boolean) {
        events?.send(JSObject().put("type", "visibility").put("visible", visible))
    }

    fun status(context: Context, active: Boolean): JSObject {
        val notifications = context.getSystemService(NotificationManager::class.java)
        val power = context.getSystemService(PowerManager::class.java)
        return JSObject().put("supported", true).put("active", active)
            .put("notifications_enabled", notifications.areNotificationsEnabled())
            .put("battery_optimized", !power.isIgnoringBatteryOptimizations(context.packageName))
    }
}

/** Lifecycle and permission bridge; the service never owns account credentials. */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class SessionServicePlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        installChatKeyboardInsets(activity)
        ChatUtilities.appearance(activity)
    }

    @Command
    fun testAlert(invoke: Invoke) {
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
                requestPermissionForAlias("notifications", invoke, "testNotificationReady")
            } else ChatUtilities.alert(activity, invoke)
        }
    }

    @PermissionCallback
    fun testNotificationReady(invoke: Invoke) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) ChatUtilities.alert(activity, invoke)
        else invoke.reject("Notifications are disabled.")
    }

    @Command
    fun begin(invoke: Invoke) {
        activity.runOnUiThread {
            if (SessionRuntime.sessionId != null) {
                invoke.reject("A background session is already running.")
                return@runOnUiThread
            }
            val args = invoke.parseArgs(StartSessionArgs::class.java)
            SessionRuntime.sessionId = args.sessionId
            SessionRuntime.events = args.events
            SessionRuntime.pending = invoke
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
                requestPermissionForAlias("notifications", invoke, "notificationsReady")
            } else launch(invoke)
        }
    }

    @PermissionCallback
    fun notificationsReady(invoke: Invoke) { launch(invoke) }

    private fun launch(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val intent = Intent(activity, ChatConnectionService::class.java)
                    .putExtra(ChatConnectionService.SESSION_ID, SessionRuntime.sessionId)
                if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent)
                else activity.startService(intent)
                // onStartCommand resolves only after startForeground succeeds.
            } catch (_: Exception) {
                SessionRuntime.pending = null
                SessionRuntime.sessionId = null
                invoke.reject("Background connection support is unavailable.")
            }
        }
    }

    @Command
    fun update(invoke: Invoke) {
        activity.runOnUiThread {
            val args = invoke.parseArgs(SessionArgs::class.java)
            if (SessionRuntime.sessionId == args.sessionId) SessionRuntime.service?.update(args.notice)
            invoke.resolve()
        }
    }

    @Command
    fun end(invoke: Invoke) {
        activity.runOnUiThread {
            val args = invoke.parseArgs(SessionArgs::class.java)
            if (SessionRuntime.sessionId == args.sessionId) {
                SessionRuntime.pending = null
                SessionRuntime.sessionId = null
                activity.stopService(Intent(activity, ChatConnectionService::class.java))
            }
            invoke.resolve()
        }
    }

    @Command
    fun copyText(invoke: Invoke) { activity.runOnUiThread { ChatUtilities.copy(activity,invoke) } }
    @Command
    fun shareDocument(invoke: Invoke) { activity.runOnUiThread { ChatUtilities.share(activity,invoke) } }
    @Command
    fun alertChat(invoke: Invoke) { activity.runOnUiThread { ChatUtilities.alert(activity,invoke) } }

    override fun onPause() { SessionRuntime.visibility(false) }
    override fun onResume() { ChatUtilities.appearance(activity); SessionRuntime.visibility(true) }
}
