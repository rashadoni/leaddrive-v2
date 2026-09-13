package com.leaddrive.workforce.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Minimal encrypted installation/session store. It uses a non-exportable AES
 * key from Android Keystore and deliberately excludes app data from cloud and
 * device-transfer backup. It stores a random installation selector and bearer
 * token only; passwords, biometric templates, QR values and raw location are
 * never persisted here.
 */
class WorkforceSecureStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    fun readSession(): WorkforceStoredSession? {
        val token = decrypt(PREFERENCE_TOKEN) ?: return null
        val organizationSlug = decrypt(PREFERENCE_ORGANIZATION_SLUG) ?: return null
        return WorkforceStoredSession(token = token, organizationSlug = organizationSlug)
    }

    fun writeSession(session: WorkforceStoredSession) {
        require(session.token.isNotBlank()) { "Mobile session token is required." }
        require(session.organizationSlug.isNotBlank()) { "Organization slug is required." }
        writeEncrypted(PREFERENCE_TOKEN, session.token)
        writeEncrypted(PREFERENCE_ORGANIZATION_SLUG, session.organizationSlug)
    }

    fun installationId(): String {
        decrypt(PREFERENCE_INSTALLATION_ID)?.let { return it }
        return java.util.UUID.randomUUID().toString().also {
            writeEncrypted(PREFERENCE_INSTALLATION_ID, it)
        }
    }

    /** A logout/tenant switch must not retain a token or device selector. */
    fun clearForLogout() {
        check(preferences.edit().clear().commit()) { "Unable to clear the Workforce session." }
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    }

    private fun writeEncrypted(name: String, plaintext: String) {
        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey())
        val encoded = listOf(
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
            Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8)), Base64.NO_WRAP),
        ).joinToString(ENCODED_SEPARATOR)
        check(preferences.edit().putString(name, encoded).commit()) { "Unable to persist secure Workforce state." }
    }

    private fun decrypt(name: String): String? {
        val encoded = preferences.getString(name, null) ?: return null
        val parts = encoded.split(ENCODED_SEPARATOR, limit = 2)
        if (parts.size != 2) return null
        return runCatching {
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                encryptionKey(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(parts[0], Base64.NO_WRAP)),
            )
            String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)
        }.getOrNull()
    }

    private fun encryptionKey(): SecretKey {
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val KEY_ALIAS = "leaddrive.workforce.session.v1"
        const val PREFERENCES_NAME = "leaddrive.workforce.secure.v1"
        const val PREFERENCE_TOKEN = "token"
        const val PREFERENCE_ORGANIZATION_SLUG = "organization_slug"
        const val PREFERENCE_INSTALLATION_ID = "installation_id"
        const val ENCODED_SEPARATOR = ":"
    }
}

data class WorkforceStoredSession(
    val token: String,
    val organizationSlug: String,
)
