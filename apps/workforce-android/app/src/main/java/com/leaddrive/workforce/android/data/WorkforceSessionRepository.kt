package com.leaddrive.workforce.android.data

/**
 * One account/tenant boundary for the standalone client. Clearing this store
 * also deletes the random device selector, so an account switch cannot reuse a
 * stale local token or cohort header. Durable attendance outbox work will be a
 * separate Room/WorkManager implementation under WF-C9-006.
 */
class WorkforceSessionRepository(
    private val api: WorkforceApiClient,
    private val secureStore: WorkforceSecureStore,
) {
    suspend fun signIn(input: WorkforceLoginInput): WorkforceBootstrap {
        secureStore.clearForLogout()
        val login = api.login(input)
        val session = WorkforceStoredSession(login.token, login.organizationSlug)
        secureStore.writeSession(session)
        return api.bootstrap(session, secureStore.installationId())
    }

    suspend fun restore(): WorkforceBootstrap? {
        val session = secureStore.readSession() ?: return null
        return api.bootstrap(session, secureStore.installationId())
    }

    suspend fun loadToday(): WorkforceTodaySnapshot {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        return api.loadToday(session, secureStore.installationId())
    }

    suspend fun submitTodayAction(
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
    ): WorkforceTodaySnapshot {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        return api.submitTodayAction(session, secureStore.installationId(), snapshot, action)
    }

    fun signOut() {
        secureStore.clearForLogout()
    }
}
