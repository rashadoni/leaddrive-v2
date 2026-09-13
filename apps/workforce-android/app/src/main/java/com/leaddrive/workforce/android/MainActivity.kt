package com.leaddrive.workforce.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.leaddrive.workforce.android.data.WorkforceActionConflictException
import com.leaddrive.workforce.android.data.WorkforceApiClient
import com.leaddrive.workforce.android.data.WorkforceApiException
import com.leaddrive.workforce.android.data.WorkforceBootstrap
import com.leaddrive.workforce.android.data.WorkforceEncryptedOutbox
import com.leaddrive.workforce.android.data.WorkforceHistorySnapshot
import com.leaddrive.workforce.android.data.WorkforceHrmRequestDraft
import com.leaddrive.workforce.android.data.WorkforceHrmRequestType
import com.leaddrive.workforce.android.data.WorkforceHrmSubmission
import com.leaddrive.workforce.android.data.WorkforceLoginInput
import com.leaddrive.workforce.android.data.WorkforceRuntimeConfiguration
import com.leaddrive.workforce.android.data.WorkforceSecureStore
import com.leaddrive.workforce.android.data.WorkforceSessionRepository
import com.leaddrive.workforce.android.data.WorkforceTodaySnapshot
import com.leaddrive.workforce.android.data.WorkforceWorkday
import com.leaddrive.workforce.android.data.WorkforceWorkdayAction
import com.leaddrive.workforce.android.data.WorkforceWorkdayStatus
import com.leaddrive.workforce.android.security.WorkforceQrScanner
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val configuration = WorkforceRuntimeConfiguration.fromBuildConfig()
        val secureStore = WorkforceSecureStore(applicationContext)
        val repository = WorkforceSessionRepository(
            api = WorkforceApiClient(configuration),
            secureStore = secureStore,
            outbox = WorkforceEncryptedOutbox(applicationContext),
        )
        setContent {
            MaterialTheme {
                WorkforceRoot(repository, WorkforceQrScanner(this@MainActivity))
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
) {
    val scope = rememberCoroutineScope()
    var bootstrap by remember { mutableStateOf<WorkforceBootstrap?>(null) }
    var today by remember { mutableStateOf<WorkforceTodaySnapshot?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var history by remember { mutableStateOf<WorkforceHistorySnapshot?>(null) }
    var section by remember { mutableStateOf(WorkforceSection.TODAY) }
    var restoring by remember { mutableStateOf(true) }
    var busyAction by remember { mutableStateOf<WorkforceWorkdayAction?>(null) }

    fun refreshToday() {
        scope.launch {
            status = "Refreshing server state…"
            runCatching { repository.loadToday() }
                .onSuccess {
                    today = it
                    history = null
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
                .onSuccess { submission ->
                    when (submission) {
                        is com.leaddrive.workforce.android.data.WorkforceTodaySubmission.Accepted -> {
                            today = submission.snapshot
                            history = null
                            status = null
                        }
                        com.leaddrive.workforce.android.data.WorkforceTodaySubmission.Queued -> {
                            status = "Saved in this device’s encrypted outbox. It will retry in order for up to seven days."
                        }
                    }
                }
                .onFailure { status = it.employeeMessage() }
            busyAction = null
        }
    }

    LaunchedEffect(Unit) {
        runCatching { repository.restore() }
            .onSuccess { restored ->
                bootstrap = restored
                if (restored != null) {
                    runCatching { repository.loadToday() }
                        .onSuccess { today = it }
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
                        history = null
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
            onSubmitRequest = { draft ->
                status = "Submitting request…"
                scope.launch {
                    runCatching { repository.submitHrmRequest(draft) }
                        .onSuccess { submission ->
                            history = null
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
            onAction = { action -> submitTodayAction(action) },
            onScanQr = { action ->
                qrScanner.scan(
                    onToken = { token -> submitTodayAction(action, token.value) },
                    onCancelled = { status = "QR scan cancelled. No attendance action was sent." },
                    onFailure = { status = "A fresh QR code could not be read. No attendance action was sent." },
                )
            },
            onSignOut = {
                scope.launch {
                    runCatching { repository.signOut() }
                        .onSuccess {
                            bootstrap = null
                            today = null
                            history = null
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
        Text("LeadDrive Workforce", style = MaterialTheme.typography.headlineMedium)
        Text("Restoring your secure session…")
    }
}

@Composable
private fun WorkforceLogin(
    status: String?,
    onSubmit: (WorkforceLoginInput) -> Unit,
) {
    var organizationSlug by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("LeadDrive Workforce", style = MaterialTheme.typography.headlineMedium)
        Text("Work time is separate from Route & Field.")
        OutlinedTextField(
            value = organizationSlug,
            onValueChange = { organizationSlug = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Organization") },
            singleLine = true,
        )
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Email") },
            singleLine = true,
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Password") },
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
            Text("Sign in")
        }
        status?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun WorkforceHome(
    bootstrap: WorkforceBootstrap,
    today: WorkforceTodaySnapshot?,
    status: String?,
    section: WorkforceSection,
    history: WorkforceHistorySnapshot?,
    busyAction: WorkforceWorkdayAction?,
    onRefresh: () -> Unit,
    onSelectSection: (WorkforceSection) -> Unit,
    onLoadHistory: () -> Unit,
    onSubmitRequest: (WorkforceHrmRequestDraft) -> Unit,
    onCancelRequest: (String) -> Unit,
    onAction: (WorkforceWorkdayAction) -> Unit,
    onScanQr: (WorkforceWorkdayAction) -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Hello, ${bootstrap.employeeName}", style = MaterialTheme.typography.headlineMedium)
        Text("Timezone: ${bootstrap.timezone}")
        Row(modifier = Modifier.fillMaxWidth()) {
            WorkforceSection.entries.forEach { candidate ->
                TextButton(onClick = { onSelectSection(candidate) }) {
                    Text(if (candidate == section) "• ${candidate.label}" else candidate.label)
                }
            }
        }
        when (section) {
            WorkforceSection.TODAY -> {
                Text("Server truth: ${today?.date ?: "not loaded"}")
                if (today == null) {
                    Text("Work-time state is unavailable. No attendance action was created locally.")
                    Button(onClick = onRefresh) { Text("Retry server state") }
                } else {
                    WorkforceTodayCard(
                        snapshot = today,
                        attendance = bootstrap.attendance,
                        busyAction = busyAction,
                        onAction = onAction,
                        onScanQr = onScanQr,
                    )
                    Text("Current site: not asserted until an approved action-time proof is captured.")
                    Text("Location is never tracked in the background. Action-time location remains unavailable until the published legal notice and tenant proof policy are active.")
                    Text("A transient transport failure can keep the same action only in this device’s encrypted, bounded outbox; it is not a server-accepted fact.")
                    TextButton(onClick = onRefresh) { Text("Refresh server state") }
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
        }
        if (bootstrap.updateUrl != null) {
            Text("An approved update is available through your organization’s managed Play channel.")
        }
        status?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TextButton(onClick = onSignOut) { Text("Sign out") }
    }
}

private enum class WorkforceSection(val label: String) {
    TODAY("Today"),
    HISTORY("Work Time"),
    REQUESTS("Requests"),
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
                    TextButton(onClick = { type = candidate }) {
                        Text(if (candidate == type) "• ${candidate.label}" else candidate.label)
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
    onScanQr: (WorkforceWorkdayAction) -> Unit,
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
        Text("Today", style = MaterialTheme.typography.titleLarge)
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
                when {
                    attendance.requiresBiometric(action) -> {
                        Text("${action.label} requires an authenticated trusted-device proof. It is unavailable on this build.")
                    }
                    attendance.requiresDeviceTrust(action) -> {
                        Text("${action.label} requires a trusted device. Device enrollment is not yet available on this build.")
                    }
                    attendance.requiresQr(action) -> Button(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = busyAction == null,
                        onClick = { onScanQr(action) },
                    ) {
                        Text(if (busyAction == action) "Sending…" else "Scan fresh QR to ${action.label.lowercase()}")
                    }
                    else -> Button(
                        modifier = Modifier.fillMaxWidth(),
                        enabled = busyAction == null,
                        onClick = { onAction(action) },
                    ) {
                        Text(if (busyAction == action) "Sending…" else action.label)
                    }
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
