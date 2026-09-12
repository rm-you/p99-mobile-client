package io.github.rmyou.sessionservice

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import java.io.File

@InvokeArg
class DocumentArgs {
    var text: String = ""
    var format: String = "txt"
}

@InvokeArg
class AlertArgs {
    var title: String = "New chat message"
    var body: String = "Open P99 Mobile Chat to read it."
}

/** System integrations never receive login credentials or arbitrary filesystem paths. */
internal object ChatUtilities {
    private const val CHANNEL = "p99-chat-alerts"
    private const val NOTIFICATION_ID = 2000

    fun appearance(activity: Activity) {
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }

    fun copy(activity: Activity, invoke: Invoke) {
        val args = invoke.parseArgs(DocumentArgs::class.java)
        if (args.text.length > 100000) {
            invoke.reject("Message is too large to copy.")
            return
        }
        activity.getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText("Chat", args.text))
        invoke.resolve()
    }

    /** Share only the dedicated cache file, granting the selected app temporary read access. */
    fun share(activity: Activity, invoke: Invoke) {
        val args = invoke.parseArgs(DocumentArgs::class.java)
        if (args.format !in listOf("txt", "jsonl", "json") ||
            args.text.toByteArray(Charsets.UTF_8).size > 20000000) {
            invoke.reject("Export is too large.")
            return
        }
        try {
            val directory = File(activity.cacheDir, "shared-chat").apply { mkdirs() }
            // Unique URIs prevent an older recipient's grant from reading a later export.
            val expires = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
            directory.listFiles()?.filter { it.lastModified() < expires }?.forEach { it.delete() }
            directory.listFiles()?.sortedByDescending { it.lastModified() }?.drop(9)?.forEach { it.delete() }
            val file = File.createTempFile("p99-chat-", ".${args.format}", directory)
            file.writeText(args.text, Charsets.UTF_8)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.chat-exports", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = if (args.format == "json") "application/json" else "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri("Chat export", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, "Share export"))
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("Could not share the export.")
        }
    }

    /** The public lock-screen version never contains sender names or message text. */
    fun alert(activity: Activity, invoke: Invoke) {
        val args = invoke.parseArgs(AlertArgs::class.java)
        val manager = activity.getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) {
            invoke.reject("Notifications are disabled.")
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL, "Chat messages", NotificationManager.IMPORTANCE_DEFAULT)
                )
            }
            val launch = activity.packageManager.getLaunchIntentForPackage(activity.packageName)
            val open = PendingIntent.getActivity(
                activity, NOTIFICATION_ID, launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            fun builder() = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(activity, CHANNEL)
                else Notification.Builder(activity)
            val publicNotice = builder()
                .setSmallIcon(R.drawable.ic_chat_connection)
                .setContentTitle("P99 Mobile Chat")
                .setContentText("New chat message")
                .build()
            manager.notify(NOTIFICATION_ID, builder()
                .setSmallIcon(R.drawable.ic_chat_connection)
                .setContentTitle(args.title.take(100))
                .setContentText(args.body.take(240))
                .setStyle(Notification.BigTextStyle().bigText(args.body.take(240)))
                .setAutoCancel(true)
                .setContentIntent(open)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicNotice)
                .build())
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("Chat notifications are unavailable.")
        }
    }
}
