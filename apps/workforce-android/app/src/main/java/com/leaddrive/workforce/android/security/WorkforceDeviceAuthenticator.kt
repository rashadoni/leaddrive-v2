package com.leaddrive.workforce.android.security

import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.leaddrive.workforce.android.R
import java.security.Signature
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The Android system owns all biometric collection and matching. This adapter
 * receives only the CryptoObject returned after a successful strong-biometric
 * authentication and completes the exact signature prepared by the key store.
 */
class WorkforceDeviceAuthenticator(private val activity: FragmentActivity) {
    suspend fun authenticateAndSign(signature: Signature, actionLabel: String): String {
        val availability = BiometricManager.from(activity).canAuthenticate(STRONG_BIOMETRIC)
        if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
            throw WorkforceLocalAuthenticationException(
                "Strong biometric authentication is unavailable on this device. Ask your manager for the review path.",
            )
        }
        return suspendCancellableCoroutine { continuation ->
            val prompt = BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (!continuation.isActive) return
                        val unlockedSignature = result.cryptoObject?.signature
                        if (unlockedSignature == null) {
                            continuation.resumeWithException(
                                WorkforceLocalAuthenticationException("The device did not authorize this Workforce action."),
                            )
                            return
                        }
                        runCatching { Base64.encodeToString(unlockedSignature.sign(), Base64.NO_WRAP) }
                            .onSuccess { encoded ->
                                if (continuation.isActive) continuation.resume(encoded)
                            }
                            .onFailure {
                                if (continuation.isActive) {
                                    continuation.resumeWithException(
                                        WorkforceLocalAuthenticationException("The device could not complete this Workforce signature."),
                                    )
                                }
                            }
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (continuation.isActive) {
                            continuation.resumeWithException(
                                WorkforceLocalAuthenticationException("Workforce device confirmation was not completed."),
                            )
                        }
                    }

                    override fun onAuthenticationFailed() {
                        // A failed scan is not terminal; Android may let the
                        // employee retry in the same system-owned prompt.
                    }
                },
            )
            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(activity.getString(R.string.biometric_title))
                .setSubtitle(actionLabel)
                .setAllowedAuthenticators(STRONG_BIOMETRIC)
                .setNegativeButtonText(activity.getString(R.string.cancel))
                .build()
            prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(signature))
            continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        }
    }

    private companion object {
        const val STRONG_BIOMETRIC = BiometricManager.Authenticators.BIOMETRIC_STRONG
    }
}

class WorkforceLocalAuthenticationException(message: String) : IllegalStateException(message)
