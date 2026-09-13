package com.leaddrive.workforce.android.data

import java.net.HttpURLConnection
import java.net.URI
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
    }
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
)

class WorkforceApiException(message: String, val recoverable: Boolean) : IllegalStateException(message)
