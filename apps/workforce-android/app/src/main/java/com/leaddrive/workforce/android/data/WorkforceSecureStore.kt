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

    /**
     * The choice is encrypted and local to this account/device. It controls
     * only a generic local notification; it is never sent to Workforce.
     */
    fun localRemindersEnabled(): Boolean = decrypt(PREFERENCE_LOCAL_REMINDERS_ENABLED) == "true"

    fun writeLocalRemindersEnabled(enabled: Boolean) {
        if (enabled) {
            writeEncrypted(PREFERENCE_LOCAL_REMINDERS_ENABLED, "true")
        } else {
            check(preferences.edit().remove(PREFERENCE_LOCAL_REMINDERS_ENABLED).commit()) {
                "Unable to update the local Workforce reminder preference."
            }
        }
    }

    /**
     * The alias is not a private key and is encrypted alongside the session.
     * It is bound to one organization/employee pair so a device proof cannot
     * be reused after an account boundary. The raw enrollment challenge,
     * signature and attestation certificate chain are never persisted here.
     */
    fun readDeviceBinding(): WorkforceDeviceBinding? {
        val keyAlias = decrypt(PREFERENCE_DEVICE_KEY_ALIAS) ?: return null
        val enrollmentId = decrypt(PREFERENCE_DEVICE_ENROLLMENT_ID) ?: return null
        val organizationId = decrypt(PREFERENCE_DEVICE_ORGANIZATION_ID) ?: return null
        val agentId = decrypt(PREFERENCE_DEVICE_AGENT_ID) ?: return null
        val lifecycle = decrypt(PREFERENCE_DEVICE_LIFECYCLE) ?: return null
        return WorkforceDeviceBinding(
            keyAlias = keyAlias,
            enrollmentId = enrollmentId,
            organizationId = organizationId,
            agentId = agentId,
            lifecycle = WorkforceDeviceBindingLifecycle.fromStored(lifecycle) ?: return null,
        )
    }

    fun writeDeviceBinding(binding: WorkforceDeviceBinding) {
        require(binding.keyAlias.matches(Regex("[A-Za-z0-9._-]{1,96}"))) { "Invalid Workforce device key alias." }
        require(binding.enrollmentId.matches(IDENTIFIER)) { "Invalid Workforce enrollment identifier." }
        require(binding.organizationId.matches(IDENTIFIER)) { "Invalid Workforce organization identifier." }
        require(binding.agentId.matches(IDENTIFIER)) { "Invalid Workforce employee identifier." }
        writeEncrypted(PREFERENCE_DEVICE_KEY_ALIAS, binding.keyAlias)
        writeEncrypted(PREFERENCE_DEVICE_ENROLLMENT_ID, binding.enrollmentId)
        writeEncrypted(PREFERENCE_DEVICE_ORGANIZATION_ID, binding.organizationId)
        writeEncrypted(PREFERENCE_DEVICE_AGENT_ID, binding.agentId)
        writeEncrypted(PREFERENCE_DEVICE_LIFECYCLE, binding.lifecycle.name)
    }

    /**
     * A generated key can outlive an ambiguous enrollment-start response. Keep
     * only its alias and account boundary so the next launch can submit the
     * same public key and let the server issue a fresh one-time challenge.
     */
    fun readDeviceProvisioning(): WorkforceDeviceProvisioning? {
        val keyAlias = decrypt(PREFERENCE_DEVICE_PROVISIONING_KEY_ALIAS) ?: return null
        val organizationId = decrypt(PREFERENCE_DEVICE_PROVISIONING_ORGANIZATION_ID) ?: return null
        val agentId = decrypt(PREFERENCE_DEVICE_PROVISIONING_AGENT_ID) ?: return null
        return WorkforceDeviceProvisioning(keyAlias, organizationId, agentId)
    }

    fun writeDeviceProvisioning(provisioning: WorkforceDeviceProvisioning) {
        require(provisioning.keyAlias.matches(Regex("[A-Za-z0-9._-]{1,96}"))) { "Invalid Workforce device key alias." }
        require(provisioning.organizationId.matches(IDENTIFIER)) { "Invalid Workforce organization identifier." }
        require(provisioning.agentId.matches(IDENTIFIER)) { "Invalid Workforce employee identifier." }
        writeEncrypted(PREFERENCE_DEVICE_PROVISIONING_KEY_ALIAS, provisioning.keyAlias)
        writeEncrypted(PREFERENCE_DEVICE_PROVISIONING_ORGANIZATION_ID, provisioning.organizationId)
        writeEncrypted(PREFERENCE_DEVICE_PROVISIONING_AGENT_ID, provisioning.agentId)
    }

    fun clearDeviceProvisioning() {
        check(
            preferences.edit()
                .remove(PREFERENCE_DEVICE_PROVISIONING_KEY_ALIAS)
                .remove(PREFERENCE_DEVICE_PROVISIONING_ORGANIZATION_ID)
                .remove(PREFERENCE_DEVICE_PROVISIONING_AGENT_ID)
                .commit(),
        ) { "Unable to clear Workforce device provisioning state." }
    }

    fun clearDeviceBinding() {
        check(
            preferences.edit()
                .remove(PREFERENCE_DEVICE_KEY_ALIAS)
                .remove(PREFERENCE_DEVICE_ENROLLMENT_ID)
                .remove(PREFERENCE_DEVICE_ORGANIZATION_ID)
                .remove(PREFERENCE_DEVICE_AGENT_ID)
                .remove(PREFERENCE_DEVICE_LIFECYCLE)
                .commit(),
        ) { "Unable to clear Workforce device binding." }
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
        const val PREFERENCE_LOCAL_REMINDERS_ENABLED = "local_reminders_enabled"
        const val PREFERENCE_DEVICE_KEY_ALIAS = "device_key_alias"
        const val PREFERENCE_DEVICE_ENROLLMENT_ID = "device_enrollment_id"
        const val PREFERENCE_DEVICE_ORGANIZATION_ID = "device_organization_id"
        const val PREFERENCE_DEVICE_AGENT_ID = "device_agent_id"
        const val PREFERENCE_DEVICE_LIFECYCLE = "device_lifecycle"
        const val PREFERENCE_DEVICE_PROVISIONING_KEY_ALIAS = "device_provisioning_key_alias"
        const val PREFERENCE_DEVICE_PROVISIONING_ORGANIZATION_ID = "device_provisioning_organization_id"
        const val PREFERENCE_DEVICE_PROVISIONING_AGENT_ID = "device_provisioning_agent_id"
        const val ENCODED_SEPARATOR = ":"
        val IDENTIFIER = Regex("[A-Za-z0-9_-]{1,100}")
    }
}

data class WorkforceStoredSession(
    val token: String,
    val organizationSlug: String,
)

data class WorkforceDeviceBinding(
    val keyAlias: String,
    val enrollmentId: String,
    val organizationId: String,
    val agentId: String,
    val lifecycle: WorkforceDeviceBindingLifecycle,
)

data class WorkforceDeviceProvisioning(
    val keyAlias: String,
    val organizationId: String,
    val agentId: String,
)

enum class WorkforceDeviceBindingLifecycle {
    PROVISIONING,
    PENDING_PROOF,
    PENDING_MANAGER_APPROVAL,
    ACTIVE,
    REVOKED,
    REPLACED;

    companion object {
        fun fromStored(value: String): WorkforceDeviceBindingLifecycle? = entries.firstOrNull { it.name == value }
    }
}
