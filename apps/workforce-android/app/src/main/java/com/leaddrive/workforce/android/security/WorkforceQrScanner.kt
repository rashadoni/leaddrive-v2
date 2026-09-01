package com.leaddrive.workforce.android.security

import androidx.activity.ComponentActivity
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * A one-off delegated QR scan. Google Play services owns camera frames; this
 * app receives a raw token only in the completion callback. The token is not
 * logged, persisted, placed in SavedState or passed to the encrypted outbox.
 */
class WorkforceQrScanner(private val activity: ComponentActivity) {
    fun scan(
        onToken: (WorkforceEphemeralQrToken) -> Unit,
        onCancelled: () -> Unit,
        onFailure: () -> Unit,
    ) {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build()
        val task = GmsBarcodeScanning.getClient(activity, options).startScan()
        task.addOnSuccessListener { barcode ->
            val raw = barcode.rawValue?.trim()
            if (raw.isNullOrBlank() || raw.length > MAX_QR_TOKEN_LENGTH) {
                onFailure()
            } else {
                onToken(WorkforceEphemeralQrToken(raw))
            }
        }.addOnCanceledListener(onCancelled)
            .addOnFailureListener { onFailure() }
    }

    private companion object {
        const val MAX_QR_TOKEN_LENGTH = 4_096
    }
}

/**
 * Intentionally has no string/persistence API. A successful scanner callback
 * yields one token object which can be consumed exactly once by the immediate
 * action envelope; a retry must obtain a fresh QR value from the station.
 */
class WorkforceEphemeralQrToken internal constructor(value: String) {
    private var unconsumedValue: String? = value

    @Synchronized
    internal fun consume(): String = checkNotNull(unconsumedValue) {
        "A scanned QR can only be used once. Scan a fresh code."
    }.also {
        unconsumedValue = null
    }
}
