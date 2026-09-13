package com.leaddrive.workforce.android.data

import android.content.Context
import android.content.res.Configuration
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
    val buildSha: String,
    val deviceClass: WorkforceDeviceClass,
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
        fun fromBuildConfig(context: Context) = WorkforceRuntimeConfiguration(
            apiBaseUrl = BuildConfig.WORKFORCE_API_BASE_URL,
            clientFamily = BuildConfig.WORKFORCE_CLIENT_FAMILY,
            clientPlatform = BuildConfig.WORKFORCE_CLIENT_PLATFORM,
            appVersion = BuildConfig.VERSION_NAME,
            appVersionCode = BuildConfig.VERSION_CODE,
            buildSha = BuildConfig.WORKFORCE_BUILD_SHA,
            deviceClass = WorkforceDeviceClass.from(context.resources.configuration),
        )
    }
}

/** Coarse screen category only; never a device model, serial, Android ID or IMEI. */
enum class WorkforceDeviceClass(val wireValue: String) {
    PHONE("phone"),
    TABLET("tablet"),
    OTHER("other");

    companion object {
        fun from(configuration: Configuration): WorkforceDeviceClass = when (
            configuration.screenLayout and Configuration.SCREENLAYOUT_SIZE_MASK
        ) {
            Configuration.SCREENLAYOUT_SIZE_LARGE,
            Configuration.SCREENLAYOUT_SIZE_XLARGE -> TABLET
            Configuration.SCREENLAYOUT_SIZE_NORMAL,
            Configuration.SCREENLAYOUT_SIZE_SMALL -> PHONE
            else -> OTHER
        }
    }
}

class WorkforceConfigurationException(message: String) : IllegalStateException(message)
