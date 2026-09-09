package io.github.rmyou.securelogin

import android.app.Activity
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class ProfileKey { lateinit var id: String }

@InvokeArg
class ProfileLogin {
    lateinit var id: String
    lateinit var character: String
    lateinit var server: String
    lateinit var user: String
    lateinit var pass: String
}

/** Each character has its own authenticated key and atomic encrypted file. */
@TauriPlugin
class SecureLoginPlugin(private val activity: Activity) : Plugin(activity) {
    private val legacyPrefix = "p99-login-v1-"
    private val prefix = "p99-profile-v2-"
    // Excluded from Android cloud backup and device transfer.
    private val legacyFile = AtomicFile(File(activity.noBackupFilesDir, "p99-login.json"))
    private val directory = File(activity.noBackupFilesDir, "p99-profiles")
    private var busy = false // Accessed only on the activity thread.

    private fun validId(id: String): Boolean =
        runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false)

    private fun file(id: String): AtomicFile {
        require(validId(id))
        return AtomicFile(File(directory, "$id.json"))
    }

    private fun read(file: AtomicFile): JSONObject = file.openRead().use {
        val bytes = it.readBytes()
        require(bytes.size <= 16384)
        JSONObject(bytes.toString(Charsets.UTF_8))
    }

    private fun metadata(value: JSONObject): JSONObject {
        val id = value.getString("id")
        val character = value.getString("character")
        val server = value.getString("server")
        require(validId(id) && character.matches(Regex("[A-Za-z]{1,63}")))
        require(server == "green" || server == "blue")
        return JSONObject().put("id", id).put("character", character).put("server", server)
    }

    private fun aad(value: JSONObject): ByteArray =
        (value.getString("id") + "\u0000" + value.getString("server") + "\u0000" + value.getString("character")).toByteArray(Charsets.UTF_8)

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun authenticators() = if (Build.VERSION.SDK_INT >= 30)
        BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG
    private fun available() = BiometricManager.from(activity).canAuthenticate(authenticators()) ==
        BiometricManager.BIOMETRIC_SUCCESS

    /** Serialize prompts and mutations so a cancelled save cannot erase a newer login. */
    private fun operation(invoke: Invoke, body: () -> Unit) {
        activity.runOnUiThread {
            if (busy) { invoke.reject("A login operation is already in progress."); return@runOnUiThread }
            busy = true
            try {
                body()
            } catch (error: Exception) {
                android.util.Log.w("P99SecureLogin", "Secure operation failed: ${error.javaClass.simpleName}")
                fail(invoke)
            }
        }
    }
    private fun fail(invoke: Invoke) {
        busy = false
        invoke.reject("Secure login operation failed or was cancelled.")
    }
    private fun finish(invoke: Invoke, value: JSObject? = null) {
        busy = false
        if (value == null) invoke.resolve() else invoke.resolve(value)
    }

    @Command
    fun status(invoke: Invoke) = operation(invoke) {
        val profiles = JSONArray()
        // AtomicFile restores a backup on openRead, including after an interrupted replacement.
        val ids = directory.listFiles().orEmpty().map { it.name.removeSuffix(".bak") }
            .filter { it.endsWith(".json") }.map { it.removeSuffix(".json") }.filter { validId(it) }.distinct().sorted()
        for (id in ids) {
            val entry = read(file(id))
            require(entry.getInt("version") == 2 && entry.getString("id") == id)
            profiles.put(metadata(entry))
        }
        finish(invoke, JSObject().apply {
            put("available", available()); put("profiles", profiles)
            put("legacySaved", legacyFile.baseFile.exists() || File(legacyFile.baseFile.path + ".bak").exists())
        })
    }

    /** Preserve all existing entries until this one replacement is durable. */
    @Command
    fun save(invoke: Invoke) = operation(invoke) {
        val args = invoke.parseArgs(ProfileLogin::class.java)
        val label = metadata(JSONObject().put("id", args.id).put("character", args.character).put("server", args.server))
        require(args.user.isNotBlank() && args.pass.isNotEmpty())
        require(args.user.toByteArray().size <= 1024 && args.pass.toByteArray().size <= 1024)
        require(!args.user.contains('\u0000') && !args.pass.contains('\u0000'))
        require(available())
        directory.mkdirs()
        val target = file(args.id)
        val oldAlias = if (target.baseFile.exists() || File(target.baseFile.path + ".bak").exists()) read(target).getString("alias") else null
        if (oldAlias != null) require(oldAlias.startsWith(prefix))
        val alias = prefix + UUID.randomUUID().toString()
        var committed = false
        val cleanup = { if (!committed) keyStore().deleteEntry(alias) }
        try {
            val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .apply {
                    if (Build.VERSION.SDK_INT >= 30) {
                        setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                    } else {
                        @Suppress("DEPRECATION")
                        setUserAuthenticationValidityDurationSeconds(-1)
                        setInvalidatedByBiometricEnrollment(true)
                    }
                }.build()
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec); generateKey() }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, keyStore().getKey(alias, null) as SecretKey)
            }
            authenticate(invoke, cipher, onCancel = cleanup) { unlocked ->
                unlocked.updateAAD(aad(label))
                val plain = JSONObject(label.toString()).put("user", args.user).put("pass", args.pass).toString().toByteArray(Charsets.UTF_8)
                try {
                    val encrypted = unlocked.doFinal(plain)
                    val envelope = JSONObject(label.toString()).put("version", 2).put("alias", alias)
                        .put("iv", Base64.encodeToString(unlocked.iv, Base64.NO_WRAP))
                        .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    val stream = target.startWrite()
                    try {
                        stream.write(envelope.toString().toByteArray(Charsets.UTF_8))
                        target.finishWrite(stream)
                    } catch (error: Exception) { target.failWrite(stream); throw error }
                    committed = true
                    // A stale key is harmless if cleanup fails; never report a durable save as failed.
                    if (oldAlias != null) runCatching { keyStore().deleteEntry(oldAlias) }
                    finish(invoke)
                } finally { plain.fill(0) }
            }
        } catch (error: Exception) { cleanup(); throw error }
    }

    /** The authenticated cipher verifies both the secret and its visible profile label. */
    @Command
    fun unlock(invoke: Invoke) = operation(invoke) {
        val id = invoke.parseArgs(ProfileKey::class.java).id
        val envelope = read(file(id))
        require(envelope.getInt("version") == 2 && envelope.getString("id") == id)
        val label = metadata(envelope)
        decrypt(invoke, envelope, prefix, label)
    }

    @Command
    fun unlockLegacy(invoke: Invoke) = operation(invoke) {
        val envelope = read(legacyFile)
        require(envelope.getInt("version") == 1)
        decrypt(invoke, envelope, legacyPrefix, null)
    }

    private fun decrypt(invoke: Invoke, envelope: JSONObject, expectedPrefix: String, label: JSONObject?) {
        val alias = envelope.getString("alias")
        require(alias.startsWith(expectedPrefix))
        val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
        val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, keyStore().getKey(alias, null) as SecretKey, GCMParameterSpec(128, iv))
        }
        authenticate(invoke, cipher) { unlocked ->
            if (label != null) unlocked.updateAAD(aad(label))
            val plain = unlocked.doFinal(ciphertext)
            try {
                val login = JSONObject(plain.toString(Charsets.UTF_8))
                if (label != null) require(aad(metadata(login)).contentEquals(aad(label)))
                finish(invoke, JSObject().apply {
                    if (label != null) {
                        put("id", login.getString("id")); put("character", login.getString("character")); put("server", login.getString("server"))
                    }
                    put("user", login.getString("user")); put("pass", login.getString("pass"))
                })
            } finally { plain.fill(0) }
        }
    }

    @Command
    fun forget(invoke: Invoke) = operation(invoke) {
        val target = file(invoke.parseArgs(ProfileKey::class.java).id)
        if (target.baseFile.exists() || File(target.baseFile.path + ".bak").exists()) {
            val alias = read(target).getString("alias")
            require(alias.startsWith(prefix))
            keyStore().deleteEntry(alias)
            target.delete()
        }
        finish(invoke)
    }

    @Command
    fun forgetLegacy(invoke: Invoke) = operation(invoke) {
        val store = keyStore()
        store.aliases().toList().filter { it.startsWith(legacyPrefix) }.forEach { store.deleteEntry(it) }
        legacyFile.delete()
        finish(invoke)
    }

    private fun authenticate(invoke: Invoke, cipher: Cipher, onCancel: () -> Unit = {}, done: (Cipher) -> Unit) {
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock P99 login")
            .setSubtitle("Use your device lock to protect your account and password")
            .setAllowedAuthenticators(authenticators())
            .apply { if (Build.VERSION.SDK_INT < 30) setNegativeButtonText("Cancel") }
            .build()
        BiometricPrompt(activity as FragmentActivity, ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    try { done(requireNotNull(result.cryptoObject?.cipher)) }
                    catch (error: Exception) {
                        android.util.Log.w("P99SecureLogin", "Secure operation failed: ${error.javaClass.simpleName}")
                        try { onCancel() } finally { fail(invoke) }
                    }
                }
                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    try { onCancel() } finally { fail(invoke) }
                }
                // A failed fingerprint keeps the system prompt open for another attempt.
            }).authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
}
