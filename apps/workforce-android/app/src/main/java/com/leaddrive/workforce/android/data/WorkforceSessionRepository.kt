package com.leaddrive.workforce.android.data

import com.leaddrive.workforce.android.security.WorkforceDeviceKeyManager
import java.security.SecureRandom
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
        clearAccountBoundary()
        val login = api.login(input)
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
    ): WorkforceTodaySubmission = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val session = secureStore.readSession()
            ?: throw WorkforceApiException("Your Workforce session has ended. Sign in again.", recoverable = false)
        val operation = api.newTodayOperation(snapshot, action, attendanceQrToken)
        try {
            val accepted = api.submitTodayOperation(session, secureStore.installationId(), operation)
            WorkforceTodaySubmission.Accepted(accepted, reminderSettings(accepted))
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
            WorkforceHrmSubmission.ACCEPTED
        } catch (error: Throwable) {
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceHrmSubmission.QUEUED
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
            WorkforceHrmSubmission.ACCEPTED
        } catch (error: Throwable) {
            if (!error.isEligibleForOfflineOutbox()) throw error
            outbox.enqueue(session, operation)
            WorkforceHrmSubmission.QUEUED
        }
    }

    suspend fun loadRecoveryItems(): List<WorkforceOutboxRecoveryItem> = sessionMutex.withLock {
        if (secureStore.readSession() == null) emptyList() else outbox.recoveryItems()
    }

    /**
     * Creates or resumes proof of possession of a single Android Keystore key.
     * A server response can be lost after committing the pending enrollment, so
     * the provisional alias is retained (encrypted) and the same public key is
     * safely re-submitted for a fresh one-time challenge on the next attempt.
     */
    suspend fun beginDeviceEnrollment(
        bootstrap: WorkforceBootstrap,
        deviceLabel: String,
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
                reusableOrNewDeviceKeyAlias(bootstrap)
            }
            existing != null && existing.matches(bootstrap) ->
                throw WorkforceApiException(
                    "This device enrollment is ${existing.lifecycle.employeeLabel}. Refresh its status or ask an administrator for the replacement path.",
                    recoverable = false,
                )
            else -> reusableOrNewDeviceKeyAlias(bootstrap)
        }
        val publicKeySpki = deviceKeys.publicKeyDerBase64(alias)
        val started = api.beginDeviceEnrollment(
            session = session,
            deviceId = secureStore.installationId(),
            deviceLabel = deviceLabel,
            publicKeySpki = publicKeySpki,
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
            message = "Device proof received. An administrator must approve this device before it can confirm work-time actions.",
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
                    message = "A device key is waiting for a safe enrollment retry. Refresh or enroll again on this device.",
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
                message = "This device binding belongs to another Workforce account and cannot be used here. Sign out to clear it safely.",
                enrollments = enrollments,
            )
        }
        if (binding.lifecycle == WorkforceDeviceBindingLifecycle.PENDING_PROOF) {
            return WorkforceDeviceTrustState(
                lifecycle = binding.lifecycle,
                enrollmentId = binding.enrollmentId,
                message = "Device enrollment is awaiting its local confirmation. Restart enrollment to request a fresh challenge.",
                enrollments = enrollments,
            )
        }
        val enrollment = enrollments.firstOrNull { it.id == binding.enrollmentId }
        if (enrollment == null) {
            return WorkforceDeviceTrustState(
                lifecycle = null,
                enrollmentId = binding.enrollmentId,
                message = "The server no longer recognizes this device enrollment. Ask an administrator for the replacement path.",
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
                message = "The server returned an unknown device status. Do not use it for attendance; ask an administrator for review.",
                enrollments = enrollments,
            )
        }
        if (lifecycle != binding.lifecycle) secureStore.writeDeviceBinding(binding.copy(lifecycle = lifecycle))
        WorkforceDeviceTrustState(
            lifecycle = lifecycle,
            enrollmentId = binding.enrollmentId,
            message = lifecycle.employeeMessage,
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
    ): WorkforcePreparedDeviceTodayAction = sessionMutex.withLock {
        bootstrap.requireMutableRelease()
        val binding = secureStore.readDeviceBinding()
            ?: throw WorkforceApiException("Enroll and approve this device before using device trust.", recoverable = false)
        if (!binding.matches(bootstrap) || binding.lifecycle != WorkforceDeviceBindingLifecycle.ACTIVE) {
            throw WorkforceApiException("This device is not approved for Workforce attendance. Refresh its status or ask an administrator.", recoverable = false)
        }
        val operation = api.newTodayOperation(snapshot, action, attendanceQrToken)
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

    private fun reusableOrNewDeviceKeyAlias(bootstrap: WorkforceBootstrap): String {
        val provisioning = secureStore.readDeviceProvisioning()
        if (provisioning != null && provisioning.matches(bootstrap)) return provisioning.keyAlias
        if (provisioning != null) {
            deviceKeys.delete(provisioning.keyAlias)
            secureStore.clearDeviceProvisioning()
        }
        val alias = "leaddrive.workforce.device.${UUID.randomUUID()}"
        deviceKeys.createEnrollmentKey(alias, ByteArray(32).also(SecureRandom()::nextBytes))
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

data class WorkforceReminderSettings(
    val enabled: Boolean,
    val state: WorkforceReminderState,
)

enum class WorkforceHrmSubmission {
    ACCEPTED,
    QUEUED,
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
    val message: String,
    /** Metadata-only self-service containment list; it never contains keys or proofs. */
    val enrollments: List<WorkforceDeviceEnrollment> = emptyList(),
) {
    companion object {
        fun unenrolled(enrollments: List<WorkforceDeviceEnrollment> = emptyList()) = WorkforceDeviceTrustState(
            lifecycle = null,
            enrollmentId = null,
            message = "No trusted device is enrolled on this phone.",
            enrollments = enrollments,
        )
    }
}

private fun WorkforceDeviceBinding.matches(bootstrap: WorkforceBootstrap): Boolean =
    organizationId == bootstrap.organizationId && agentId == bootstrap.agentId

private fun WorkforceDeviceProvisioning.matches(bootstrap: WorkforceBootstrap): Boolean =
    organizationId == bootstrap.organizationId && agentId == bootstrap.agentId

private val WorkforceDeviceBindingLifecycle.employeeLabel: String
    get() = when (this) {
        WorkforceDeviceBindingLifecycle.PROVISIONING -> "being prepared"
        WorkforceDeviceBindingLifecycle.PENDING_PROOF -> "waiting for local confirmation"
        WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL -> "waiting for manager approval"
        WorkforceDeviceBindingLifecycle.ACTIVE -> "already active"
        WorkforceDeviceBindingLifecycle.REVOKED -> "revoked"
        WorkforceDeviceBindingLifecycle.REPLACED -> "replaced"
    }

private val WorkforceDeviceBindingLifecycle.employeeMessage: String
    get() = when (this) {
        WorkforceDeviceBindingLifecycle.ACTIVE -> "This trusted device is approved for exact-action confirmation."
        WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL -> "Device proof is complete and awaits manager approval."
        WorkforceDeviceBindingLifecycle.PENDING_PROOF -> "Device enrollment awaits a fresh local confirmation."
        WorkforceDeviceBindingLifecycle.PROVISIONING -> "Device enrollment is waiting for a safe retry."
        WorkforceDeviceBindingLifecycle.REVOKED -> "This device was revoked and cannot confirm attendance."
        WorkforceDeviceBindingLifecycle.REPLACED -> "This device was replaced and cannot confirm attendance."
    }

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
): String = listOf(
    "workforce-device-attendance:v1",
    "organizationId=${bootstrap.organizationId}",
    "agentId=${bootstrap.agentId}",
    "enrollmentId=${binding.enrollmentId}",
    "clientEventId=${operation.operationId}",
    "action=${operation.action.wireValue}",
    "workdayId=${operation.workdayId}",
    "occurredAt=${Instant.ofEpochMilli(Instant.parse(operation.occurredAt).toEpochMilli())}",
).joinToString("\n")

private fun Throwable.isEligibleForOfflineOutbox(): Boolean = this is java.io.IOException
    || (this is WorkforceApiException && recoverable && recoveryCode == null)
