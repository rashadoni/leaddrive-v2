package com.leaddrive.workforce.android.data

import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val MAX_HRM_REQUEST_DAYS = 366L
private const val MAX_QR_TOKEN_LENGTH = 4_096

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
            attendance = workforce.optJSONObject("attendance")?.toAttendanceRequirements()
                ?: WorkforceAttendanceRequirements.unconfigured(),
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

    /** Sends exactly one employee action and reloads the canonical result. */
    suspend fun submitTodayAction(
        session: WorkforceStoredSession,
        deviceId: String,
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
    ): WorkforceTodaySnapshot = submitTodayOperation(
        session = session,
        deviceId = deviceId,
        operation = newTodayOperation(snapshot, action),
    )

    /**
     * Creates the immutable client-side envelope before attempting transport.
     * A retry must reuse this exact operation ID and claimed time; it must not
     * manufacture a later attendance event.
     */
    fun newTodayOperation(
        snapshot: WorkforceTodaySnapshot,
        action: WorkforceWorkdayAction,
        attendanceQrToken: String? = null,
        now: Instant = Instant.now(),
    ): WorkforceWorkdayOperation {
        require(action.wireValue in snapshot.availableActions) {
            "This work-time action is no longer available. Refresh and try again."
        }
        val workdayId = if (action == WorkforceWorkdayAction.START) {
            UUID.randomUUID().toString()
        } else {
            snapshot.workday?.id
                ?: throw WorkforceApiException("There is no active workday to update. Refresh and try again.", recoverable = true)
        }
        return WorkforceWorkdayOperation(
            operationId = UUID.randomUUID().toString(),
            action = action,
            workdayId = workdayId,
            occurredAt = now.toString(),
            claimedAt = now.toString(),
            capturedAt = now.toString(),
            queuedAt = now.toString(),
            attendanceQrToken = attendanceQrToken?.trim()?.takeIf { it.isNotBlank() }?.also {
                if (it.length > MAX_QR_TOKEN_LENGTH) {
                    throw WorkforceApiException("The scanned QR token was invalid. Scan a fresh code.", recoverable = false)
                }
            },
        )
    }

    fun newHrmRequestOperation(
        draft: WorkforceHrmRequestDraft,
        now: Instant = Instant.now(),
    ): WorkforceHrmRequestCreateOperation {
        val start = runCatching { LocalDate.parse(draft.startDate) }.getOrNull()
            ?: throw WorkforceApiException("Choose a valid start date.", recoverable = false)
        val end = runCatching { LocalDate.parse(draft.endDate) }.getOrNull()
            ?: throw WorkforceApiException("Choose a valid end date.", recoverable = false)
        if (end.isBefore(start) || end.isAfter(start.plusDays(MAX_HRM_REQUEST_DAYS))) {
            throw WorkforceApiException("Choose an end date within one year of the start date.", recoverable = false)
        }
        val reason = draft.reason.trim()
        if (reason.length !in 3..1_000) {
            throw WorkforceApiException("Reason must contain 3 to 1000 characters.", recoverable = false)
        }
        if (draft.type == WorkforceHrmRequestType.TIME_CORRECTION) {
            if (draft.correctionWorkdayId.isNullOrBlank()) {
                throw WorkforceApiException("Choose a workday to correct.", recoverable = false)
            }
            if (draft.requestedStartAt.isNullOrBlank() && draft.requestedEndAt.isNullOrBlank()) {
                throw WorkforceApiException("Provide the requested start or finish time.", recoverable = false)
            }
        }
        val requestedStartAt = if (draft.type == WorkforceHrmRequestType.TIME_CORRECTION) {
            draft.requestedStartAt.toOptionalInstant("requested start")
        } else null
        val requestedEndAt = if (draft.type == WorkforceHrmRequestType.TIME_CORRECTION) {
            draft.requestedEndAt.toOptionalInstant("requested finish")
        } else null
        if (requestedStartAt != null && requestedEndAt != null && !requestedEndAt.isAfter(requestedStartAt)) {
            throw WorkforceApiException("Requested finish must be after requested start.", recoverable = false)
        }
        return WorkforceHrmRequestCreateOperation(
            operationId = UUID.randomUUID().toString(),
            requestId = UUID.randomUUID().toString(),
            clientRequestId = UUID.randomUUID().toString(),
            type = draft.type,
            startDate = start.toString(),
            endDate = end.toString(),
            correctionWorkdayId = if (draft.type == WorkforceHrmRequestType.TIME_CORRECTION) {
                draft.correctionWorkdayId?.trim()?.takeIf { it.isNotBlank() }
            } else null,
            requestedStartAt = requestedStartAt?.toString(),
            requestedEndAt = requestedEndAt?.toString(),
            reason = reason,
            submittedAt = now.toString(),
        )
    }

    fun newHrmRequestCancellation(requestId: String, now: Instant = Instant.now()): WorkforceHrmRequestCancelOperation {
        if (requestId.isBlank()) throw WorkforceApiException("Choose a request to cancel.", recoverable = false)
        return WorkforceHrmRequestCancelOperation(
            operationId = UUID.randomUUID().toString(),
            requestId = requestId,
            cancelledAt = now.toString(),
        )
    }

    suspend fun submitTodayOperation(
        session: WorkforceStoredSession,
        deviceId: String,
        operation: WorkforceWorkdayOperation,
    ): WorkforceTodaySnapshot {
        submitOperation(session, deviceId, operation)
        return loadToday(session, deviceId)
    }

    /** Sends one durable operation without projecting it into a UI model. */
    suspend fun submitOperation(
        session: WorkforceStoredSession,
        deviceId: String,
        operation: WorkforceSyncOperation,
    ) = withContext(Dispatchers.IO) {
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
                            .put("operationId", operation.operationId)
                            .put("op", operation.opType)
                            .put("entity", operation.entity)
                            .put("data", operation.toDataJson())
                            .put("clientTimestamp", System.currentTimeMillis()),
                    ),
                )
                .toString(),
        )
        val result = response.optJSONArray("results")?.optJSONObject(0)
            ?: throw WorkforceApiException("The Workforce action response was incomplete.", recoverable = true)
        when (result.optString("status")) {
            "ok" -> Unit
            "conflict" -> throw WorkforceActionConflictException(
                message = result.optString("error", "The server state changed. Refresh before trying again."),
                recoveryCode = result.optJSONObject("serverData")?.optString("code"),
            )
            else -> throw WorkforceApiException(
                result.optString("error", "The Workforce action was not accepted."),
                // The server produced a terminal operation result. Retrying a
                // rejected proof/state mutation through the offline outbox
                // would be a bypass attempt, so it is never queued.
                recoverable = false,
                recoveryCode = result.optJSONObject("serverData")?.optString("code"),
            )
        }
    }

    /** Employee-only work-time history supplied by the existing HRM endpoint. */
    suspend fun loadHistory(
        session: WorkforceStoredSession,
        deviceId: String,
        anchorDate: String,
    ): WorkforceHistorySnapshot = withContext(Dispatchers.IO) {
        val anchor = runCatching { LocalDate.parse(anchorDate) }.getOrElse {
            throw WorkforceApiException("The Workforce server date was invalid.", recoverable = true)
        }
        val start = anchor.minusDays(HISTORY_DAYS_BEFORE).toString()
        val end = anchor.plusDays(HISTORY_DAYS_AFTER).toString()
        val response = request(
            method = "GET",
            path = "/api/v1/mtm/mobile/hrm?start=$start&end=$end",
            token = session.token,
            deviceId = deviceId,
        )
        val data = response.optJSONObject("data")
            ?: throw WorkforceApiException("The Workforce history response was incomplete.", recoverable = true)
        val days = data.optJSONArray("days")?.let { values ->
            buildList {
                for (index in 0 until values.length()) {
                    values.optJSONObject(index)?.toHistoryDay()?.let(::add)
                }
            }
        }.orEmpty()
        val requests = data.optJSONArray("requests")?.let { values ->
            buildList {
                for (index in 0 until values.length()) {
                    values.optJSONObject(index)?.toHrmRequest()?.let(::add)
                }
            }
        }.orEmpty()
        WorkforceHistorySnapshot(
            timezone = data.optString("timezone", "UTC"),
            start = data.requiredString("start", "The Workforce history start date was missing."),
            end = data.requiredString("end", "The Workforce history end date was missing."),
            days = days,
            requests = requests,
        )
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
        const val HISTORY_DAYS_BEFORE = 14L
        const val HISTORY_DAYS_AFTER = 45L
    }
}

sealed interface WorkforceSyncOperation {
    val operationId: String
    /** Original client queue time; used only to enforce the seven-day bound. */
    val queuedAt: String
    val domain: WorkforceOutboxDomain
    val entity: String
    val opType: String
    /** Raw QR/device proof may never enter durable offline storage. */
    val hasEphemeralProof: Boolean get() = false

    fun toDataJson(): JSONObject

    fun toEncryptedPayload(organizationSlug: String): String = JSONObject()
        .put("organizationSlug", organizationSlug.trim().lowercase())
        .put("operationId", operationId)
        .put("entity", entity)
        .put("op", opType)
        .put("data", toDataJson())
        .toString()
}

enum class WorkforceHrmRequestType(val wireValue: String, val label: String) {
    LEAVE("LEAVE", "Leave"),
    ABSENCE("ABSENCE", "Absence"),
    TIME_CORRECTION("TIME_CORRECTION", "Time correction");

    companion object {
        fun fromWire(value: String): WorkforceHrmRequestType? = entries.firstOrNull { it.wireValue == value }
    }
}

data class WorkforceHrmRequestDraft(
    val type: WorkforceHrmRequestType,
    val startDate: String,
    val endDate: String,
    val reason: String,
    val correctionWorkdayId: String? = null,
    val requestedStartAt: String? = null,
    val requestedEndAt: String? = null,
)

data class WorkforceHrmRequestCreateOperation(
    override val operationId: String,
    val requestId: String,
    val clientRequestId: String,
    val type: WorkforceHrmRequestType,
    val startDate: String,
    val endDate: String,
    val correctionWorkdayId: String?,
    val requestedStartAt: String?,
    val requestedEndAt: String?,
    val reason: String,
    val submittedAt: String,
) : WorkforceSyncOperation {
    override val queuedAt: String get() = submittedAt
    override val domain = WorkforceOutboxDomain.HRM_REQUEST
    override val entity = "hrmRequests"
    override val opType = "create"

    override fun toDataJson(): JSONObject = JSONObject()
        .put("id", requestId)
        .put("clientRequestId", clientRequestId)
        .put("type", type.wireValue)
        .put("startDate", startDate)
        .put("endDate", endDate)
        .put("reason", reason)
        .put("submittedAt", submittedAt)
        .apply {
            correctionWorkdayId?.let { put("correctionWorkdayId", it) }
            requestedStartAt?.let { put("requestedStartAt", it) }
            requestedEndAt?.let { put("requestedEndAt", it) }
        }
}

data class WorkforceHrmRequestCancelOperation(
    override val operationId: String,
    val requestId: String,
    val cancelledAt: String,
) : WorkforceSyncOperation {
    override val queuedAt: String get() = cancelledAt
    override val domain = WorkforceOutboxDomain.HRM_REQUEST
    override val entity = "hrmRequests"
    override val opType = "update"

    override fun toDataJson(): JSONObject = JSONObject()
        .put("id", requestId)
        .put("cancelledAt", cancelledAt)
}

data class WorkforceWorkdayOperation(
    override val operationId: String,
    val action: WorkforceWorkdayAction,
    val workdayId: String,
    val occurredAt: String,
    val claimedAt: String,
    val capturedAt: String,
    override val queuedAt: String,
    val attendanceQrToken: String? = null,
) : WorkforceSyncOperation {
    override val domain = WorkforceOutboxDomain.WORKDAY
    override val entity = "workdays"
    override val opType = "create"
    override val hasEphemeralProof: Boolean get() = attendanceQrToken != null

    override fun toDataJson(): JSONObject = JSONObject()
        .put("action", action.wireValue)
        .put("occurredAt", occurredAt)
        .put("claimedAt", claimedAt)
        .put("capturedAt", capturedAt)
        .put("queuedAt", queuedAt)
        .put("schemaVersion", WORKFORCE_WORKDAY_SCHEMA_VERSION)
        .apply {
            if (action == WorkforceWorkdayAction.START) put("id", workdayId)
            else put("workdayId", workdayId)
            attendanceQrToken?.let { put("attendance", JSONObject().put("qrToken", it)) }
        }

    companion object {
        const val WORKFORCE_WORKDAY_SCHEMA_VERSION = 3

        fun fromEncryptedPayload(value: String): WorkforceStoredOperation? = runCatching {
            val json = JSONObject(value)
            val organizationSlug = json.optString("organizationSlug").trim().lowercase()
            val operationId = json.optString("operationId")
            val entity = json.optString("entity")
            val opType = json.optString("op")
            val data = json.optJSONObject("data")
            if (organizationSlug.isBlank() || operationId.isBlank() || data == null) return null
            val operation = when {
                entity == "workdays" && opType == "create" -> workdayOperationFromJson(operationId, data)
                entity == "hrmRequests" && opType == "create" -> hrmCreateOperationFromJson(operationId, data)
                entity == "hrmRequests" && opType == "update" -> hrmCancelOperationFromJson(operationId, data)
                else -> null
            } ?: return null
            WorkforceStoredOperation(organizationSlug = organizationSlug, operation = operation)
        }.getOrNull()

        private fun workdayOperationFromJson(operationId: String, data: JSONObject): WorkforceWorkdayOperation? {
            val action = WorkforceWorkdayAction.fromWire(data.optString("action")) ?: return null
            val workdayId = if (action == WorkforceWorkdayAction.START) data.optString("id") else data.optString("workdayId")
            val occurredAt = data.optString("occurredAt")
            val claimedAt = data.optString("claimedAt")
            val capturedAt = data.optString("capturedAt")
            val queuedAt = data.optString("queuedAt")
            // The outbox must never recover a raw QR/device proof. Any row
            // containing one is terminally unreadable rather than replayable.
            if (data.has("attendance") || workdayId.isBlank() || occurredAt.isBlank() || claimedAt.isBlank() || capturedAt.isBlank() || queuedAt.isBlank()) return null
            return WorkforceWorkdayOperation(operationId, action, workdayId, occurredAt, claimedAt, capturedAt, queuedAt)
        }

        private fun hrmCreateOperationFromJson(operationId: String, data: JSONObject): WorkforceHrmRequestCreateOperation? {
            val requestId = data.optString("id")
            val clientRequestId = data.optString("clientRequestId")
            val type = WorkforceHrmRequestType.fromWire(data.optString("type"))
            val startDate = data.optString("startDate")
            val endDate = data.optString("endDate")
            val reason = data.optString("reason")
            val submittedAt = data.optString("submittedAt")
            val parsedStart = runCatching { LocalDate.parse(startDate) }.getOrNull() ?: return null
            val parsedEnd = runCatching { LocalDate.parse(endDate) }.getOrNull() ?: return null
            if (requestId.isBlank() || clientRequestId.length !in 8..128 || type == null
                || parsedEnd.isBefore(parsedStart) || parsedEnd.isAfter(parsedStart.plusDays(MAX_HRM_REQUEST_DAYS))
                || reason.length !in 3..1_000 || runCatching { Instant.parse(submittedAt) }.isFailure
            ) return null
            val correctionWorkdayId = data.optString("correctionWorkdayId").takeIf { it.isNotBlank() }
            val requestedStartAt = data.optString("requestedStartAt").takeIf { it.isNotBlank() }
            val requestedEndAt = data.optString("requestedEndAt").takeIf { it.isNotBlank() }
            val parsedRequestedStart = requestedStartAt?.let { runCatching { Instant.parse(it) }.getOrNull() ?: return null }
            val parsedRequestedEnd = requestedEndAt?.let { runCatching { Instant.parse(it) }.getOrNull() ?: return null }
            if (type == WorkforceHrmRequestType.TIME_CORRECTION) {
                if (correctionWorkdayId == null || (parsedRequestedStart == null && parsedRequestedEnd == null)) return null
                if (parsedRequestedStart != null && parsedRequestedEnd != null && !parsedRequestedEnd.isAfter(parsedRequestedStart)) return null
            }
            return WorkforceHrmRequestCreateOperation(
                operationId, requestId, clientRequestId, type, startDate, endDate,
                correctionWorkdayId,
                requestedStartAt,
                requestedEndAt,
                reason, submittedAt,
            )
        }

        private fun hrmCancelOperationFromJson(operationId: String, data: JSONObject): WorkforceHrmRequestCancelOperation? {
            val requestId = data.optString("id")
            val cancelledAt = data.optString("cancelledAt")
            return if (requestId.isBlank() || cancelledAt.isBlank()) null
            else WorkforceHrmRequestCancelOperation(operationId, requestId, cancelledAt)
        }
    }
}

data class WorkforceStoredOperation(
    val organizationSlug: String,
    val operation: WorkforceSyncOperation,
)

private fun JSONObject.requiredString(name: String, message: String): String = optString(name).takeIf { it.isNotBlank() }
    ?: throw WorkforceApiException(message, recoverable = true)

private fun String?.toOptionalInstant(label: String): Instant? {
    val value = this?.trim()?.takeIf { it.isNotBlank() } ?: return null
    return runCatching { Instant.parse(value) }.getOrElse {
        throw WorkforceApiException("Provide a valid ISO $label date-time with a timezone.", recoverable = false)
    }
}

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

private fun JSONObject.toAttendanceRequirements(): WorkforceAttendanceRequirements {
    val status = optString("status")
    val qrActions = optStringList("qrRequiredActions")
    return if (status == "ACTIVE" && optInt("enforcementVersion", 0) == 1) {
        WorkforceAttendanceRequirements(
            status = status,
            qrRequiredActions = qrActions,
            deviceTrustRequiredActions = optStringList("deviceTrustRequiredActions"),
            biometricRequiredActions = optStringList("biometricRequiredActions"),
        )
    } else if (status == "NOT_CONFIGURED") {
        WorkforceAttendanceRequirements.unconfigured()
    } else {
        WorkforceAttendanceRequirements.invalid()
    }
}

private fun JSONObject.toHistoryDay(): WorkforceHistoryDay? {
    val date = optString("date").takeIf { it.isNotBlank() } ?: return null
    val calendar = optJSONObject("calendar")
    return WorkforceHistoryDay(
        date = date,
        calendarKind = calendar?.optString("kind")?.takeIf { it.isNotBlank() },
        calendarName = calendar?.optString("name")?.takeIf { it.isNotBlank() },
        workday = optJSONObject("workday")?.toWorkday(),
        activeRequestStates = optJSONArray("requests")?.let { values ->
            buildList {
                for (index in 0 until values.length()) {
                    values.optJSONObject(index)?.let { request ->
                        val type = request.optString("type")
                        val status = request.optString("status")
                        if (type.isNotBlank() && status.isNotBlank()) add("$type: $status")
                    }
                }
            }
        }.orEmpty(),
    )
}

private fun JSONObject.toHrmRequest(): WorkforceHrmRequest? {
    val id = optString("id").takeIf { it.isNotBlank() } ?: return null
    val type = optString("type").takeIf { it.isNotBlank() } ?: return null
    val status = optString("status").takeIf { it.isNotBlank() } ?: return null
    val startDate = optString("startDate").takeIf { it.isNotBlank() } ?: return null
    val endDate = optString("endDate").takeIf { it.isNotBlank() } ?: return null
    return WorkforceHrmRequest(
        id = id,
        type = type,
        status = status,
        startDate = startDate,
        endDate = endDate,
        correctionWorkdayId = optString("correctionWorkdayId").takeIf { it.isNotBlank() && it != "null" },
        requestedStartAt = optString("requestedStartAt").takeIf { it.isNotBlank() && it != "null" },
        requestedEndAt = optString("requestedEndAt").takeIf { it.isNotBlank() && it != "null" },
        decisionNote = optString("decisionNote").takeIf { it.isNotBlank() && it != "null" },
        updatedAt = optString("updatedAt").takeIf { it.isNotBlank() && it != "null" },
    )
}

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
    val attendance: WorkforceAttendanceRequirements,
)

data class WorkforceAttendanceRequirements(
    val status: String,
    val qrRequiredActions: List<String>,
    val deviceTrustRequiredActions: List<String>,
    val biometricRequiredActions: List<String>,
) {
    fun requiresQr(action: WorkforceWorkdayAction): Boolean = action.wireValue in qrRequiredActions
    fun requiresDeviceTrust(action: WorkforceWorkdayAction): Boolean = action.wireValue in deviceTrustRequiredActions
    fun requiresBiometric(action: WorkforceWorkdayAction): Boolean = action.wireValue in biometricRequiredActions

    companion object {
        fun unconfigured() = WorkforceAttendanceRequirements(
            status = "NOT_CONFIGURED",
            qrRequiredActions = emptyList(),
            deviceTrustRequiredActions = emptyList(),
            biometricRequiredActions = emptyList(),
        )

        fun invalid() = WorkforceAttendanceRequirements(
            status = "INVALID",
            qrRequiredActions = emptyList(),
            deviceTrustRequiredActions = emptyList(),
            biometricRequiredActions = emptyList(),
        )
    }
}

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

data class WorkforceHistorySnapshot(
    val timezone: String,
    val start: String,
    val end: String,
    val days: List<WorkforceHistoryDay>,
    val requests: List<WorkforceHrmRequest>,
)

data class WorkforceHistoryDay(
    val date: String,
    val calendarKind: String?,
    val calendarName: String?,
    val workday: WorkforceWorkday?,
    val activeRequestStates: List<String>,
)

data class WorkforceHrmRequest(
    val id: String,
    val type: String,
    val status: String,
    val startDate: String,
    val endDate: String,
    val correctionWorkdayId: String?,
    val requestedStartAt: String?,
    val requestedEndAt: String?,
    val decisionNote: String?,
    val updatedAt: String?,
)

open class WorkforceApiException(
    message: String,
    val recoverable: Boolean,
    val recoveryCode: String? = null,
) : IllegalStateException(message)

class WorkforceActionConflictException(
    message: String,
    recoveryCode: String?,
) : WorkforceApiException(message, recoverable = true, recoveryCode = recoveryCode)
