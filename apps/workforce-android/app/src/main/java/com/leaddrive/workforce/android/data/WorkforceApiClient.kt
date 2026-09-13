package com.leaddrive.workforce.android.data

import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small, explicit Workforce-only HTTP adapter. The app never discovers or
 * calls Route endpoints; its endpoint list is intentionally fixed here until
 * a separately reviewed API-contract module is introduced.
 */
class WorkforceApiClient(
    private val configuration: WorkforceRuntimeConfiguration,
) {
    suspend fun login(input: WorkforceLoginInput): WorkforceLoginResult = withContext(Dispatchers.IO) {
        require(input.email.isNotBlank()) { "Email is required." }
        require(input.password.isNotBlank()) { "Password is required." }
        require(input.organizationSlug.isNotBlank()) { "Organization slug is required." }
        val response = request(
            method = "POST",
            path = "/api/v1/mtm/mobile/auth",
            token = null,
            body = JSONObject()
                .put("email", input.email.trim())
                .put("password", input.password)
                .put("organizationSlug", input.organizationSlug.trim().lowercase())
                .toString(),
        )
        val data = response.optJSONObject("data")
            ?: throw WorkforceApiException("The Workforce login response was incomplete.", recoverable = false)
        val token = data.optString("token")
        if (token.isBlank()) throw WorkforceApiException("The Workforce login response did not contain a session.", recoverable = false)
        WorkforceLoginResult(token = token, organizationSlug = input.organizationSlug.trim().lowercase())
    }

    suspend fun bootstrap(session: WorkforceStoredSession, deviceId: String): WorkforceBootstrap = withContext(Dispatchers.IO) {
        val response = request(
            method = "GET",
            path = "/api/v1/mtm/mobile/bootstrap",
            token = session.token,
            deviceId = deviceId,
        )
        val data = response.optJSONObject("data")
            ?: throw WorkforceApiException("The Workforce bootstrap response was incomplete.", recoverable = true)
        val modules = data.optJSONObject("modules")
            ?: throw WorkforceApiException("The Workforce module manifest was missing.", recoverable = true)
        val workforce = modules.optJSONObject("workforce")
            ?: throw WorkforceApiException("The Workforce module was missing from bootstrap.", recoverable = true)
        val enabled = workforce.optBoolean("enabled", false)
        if (!enabled) throw WorkforceApiException("Workforce is not enabled for this tenant.", recoverable = false)
        val principal = data.optJSONObject("principal")
        val release = workforce.optJSONObject("release")
        WorkforceBootstrap(
            employeeName = principal?.optString("name")?.takeIf { it.isNotBlank() } ?: "Employee",
            timezone = data.optString("timezone", "UTC"),
            releaseStatus = release?.optString("status")?.takeIf { it.isNotBlank() } ?: "NOT_CONFIGURED",
            updateUrl = release?.optString("updateUrl")?.takeIf { it.isNotBlank() },
        )
    }

    /**
     * Read the current work-time state from the canonical service.  The client
     * never derives a shift state from a timer or an optimistic local action.
     */
    suspend fun loadToday(session: WorkforceStoredSession, deviceId: String): WorkforceTodaySnapshot = withContext(Dispatchers.IO) {
        val response = request(
            method = "GET",
            path = "/api/v1/mtm/mobile/workday",
            token = session.token,
            deviceId = deviceId,
        )
        val data = response.optJSONObject("data")
            ?: throw WorkforceApiException("The Workforce work-time response was incomplete.", recoverable = true)
        WorkforceTodaySnapshot(
            date = data.requiredString("date", "The Workforce work date was missing."),
            timezone = data.optString("timezone", "UTC"),
            workday = data.optJSONObject("workday")?.toWorkday(),
            activeWorkday = data.optJSONObject("activeWorkday")?.toWorkday(),
            availableActions = data.optStringList("availableActions"),
        )
    }

    /**
     * Sends exactly one employee action.  Until WF-C9-006 adds the encrypted
     * outbox, a network failure means no local attendance claim is retained;
     * the employee must retry after refreshing server truth.
     */
    suspend fun submitTodayAction(
        session: WorkforceStoredSession,
        deviceId: String,
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
    ): WorkforceTodaySnapshot = withContext(Dispatchers.IO) {
        require(action.wireValue in snapshot.availableActions) {
            "This work-time action is no longer available. Refresh and try again."
        }
        val now = Instant.now().toString()
        val operationId = UUID.randomUUID().toString()
        val workdayId = if (action == WorkforceWorkdayAction.START) {
            UUID.randomUUID().toString()
        } else {
            snapshot.workday?.id
                ?: throw WorkforceApiException("There is no active workday to update. Refresh and try again.", recoverable = true)
        }
        val event = JSONObject()
            .put("action", action.wireValue)
            .put("occurredAt", now)
            .put("claimedAt", now)
            .put("capturedAt", now)
            .put("queuedAt", now)
            .put("schemaVersion", WORKFORCE_WORKDAY_SCHEMA_VERSION)
        if (action == WorkforceWorkdayAction.START) {
            event.put("id", workdayId)
        } else {
            event.put("workdayId", workdayId)
        }
        val response = request(
            method = "POST",
            path = "/api/v1/mtm/mobile/sync/push",
            token = session.token,
            deviceId = deviceId,
            body = JSONObject()
                .put("clientId", deviceId)
                .put(
                    "operations",
                    JSONArray().put(
                        JSONObject()
                            .put("operationId", operationId)
                            .put("op", "create")
                            .put("entity", "workdays")
                            .put("data", event)
                            .put("clientTimestamp", System.currentTimeMillis()),
                    ),
                )
                .toString(),
        )
        val result = response.optJSONArray("results")?.optJSONObject(0)
            ?: throw WorkforceApiException("The Workforce action response was incomplete.", recoverable = true)
        when (result.optString("status")) {
            "ok" -> loadToday(session, deviceId)
            "conflict" -> throw WorkforceActionConflictException(
                message = result.optString("error", "The server state changed. Refresh before trying again."),
                recoveryCode = result.optJSONObject("serverData")?.optString("code"),
            )
            else -> throw WorkforceApiException(
                result.optString("error", "The Workforce action was not accepted."),
                recoverable = true,
                recoveryCode = result.optJSONObject("serverData")?.optString("code"),
            )
        }
    }

    private fun request(
        method: String,
        path: String,
        token: String?,
        deviceId: String? = null,
        body: String? = null,
    ): JSONObject {
        val base = configuration.requireHttpsBaseUrl()
        val url = base.resolve(path).toURL()
        val connection = (url.openConnection() as HttpURLConnection)
        try {
            connection.requestMethod = method
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("x-workforce-client", configuration.clientFamily)
            connection.setRequestProperty("x-workforce-client-platform", configuration.clientPlatform)
            connection.setRequestProperty("x-workforce-app-version", configuration.appVersion)
            connection.setRequestProperty("x-workforce-app-version-code", configuration.appVersionCode.toString())
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (deviceId != null) connection.setRequestProperty("x-field-device-id", deviceId)
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.bufferedWriter(StandardCharsets.UTF_8).use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = runCatching { JSONObject(responseText) }.getOrDefault(JSONObject())
            if (status !in 200..299) {
                val detail = response.optString("error").takeIf { it.isNotBlank() } ?: "Workforce request failed."
                throw WorkforceApiException(detail, recoverable = status >= 500 || status == 429)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 20_000
        const val WORKFORCE_WORKDAY_SCHEMA_VERSION = 3
    }
}

private fun JSONObject.requiredString(name: String, message: String): String = optString(name).takeIf { it.isNotBlank() }
    ?: throw WorkforceApiException(message, recoverable = true)

private fun JSONObject.optStringList(name: String): List<String> {
    val values = optJSONArray(name) ?: return emptyList()
    return buildList {
        for (index in 0 until values.length()) {
            values.optString(index).takeIf { it.isNotBlank() }?.let(::add)
        }
    }
}

private fun JSONObject.toWorkday(): WorkforceWorkday = WorkforceWorkday(
    id = requiredString("id", "The Workforce workday identifier was missing."),
    status = WorkforceWorkdayStatus.fromWire(requiredString("status", "The Workforce workday state was missing.")),
    startedAt = requiredString("startedAt", "The Workforce start time was missing."),
    pausedAt = optString("pausedAt").takeIf { it.isNotBlank() && it != "null" },
    completedAt = optString("completedAt").takeIf { it.isNotBlank() && it != "null" },
    workedSeconds = optLong("workedSeconds", 0).coerceAtLeast(0),
    availableActions = optStringList("availableActions"),
)

data class WorkforceLoginInput(
    val email: String,
    val password: String,
    val organizationSlug: String,
)

data class WorkforceLoginResult(
    val token: String,
    val organizationSlug: String,
)

data class WorkforceBootstrap(
    val employeeName: String,
    val timezone: String,
    val releaseStatus: String,
    val updateUrl: String?,
)

enum class WorkforceWorkdayAction(val wireValue: String, val label: String) {
    START("START", "Start work"),
    PAUSE("PAUSE", "Pause"),
    RESUME("RESUME", "Resume"),
    FINISH("FINISH", "Finish work");

    companion object {
        fun fromWire(value: String): WorkforceWorkdayAction? = entries.firstOrNull { it.wireValue == value }
    }
}

enum class WorkforceWorkdayStatus {
    STARTED,
    PAUSED,
    COMPLETED;

    companion object {
        fun fromWire(value: String): WorkforceWorkdayStatus = entries.firstOrNull { it.name == value }
            ?: throw WorkforceApiException("The Workforce workday state was invalid.", recoverable = true)
    }
}

data class WorkforceWorkday(
    val id: String,
    val status: WorkforceWorkdayStatus,
    val startedAt: String,
    val pausedAt: String?,
    val completedAt: String?,
    val workedSeconds: Long,
    val availableActions: List<String>,
)

data class WorkforceTodaySnapshot(
    val date: String,
    val timezone: String,
    val workday: WorkforceWorkday?,
    val activeWorkday: WorkforceWorkday?,
    val availableActions: List<String>,
) {
    fun actions(): List<WorkforceWorkdayAction> = if (activeWorkday == null) {
        availableActions.mapNotNull(WorkforceWorkdayAction::fromWire)
    } else {
        // The server returns the other still-open day separately so the user
        // can recover it. Never offer START for today's empty row while that
        // authoritative older workday remains active.
        emptyList()
    }
}

open class WorkforceApiException(
    message: String,
    val recoverable: Boolean,
    val recoveryCode: String? = null,
) : IllegalStateException(message)

class WorkforceActionConflictException(
    message: String,
    recoveryCode: String?,
) : WorkforceApiException(message, recoverable = true, recoveryCode = recoveryCode)
