package com.leaddrive.workforce.android.data

import com.leaddrive.workforce.android.BuildConfig
import java.net.URI

/**
 * Release endpoints are supplied outside Git. A debug build deliberately uses
 * an invalid URL, which makes an unconfigured build visibly unusable instead
 * of silently sending credentials to a guessed host.
 */
data class WorkforceRuntimeConfiguration(
    val apiBaseUrl: String,
    val clientFamily: String,
    val clientPlatform: String,
    val appVersion: String,
    val appVersionCode: Int,
) {
    fun requireHttpsBaseUrl(): URI {
        val uri = runCatching { URI(apiBaseUrl) }.getOrElse {
            throw WorkforceConfigurationException("The Workforce API address is invalid.")
        }
        if (uri.scheme != "https" || uri.host.isNullOrBlank()) {
            throw WorkforceConfigurationException("The Workforce API address must use HTTPS.")
        }
        return uri
    }

    companion object {
        fun fromBuildConfig() = WorkforceRuntimeConfiguration(
            apiBaseUrl = BuildConfig.WORKFORCE_API_BASE_URL,
            clientFamily = BuildConfig.WORKFORCE_CLIENT_FAMILY,
            clientPlatform = BuildConfig.WORKFORCE_CLIENT_PLATFORM,
            appVersion = BuildConfig.VERSION_NAME,
            appVersionCode = BuildConfig.VERSION_CODE,
        )
    }
}

class WorkforceConfigurationException(message: String) : IllegalStateException(message)
