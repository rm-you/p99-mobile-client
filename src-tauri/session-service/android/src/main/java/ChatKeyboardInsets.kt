package io.github.rmyou.sessionservice

import android.app.Activity
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Resize the edge-to-edge WebView above the keyboard, including while logged out. */
internal fun installChatKeyboardInsets(activity: Activity) {
    val content = activity.findViewById<View>(android.R.id.content)
    val left = content.paddingLeft
    val top = content.paddingTop
    val right = content.paddingRight
    val bottom = content.paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
        val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        view.setPadding(left, top, right, bottom + keyboard)
        // The native container already used this space. Preserve system-bar
        // insets for the WebView's CSS safe areas without counting the IME twice.
        WindowInsetsCompat.Builder(insets)
            .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
            .build()
    }
    ViewCompat.requestApplyInsets(content)
}
