package com.leaddrive.workforce.android.data

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.leaddrive.workforce.android.MainActivity
import com.leaddrive.workforce.android.R
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Opt-in, on-device reminder scheduling. It accepts only a server-snapshotted
 * planned end for an already-open workday. It never derives a shift from a
 * tenant default and never includes employee, tenant, site, location, QR or
 * device-proof data in a notification or WorkManager input.
 */
class WorkforceReminderScheduler(context: Context) {
    private val applicationContext = context.applicationContext

    fun reconcile(enabled: Boolean, workday: WorkforceWorkday?): WorkforceReminderState {
        if (!enabled) {
            cancelAll()
            return WorkforceReminderState.DISABLED
        }
        if (workday?.status == WorkforceWorkdayStatus.COMPLETED) {
            cancelAll()
            return WorkforceReminderState.NOT_NEEDED
        }
        if (!notificationPermissionGranted(applicationContext)) {
            cancelAll()
            return WorkforceReminderState.PERMISSION_REQUIRED
        }
        if (!NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()) {
            cancelAll()
            return WorkforceReminderState.NOTIFICATIONS_DISABLED
        }
        val plannedEndAt = workday?.schedule?.plannedEndAt
        if (plannedEndAt == null) {
            cancelAll()
            return WorkforceReminderState.NO_APPROVED_SCHEDULE
        }
        val triggerAt = runCatching { Instant.parse(plannedEndAt) }.getOrNull()
        if (triggerAt == null) {
            cancelAll()
            return WorkforceReminderState.NO_APPROVED_SCHEDULE
        }
        val delayMillis = triggerAt.toEpochMilli() - System.currentTimeMillis()
        if (delayMillis <= 0L) {
            cancelAll()
            return WorkforceReminderState.WINDOW_PASSED
        }
        val work = OneTimeWorkRequestBuilder<WorkforceGenericReminderWorker>()
            .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
            .setInputData(Data.EMPTY)
            .addTag(WORK_TAG)
            .build()
        WorkManager.getInstance(applicationContext).enqueueUniqueWork(
            WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            work,
        )
        return WorkforceReminderState.SCHEDULED
    }

    /** Logout and a disabled preference erase all opaque local reminder jobs. */
    fun cancelAll() {
        WorkManager.getInstance(applicationContext).cancelAllWorkByTag(WORK_TAG)
    }

    private fun notificationPermissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val WORK_TAG = "workforce-local-reminder"
        // A fixed name prevents employee/workday identifiers entering local
        // WorkManager metadata. Workforce supports only the current workday
        // reminder, which is replaced from fresh server state.
        const val WORK_NAME = "workforce-local-reminder"
    }
}

enum class WorkforceReminderState(val employeeMessage: String) {
    DISABLED("Local reminders are off on this device."),
    PERMISSION_REQUIRED("Allow notifications to receive a generic local Workforce reminder."),
    NOTIFICATIONS_DISABLED("Notifications are disabled for Workforce in system settings, so no local reminder is scheduled."),
    NO_APPROVED_SCHEDULE("No server-approved shift end is available, so this device will not guess a reminder time."),
    WINDOW_PASSED("The planned shift end has already passed. Refresh server state instead of scheduling a late reminder."),
    NOT_NEEDED("No local missed-finish reminder is needed for this completed workday."),
    SCHEDULED("A private local reminder is scheduled. It contains no work-time, site or proof details."),
}

/** Displays a deliberately generic local notification after an approved end. */
class WorkforceGenericReminderWorker(
    appContext: Context,
    workerParameters: WorkerParameters,
) : CoroutineWorker(appContext, workerParameters) {
    override suspend fun doWork(): Result {
        if (!notificationsAllowed(applicationContext)) return Result.success()
        return postGenericReminder()
    }

    /**
     * Permission is checked immediately before this call. A concurrent revoke
     * is treated as an unposted optional reminder, never as retrying work.
     */
    @SuppressLint("MissingPermission")
    private fun postGenericReminder(): Result {
        val manager = NotificationManagerCompat.from(applicationContext)
        return try {
            ensureChannel(applicationContext)
            val notificationText = applicationContext.getString(R.string.notification_text)
            manager.notify(
                NOTIFICATION_ID,
                NotificationCompat.Builder(applicationContext, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(applicationContext.getString(R.string.notification_title))
                    .setContentText(notificationText)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(notificationText))
                    .setContentIntent(openWorkforceIntent(applicationContext))
                    .setAutoCancel(true)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build(),
            )
            Result.success()
        } catch (_: Exception) {
            // A second notification after an OS failure would be more
            // surprising than useful; a fresh server state schedules anew.
            Result.success()
        }
    }

    private fun notificationsAllowed(context: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_channel),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = context.getString(R.string.notification_channel_description)
            },
        )
    }

    private fun openWorkforceIntent(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private companion object {
        const val CHANNEL_ID = "workforce-local-reminders-v1"
        const val NOTIFICATION_ID = 7_401
    }
}
