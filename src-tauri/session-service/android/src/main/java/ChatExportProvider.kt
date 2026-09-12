package io.github.rmyou.sessionservice

import androidx.core.content.FileProvider

/** Separate manifest identity keeps chat export paths independent of Tauri's provider. */
class ChatExportProvider : FileProvider()
