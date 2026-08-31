package com.leaddrive.workforce.android.data

import com.leaddrive.workforce.android.security.WorkforceDeviceKeyManager
import android.util.Base64
import java.security.Signature
import java.time.Instant
import java.util.UUID
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
    private val deviceKeys: WorkforceDeviceKeyManager,
    private val reminderScheduler: WorkforceReminderScheduler,
) {
    private val sessionMutex = Mutex()

    suspend fun signIn(input: WorkforceLoginInput): WorkforceBootstrap = sessionMutex.withLock {
        val login = api.login(input)
        // Do not destroy a recoverable current session, its local key or its
        // encrypted queue for a rejected/cancelled new sign-in. Once the
        // server has authenticated the new account, clear that old boundary
        // before writing any new token so no pending data or device selector
        // can cross into the newly authenticated account.
        clearAccountBoundary()
        val session = WorkforceStoredSession(login.token, login.organizationSlug)
        secureStore.writeSession(session)
        api.bootstrap(session, secureStore.installationId()).also { bootstrap ->
            if (!bootstrap.release.mutationsBlocked) outbox.resumeDrain()
        }
    }

    suspend fun restore(): WorkforceBootstrap? = sessionMutex.withLock {
        val session = secureStore.readSession() ?: return@withLock null
        api.bootstrap(session, secureStore.installationId()).also { bootstrap ->
            if (!bootstrap.release.mutationsBlocked) outbox.resumeDrain()
        }
    }

    suspend fun loadToday(): WorkforceTodaySnapshot = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        api.loadToday(session, secureStore.installationId())
    }

    suspend fun submitTodayAction(
        bootstrap: WorkforceBootstrap,
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
        attendanceQrToken: String? = null,
        attendanceLocationProof: WorkforceLocationProof? = null,
    ): WorkforceTodaySubmission = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newTodayOperation(snapshot, action, attendanceQrToken, attendanceLocationProof)
        try {
            val accepted = api.submitTodayOperation(session, secureStore.installationId(), operation)
            WorkforceTodaySubmission.Accepted(accepted, reminderSettings(accepted))
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            if (operation.hasEphemeralProof && error.isEligibleForOfflineOutbox()) {
                // QR, device signatures and action-time location must never
                // enter the durable retry path: a later replay could reuse
                // expired proof or place raw coordinates in the outbox.
                throw WorkforceApiException("The fresh attendance proof was not accepted. Refresh and try again.", recoverable = false)
            }
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceTodaySubmission.Queued
        }
    }

    /**
     * Pairs accepted server history with metadata-only local Work Time recovery
     * state. It never decrypts an outbox payload or assigns a pending local
     * action to a day, so a queued/conflicted action cannot look accepted.
     */
    suspend fun loadHistoryWithLocalRecovery(anchorDate: String): WorkforceHistoryWithLocalRecovery = sessionMutex.withLock {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val history = api.loadHistory(session, secureStore.installationId(), anchorDate)
        val recoveryItems = outbox.recoveryItems(session)
        WorkforceHistoryWithLocalRecovery(
            history = history,
            localRecovery = WorkforceHistoryLocalRecovery.from(recoveryItems),
            requestLocalRecovery = WorkforceRequestLocalRecovery.from(recoveryItems),
        )
    }

    /**
     * Reads only local request-delivery metadata. It intentionally has no
     * request ID, date, reason or operation payload, and is safe to use when
     * a server-history refresh fails.
     */
    suspend fun loadRequestLocalRecovery(): WorkforceRequestLocalRecovery = sessionMutex.withLock {
        WorkforceRequestLocalRecovery.from(outbox.recoveryItems(requireSession()))
    }

    /** Read-only self-service discovery; it is never queued or made into a fact. */
    suspend fun loadOwnExceptions(): List<WorkforceSelfException> {
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        return api.loadOwnExceptions(session, secureStore.installationId())
    }

    /**
     * Reconciles only an opt-in generic local reminder from fresh server truth.
     * It never derives a shift locally or sends a preference/notification fact
     * to the API.
     */
    fun reminderSettings(snapshot: WorkforceTodaySnapshot): WorkforceReminderSettings {
        val enabled = secureStore.localRemindersEnabled()
        return WorkforceReminderSettings(
            enabled = enabled,
            state = reminderScheduler.reconcile(enabled, snapshot.workday),
        )
    }

    fun setLocalRemindersEnabled(
        enabled: Boolean,
        snapshot: WorkforceTodaySnapshot,
    ): WorkforceReminderSettings {
        secureStore.writeLocalRemindersEnabled(enabled)
        return reminderSettings(snapshot)
    }

    suspend fun submitHrmRequest(
        bootstrap: WorkforceBootstrap,
        draft: WorkforceHrmRequestDraft,
    ): WorkforceHrmSubmission = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newHrmRequestOperation(draft)
        try {
            api.submitOperation(session, secureStore.installationId(), operation)
            WorkforceHrmSubmission.Accepted
        } catch (error: Throwable) {
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceHrmSubmission.Queued(WorkforceRequestLocalRecovery.from(outbox.recoveryItems(session)))
        }
    }

    suspend fun cancelHrmRequest(
        bootstrap: WorkforceBootstrap,
        requestId: String,
    ): WorkforceHrmSubmission = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newHrmRequestCancellation(requestId)
        try {
            api.submitOperation(session, secureStore.installationId(), operation)
            WorkforceHrmSubmission.Accepted
        } catch (error: Throwable) {
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceHrmSubmission.Queued(WorkforceRequestLocalRecovery.from(outbox.recoveryItems(session)))
        }
    }

    suspend fun loadRecoveryItems(): List<WorkforceOutboxRecoveryItem> = sessionMutex.withLock {
        val session = secureStore.readSession() ?: return@withLock emptyList()
        outbox.recoveryItems(session)
    }

    /**
     * Creates or resumes proof of possession of one Android Keystore key. A
     * newly created key always receives a server-issued attestation nonce
     * before `setAttestationChallenge` runs. A lost enrollment response still
     * retains only the encrypted alias/account boundary for its public-key
     * proof retry; raw attestation material is never persisted locally.
     */
    suspend fun beginDeviceEnrollment(
        bootstrap: WorkforceBootstrap,
        deviceLabel: String,
        replacesEnrollmentId: String? = null,
    ): WorkforcePendingDeviceEnrollment = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val session = requireSession()
        val existing = secureStore.readDeviceBinding()
        val alias = when {
            existing != null && existing.matches(bootstrap) && existing.lifecycle == WorkforceDeviceBindingLifecycle.PENDING_PROOF ->
                existing.keyAlias
            existing != null && existing.matches(bootstrap)
                && (existing.lifecycle == WorkforceDeviceBindingLifecycle.REVOKED || existing.lifecycle == WorkforceDeviceBindingLifecycle.REPLACED) -> {
                // The server has already made this key ineligible. Delete only
                // its local private key before creating a new enrollment; this
                // never alters server lifecycle history or silently approves a
                // replacement.
                deviceKeys.delete(existing.keyAlias)
                secureStore.clearDeviceBinding()
                reusableOrNewDeviceKeyAlias(bootstrap, session)
            }
            existing != null && existing.matches(bootstrap) ->
                throw WorkforceApiException(
                    "Device enrollment requires a status refresh before another enrollment can start.",
                    recoverable = false,
                )
            else -> reusableOrNewDeviceKeyAlias(bootstrap, session)
        }
        val publicKeySpki = deviceKeys.publicKeyDerBase64(alias)
        val started = api.beginDeviceEnrollment(
            session = session,
            deviceId = secureStore.installationId(),
            deviceLabel = deviceLabel,
            publicKeySpki = publicKeySpki,
            replacesEnrollmentId = replacesEnrollmentId,
        )
        val binding = WorkforceDeviceBinding(
            keyAlias = alias,
            enrollmentId = started.enrollmentId,
            organizationId = bootstrap.organizationId,
            agentId = bootstrap.agentId,
            lifecycle = WorkforceDeviceBindingLifecycle.PENDING_PROOF,
        )
        secureStore.writeDeviceBinding(binding)
        secureStore.clearDeviceProvisioning()
        WorkforcePendingDeviceEnrollment(
            binding = binding,
            challenge = started.challenge,
            signature = deviceKeys.prepareCanonicalActionSignature(
                alias,
                workforceDeviceEnrollmentChallenge(binding, started.challenge),
            ),
            expiresAt = started.expiresAt,
        )
    }

    /** The raw challenge remains in memory only until the immediate OS prompt. */
    suspend fun completeDeviceEnrollment(
        pending: WorkforcePendingDeviceEnrollment,
        signature: String,
    ): WorkforceDeviceTrustState = sessionMutex.withLock {
        val session = requireSession()
        val current = secureStore.readDeviceBinding()
            ?: throw WorkforceApiException("The device enrollment was cleared. Start again.", recoverable = false)
        if (current != pending.binding || current.lifecycle != WorkforceDeviceBindingLifecycle.PENDING_PROOF) {
            throw WorkforceApiException("The device enrollment changed. Refresh before continuing.", recoverable = false)
        }
        val proof = api.proveDeviceEnrollment(
            session = session,
            deviceId = secureStore.installationId(),
            enrollmentId = pending.binding.enrollmentId,
            challenge = pending.challenge,
            signature = signature,
        )
        if (proof.enrollmentId != pending.binding.enrollmentId || proof.status != "PENDING_MANAGER_APPROVAL") {
            throw WorkforceApiException("The device proof response was not safe to apply. Refresh its status.", recoverable = false)
        }
        val verified = current.copy(lifecycle = WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL)
        secureStore.writeDeviceBinding(verified)
        WorkforceDeviceTrustState(
            lifecycle = verified.lifecycle,
            enrollmentId = verified.enrollmentId,
        )
    }

    suspend fun loadDeviceTrustState(bootstrap: WorkforceBootstrap): WorkforceDeviceTrustState = sessionMutex.withLock {
        loadDeviceTrustStateLocked(bootstrap)
    }

    private suspend fun loadDeviceTrustStateLocked(bootstrap: WorkforceBootstrap): WorkforceDeviceTrustState {
        // Even a new/replacement phone must be able to see its own lifecycle
        // metadata in order to contain a lost older device. The endpoint never
        // returns a public key, proof, QR or biometric material.
        val enrollments = api.loadDeviceEnrollments(requireSession(), secureStore.installationId())
        val binding = secureStore.readDeviceBinding()
        if (binding == null) {
            val provisioning = secureStore.readDeviceProvisioning()
            return if (provisioning != null && provisioning.matches(bootstrap)) {
                WorkforceDeviceTrustState(
                    lifecycle = WorkforceDeviceBindingLifecycle.PROVISIONING,
                    enrollmentId = null,
                    enrollments = enrollments,
                )
            } else {
                WorkforceDeviceTrustState.unenrolled(enrollments)
            }
        }
        if (!binding.matches(bootstrap)) {
            return WorkforceDeviceTrustState(
                lifecycle = null,
                enrollmentId = null,
                enrollments = enrollments,
            )
        }
        if (binding.lifecycle == WorkforceDeviceBindingLifecycle.PENDING_PROOF) {
            return WorkforceDeviceTrustState(
                lifecycle = binding.lifecycle,
                enrollmentId = binding.enrollmentId,
                enrollments = enrollments,
            )
        }
        val enrollment = enrollments.firstOrNull { it.id == binding.enrollmentId }
        if (enrollment == null) {
            return WorkforceDeviceTrustState(
                lifecycle = null,
                enrollmentId = binding.enrollmentId,
                enrollments = enrollments,
            )
        }
        val lifecycle = when (enrollment.status) {
            // The server deliberately retains PENDING as its durable lifecycle
            // until an accountable manager approves the enrollment; only its
            // keyVerifiedAt field distinguishes local-proof from approval wait.
            "PENDING" -> if (enrollment.keyVerifiedAt == null) {
                WorkforceDeviceBindingLifecycle.PENDING_PROOF
            } else {
                WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL
            }
            else -> WorkforceDeviceBindingLifecycle.fromStored(enrollment.status)
        }
        if (lifecycle == null) {
            return WorkforceDeviceTrustState(
                lifecycle = null,
                enrollmentId = binding.enrollmentId,
                enrollments = enrollments,
            )
        }
        if (lifecycle != binding.lifecycle) secureStore.writeDeviceBinding(binding.copy(lifecycle = lifecycle))
        WorkforceDeviceTrustState(
            lifecycle = lifecycle,
            enrollmentId = binding.enrollmentId,
            enrollments = enrollments,
        )
    }

    /**
     * This deliberate one-way containment action remains available when the
     * managed-Play release window blocks ordinary work-time changes. The local
     * private key is deleted only after the server acknowledges revocation, so
     * a failed request cannot silently lose recovery material or pretend that
     * the factor is no longer active.
     */
    suspend fun revokeOwnDeviceEnrollment(
        bootstrap: WorkforceBootstrap,
        enrollmentId: String,
    ): WorkforceDeviceTrustState = sessionMutex.withLock {
        api.revokeDeviceEnrollment(requireSession(), secureStore.installationId(), enrollmentId)
        val binding = secureStore.readDeviceBinding()
        if (binding != null && binding.matches(bootstrap) && binding.enrollmentId == enrollmentId) {
            deviceKeys.delete(binding.keyAlias)
            secureStore.clearDeviceBinding()
        }
        loadDeviceTrustStateLocked(bootstrap)
    }

    /**
     * A device signature is bound to this operation ID/action/workday/time and
     * is never eligible for offline storage or replay after transport loss.
     */
    suspend fun prepareDeviceTrustedTodayAction(
        bootstrap: WorkforceBootstrap,
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
        attendanceQrToken: String? = null,
        attendanceLocationProof: WorkforceLocationProof? = null,
    ): WorkforcePreparedDeviceTodayAction = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val binding = secureStore.readDeviceBinding()
            ?: throw WorkforceApiException("Enroll and approve this device before using device trust.", recoverable = false)
        if (!binding.matches(bootstrap) || binding.lifecycle != WorkforceDeviceBindingLifecycle.ACTIVE) {
            throw WorkforceApiException("This device is not approved for Workforce attendance. Refresh its status or ask an administrator.", recoverable = false)
        }
        val operation = api.newTodayOperation(snapshot, action, attendanceQrToken, attendanceLocationProof)
        val canonical = workforceDeviceAttendanceChallenge(bootstrap, binding, operation)
        WorkforcePreparedDeviceTodayAction(
            operation = operation,
            enrollmentId = binding.enrollmentId,
            signature = deviceKeys.prepareCanonicalActionSignature(binding.keyAlias, canonical),
        )
    }

    suspend fun submitPreparedDeviceTodayAction(
        bootstrap: WorkforceBootstrap,
        prepared: WorkforcePreparedDeviceTodayAction,
        signature: String,
    ): WorkforceTodaySubmission = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val session = requireSession()
        val binding = secureStore.readDeviceBinding()
            ?: throw WorkforceApiException("The trusted-device binding was cleared. Refresh before continuing.", recoverable = false)
        if (binding.enrollmentId != prepared.enrollmentId || binding.lifecycle != WorkforceDeviceBindingLifecycle.ACTIVE) {
            throw WorkforceApiException("This device is no longer approved for the prepared action. Refresh before continuing.", recoverable = false)
        }
        val operation = prepared.operation.copy(
            attendanceDeviceProof = WorkforceDeviceProof(prepared.enrollmentId, signature),
        )
        try {
            val accepted = api.submitTodayOperation(session, secureStore.installationId(), operation)
            WorkforceTodaySubmission.Accepted(accepted, reminderSettings(accepted))
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // An exact proof must never enter the durable outbox. On an
            // ambiguous response, server truth decides whether a new action is
            // possible; a new signature/QR cannot be treated as a retry.
            throw WorkforceApiException(
                "The trusted-device action was not confirmed. Refresh server state before trying again.",
                recoverable = false,
                recoveryCode = (error as? WorkforceApiException)?.recoveryCode,
            )
        }
    }

    suspend fun signOut() = sessionMutex.withLock {
        clearAccountBoundary()
    }

    private suspend fun clearAccountBoundary() {
        reminderScheduler.cancelAll()
        val bindings = listOfNotNull(
            secureStore.readDeviceBinding()?.keyAlias,
            secureStore.readDeviceProvisioning()?.keyAlias,
        ).distinct()
        var deletionFailure: Throwable? = null
        bindings.forEach { alias ->
            runCatching { deviceKeys.delete(alias) }
                .onFailure { if (deletionFailure == null) deletionFailure = it }
        }
        secureStore.clearForLogout()
        outbox.clearForAccountBoundary()
        if (deletionFailure != null) throw deletionFailure
    }

    private fun requireSession(): WorkforceStoredSession = secureStore.readSession()
        ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)

    private fun WorkforceBootstrap.requireMutableRelease() {
        if (release.mutationsBlocked) {
            throw WorkforceApiException(
                "This Workforce version must be updated through your organization’s managed Play channel before submitting changes.",
                recoverable = false,
                recoveryCode = "WORKFORCE_MOBILE_UPDATE_REQUIRED",
            )
        }
    }

    private suspend fun reusableOrNewDeviceKeyAlias(
        bootstrap: WorkforceBootstrap,
        session: WorkforceStoredSession,
    ): String {
        val provisioning = secureStore.readDeviceProvisioning()
        if (provisioning != null && provisioning.matches(bootstrap)) return provisioning.keyAlias
        if (provisioning != null) {
            deviceKeys.delete(provisioning.keyAlias)
            secureStore.clearDeviceProvisioning()
        }
        val attestation = api.beginDeviceAttestationChallenge(session, secureStore.installationId())
        val challengeBytes = try {
            Base64.decode(
                attestation.challenge,
                Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
            )
        } catch (_: IllegalArgumentException) {
            throw WorkforceApiException("The device attestation challenge was invalid. Refresh and try again.", recoverable = true)
        }
        if (challengeBytes.size !in 16..128) {
            throw WorkforceApiException("The device attestation challenge was invalid. Refresh and try again.", recoverable = true)
        }
        val alias = "leaddrive.workforce.device.${UUID.randomUUID()}"
        deviceKeys.createEnrollmentKey(alias, challengeBytes)
        secureStore.writeDeviceProvisioning(
            WorkforceDeviceProvisioning(alias, bootstrap.organizationId, bootstrap.agentId),
        )
        return alias
    }
}

sealed interface WorkforceTodaySubmission {
    data class Accepted(
        val snapshot: WorkforceTodaySnapshot,
        val reminderSettings: WorkforceReminderSettings,
    ) : WorkforceTodaySubmission
    data object Queued : WorkforceTodaySubmission
}

data class WorkforceHistoryWithLocalRecovery(
    val history: WorkforceHistorySnapshot,
    val localRecovery: WorkforceHistoryLocalRecovery,
    val requestLocalRecovery: WorkforceRequestLocalRecovery,
)

/** Counts only known Work Time outbox states; it carries no event/day/payload. */
data class WorkforceHistoryLocalRecovery(
    val pendingCount: Int,
    val conflictCount: Int,
    val reviewCount: Int,
) {
    val hasOutstanding: Boolean get() = pendingCount + conflictCount + reviewCount > 0

    companion object {
        fun from(items: List<WorkforceOutboxRecoveryItem>): WorkforceHistoryLocalRecovery {
            val workday = items.filter { it.domain == WorkforceOutboxDomain.WORKDAY }
            return WorkforceHistoryLocalRecovery(
                pendingCount = workday.count {
                    it.state == WorkforceOutboxState.QUEUED || it.state == WorkforceOutboxState.RETRY
                },
                conflictCount = workday.count { it.state == WorkforceOutboxState.CONFLICT },
                reviewCount = workday.count {
                    it.state == WorkforceOutboxState.EXPIRED
                        || it.state == WorkforceOutboxState.REQUIRES_REVIEW
                        || it.state == null
                },
            )
        }
    }
}

/** Counts only request-domain outbox state; it carries no request field or payload. */
data class WorkforceRequestLocalRecovery(
    val pendingCount: Int,
    val conflictCount: Int,
    val reviewCount: Int,
) {
    val hasOutstanding: Boolean get() = pendingCount + conflictCount + reviewCount > 0

    companion object {
        fun from(items: List<WorkforceOutboxRecoveryItem>): WorkforceRequestLocalRecovery {
            val requests = items.filter { it.domain == WorkforceOutboxDomain.HRM_REQUEST }
            return WorkforceRequestLocalRecovery(
                pendingCount = requests.count {
                    it.state == WorkforceOutboxState.QUEUED || it.state == WorkforceOutboxState.RETRY
                },
                conflictCount = requests.count { it.state == WorkforceOutboxState.CONFLICT },
                reviewCount = requests.count {
                    it.state == WorkforceOutboxState.EXPIRED
                        || it.state == WorkforceOutboxState.REQUIRES_REVIEW
                        || it.state == null
                },
            )
        }
    }
}

data class WorkforceReminderSettings(
    val enabled: Boolean,
    val state: WorkforceReminderState,
)

sealed interface WorkforceHrmSubmission {
    data object Accepted : WorkforceHrmSubmission
    data class Queued(val localRecovery: WorkforceRequestLocalRecovery) : WorkforceHrmSubmission
}

data class WorkforcePendingDeviceEnrollment(
    val binding: WorkforceDeviceBinding,
    /** One-time server value: never persisted or logged. */
    val challenge: String,
    val signature: Signature,
    val expiresAt: String,
)

data class WorkforcePreparedDeviceTodayAction(
    val operation: WorkforceWorkdayOperation,
    val enrollmentId: String,
    val signature: Signature,
)

data class WorkforceDeviceTrustState(
    val lifecycle: WorkforceDeviceBindingLifecycle?,
    val enrollmentId: String?,
    /** Metadata-only self-service containment list; it never contains keys or proofs. */
    val enrollments: List<WorkforceDeviceEnrollment> = emptyList(),
) {
    companion object {
        fun unenrolled(enrollments: List<WorkforceDeviceEnrollment> = emptyList()) = WorkforceDeviceTrustState(
            lifecycle = null,
            enrollmentId = null,
            enrollments = enrollments,
        )
    }
}

private fun WorkforceDeviceBinding.matches(bootstrap: WorkforceBootstrap): Boolean =
    organizationId == bootstrap.organizationId && agentId == bootstrap.agentId

private fun WorkforceDeviceProvisioning.matches(bootstrap: WorkforceBootstrap): Boolean =
    organizationId == bootstrap.organizationId && agentId == bootstrap.agentId

private fun workforceDeviceEnrollmentChallenge(binding: WorkforceDeviceBinding, challenge: String): String = listOf(
    "workforce-device-enrollment:v1",
    "organizationId=${binding.organizationId}",
    "agentId=${binding.agentId}",
    "enrollmentId=${binding.enrollmentId}",
    "challenge=$challenge",
).joinToString("\n")

private fun workforceDeviceAttendanceChallenge(
    bootstrap: WorkforceBootstrap,
    binding: WorkforceDeviceBinding,
    operation: WorkforceWorkdayOperation,
): String = buildList {
    add("workforce-device-attendance:v1")
    add("organizationId=${bootstrap.organizationId}")
    add("agentId=${bootstrap.agentId}")
    add("enrollmentId=${binding.enrollmentId}")
    add("clientEventId=${operation.operationId}")
    add("action=${operation.action.wireValue}")
    add("workdayId=${operation.workdayId}")
    add("occurredAt=${Instant.ofEpochMilli(Instant.parse(operation.occurredAt).toEpochMilli())}")
    operation.attendanceLocationProof?.let { location ->
        add("locationCapturedAt=${Instant.ofEpochMilli(Instant.parse(location.capturedAt).toEpochMilli())}")
        add("latitude=${location.latitude}")
        add("longitude=${location.longitude}")
        add("accuracy=${location.accuracyMeters}")
        add("locationProvider=${location.provider}")
        add("locationMock=${location.isMock}")
    }
}.joinToString("\n")

private fun Throwable.isEligibleForOfflineOutbox(): Boolean = this is java.io.IOException
    || (this is WorkforceApiException && recoverable && recoveryCode == null)
