package com.leaddrive.workforce.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import com.leaddrive.workforce.android.data.WorkforceLoginInput
import com.leaddrive.workforce.android.data.WorkforceRuntimeConfiguration
import com.leaddrive.workforce.android.data.WorkforceSecureStore
import com.leaddrive.workforce.android.data.WorkforceSessionRepository
import com.leaddrive.workforce.android.data.WorkforceTodaySnapshot
import com.leaddrive.workforce.android.data.WorkforceWorkday
import com.leaddrive.workforce.android.data.WorkforceWorkdayAction
import com.leaddrive.workforce.android.data.WorkforceWorkdayStatus
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
                WorkforceRoot(repository)
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
private fun WorkforceRoot(repository: WorkforceSessionRepository) {
    val scope = rememberCoroutineScope()
    var bootstrap by remember { mutableStateOf<WorkforceBootstrap?>(null) }
    var today by remember { mutableStateOf<WorkforceTodaySnapshot?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var restoring by remember { mutableStateOf(true) }
    var busyAction by remember { mutableStateOf<WorkforceWorkdayAction?>(null) }

    fun refreshToday() {
        scope.launch {
            status = "Refreshing server state…"
            runCatching { repository.loadToday() }
                .onSuccess {
                    today = it
                    status = null
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
                        status = null
                    }.onFailure { status = it.employeeMessage() }
                }
            },
        )
        else -> WorkforceHome(
            bootstrap = bootstrap!!,
            today = today,
            status = status,
            busyAction = busyAction,
            onRefresh = ::refreshToday,
            onAction = { action ->
                val snapshot = today
                if (snapshot != null) {
                    busyAction = action
                    status = null
                    scope.launch {
                        runCatching { repository.submitTodayAction(snapshot, action) }
                            .onSuccess { submission ->
                                when (submission) {
                                    is com.leaddrive.workforce.android.data.WorkforceTodaySubmission.Accepted -> {
                                        today = submission.snapshot
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
            },
            onSignOut = {
                scope.launch {
                    runCatching { repository.signOut() }
                        .onSuccess {
                            bootstrap = null
                            today = null
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
    busyAction: WorkforceWorkdayAction?,
    onRefresh: () -> Unit,
    onAction: (WorkforceWorkdayAction) -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Hello, ${bootstrap.employeeName}", style = MaterialTheme.typography.headlineMedium)
        Text("Timezone: ${bootstrap.timezone}")
        Text("Server truth: ${today?.date ?: "not loaded"}")
        if (today == null) {
            Text("Work-time state is unavailable. No attendance action was created locally.")
            Button(onClick = onRefresh) { Text("Retry server state") }
        } else {
            WorkforceTodayCard(
                snapshot = today,
                busyAction = busyAction,
                onAction = onAction,
            )
            Text("Current site: not asserted until an approved action-time proof is captured.")
            Text("Until the encrypted outbox is added, actions require a live server acknowledgement and are never silently queued.")
            TextButton(onClick = onRefresh) { Text("Refresh server state") }
        }
        if (bootstrap.updateUrl != null) {
            Text("An approved update is available through your organization’s managed Play channel.")
        }
        status?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TextButton(onClick = onSignOut) { Text("Sign out") }
    }
}

@Composable
private fun WorkforceTodayCard(
    snapshot: WorkforceTodaySnapshot,
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
        Text("Today", style = MaterialTheme.typography.titleLarge)
        when {
            workday == null -> Text("No workday has been accepted by the server.")
            else -> WorkforceWorkdayState(workday, elapsedSeconds)
        }
        snapshot.activeWorkday?.let {
            Text("Another active workday is recorded by the server. Finish that day before starting a new one.")
        }
        if (allowed.isEmpty()) {
            Text("No work-time action is available for this server state.")
        } else {
            allowed.forEach { action ->
                Button(
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
