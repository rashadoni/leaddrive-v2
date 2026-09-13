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
import com.leaddrive.workforce.android.data.WorkforceHrmSubmission
import com.leaddrive.workforce.android.data.WorkforceLoginInput
import com.leaddrive.workforce.android.data.WorkforceOutboxRecoveryItem
import com.leaddrive.workforce.android.data.WorkforceRuntimeConfiguration
import com.leaddrive.workforce.android.data.WorkforceReminderSettings
import com.leaddrive.workforce.android.data.WorkforceReminderScheduler
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
        val configuration = WorkforceRuntimeConfiguration.fromBuildConfig()
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
    var reminderSettings by remember { mutableStateOf<WorkforceReminderSettings?>(null) }
    var section by remember { mutableStateOf(WorkforceSection.TODAY) }
    var restoring by remember { mutableStateOf(true) }
    var busyAction by remember { mutableStateOf<WorkforceWorkdayAction?>(null) }
    val context = LocalContext.current

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
                status = "Saved in this device’s encrypted outbox. It will retry in order for up to seven days."
            }
        }
    }

    fun refreshToday() {
        scope.launch {
            status = "Refreshing server state…"
            runCatching { repository.loadToday() }
                .onSuccess {
                    today = it
                    applyReminderSettings(it)
                    history = null
                    recoveryItems = null
                    deviceTrust = null
                    status = null
                }
                .onFailure { status = it.employeeMessage() }
        }
    }

    fun submitTodayAction(action: WorkforceWorkdayAction, qrToken: String? = null) {
        val snapshot = today ?: return
        busyAction = action
        status = null
        scope.launch {
            runCatching { repository.submitTodayAction(snapshot, action, qrToken) }
                .onSuccess(::applyTodaySubmission)
                .onFailure { status = it.employeeMessage() }
            busyAction = null
        }
    }

    fun submitDeviceTrustedTodayAction(action: WorkforceWorkdayAction, qrToken: String? = null) {
        val snapshot = today ?: return
        val currentBootstrap = bootstrap ?: return
        busyAction = action
        status = "Confirming this exact action on your device…"
        scope.launch {
            runCatching {
                val prepared = repository.prepareDeviceTrustedTodayAction(currentBootstrap, snapshot, action, qrToken)
                val signature = deviceAuthenticator.authenticateAndSign(
                    prepared.signature,
                    "Confirm ${action.label.lowercase()} for this exact Workforce action",
                )
                repository.submitPreparedDeviceTodayAction(prepared, signature)
            }.onSuccess(::applyTodaySubmission)
                .onFailure { status = it.employeeMessage() }
            busyAction = null
        }
    }

    fun beginDeviceEnrollment(deviceLabel: String) {
        val currentBootstrap = bootstrap ?: return
        status = "Preparing the protected device enrollment…"
        scope.launch {
            runCatching {
                val pending = repository.beginDeviceEnrollment(currentBootstrap, deviceLabel)
                val signature = deviceAuthenticator.authenticateAndSign(
                    pending.signature,
                    "Confirm this device enrollment before ${pending.expiresAt}",
                )
                repository.completeDeviceEnrollment(pending, signature)
            }.onSuccess {
                deviceTrust = it
                status = it.message
            }.onFailure { status = it.employeeMessage() }
        }
    }

    fun refreshDeviceTrust() {
        val currentBootstrap = bootstrap ?: return
        status = "Refreshing trusted-device status…"
        scope.launch {
            runCatching { repository.loadDeviceTrustState(currentBootstrap) }
                .onSuccess {
                    deviceTrust = it
                    status = it.message
                }
                .onFailure { status = it.employeeMessage() }
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
                        .onFailure { status = it.employeeMessage() }
                }
            }
            .onFailure { status = it.employeeMessage() }
        restoring = false
    }

    when {
        restoring -> WorkforceLoading()
        bootstrap == null -> WorkforceLogin(
            status = status,
            onSubmit = { input ->
                status = "Signing in…"
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
                    }.onFailure { status = it.employeeMessage() }
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
                    status = "Loading accepted work-time history…"
                    scope.launch {
                        runCatching { repository.loadHistory(anchorDate) }
                            .onSuccess {
                                history = it
                                status = null
                            }
                            .onFailure { status = it.employeeMessage() }
                    }
                }
            },
            onLoadRecovery = {
                status = "Loading private recovery state…"
                scope.launch {
                    runCatching { repository.loadRecoveryItems() }
                        .onSuccess {
                            recoveryItems = it
                            status = null
                        }
                        .onFailure { status = it.employeeMessage() }
                }
            },
            onLoadDeviceTrust = ::refreshDeviceTrust,
            onBeginDeviceEnrollment = ::beginDeviceEnrollment,
            onSetLocalReminders = ::setLocalReminders,
            onSubmitRequest = { draft ->
                status = "Submitting request…"
                scope.launch {
                    runCatching { repository.submitHrmRequest(draft) }
                        .onSuccess { submission ->
                            history = null
                            recoveryItems = null
                            status = when (submission) {
                                WorkforceHrmSubmission.ACCEPTED -> "Request accepted by the server. Refresh its status."
                                WorkforceHrmSubmission.QUEUED -> "Request is in this device’s encrypted outbox and will retry in order for up to seven days."
                            }
                        }
                        .onFailure { status = it.employeeMessage() }
                }
            },
            onCancelRequest = { requestId ->
                status = "Cancelling request…"
                scope.launch {
                    runCatching { repository.cancelHrmRequest(requestId) }
                        .onSuccess { submission ->
                            history = null
                            status = when (submission) {
                                WorkforceHrmSubmission.ACCEPTED -> "Cancellation accepted by the server. Refresh its status."
                                WorkforceHrmSubmission.QUEUED -> "Cancellation is in this device’s encrypted outbox and will retry in order for up to seven days."
                            }
                        }
                        .onFailure { status = it.employeeMessage() }
                }
            },
            onAction = { action ->
                val attendance = bootstrap!!.attendance
                if (attendance.requiresQr(action)) {
                    qrScanner.scan(
                        onToken = { token ->
                            if (attendance.requiresDeviceProof(action)) {
                                submitDeviceTrustedTodayAction(action, token.value)
                            } else {
                                submitTodayAction(action, token.value)
                            }
                        },
                        onCancelled = { status = "QR scan cancelled. No attendance action was sent." },
                        onFailure = { status = "A fresh QR code could not be read. No attendance action was sent." },
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
                        .onFailure { status = "Secure sign-out could not finish. Try again." }
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
                        busyAction = busyAction,
                        onAction = onAction,
                    )
                    WorkforceLocalReminders(
                        settings = reminderSettings,
                        onSetEnabled = onSetLocalReminders,
                    )
                    Text("Current site: not asserted until an approved action-time proof is captured.")
                    Text("Location is never tracked in the background. Action-time location remains unavailable until the published legal notice and tenant proof policy are active.")
                    Text("A transient transport failure can keep the same action only in this device’s encrypted, bounded outbox; it is not a server-accepted fact.")
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
                onLoad = onLoadDeviceTrust,
                onEnroll = onBeginDeviceEnrollment,
            )
        }
        if (bootstrap.updateUrl != null) {
            Text("An approved update is available through your organization’s managed Play channel.")
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
            Text(settings.state.employeeMessage)
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
private fun WorkforceHrmRequestType.localizedLabel(): String = stringResource(
    when (this) {
        WorkforceHrmRequestType.LEAVE -> R.string.request_leave
        WorkforceHrmRequestType.ABSENCE -> R.string.request_absence
        WorkforceHrmRequestType.TIME_CORRECTION -> R.string.request_time_correction
    },
)

@Composable
private fun WorkforceWorkdayAction.localizedLabel(): String = stringResource(
    when (this) {
        WorkforceWorkdayAction.START -> R.string.action_start
        WorkforceWorkdayAction.PAUSE -> R.string.action_pause
        WorkforceWorkdayAction.RESUME -> R.string.action_resume
        WorkforceWorkdayAction.FINISH -> R.string.action_finish
    },
)

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
            Text("Recovery", style = MaterialTheme.typography.titleLarge)
            Text("This view shows only local queue state, never request reasons, QR values, GPS or device proof.")
            Button(onClick = onLoad) { Text("Load recovery state") }
        }
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Recovery", style = MaterialTheme.typography.titleLarge)
            Text("Refresh server state before retrying any work-time action.")
            TextButton(onClick = onLoad) { Text("Refresh recovery state") }
        }
        if (items.isEmpty()) {
            item { Text("No local recovery items.") }
        } else {
            items(items) { item ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${item.domain}: ${item.state}", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Saved locally: ${Instant.ofEpochMilli(item.createdAtEpochMs).atZone(tenantZone).toLocalDateTime()}",
                    )
                    Text(item.recoveryMessage)
                }
            }
        }
    }
}

@Composable
private fun WorkforceDeviceTrust(
    state: WorkforceDeviceTrustState?,
    onLoad: () -> Unit,
    onEnroll: (String) -> Unit,
) {
    var label by rememberSaveable { mutableStateOf("This Android device") }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Trusted device", style = MaterialTheme.typography.titleLarge)
        Text("A trusted device signs only the exact work-time action you confirm. The Android system performs biometric matching; Workforce never receives a template or result.")
        if (state == null) {
            Button(onClick = onLoad) { Text("Load device status") }
            return@Column
        }
        Text(state.message)
        when (state.lifecycle) {
            WorkforceDeviceBindingLifecycle.ACTIVE,
            WorkforceDeviceBindingLifecycle.PENDING_MANAGER_APPROVAL -> {
                TextButton(onClick = onLoad) { Text("Refresh device status") }
            }
            else -> {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Device label") },
                    singleLine = true,
                )
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { onEnroll(label) },
                ) {
                    Text(
                        if (state.lifecycle == WorkforceDeviceBindingLifecycle.PENDING_PROOF || state.lifecycle == WorkforceDeviceBindingLifecycle.PROVISIONING) {
                            "Resume device enrollment"
                        } else {
                            "Enroll this device"
                        },
                    )
                }
            }
        }
        Text("If this device is lost or replaced, ask an authorized administrator to revoke or replace its enrollment. Signing out removes this phone’s private key and local binding; it does not approve or revoke a server enrollment.")
    }
}

@Composable
private fun WorkforceRequests(
    history: WorkforceHistorySnapshot?,
    defaultDate: String,
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
            Text("Requests", style = MaterialTheme.typography.titleLarge)
            Text("Leave, absence and correction requests are employee claims for review, not approved time or payroll.")
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
                label = { Text("Start date (YYYY-MM-DD)") },
                singleLine = true,
            )
        }
        item {
            OutlinedTextField(
                value = endDate,
                onValueChange = { endDate = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("End date (YYYY-MM-DD)") },
                singleLine = true,
            )
        }
        if (type == WorkforceHrmRequestType.TIME_CORRECTION) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Choose an accepted workday to correct")
                    val candidates = history?.days?.filter { it.workday != null }.orEmpty()
                    if (candidates.isEmpty()) {
                        Text("Load Work Time history first; do not invent a workday reference.")
                        TextButton(onClick = onLoad) { Text("Load Work Time history") }
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
                    label = { Text("Requested start (ISO date-time, optional)") },
                    singleLine = true,
                )
            }
            item {
                OutlinedTextField(
                    value = requestedEndAt,
                    onValueChange = { requestedEndAt = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Requested finish (ISO date-time, optional)") },
                    singleLine = true,
                )
            }
        }
        item {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Reason (visible only to the responsible reviewers)") },
                minLines = 3,
            )
        }
        item {
            Button(
                modifier = Modifier.fillMaxWidth(),
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
            ) { Text("Submit request") }
        }
        item {
            Text("Status history", style = MaterialTheme.typography.titleMedium)
            Text("Refresh before cancelling; only pending requests are eligible.")
            TextButton(onClick = onLoad) { Text("Refresh requests") }
        }
        if (history == null) {
            item { Text("No server request history loaded.") }
        } else {
            items(history.requests, key = { it.id }) { request ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${request.type}: ${request.status}", style = MaterialTheme.typography.titleSmall)
                    Text("${request.startDate} – ${request.endDate}")
                    request.decisionNote?.let { Text("Reviewer note: $it") }
                    if (request.status == "PENDING") {
                        TextButton(onClick = { onCancel(request.id) }) { Text("Cancel pending request") }
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
            Text("Work Time", style = MaterialTheme.typography.titleLarge)
            Text("History is always reloaded from the server. A local pending claim is never presented as an accepted fact.")
            Button(onClick = onLoad) { Text("Load work-time history") }
        }
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Work Time", style = MaterialTheme.typography.titleLarge)
            Text("Accepted server history: ${history.start} – ${history.end} (${history.timezone})")
        }
        items(history.days, key = { it.date }) { day ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(day.date, style = MaterialTheme.typography.titleMedium)
                day.calendarName?.let { Text("Calendar: $it") }
                day.calendarKind?.let { Text("Calendar state: $it") }
                day.workday?.let { workday ->
                    Text("Server workday: ${workday.status}")
                    Text("Recorded worked time: ${workday.workedSeconds.asWorkDuration()}")
                } ?: Text("No accepted workday")
                day.activeRequestStates.forEach { Text("Request: $it") }
            }
        }
    }
}

@Composable
private fun WorkforceTodayCard(
    snapshot: WorkforceTodaySnapshot,
    attendance: com.leaddrive.workforce.android.data.WorkforceAttendanceRequirements,
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
            workday == null -> Text("No workday has been accepted by the server.")
            else -> WorkforceWorkdayState(workday, elapsedSeconds)
        }
        snapshot.activeWorkday?.let {
            Text("Another active workday is recorded by the server. Finish that day before starting a new one.")
        }
        if (attendance.status == "INVALID") {
            Text("Attendance policy is unavailable or unsupported. Refresh or contact your administrator; no action can be sent.")
        } else if (allowed.isEmpty()) {
            Text("No work-time action is available for this server state.")
        } else {
            allowed.forEach { action ->
                val actionLabel = action.localizedLabel()
                Button(
                    modifier = Modifier.fillMaxWidth(),
                    enabled = busyAction == null,
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
    val state = when (workday.status) {
        WorkforceWorkdayStatus.STARTED -> "Working"
        WorkforceWorkdayStatus.PAUSED -> "Paused"
        WorkforceWorkdayStatus.COMPLETED -> "Completed"
    }
    Text("Status: $state")
    Text("Worked: ${elapsedSeconds.asWorkDuration()}")
    Text("Started: ${workday.startedAt}")
}

private fun Long.asWorkDuration(): String {
    val hours = this / 3_600
    val minutes = (this % 3_600) / 60
    val seconds = this % 60
    return "%02d:%02d:%02d".format(hours, minutes, seconds)
}

private fun Throwable.employeeMessage(): String = when (this) {
    is WorkforceActionConflictException -> "The server state changed. Refresh before trying another action."
    is WorkforceApiException -> message ?: "Workforce could not complete this request."
    else -> "Unable to reach Workforce. No attendance action was accepted locally."
}
