package com.leaddrive.workforce.android.security

import android.content.Context
import android.util.Base64
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityTokenRequest
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await

/**
 * Ephemeral Standard API transport only. This object never stores a token,
 * decoded verdict, project credential or device identifier. A provider is
 * prepared once in memory and its token is requested for one exact action.
 */
class WorkforcePlayIntegrityClient(
    context: Context,
    private val cloudProjectNumber: Long?,
) {
    private val applicationContext = context.applicationContext
    private val manager: StandardIntegrityManager by lazy {
        IntegrityManagerFactory.createStandard(applicationContext)
    }
    private val providerMutex = Mutex()
    private var provider: StandardIntegrityManager.StandardIntegrityTokenProvider? = null

    /** Warm up after an authenticated bootstrap whenever the server requires it. */
    suspend fun warmUp() {
        providerOrPrepare()
    }

    suspend fun tokenFor(requestHash: String): String {
        require(REQUEST_HASH.matches(requestHash)) { "The Workforce Play Integrity action binding is invalid." }
        val token = providerOrPrepare()
            .request(StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build())
            .await()
            .token()
            .trim()
        check(token.isNotEmpty() && token.length <= MAX_TOKEN_LENGTH) {
            "The Workforce Play Integrity response was invalid."
        }
        return token
    }

    private suspend fun providerOrPrepare(): StandardIntegrityManager.StandardIntegrityTokenProvider = providerMutex.withLock {
        provider ?: run {
            val projectNumber = cloudProjectNumber
                ?: throw WorkforcePlayIntegrityUnavailableException("Play Integrity is not configured in this Workforce APK.")
            check(projectNumber > 0) { "The Workforce Play Integrity project is invalid." }
            manager.prepareIntegrityToken(
                PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(projectNumber).build(),
            ).await().also { provider = it }
        }
    }

    private companion object {
        val REQUEST_HASH = Regex("[A-Za-z0-9_-]{43}")
        const val MAX_TOKEN_LENGTH = 20_000
    }
}

class WorkforcePlayIntegrityUnavailableException(message: String) : IllegalStateException(message)
