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
    ): WorkforceTodaySubmission = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newTodayOperation(snapshot, action)
        try {
            WorkforceTodaySubmission.Accepted(
                api.submitTodayOperation(session, secureStore.installationId(), operation),
            )
        } catch (error: Throwable) {
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

    suspend fun signOut() = sessionMutex.withLock {
        secureStore.clearForLogout()
        outbox.clearForAccountBoundary()
    }
}

sealed interface WorkforceTodaySubmission {
    data class Accepted(val snapshot: WorkforceTodaySnapshot) : WorkforceTodaySubmission
    data object Queued : WorkforceTodaySubmission
}

private fun Throwable.isEligibleForOfflineOutbox(): Boolean = this is java.io.IOException
    || (this is WorkforceApiException && recoverable && recoveryCode == null)
