package com.leaddrive.workforce.android.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * One account/tenant boundary for the standalone client. Clearing this store
 * also deletes the random device selector, so an account switch cannot reuse a
 * stale local token or cohort header. The injected encrypted Room/WorkManager
 * outbox is cleared on the same account boundary.
 */
class WorkforceSessionRepository(
    private val api: WorkforceApiClient,
    private val secureStore: WorkforceSecureStore,
    private val outbox: WorkforceEncryptedOutbox,
) {
    private val sessionMutex = Mutex()

    suspend fun signIn(input: WorkforceLoginInput): WorkforceBootstrap = sessionMutex.withLock {
        secureStore.clearForLogout()
        outbox.clearForAccountBoundary()
        val login = api.login(input)
        val session = WorkforceStoredSession(login.token, login.organizationSlug)
        secureStore.writeSession(session)
        api.bootstrap(session, secureStore.installationId())
    }

    suspend fun restore(): WorkforceBootstrap? = sessionMutex.withLock {
        val session = secureStore.readSession() ?: return@withLock null
        api.bootstrap(session, secureStore.installationId())
    }

    suspend fun loadToday(): WorkforceTodaySnapshot = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        api.loadToday(session, secureStore.installationId())
    }

    suspend fun submitTodayAction(
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
        attendanceQrToken: String? = null,
    ): WorkforceTodaySubmission = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newTodayOperation(snapshot, action, attendanceQrToken)
        try {
            WorkforceTodaySubmission.Accepted(
                api.submitTodayOperation(session, secureStore.installationId(), operation),
            )
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            if (operation.hasEphemeralProof && error.isEligibleForOfflineOutbox()) {
                throw WorkforceApiException("The fresh QR proof was not accepted. Scan a new code and try again.", recoverable = false)
            }
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceTodaySubmission.Queued
        }
    }

    suspend fun loadHistory(anchorDate: String): WorkforceHistorySnapshot = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        api.loadHistory(session, secureStore.installationId(), anchorDate)
    }

    suspend fun submitHrmRequest(draft: WorkforceHrmRequestDraft): WorkforceHrmSubmission = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newHrmRequestOperation(draft)
        try {
            api.submitOperation(session, secureStore.installationId(), operation)
            WorkforceHrmSubmission.ACCEPTED
        } catch (error: Throwable) {
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceHrmSubmission.QUEUED
        }
    }

    suspend fun cancelHrmRequest(requestId: String): WorkforceHrmSubmission = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newHrmRequestCancellation(requestId)
        try {
            api.submitOperation(session, secureStore.installationId(), operation)
            WorkforceHrmSubmission.ACCEPTED
        } catch (error: Throwable) {
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceHrmSubmission.QUEUED
        }
    }

    suspend fun signOut() = sessionMutex.withLock {
        secureStore.clearForLogout()
        outbox.clearForAccountBoundary()
    }
}

sealed interface WorkforceTodaySubmission {
    data class Accepted(val snapshot: WorkforceTodaySnapshot) : WorkforceTodaySubmission
    data object Queued : WorkforceTodaySubmission
}

enum class WorkforceHrmSubmission {
    ACCEPTED,
    QUEUED,
}

private fun Throwable.isEligibleForOfflineOutbox(): Boolean = this is java.io.IOException
    || (this is WorkforceApiException && recoverable && recoveryCode == null)
