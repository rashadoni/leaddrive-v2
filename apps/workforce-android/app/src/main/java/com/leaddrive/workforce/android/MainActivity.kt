package com.leaddrive.workforce.android

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import androidx.annotation.StringRes
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.core.content.ContextCompat
import com.leaddrive.workforce.android.data.WorkforceActionConflictException
import com.leaddrive.workforce.android.data.WorkforceApiClient
import com.leaddrive.workforce.android.data.WorkforceApiException
import com.leaddrive.workforce.android.data.WorkforceBootstrap
import com.leaddrive.workforce.android.data.WorkforceDeviceBindingLifecycle
import com.leaddrive.workforce.android.data.WorkforceDeviceTrustState
import com.leaddrive.workforce.android.data.WorkforceEncryptedOutbox
import com.leaddrive.workforce.android.data.WorkforceHistorySnapshot
import com.leaddrive.workforce.android.data.WorkforceHrmRequestDraft
import com.leaddrive.workforce.android.data.WorkforceHrmRequestType
import com.leaddrive.workforce.android.data.WorkforceHrmRequestStatus
import com.leaddrive.workforce.android.data.WorkforceHrmSubmission
import com.leaddrive.workforce.android.data.WorkforceLoginInput
import com.leaddrive.workforce.android.data.WorkforceOutboxRecoveryItem
import com.leaddrive.workforce.android.data.WorkforceOutboxRecoveryHint
import com.leaddrive.workforce.android.data.WorkforceOutboxDomain
import com.leaddrive.workforce.android.data.WorkforceOutboxState
import com.leaddrive.workforce.android.data.WorkforceRuntimeConfiguration
import com.leaddrive.workforce.android.data.WorkforceReminderSettings
import com.leaddrive.workforce.android.data.WorkforceReminderScheduler
import com.leaddrive.workforce.android.data.WorkforceReminderState
import com.leaddrive.workforce.android.data.WorkforceSecureStore
import com.leaddrive.workforce.android.data.WorkforceSessionRepository
import com.leaddrive.workforce.android.data.WorkforceTodaySnapshot
import com.leaddrive.workforce.android.data.WorkforceWorkday
import com.leaddrive.workforce.android.data.WorkforceWorkdayAction
import com.leaddrive.workforce.android.data.WorkforceWorkdayStatus
import com.leaddrive.workforce.android.security.WorkforceQrScanner
import com.leaddrive.workforce.android.security.WorkforceDeviceAuthenticator
import com.leaddrive.workforce.android.security.WorkforceDeviceKeyManager
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val configuration = WorkforceRuntimeConfiguration.fromBuildConfig(applicationContext)
        val secureStore = WorkforceSecureStore(applicationContext)
        val deviceKeys = WorkforceDeviceKeyManager()
        val repository = WorkforceSessionRepository(
            api = WorkforceApiClient(configuration),
            secureStore = secureStore,
            outbox = WorkforceEncryptedOutbox(applicationContext),
            deviceKeys = deviceKeys,
            reminderScheduler = WorkforceReminderScheduler(applicationContext),
        )
        setContent {
            MaterialTheme {
                WorkforceRoot(
                    repository,
                    WorkforceQrScanner(this@MainActivity),
                    WorkforceDeviceAuthenticator(this@MainActivity),
                )
            }
        }
    }
}

/**
 * Server state is the only source of truth.  The composable intentionally
 * restores the existing secure session and reloads the workday after process
 * death instead of reconstructing an attendance state from a local timer.
 */
@Composable
private fun WorkforceRoot(
    repository: WorkforceSessionRepository,
    qrScanner: WorkforceQrScanner,
    deviceAuthenticator: WorkforceDeviceAuthenticator,
) {
    val scope = rememberCoroutineScope()
    var bootstrap by remember { mutableStateOf<WorkforceBootstrap?>(null) }
    var today by remember { mutableStateOf<WorkforceTodaySnapshot?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var history by remember { mutableStateOf<WorkforceHistorySnapshot?>(null) }
    var recoveryItems by remember { mutableStateOf<List<WorkforceOutboxRecoveryItem>?>(null) }
    var deviceTrust by remember { mutableStateOf<WorkforceDeviceTrustState?>(null) }
    val qrScanCancelled = stringResource(R.string.qr_scan_cancelled)
    val qrScanUnreadable = stringResource(R.string.qr_scan_unreadable)
    val employeeErrorCopy = WorkforceEmployeeErrorCopy(
        conflict = stringResource(R.string.error_action_conflict),
        api = stringResource(R.string.error_request_failed),
        network = stringResource(R.string.error_network_unavailable),
    )
    val queuedToday = stringResource(R.string.status_today_queued)
    val refreshingToday = stringResource(R.string.status_refreshing_server)
    val confirmingDeviceAction = stringResource(R.string.status_confirming_device_action)
    val preparingDeviceEnrollment = stringResource(R.string.status_preparing_device_enrollment)
    val refreshingDeviceTrust = stringResource(R.string.status_refreshing_device_trust)
    val revokingDeviceTrust = stringResource(R.string.status_revoking_device_trust)
    val deviceRevoked = stringResource(R.string.status_device_revoked)
    val signingIn = stringResource(R.string.status_signing_in)
    val loadingHistory = stringResource(R.string.status_loading_history)
    val loadingRecovery = stringResource(R.string.status_loading_recovery)
    val submittingRequest = stringResource(R.string.status_submitting_request)
    val requestAccepted = stringResource(R.string.status_request_accepted)
    val requestQueued = stringResource(R.string.status_request_queued)
    val cancellingRequest = stringResource(R.string.status_cancelling_request)
    val cancellationAccepted = stringResource(R.string.status_cancellation_accepted)
    val cancellationQueued = stringResource(R.string.status_cancellation_queued)
    val signOutFailed = stringResource(R.string.status_sign_out_failed)
    val deviceActionPrompts = mapOf(
        WorkforceWorkdayAction.START to stringResource(
            R.string.device_action_prompt,
            stringResource(R.string.action_start),
        ),
        WorkforceWorkdayAction.PAUSE to stringResource(
            R.string.device_action_prompt,
            stringResource(R.string.action_pause),
        ),
        WorkforceWorkdayAction.RESUME to stringResource(
            R.string.device_action_prompt,
            stringResource(R.string.action_resume),
        ),
        WorkforceWorkdayAction.FINISH to stringResource(
            R.string.device_action_prompt,
            stringResource(R.string.action_finish),
        ),
    )
    val deviceEnrollmentPromptTemplate = stringResource(
        R.string.device_enrollment_prompt,
        "__WORKFORCE_EXPIRY__",
    )
    val deviceLifecycleMessages = mapOf<WorkforceDeviceBindingLifecycle?, String>(
        null to stringResource(R.string.device_state_unenrolled),
        WorkforceDeviceBindingLifecycle.PROVISIONING to stringResource(R.string.device_state_provisioning),
        WorkforceDeviceBindingLifecycle.PENDING_PROOF to stringResource(R.string.device_state_pending_proof),
        WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL to stringResource(
            R.string.device_state_pending_manager_approval,
        ),
        WorkforceDeviceBindingLifecycle.ACTIVE to stringResource(R.string.device_state_active),
        WorkforceDeviceBindingLifecycle.REVOKED to stringResource(R.string.device_state_revoked),
        WorkforceDeviceBindingLifecycle.REPLACED to stringResource(R.string.device_state_replaced),
    )
    var reminderSettings by remember { mutableStateOf<WorkforceReminderSettings?>(null) }
    var section by remember { mutableStateOf(WorkforceSection.TODAY) }
    var restoring by remember { mutableStateOf(true) }
    var busyAction by remember { mutableStateOf<WorkforceWorkdayAction?>(null) }
    val context = LocalContext.current
    val updateRequiredBeforeChanges = stringResource(R.string.update_required_before_changes)

    fun applyReminderSettings(snapshot: WorkforceTodaySnapshot) {
        reminderSettings = repository.reminderSettings(snapshot)
    }

    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        val snapshot = today
        if (snapshot != null) {
            reminderSettings = repository.setLocalRemindersEnabled(true, snapshot)
        }
    }

    fun setLocalReminders(enabled: Boolean) {
        val snapshot = today ?: return
        if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            // The app never requests notification permission until the employee
            // explicitly enables this optional private reminder.
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        reminderSettings = repository.setLocalRemindersEnabled(enabled, snapshot)
    }

    fun applyTodaySubmission(submission: com.leaddrive.workforce.android.data.WorkforceTodaySubmission) {
        when (submission) {
            is com.leaddrive.workforce.android.data.WorkforceTodaySubmission.Accepted -> {
                today = submission.snapshot
                reminderSettings = submission.reminderSettings
                history = null
                recoveryItems = null
                status = null
            }
            com.leaddrive.workforce.android.data.WorkforceTodaySubmission.Queued -> {
                status = queuedToday
            }
        }
    }

    fun refreshToday() {
        scope.launch {
            status = refreshingToday
            runCatching { repository.loadToday() }
                .onSuccess {
                    today = it
                    applyReminderSettings(it)
                    history = null
                    recoveryItems = null
                    deviceTrust = null
                    status = null
                }
                .onFailure { status = it.employeeMessage(employeeErrorCopy) }
        }
    }

    fun submitTodayAction(action: WorkforceWorkdayAction, qrToken: String? = null) {
        val snapshot = today ?: return
        val currentBootstrap = bootstrap ?: return
        busyAction = action
        status = null
        scope.launch {
            runCatching { repository.submitTodayAction(currentBootstrap, snapshot, action, qrToken) }
                .onSuccess(::applyTodaySubmission)
                .onFailure { status = it.employeeMessage(employeeErrorCopy) }
            busyAction = null
        }
    }

    fun submitDeviceTrustedTodayAction(action: WorkforceWorkdayAction, qrToken: String? = null) {
        val snapshot = today ?: return
        val currentBootstrap = bootstrap ?: return
        busyAction = action
        status = confirmingDeviceAction
        scope.launch {
            runCatching {
                val prepared = repository.prepareDeviceTrustedTodayAction(currentBootstrap, snapshot, action, qrToken)
                val signature = deviceAuthenticator.authenticateAndSign(
                    prepared.signature,
                    deviceActionPrompts.getValue(action),
                )
                repository.submitPreparedDeviceTodayAction(currentBootstrap, prepared, signature)
            }.onSuccess(::applyTodaySubmission)
                .onFailure { status = it.employeeMessage(employeeErrorCopy) }
            busyAction = null
        }
    }

    fun beginDeviceEnrollment(deviceLabel: String) {
        val currentBootstrap = bootstrap ?: return
        status = preparingDeviceEnrollment
        scope.launch {
            runCatching {
                val pending = repository.beginDeviceEnrollment(currentBootstrap, deviceLabel)
                val signature = deviceAuthenticator.authenticateAndSign(
                    pending.signature,
                    deviceEnrollmentPromptTemplate.replace("__WORKFORCE_EXPIRY__", pending.expiresAt),
                )
                repository.completeDeviceEnrollment(pending, signature)
            }.onSuccess {
                deviceTrust = it
                status = deviceLifecycleMessages.getValue(it.lifecycle)
            }.onFailure { status = it.employeeMessage(employeeErrorCopy) }
        }
    }

    fun refreshDeviceTrust() {
        val currentBootstrap = bootstrap ?: return
        status = refreshingDeviceTrust
        scope.launch {
            runCatching { repository.loadDeviceTrustState(currentBootstrap) }
                .onSuccess {
                    deviceTrust = it
                    status = deviceLifecycleMessages.getValue(it.lifecycle)
                }
                .onFailure { status = it.employeeMessage(employeeErrorCopy) }
        }
    }

    fun revokeOwnDeviceEnrollment(enrollmentId: String) {
        val currentBootstrap = bootstrap ?: return
        status = revokingDeviceTrust
        scope.launch {
            runCatching { repository.revokeOwnDeviceEnrollment(currentBootstrap, enrollmentId) }
                .onSuccess {
                    deviceTrust = it
                    status = deviceRevoked
                }
                .onFailure { status = it.employeeMessage(employeeErrorCopy) }
        }
    }

    LaunchedEffect(Unit) {
        runCatching { repository.restore() }
            .onSuccess { restored ->
                bootstrap = restored
                if (restored != null) {
                    runCatching { repository.loadToday() }
                        .onSuccess {
                            today = it
                            applyReminderSettings(it)
                        }
                        .onFailure { status = it.employeeMessage(employeeErrorCopy) }
                }
            }
            .onFailure { status = it.employeeMessage(employeeErrorCopy) }
        restoring = false
    }

    when {
        restoring -> WorkforceLoading()
        bootstrap == null -> WorkforceLogin(
            status = status,
            onSubmit = { input ->
                status = signingIn
                scope.launch {
                    runCatching {
                        val signedIn = repository.signIn(input)
                        val loadedToday = repository.loadToday()
                        signedIn to loadedToday
                    }.onSuccess { (signedIn, loadedToday) ->
                        bootstrap = signedIn
                        today = loadedToday
                        applyReminderSettings(loadedToday)
                        history = null
                        recoveryItems = null
                        deviceTrust = null
                        status = null
                    }.onFailure { status = it.employeeMessage(employeeErrorCopy) }
                }
            },
        )
        else -> WorkforceHome(
            bootstrap = bootstrap!!,
            today = today,
            status = status,
            section = section,
            history = history,
            recoveryItems = recoveryItems,
            deviceTrust = deviceTrust,
            reminderSettings = reminderSettings,
            busyAction = busyAction,
            onRefresh = ::refreshToday,
            onSelectSection = { section = it },
            onLoadHistory = {
                val anchorDate = today?.date
                if (anchorDate != null) {
                    status = loadingHistory
                    scope.launch {
                        runCatching { repository.loadHistory(anchorDate) }
                            .onSuccess {
                                history = it
                                status = null
                            }
                            .onFailure { status = it.employeeMessage(employeeErrorCopy) }
                    }
                }
            },
            onLoadRecovery = {
                status = loadingRecovery
                scope.launch {
                    runCatching { repository.loadRecoveryItems() }
                        .onSuccess {
                            recoveryItems = it
                            status = null
                        }
                        .onFailure { status = it.employeeMessage(employeeErrorCopy) }
                }
            },
            onLoadDeviceTrust = ::refreshDeviceTrust,
            onBeginDeviceEnrollment = ::beginDeviceEnrollment,
            onRevokeDeviceEnrollment = ::revokeOwnDeviceEnrollment,
            onSetLocalReminders = ::setLocalReminders,
            onSubmitRequest = { draft ->
                status = submittingRequest
                scope.launch {
                    runCatching { repository.submitHrmRequest(bootstrap!!, draft) }
                        .onSuccess { submission ->
                            history = null
                            recoveryItems = null
                            status = when (submission) {
                                WorkforceHrmSubmission.ACCEPTED -> requestAccepted
                                WorkforceHrmSubmission.QUEUED -> requestQueued
                            }
                        }
                        .onFailure { status = it.employeeMessage(employeeErrorCopy) }
                }
            },
            onCancelRequest = { requestId ->
                status = cancellingRequest
                scope.launch {
                    runCatching { repository.cancelHrmRequest(bootstrap!!, requestId) }
                        .onSuccess { submission ->
                            history = null
                            status = when (submission) {
                                WorkforceHrmSubmission.ACCEPTED -> cancellationAccepted
                                WorkforceHrmSubmission.QUEUED -> cancellationQueued
                            }
                        }
                        .onFailure { status = it.employeeMessage(employeeErrorCopy) }
                }
            },
            onAction = { action ->
                val currentBootstrap = bootstrap!!
                val attendance = currentBootstrap.attendance
                if (currentBootstrap.release.mutationsBlocked) {
                    status = updateRequiredBeforeChanges
                } else if (attendance.requiresQr(action)) {
                    qrScanner.scan(
                        onToken = { token ->
                            if (attendance.requiresDeviceProof(action)) {
                                submitDeviceTrustedTodayAction(action, token.value)
                            } else {
                                submitTodayAction(action, token.value)
                            }
                        },
                        onCancelled = { status = qrScanCancelled },
                        onFailure = { status = qrScanUnreadable },
                    )
                } else if (attendance.requiresDeviceProof(action)) {
                    submitDeviceTrustedTodayAction(action)
                } else {
                    submitTodayAction(action)
                }
            },
            onSignOut = {
                scope.launch {
                    runCatching { repository.signOut() }
                        .onSuccess {
                            bootstrap = null
                            today = null
                            history = null
                            recoveryItems = null
                            deviceTrust = null
                            reminderSettings = null
                            status = null
                        }
                        .onFailure { status = signOutFailed }
                }
            },
        )
    }
}

@Composable
private fun WorkforceLoading() {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.title_loading), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.restoring_session))
    }
}

@Composable
private fun WorkforceLogin(
    status: String?,
    onSubmit: (WorkforceLoginInput) -> Unit,
) {
    var organizationSlug by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    // Credentials remain in live memory only and are cleared on submit.
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.title_loading), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.work_time_separate))
        OutlinedTextField(
            value = organizationSlug,
            onValueChange = { organizationSlug = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.organization)) },
            singleLine = true,
        )
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.email)) },
            singleLine = true,
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.password)) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                onSubmit(WorkforceLoginInput(email, password, organizationSlug))
                password = ""
            },
        ) {
            Text(stringResource(R.string.sign_in))
        }
        status?.let {
            Text(
                it,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun WorkforceHome(
    bootstrap: WorkforceBootstrap,
    today: WorkforceTodaySnapshot?,
    status: String?,
    section: WorkforceSection,
    history: WorkforceHistorySnapshot?,
    recoveryItems: List<WorkforceOutboxRecoveryItem>?,
    deviceTrust: WorkforceDeviceTrustState?,
    reminderSettings: WorkforceReminderSettings?,
    busyAction: WorkforceWorkdayAction?,
    onRefresh: () -> Unit,
    onSelectSection: (WorkforceSection) -> Unit,
    onLoadHistory: () -> Unit,
    onLoadRecovery: () -> Unit,
    onLoadDeviceTrust: () -> Unit,
    onBeginDeviceEnrollment: (String) -> Unit,
    onRevokeDeviceEnrollment: (String) -> Unit,
    onSetLocalReminders: (Boolean) -> Unit,
    onSubmitRequest: (WorkforceHrmRequestDraft) -> Unit,
    onCancelRequest: (String) -> Unit,
    onAction: (WorkforceWorkdayAction) -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.hello_employee, bootstrap.employeeName), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.timezone, bootstrap.timezone))
        Row(modifier = Modifier.fillMaxWidth().selectableGroup()) {
            WorkforceSection.entries.forEach { candidate ->
                val label = stringResource(candidate.labelRes)
                val selected = candidate == section
                val selectionState = stringResource(
                    if (selected) R.string.tab_selected else R.string.tab_not_selected,
                )
                TextButton(
                    modifier = Modifier.workforceTapTarget().semantics {
                        role = Role.Tab
                        stateDescription = selectionState
                    },
                    onClick = { onSelectSection(candidate) },
                ) {
                    Text(if (selected) "• $label" else label)
                }
            }
        }
        when (section) {
            WorkforceSection.TODAY -> {
                Text(stringResource(R.string.server_truth, today?.date ?: stringResource(R.string.not_loaded)))
                if (today == null) {
                    Text(stringResource(R.string.worktime_unavailable))
                    Button(onClick = onRefresh) { Text(stringResource(R.string.retry_server_state)) }
                } else {
                    WorkforceTodayCard(
                        snapshot = today,
                        attendance = bootstrap.attendance,
                        mutationsBlocked = bootstrap.release.mutationsBlocked,
                        busyAction = busyAction,
                        onAction = onAction,
                    )
                    WorkforceLocalReminders(
                        settings = reminderSettings,
                        onSetEnabled = onSetLocalReminders,
                    )
                    WorkforceScheduledContext(today.workday?.schedule?.segment)
                    Text(stringResource(R.string.today_location_disclaimer))
                    Text(stringResource(R.string.today_outbox_disclaimer))
                    TextButton(onClick = onRefresh) { Text(stringResource(R.string.refresh_server_state)) }
                }
            }
            WorkforceSection.HISTORY -> WorkforceHistory(
                history = history,
                onLoad = onLoadHistory,
            )
            WorkforceSection.REQUESTS -> WorkforceRequests(
                history = history,
                defaultDate = today?.date.orEmpty(),
                mutationsBlocked = bootstrap.release.mutationsBlocked,
                onLoad = onLoadHistory,
                onSubmit = onSubmitRequest,
                onCancel = onCancelRequest,
            )
            WorkforceSection.RECOVERY -> WorkforceRecovery(
                items = recoveryItems,
                timezone = bootstrap.timezone,
                onLoad = onLoadRecovery,
            )
            WorkforceSection.DEVICE -> WorkforceDeviceTrust(
                state = deviceTrust,
                mutationsBlocked = bootstrap.release.mutationsBlocked,
                onLoad = onLoadDeviceTrust,
                onEnroll = onBeginDeviceEnrollment,
                onRevoke = onRevokeDeviceEnrollment,
            )
        }
        if (bootstrap.release.updateUrl != null) {
            Text(
                stringResource(
                    if (bootstrap.release.mutationsBlocked) {
                        R.string.update_required_before_changes
                    } else {
                        R.string.update_available
                    },
                ),
            )
        }
        if (bootstrap.release.mutationsBlocked) {
            Text(
                stringResource(
                    R.string.update_release_window,
                    bootstrap.release.minimumVersion ?: stringResource(R.string.not_loaded),
                    bootstrap.release.latestVersion ?: stringResource(R.string.not_loaded),
                ),
                color = MaterialTheme.colorScheme.error,
            )
        }
        status?.let {
            Text(
                it,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(modifier = Modifier.workforceTapTarget(), onClick = onSignOut) { Text(stringResource(R.string.sign_out)) }
    }
}

@Composable
private fun WorkforceLocalReminders(
    settings: WorkforceReminderSettings?,
    onSetEnabled: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.private_reminder), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.private_reminder_explainer))
        if (settings == null) {
            Text(stringResource(R.string.private_reminder_refresh))
        } else {
            Text(settings.state.localizedLabel())
            Button(onClick = { onSetEnabled(!settings.enabled) }) {
                Text(stringResource(if (settings.enabled) R.string.turn_off_reminders else R.string.turn_on_reminders))
            }
        }
    }
}

private enum class WorkforceSection(@StringRes val labelRes: Int) {
    TODAY(R.string.tab_today),
    HISTORY(R.string.tab_work_time),
    REQUESTS(R.string.tab_requests),
    RECOVERY(R.string.tab_recovery),
    DEVICE(R.string.tab_device),
}

@Composable
private fun WorkforceHrmRequestType?.localizedLabel(): String = stringResource(
    when (this) {
        WorkforceHrmRequestType.LEAVE -> R.string.request_leave
        WorkforceHrmRequestType.ABSENCE -> R.string.request_absence
        WorkforceHrmRequestType.TIME_CORRECTION -> R.string.request_time_correction
        null -> R.string.request_type_unknown
    },
)

@Composable
private fun WorkforceHrmRequestStatus?.localizedLabel(): String = stringResource(
    when (this) {
        WorkforceHrmRequestStatus.PENDING -> R.string.request_status_pending
        WorkforceHrmRequestStatus.APPROVED -> R.string.request_status_approved
        WorkforceHrmRequestStatus.REJECTED -> R.string.request_status_rejected
        WorkforceHrmRequestStatus.CANCELLED -> R.string.request_status_cancelled
        null -> R.string.request_status_unknown
    },
)

@Composable
private fun String.localizedCalendarKind(): String = stringResource(
    when (this) {
        "WORKING_DAY" -> R.string.calendar_kind_working_day
        "WEEKEND" -> R.string.calendar_kind_weekend
        "PUBLIC_HOLIDAY" -> R.string.calendar_kind_public_holiday
        "COMPANY_HOLIDAY" -> R.string.calendar_kind_company_holiday
        "EXCEPTION_WORKDAY" -> R.string.calendar_kind_exception_workday
        "MOVED_WORKDAY" -> R.string.calendar_kind_moved_workday
        "MOVED_DAY_OFF" -> R.string.calendar_kind_moved_day_off
        else -> R.string.calendar_kind_unknown
    },
)

@Composable
private fun WorkforceWorkdayAction.localizedLabel(): String = stringResource(labelRes())

@StringRes
private fun WorkforceWorkdayAction.labelRes(): Int = when (this) {
    WorkforceWorkdayAction.START -> R.string.action_start
    WorkforceWorkdayAction.PAUSE -> R.string.action_pause
    WorkforceWorkdayAction.RESUME -> R.string.action_resume
    WorkforceWorkdayAction.FINISH -> R.string.action_finish
}

@Composable
private fun WorkforceWorkdayStatus.localizedLabel(): String = stringResource(labelRes())

@StringRes
private fun WorkforceWorkdayStatus.labelRes(): Int = when (this) {
    WorkforceWorkdayStatus.STARTED -> R.string.workday_state_working
    WorkforceWorkdayStatus.PAUSED -> R.string.workday_state_paused
    WorkforceWorkdayStatus.COMPLETED -> R.string.workday_state_completed
}

@Composable
private fun WorkforceReminderState.localizedLabel(): String = stringResource(labelRes())

@StringRes
private fun WorkforceReminderState.labelRes(): Int = when (this) {
    WorkforceReminderState.DISABLED -> R.string.reminder_state_disabled
    WorkforceReminderState.PERMISSION_REQUIRED -> R.string.reminder_state_permission_required
    WorkforceReminderState.NOTIFICATIONS_DISABLED -> R.string.reminder_state_notifications_disabled
    WorkforceReminderState.NO_APPROVED_SCHEDULE -> R.string.reminder_state_no_approved_schedule
    WorkforceReminderState.WINDOW_PASSED -> R.string.reminder_state_window_passed
    WorkforceReminderState.NOT_NEEDED -> R.string.reminder_state_not_needed
    WorkforceReminderState.SCHEDULED -> R.string.reminder_state_scheduled
}

@Composable
private fun WorkforceOutboxDomain?.localizedLabel(): String = stringResource(
    when (this) {
        WorkforceOutboxDomain.WORKDAY -> R.string.recovery_domain_workday
        WorkforceOutboxDomain.HRM_REQUEST -> R.string.recovery_domain_request
        null -> R.string.recovery_domain_unknown
    },
)

@Composable
private fun WorkforceOutboxState?.localizedLabel(): String = stringResource(
    when (this) {
        WorkforceOutboxState.QUEUED, WorkforceOutboxState.RETRY -> R.string.recovery_state_pending
        WorkforceOutboxState.CONFLICT -> R.string.recovery_state_conflict
        WorkforceOutboxState.EXPIRED -> R.string.recovery_state_expired
        WorkforceOutboxState.REQUIRES_REVIEW, null -> R.string.recovery_state_review_required
    },
)

@StringRes
private fun WorkforceOutboxRecoveryHint.labelRes(): Int = when (this) {
    WorkforceOutboxRecoveryHint.PENDING_ACKNOWLEDGEMENT -> R.string.recovery_hint_pending_acknowledgement
    WorkforceOutboxRecoveryHint.CONFLICT_REFRESH -> R.string.recovery_hint_conflict_refresh
    WorkforceOutboxRecoveryHint.OFFLINE_LIMIT_EXPIRED -> R.string.recovery_hint_offline_limit_expired
    WorkforceOutboxRecoveryHint.UPDATE_REQUIRED -> R.string.recovery_hint_update_required
    WorkforceOutboxRecoveryHint.LOCAL_ITEM_UNRECOVERABLE -> R.string.recovery_hint_local_item_unrecoverable
    WorkforceOutboxRecoveryHint.REVIEW_REQUIRED -> R.string.recovery_hint_review_required
}

private fun Modifier.workforceTapTarget(): Modifier = defaultMinSize(
    minWidth = 48.dp,
    minHeight = 48.dp,
)

@Composable
private fun WorkforceRecovery(
    items: List<WorkforceOutboxRecoveryItem>?,
    timezone: String,
    onLoad: () -> Unit,
) {
    val tenantZone = remember(timezone) {
        runCatching { ZoneId.of(timezone) }.getOrDefault(ZoneOffset.UTC)
    }
    if (items == null) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.tab_recovery), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.recovery_explainer))
            Button(onClick = onLoad) { Text(stringResource(R.string.recovery_load)) }
        }
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.tab_recovery), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.recovery_retry_explainer))
            TextButton(onClick = onLoad) { Text(stringResource(R.string.recovery_refresh)) }
        }
        if (items.isEmpty()) {
            item { Text(stringResource(R.string.recovery_empty)) }
        } else {
            items(items) { item ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        stringResource(
                            R.string.recovery_item_label,
                            item.domain.localizedLabel(),
                            item.state.localizedLabel(),
                        ),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(stringResource(
                        R.string.recovery_saved_at,
                        Instant.ofEpochMilli(item.createdAtEpochMs).atZone(tenantZone).toLocalDateTime(),
                    ))
                    Text(stringResource(item.recoveryHint.labelRes()))
                }
            }
        }
    }
}

@Composable
private fun WorkforceDeviceTrust(
    state: WorkforceDeviceTrustState?,
    mutationsBlocked: Boolean,
    onLoad: () -> Unit,
    onEnroll: (String) -> Unit,
    onRevoke: (String) -> Unit,
) {
    val defaultDeviceLabel = stringResource(R.string.device_label_default)
    var label by rememberSaveable { mutableStateOf(defaultDeviceLabel) }
    var revokeCandidateId by rememberSaveable { mutableStateOf<String?>(null) }
    val trustedState = state ?: run {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.device_trust_title), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.device_trust_explainer))
            Button(onClick = onLoad) { Text(stringResource(R.string.device_status_load)) }
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.device_trust_title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.device_trust_explainer))
        Text(stringResource(deviceLifecycleMessage(trustedState.lifecycle)))
        when (trustedState.lifecycle) {
            WorkforceDeviceBindingLifecycle.ACTIVE,
            WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL -> {
                TextButton(onClick = onLoad) { Text(stringResource(R.string.device_status_refresh)) }
            }
            else -> {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.device_label)) },
                    singleLine = true,
                )
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !mutationsBlocked,
                    onClick = { onEnroll(label) },
                ) {
                    Text(
                        if (trustedState.lifecycle == WorkforceDeviceBindingLifecycle.PENDING_PROOF || trustedState.lifecycle == WorkforceDeviceBindingLifecycle.PROVISIONING) {
                            stringResource(R.string.device_enrollment_resume)
                        } else {
                            stringResource(R.string.device_enrollment_start)
                        },
                    )
                }
            }
        }
        Text(stringResource(R.string.device_lost_guidance))
        Text(stringResource(R.string.device_uninstall_guidance))
        val revocable = trustedState.enrollments.filter { it.status == "PENDING" || it.status == "ACTIVE" }
        if (revocable.isNotEmpty()) {
            Text(stringResource(R.string.device_enrollments_title))
            Text(stringResource(R.string.device_revoke_hint))
            revocable.forEach { enrollment ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.device_enrollment_status, enrollment.deviceLabel, stringResource(deviceEnrollmentStatus(enrollment.status))))
                    TextButton(
                        modifier = Modifier.workforceTapTarget(),
                        onClick = { revokeCandidateId = enrollment.id },
                    ) {
                        Text(stringResource(R.string.device_revoke_action))
                    }
                }
            }
        }
    }
    revokeCandidateId?.let { enrollmentId ->
        val labelForCandidate = trustedState.enrollments.firstOrNull { it.id == enrollmentId }?.deviceLabel ?: stringResource(R.string.device_label_fallback)
        AlertDialog(
            onDismissRequest = { revokeCandidateId = null },
            title = { Text(stringResource(R.string.device_revoke_dialog_title)) },
            text = { Text(stringResource(R.string.device_revoke_dialog_body, labelForCandidate)) },
            confirmButton = {
                Button(onClick = {
                    revokeCandidateId = null
                    onRevoke(enrollmentId)
                }) { Text(stringResource(R.string.device_revoke_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { revokeCandidateId = null }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@StringRes
private fun deviceLifecycleMessage(lifecycle: WorkforceDeviceBindingLifecycle?): Int = when (lifecycle) {
    null -> R.string.device_state_unenrolled
    WorkforceDeviceBindingLifecycle.PROVISIONING -> R.string.device_state_provisioning
    WorkforceDeviceBindingLifecycle.PENDING_PROOF -> R.string.device_state_pending_proof
    WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL -> R.string.device_state_pending_manager_approval
    WorkforceDeviceBindingLifecycle.ACTIVE -> R.string.device_state_active
    WorkforceDeviceBindingLifecycle.REVOKED -> R.string.device_state_revoked
    WorkforceDeviceBindingLifecycle.REPLACED -> R.string.device_state_replaced
}

@StringRes
private fun deviceEnrollmentStatus(status: String): Int = when (status) {
    "PENDING" -> R.string.device_enrollment_pending
    "ACTIVE" -> R.string.device_enrollment_active
    else -> R.string.device_enrollment_unknown
}

@Composable
private fun WorkforceRequests(
    history: WorkforceHistorySnapshot?,
    defaultDate: String,
    mutationsBlocked: Boolean,
    onLoad: () -> Unit,
    onSubmit: (WorkforceHrmRequestDraft) -> Unit,
    onCancel: (String) -> Unit,
) {
    var type by remember { mutableStateOf(WorkforceHrmRequestType.LEAVE) }
    var startDate by rememberSaveable { mutableStateOf(defaultDate) }
    var endDate by rememberSaveable { mutableStateOf(defaultDate) }
    // Reasons can contain sensitive employment context. Keep draft text only
    // in live memory; do not persist it in the saved-instance-state bundle.
    var reason by remember { mutableStateOf("") }
    var correctionWorkdayId by rememberSaveable { mutableStateOf("") }
    var requestedStartAt by rememberSaveable { mutableStateOf("") }
    var requestedEndAt by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(defaultDate) {
        if (startDate.isBlank()) startDate = defaultDate
        if (endDate.isBlank()) endDate = defaultDate
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.tab_requests), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.requests_explainer))
            if (mutationsBlocked) Text(stringResource(R.string.update_required_before_changes))
        }
        item {
            Column(modifier = Modifier.fillMaxWidth()) {
                WorkforceHrmRequestType.entries.forEach { candidate ->
                    val label = candidate.localizedLabel()
                    val selected = candidate == type
                    val selectionState = stringResource(
                        if (selected) R.string.tab_selected else R.string.tab_not_selected,
                    )
                    TextButton(
                        modifier = Modifier.workforceTapTarget().semantics {
                            role = Role.Tab
                            stateDescription = selectionState
                        },
                        onClick = { type = candidate },
                    ) {
                        Text(if (selected) "• $label" else label)
                    }
                }
            }
        }
        item {
            OutlinedTextField(
                value = startDate,
                onValueChange = { startDate = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.request_start_date)) },
                singleLine = true,
            )
        }
        item {
            OutlinedTextField(
                value = endDate,
                onValueChange = { endDate = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.request_end_date)) },
                singleLine = true,
            )
        }
        if (type == WorkforceHrmRequestType.TIME_CORRECTION) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.request_choose_workday))
                    val candidates = history?.days?.filter { it.workday != null }.orEmpty()
                    if (candidates.isEmpty()) {
                        Text(stringResource(R.string.request_history_required))
                        TextButton(onClick = onLoad) { Text(stringResource(R.string.request_load_history)) }
                    } else {
                        candidates.forEach { day ->
                            TextButton(onClick = {
                                correctionWorkdayId = day.workday!!.id
                                startDate = day.date
                                endDate = day.date
                            }) {
                                Text(if (correctionWorkdayId == day.workday!!.id) "• ${day.date}" else day.date)
                            }
                        }
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = requestedStartAt,
                    onValueChange = { requestedStartAt = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.request_start_time)) },
                    singleLine = true,
                )
            }
            item {
                OutlinedTextField(
                    value = requestedEndAt,
                    onValueChange = { requestedEndAt = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.request_finish_time)) },
                    singleLine = true,
                )
            }
        }
        item {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.request_reason)) },
                minLines = 3,
            )
        }
        item {
            Button(
                modifier = Modifier.fillMaxWidth(),
                enabled = !mutationsBlocked,
                onClick = {
                    onSubmit(
                        WorkforceHrmRequestDraft(
                            type = type,
                            startDate = startDate,
                            endDate = endDate,
                            reason = reason,
                            correctionWorkdayId = correctionWorkdayId,
                            requestedStartAt = requestedStartAt,
                            requestedEndAt = requestedEndAt,
                        ),
                    )
                },
            ) { Text(stringResource(R.string.request_submit)) }
        }
        item {
            Text(stringResource(R.string.request_status_history), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.request_cancel_explainer))
            TextButton(onClick = onLoad) { Text(stringResource(R.string.request_refresh)) }
        }
        if (history == null) {
            item { Text(stringResource(R.string.request_history_empty)) }
        } else {
            items(history.requests, key = { it.id }) { request ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        stringResource(
                            R.string.request_summary,
                            request.type.localizedLabel(),
                            request.status.localizedLabel(),
                        ),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(stringResource(R.string.request_date_range, request.startDate, request.endDate))
                    request.decisionNote?.let { Text(stringResource(R.string.request_reviewer_note, it)) }
                    if (request.status == WorkforceHrmRequestStatus.PENDING) {
                        TextButton(
                            enabled = !mutationsBlocked,
                            onClick = { onCancel(request.id) },
                        ) { Text(stringResource(R.string.request_cancel_pending)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkforceHistory(
    history: WorkforceHistorySnapshot?,
    onLoad: () -> Unit,
) {
    if (history == null) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.tab_work_time), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.history_empty_explainer))
            Button(onClick = onLoad) { Text(stringResource(R.string.history_load)) }
        }
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.tab_work_time), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.history_range, history.start, history.end, history.timezone))
        }
        items(history.days, key = { it.date }) { day ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(day.date, style = MaterialTheme.typography.titleMedium)
                day.calendarName?.let { Text(stringResource(R.string.history_calendar, it)) }
                day.calendarKind?.let { Text(stringResource(R.string.history_calendar_state, it.localizedCalendarKind())) }
                day.workday?.let { workday ->
                    Text(stringResource(R.string.history_workday, workday.status.localizedLabel()))
                    Text(stringResource(R.string.history_worked, workday.workedSeconds.asWorkDuration()))
                } ?: Text(stringResource(R.string.history_no_workday))
                day.activeRequestStates.forEach {
                    Text(stringResource(R.string.history_request, it.type.localizedLabel(), it.status.localizedLabel()))
                }
            }
        }
    }
}

@Composable
private fun WorkforceScheduledContext(segment: com.leaddrive.workforce.android.data.WorkforceWorkdayScheduleSegment?) {
    if (segment == null) {
        Text(stringResource(R.string.scheduled_context_unavailable))
        return
    }
    val state = if (segment.state == "CURRENT") {
        stringResource(R.string.scheduled_context_current)
    } else {
        stringResource(R.string.scheduled_context_next)
    }
    val place = segment.siteName ?: stringResource(R.string.scheduled_context_no_site)
    Text(stringResource(
        R.string.scheduled_context_value,
        state,
        segment.mode.lowercase(),
        place,
        segment.startTime,
        segment.endTime,
    ))
    Text(stringResource(R.string.scheduled_context_not_presence_proof))
}

@Composable
private fun WorkforceTodayCard(
    snapshot: WorkforceTodaySnapshot,
    attendance: com.leaddrive.workforce.android.data.WorkforceAttendanceRequirements,
    mutationsBlocked: Boolean,
    busyAction: WorkforceWorkdayAction?,
    onAction: (WorkforceWorkdayAction) -> Unit,
) {
    val workday = snapshot.workday
    val allowed = snapshot.actions()
    var elapsedSeconds by remember(workday?.id, workday?.status, workday?.workedSeconds) {
        mutableStateOf(workday?.workedSeconds ?: 0L)
    }
    LaunchedEffect(workday?.id, workday?.status, workday?.workedSeconds) {
        if (workday?.status == WorkforceWorkdayStatus.STARTED) {
            while (true) {
                delay(1_000)
                elapsedSeconds += 1
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.today), style = MaterialTheme.typography.titleLarge)
        when {
            workday == null -> Text(stringResource(R.string.today_no_workday))
            else -> WorkforceWorkdayState(workday, elapsedSeconds)
        }
        snapshot.activeWorkday?.let {
            Text(stringResource(R.string.today_other_active))
        }
        if (attendance.status == "INVALID") {
            Text(stringResource(R.string.today_attendance_unavailable))
        } else if (allowed.isEmpty()) {
            Text(stringResource(R.string.today_no_action))
        } else {
            if (mutationsBlocked) Text(stringResource(R.string.update_required_before_changes))
            allowed.forEach { action ->
                val actionLabel = action.localizedLabel()
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = busyAction == null && !mutationsBlocked,
                    onClick = { onAction(action) },
                ) {
                    val label = when {
                        attendance.requiresQr(action) && attendance.requiresDeviceProof(action) ->
                            stringResource(R.string.action_scan_and_confirm, actionLabel)
                        attendance.requiresQr(action) -> stringResource(R.string.action_scan_fresh, actionLabel)
                        attendance.requiresDeviceProof(action) -> stringResource(R.string.action_confirm_trusted, actionLabel)
                        else -> actionLabel
                    }
                    Text(if (busyAction == action) stringResource(R.string.action_sending) else label)
                }
            }
        }
    }
}

@Composable
private fun WorkforceWorkdayState(workday: WorkforceWorkday, elapsedSeconds: Long) {
    val state = workday.status.localizedLabel()
    Text(stringResource(R.string.workday_status, state))
    Text(stringResource(R.string.workday_worked, elapsedSeconds.asWorkDuration()))
    Text(stringResource(R.string.workday_started, workday.startedAt))
}

private fun Long.asWorkDuration(): String {
    val hours = this / 3_600
    val minutes = (this % 3_600) / 60
    val seconds = this % 60
    return "%02d:%02d:%02d".format(hours, minutes, seconds)
}

private data class WorkforceEmployeeErrorCopy(
    val conflict: String,
    val api: String,
    val network: String,
)

private fun Throwable.employeeMessage(copy: WorkforceEmployeeErrorCopy): String = when (this) {
    is WorkforceActionConflictException -> copy.conflict
    is WorkforceApiException -> copy.api
    else -> copy.network
}
