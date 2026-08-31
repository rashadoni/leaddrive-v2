package com.leaddrive.workforce.android.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.SystemClock
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * One foreground, user-initiated location sample for a Workforce action.
 * It deliberately has no subscription, service, receiver or background mode.
 * Product/legal policy must still opt into invoking it before an action can
 * carry location; merely declaring foreground permission is not activation.
 */
class WorkforceActionTimeLocationCapture(context: Context) {
    private val applicationContext = context.applicationContext
    private val locationManager = applicationContext.getSystemService(LocationManager::class.java)

    suspend fun captureCurrent(): WorkforceActionTimeLocationResult {
        if (!hasForegroundLocationPermission()) return WorkforceActionTimeLocationResult.PermissionMissing
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            // No legacy last-known fallback: it could silently attach a stale
            // location to an attendance fact. The supported-device matrix must
            // decide whether a separately tested API-26..29 current-location
            // implementation is required.
            return WorkforceActionTimeLocationResult.UnsupportedPlatform
        }
        val provider = try {
            val candidates = if (hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
                sequenceOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            } else {
                sequenceOf(LocationManager.NETWORK_PROVIDER)
            }
            candidates
                .firstOrNull { locationManager.isProviderEnabled(it) }
        } catch (_: SecurityException) {
            return WorkforceActionTimeLocationResult.PermissionMissing
        } ?: return WorkforceActionTimeLocationResult.ProviderDisabled
        return captureWithGrantedForegroundPermission(provider)
    }

    /** Permission is checked immediately before this narrow API-30 call. */
    @RequiresApi(Build.VERSION_CODES.R)
    @SuppressLint("MissingPermission")
    private suspend fun captureWithGrantedForegroundPermission(provider: String): WorkforceActionTimeLocationResult = try {
            withTimeoutOrNull(CAPTURE_TIMEOUT_MS) {
                suspendCancellableCoroutine { continuation ->
                    val cancellation = CancellationSignal()
                    continuation.invokeOnCancellation { cancellation.cancel() }
                    locationManager.getCurrentLocation(provider, cancellation, ContextCompat.getMainExecutor(applicationContext)) { location ->
                        if (!continuation.isActive) return@getCurrentLocation
                        continuation.resume(location?.toResult() ?: WorkforceActionTimeLocationResult.Unavailable)
                    }
                }
            } ?: WorkforceActionTimeLocationResult.TimedOut
        } catch (_: SecurityException) {
            // Permission can be revoked between the initial check and the
            // platform call. Treat that race as an explicit missing proof.
            WorkforceActionTimeLocationResult.PermissionMissing
        }

    private fun hasForegroundLocationPermission(): Boolean =
        hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) || hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(applicationContext, permission) == PackageManager.PERMISSION_GRANTED

    private fun Location.toResult(): WorkforceActionTimeLocationResult {
        val ageMillis = ((SystemClock.elapsedRealtimeNanos() - elapsedRealtimeNanos) / 1_000_000L).coerceAtLeast(0L)
        return if (ageMillis > MAX_LOCATION_AGE_MS) {
            WorkforceActionTimeLocationResult.Stale
        } else if (!latitude.isFinite() || latitude !in -90.0..90.0
            || !longitude.isFinite() || longitude !in -180.0..180.0
            || !hasAccuracy() || !accuracy.isFinite() || accuracy <= 0f
        ) {
            WorkforceActionTimeLocationResult.Unavailable
        } else {
            WorkforceActionTimeLocationResult.Captured(
                latitude = latitude,
                longitude = longitude,
                accuracyMeters = accuracy,
                capturedAtEpochMs = time,
                ageMillis = ageMillis,
                isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else isFromMockProvider,
                precision = if (hasAccuracy() && accuracy <= PRECISE_ACCURACY_METERS) {
                    WorkforceLocationPrecision.PRECISE
                } else {
                    WorkforceLocationPrecision.APPROXIMATE
                },
                provider = when (provider) {
                    LocationManager.GPS_PROVIDER -> WorkforceLocationProvider.GPS
                    LocationManager.NETWORK_PROVIDER -> WorkforceLocationProvider.NETWORK
                    else -> WorkforceLocationProvider.UNKNOWN
                },
            )
        }
    }

    private companion object {
        const val PRECISE_ACCURACY_METERS = 100f
        const val MAX_LOCATION_AGE_MS = 30_000L
        const val CAPTURE_TIMEOUT_MS = 15_000L
    }
}

sealed interface WorkforceActionTimeLocationResult {
    data class Captured(
        val latitude: Double,
        val longitude: Double,
        val accuracyMeters: Float,
        val capturedAtEpochMs: Long,
        val ageMillis: Long,
        val precision: WorkforceLocationPrecision,
        val provider: WorkforceLocationProvider,
        val isMock: Boolean,
    ) : WorkforceActionTimeLocationResult

    data object PermissionMissing : WorkforceActionTimeLocationResult
    data object ProviderDisabled : WorkforceActionTimeLocationResult
    data object UnsupportedPlatform : WorkforceActionTimeLocationResult
    data object TimedOut : WorkforceActionTimeLocationResult
    data object Stale : WorkforceActionTimeLocationResult
    data object Unavailable : WorkforceActionTimeLocationResult
}

enum class WorkforceLocationPrecision {
    PRECISE,
    APPROXIMATE,
}

enum class WorkforceLocationProvider(val wireValue: String) {
    GPS("GPS"),
    NETWORK("NETWORK"),
    UNKNOWN("UNKNOWN"),
}
