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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.leaddrive.workforce.android.data.WorkforceApiClient
import com.leaddrive.workforce.android.data.WorkforceBootstrap
import com.leaddrive.workforce.android.data.WorkforceLoginInput
import com.leaddrive.workforce.android.data.WorkforceRuntimeConfiguration
import com.leaddrive.workforce.android.data.WorkforceSecureStore
import com.leaddrive.workforce.android.data.WorkforceSessionRepository
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val configuration = WorkforceRuntimeConfiguration.fromBuildConfig()
        val repository = WorkforceSessionRepository(
            api = WorkforceApiClient(configuration),
            secureStore = WorkforceSecureStore(applicationContext),
        )
        setContent {
            MaterialTheme {
                WorkforceRoot(repository)
            }
        }
    }
}

@Composable
private fun WorkforceRoot(repository: WorkforceSessionRepository) {
    val scope = rememberCoroutineScope()
    var bootstrap by remember { mutableStateOf<WorkforceBootstrap?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    if (bootstrap != null) {
        WorkforceHome(
            bootstrap = bootstrap!!,
            onSignOut = {
                repository.signOut()
                bootstrap = null
                status = null
            },
        )
    } else {
        WorkforceLogin(
            status = status,
            onSubmit = { input ->
                status = "Signing in…"
                scope.launch {
                    runCatching { repository.signIn(input) }
                        .onSuccess {
                            bootstrap = it
                            status = null
                        }
                        .onFailure { status = it.message ?: "Unable to sign in." }
                }
            },
        )
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
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Hello, ${bootstrap.employeeName}", style = MaterialTheme.typography.headlineMedium)
        Text("Timezone: ${bootstrap.timezone}")
        Text("Client release: ${bootstrap.releaseStatus}")
        if (bootstrap.updateUrl != null) {
            Text("An approved update is available through your organization’s managed Play channel.")
        }
        Text("Today, Work Time history, requests, offline outbox, action-time location, QR and device enrollment are implemented in the next Workforce mobile slices. This screen does not create attendance facts.")
        Button(onClick = onSignOut) { Text("Sign out") }
    }
}
