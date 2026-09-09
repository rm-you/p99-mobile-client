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
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class Credentials {
    lateinit var user: String
    lateinit var pass: String
}

/** One encrypted login. Keys require authentication for each cryptographic use. */
@TauriPlugin
class SecureLoginPlugin(private val activity: Activity) : Plugin(activity) {
    private val prefix = "p99-login-v1-"
    // Android excludes this directory from both cloud backup and device transfer.
    private val file = AtomicFile(File(activity.noBackupFilesDir, "p99-login.json"))
    private var busy = false // Accessed only on the activity thread.

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
        finish(invoke, JSObject().apply { put("available", available()); put("saved", file.baseFile.exists()) })
    }

    /** Create a new key for each replacement; preserve the old login until commit succeeds. */
    @Command
    fun save(invoke: Invoke) = operation(invoke) {
        val args = invoke.parseArgs(Credentials::class.java)
        require(args.user.isNotBlank() && args.pass.isNotEmpty())
        require(args.user.length <= 1024 && args.pass.length <= 1024)
        require(available())
        val alias = prefix + UUID.randomUUID().toString()
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
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(spec); generateKey()
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, keyStore().getKey(alias, null) as SecretKey)
            }
            authenticate(invoke, cipher, onCancel = { keyStore().deleteEntry(alias) }) { unlocked ->
                val plain = JSONObject().put("user", args.user).put("pass", args.pass).toString().toByteArray(Charsets.UTF_8)
                try {
                    val encrypted = unlocked.doFinal(plain)
                    val envelope = JSONObject().put("version", 1).put("alias", alias)
                        .put("iv", Base64.encodeToString(unlocked.iv, Base64.NO_WRAP))
                        .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    val stream = file.startWrite()
                    try {
                        stream.write(envelope.toString().toByteArray(Charsets.UTF_8))
                        file.finishWrite(stream)
                    } catch (error: Exception) { file.failWrite(stream); throw error }
                    // Remove obsolete keys only after the replacement is durable.
                    removeKeysExcept(alias)
                    finish(invoke)
                } finally { plain.fill(0) }
            }
        } catch (error: Exception) { keyStore().deleteEntry(alias); throw error }
    }

    /** Decryption requires the authenticated CryptoObject, not just a successful UI prompt. */
    @Command
    fun unlock(invoke: Invoke) = operation(invoke) {
        val envelope = JSONObject(file.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
        require(envelope.getInt("version") == 1)
        val alias = envelope.getString("alias")
        require(alias.startsWith(prefix))
        val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
        val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, keyStore().getKey(alias, null) as SecretKey, GCMParameterSpec(128, iv))
        }
        authenticate(invoke, cipher) { unlocked ->
            val plain = unlocked.doFinal(ciphertext)
            try {
                val credentials = JSONObject(plain.toString(Charsets.UTF_8))
                finish(invoke, JSObject().apply {
                    put("user", credentials.getString("user")); put("pass", credentials.getString("pass"))
                })
            } finally { plain.fill(0) }
        }
    }

    @Command
    fun forget(invoke: Invoke) = operation(invoke) {
        removeKeysExcept(null)
        file.delete()
        finish(invoke)
    }

    private fun removeKeysExcept(keep: String?) {
        val store = keyStore()
        store.aliases().toList().filter { it.startsWith(prefix) && it != keep }.forEach { store.deleteEntry(it) }
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
                        fail(invoke)
                    }
                }
                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    try { onCancel() } finally { fail(invoke) }
                }
                // A failed fingerprint keeps the system prompt open for another attempt.
            }).authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
}
