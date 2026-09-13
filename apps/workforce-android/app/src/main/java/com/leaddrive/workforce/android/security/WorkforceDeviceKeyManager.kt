package com.leaddrive.workforce.android.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec
import java.nio.charset.StandardCharsets
import java.security.Signature

/**
 * Android-only device-key foundation for the future attendance enrollment
 * flow. The private key remains non-exportable in Android Keystore. A local
 * strong biometric authorizes every signing use; the server still decides
 * whether verified attestation is sufficient for an action. Android does not
 * permit a device credential with a per-use cryptographic CryptoObject, so the
 * app fails safe to manager review when strong biometric is unavailable.
 *
 * No biometric template or biometric result is read or sent by this class.
 */
class WorkforceDeviceKeyManager {
    fun createEnrollmentKey(alias: String, challenge: ByteArray): WorkforceEnrollmentKey {
        require(alias.matches(Regex("[A-Za-z0-9._-]{1,96}"))) { "Invalid Workforce key alias." }
        require(challenge.size in 16..128) { "Enrollment challenge must contain 16..128 bytes." }

        val withStrongBox = runCatching { generate(alias, challenge, preferStrongBox = true) }
        val keyPair = when {
            withStrongBox.isSuccess -> withStrongBox.getOrThrow()
            withStrongBox.exceptionOrNull() is StrongBoxUnavailableException -> generate(alias, challenge, preferStrongBox = false)
            else -> throw withStrongBox.exceptionOrNull() ?: IllegalStateException("Unable to create Workforce key.")
        }

        val certificateChain = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
            .getCertificateChain(alias)
            ?.map { Base64.encodeToString(it.encoded, Base64.NO_WRAP) }
            .orEmpty()
        check(certificateChain.isNotEmpty()) { "Android Keystore did not return an attestation certificate chain." }
        return WorkforceEnrollmentKey(
            alias = alias,
            publicKeyDerBase64 = Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP),
            attestationCertificatesDerBase64 = certificateChain,
        )
    }

    /**
     * The server verifies `SHA256withECDSA` over the canonical UTF-8 challenge
     * string, without a client-side pre-hash. This prepares, but does not
     * complete, one exact signature. The caller must
     * pass this Signature to the OS-owned BiometricPrompt CryptoObject and use
     * it only after authentication succeeds. This class never receives a
     * biometric template or biometric result.
     */
    fun prepareCanonicalActionSignature(alias: String, canonicalChallenge: String): Signature {
        require(canonicalChallenge.isNotBlank() && canonicalChallenge.length <= 4_096) {
            "Workforce action challenge is invalid."
        }
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val privateKey = keyStore.getKey(alias, null)
            ?: throw WorkforceDeviceKeyUnavailableException("The Workforce device key is unavailable.")
        val signer = java.security.Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey as java.security.PrivateKey)
        signer.update(canonicalChallenge.toByteArray(StandardCharsets.UTF_8))
        return signer
    }

    fun publicKeyDerBase64(alias: String): String {
        val certificate = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
            .getCertificate(alias)
            ?: throw WorkforceDeviceKeyUnavailableException("The Workforce device key is unavailable.")
        return Base64.encodeToString(certificate.publicKey.encoded, Base64.NO_WRAP)
    }

    fun delete(alias: String) {
        KeyStore.getInstance(ANDROID_KEY_STORE).apply {
            load(null)
            if (containsAlias(alias)) deleteEntry(alias)
        }
    }

    private fun generate(alias: String, challenge: ByteArray, preferStrongBox: Boolean): KeyPair {
        check(!KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }.containsAlias(alias)) {
            "A Workforce key already exists for this alias. Create a new alias for rotation; never replace an active key."
        }
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .setUserAuthenticationRequired(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(
                0,
                KeyProperties.AUTH_BIOMETRIC_STRONG,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }
        if (preferStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }

        return KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEY_STORE)
            .apply { initialize(builder.build()) }
            .generateKeyPair()
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
    }
}

data class WorkforceEnrollmentKey(
    val alias: String,
    val publicKeyDerBase64: String,
    val attestationCertificatesDerBase64: List<String>,
)

class WorkforceDeviceKeyUnavailableException(message: String) : IllegalStateException(message)
