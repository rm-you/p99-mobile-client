package io.github.rmyou.sessionservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/** Keeps the native UDP worker eligible to run while the chat screen is hidden. */
class ChatConnectionService : Service() {
    companion object {
        const val SESSION_ID = "session_id"
        const val STOP = "io.github.rmyou.sessionservice.STOP"
        private const val CHANNEL = "p99-connection"
        private const val NOTIFICATION = 1999
    }

    private var sessionId: String? = null
    private var notice = "connecting"
    private var stopping = false
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    // A bounded lease plus explicit cleanup limits leaks if shutdown is interrupted.
    private val renewWakeLock = object : Runnable {
        override fun run() {
            if (sessionId != null && SessionRuntime.sessionId == sessionId) {
                wakeLock?.acquire(10 * 60 * 1000L)
                handler.postDelayed(this, 5 * 60 * 1000L)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(SESSION_ID)
        if (id == null || id != SessionRuntime.sessionId) {
            // Stale notification actions cannot affect a newer session.
            if (sessionId == null) stopSelf(startId)
            return START_NOT_STICKY
        }
        if (intent.action == STOP) {
            requestStop(id)
            return START_NOT_STICKY
        }
        sessionId = id
        SessionRuntime.service = this
        try {
            val manager = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(NotificationChannel(CHANNEL, "Chat connection", NotificationManager.IMPORTANCE_LOW))
            }
            val notification = notification()
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(NOTIFICATION, notification)
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "P99MobileChat:connection")
                .apply { setReferenceCounted(false) }
            renewWakeLock.run()
            SessionRuntime.pending?.resolve(SessionRuntime.status(this, true))
            SessionRuntime.pending = null
        } catch (_: Exception) {
            SessionRuntime.pending?.reject("Background connection support is unavailable.")
            SessionRuntime.pending = null
            SessionRuntime.sessionId = null
            stopSelf()
        }
        return START_NOT_STICKY
    }

    /** Stop reaches Rust directly, even when JavaScript is paused or the screen is locked. */
    private fun requestStop(id: String) {
        if (id != sessionId || stopping) return
        stopping = true
        update("disconnecting")
        SessionRuntime.stop(id)
    }

    fun update(value: String) {
        notice = if (stopping) "disconnecting" else value
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
    }

    private fun notification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)!!
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, sessionId.hashCode(),
            Intent(this, ChatConnectionService::class.java).setAction(STOP).putExtra(SESSION_ID, sessionId),
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        return builder.setSmallIcon(R.drawable.ic_chat_connection)
            .setContentTitle("P99 Mobile Chat")
            .setContentText(when (notice) {
                "connected" -> "Connected · receiving chat"
                "reconnecting" -> "Reconnecting to chat…"
                "disconnecting" -> "Disconnecting…"
                else -> "Connecting to chat…"
            })
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        sessionId?.let(::requestStop)
    }

    override fun onDestroy() {
        handler.removeCallbacks(renewWakeLock)
        wakeLock?.let { if (it.isHeld) it.release() }
        sessionId?.let { id ->
            if (SessionRuntime.sessionId == id) {
                SessionRuntime.stop(id)
                SessionRuntime.sessionId = null
            }
        }
        if (SessionRuntime.service === this) SessionRuntime.service = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
