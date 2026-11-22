package dev.nimby.gallery

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class LicenseStorage(context: Context) {
    private val preferences = context.getSharedPreferences("nimby_license", Context.MODE_PRIVATE)

    @Synchronized fun read(): String? {
        val encoded = preferences.getString("record", null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val key = keyStore().getKey(alias, null) as? SecretKey ?: error("License storage key missing")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes, 0, ivBytes))
        return cipher.doFinal(bytes, ivBytes, bytes.size - ivBytes).toString(Charsets.UTF_8)
    }

    @Synchronized fun write(record: String?) {
        val editor = preferences.edit()
        if (record == null) {
            editor.remove("record")
        } else {
            val key = keyStore().getKey(alias, null) as? SecretKey ?: generateKey()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            check(cipher.iv.size == ivBytes)
            val bytes = cipher.iv + cipher.doFinal(record.toByteArray(Charsets.UTF_8))
            editor.putString("record", Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
        check(editor.commit()) { "Could not save license storage" }
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun generateKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val alias = "dev.nimby.lifetime.license"
        const val ivBytes = 12
    }
}
