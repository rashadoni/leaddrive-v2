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
 * Opt-in, on-device reminder scheduling. It accepts only server-snapshotted
 * planned-end and server-resolved next-segment instants for an already-open
 * workday. It never derives a shift from a tenant default and never includes
 * employee, tenant, site, location, QR or device-proof data in a notification
 * or WorkManager input.
 */
class WorkforceReminderScheduler(context: Context) {
    private val applicationContext = context.applicationContext

    fun reconcile(enabled: Boolean, snapshot: WorkforceTodaySnapshot): WorkforceReminderState {
        val workday = snapshot.workday
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
        val schedule = workday?.schedule
        if (schedule == null) {
            cancelAll()
            return WorkforceReminderState.NO_APPROVED_SCHEDULE
        }
        val nowMillis = System.currentTimeMillis()
        val slots = listOfNotNull(
            serverSlot(END_WORK_NAME, schedule.plannedEndAt),
            schedule.segment
                ?.takeIf { it.state == "NEXT" }
                ?.startsAt
                ?.let { serverSlot(NEXT_SEGMENT_WORK_NAME, it) },
        ).filter { it.triggerAt.toEpochMilli() > nowMillis }
        if (slots.isEmpty()) {
            cancelAll()
            return WorkforceReminderState.WINDOW_PASSED
        }
        val manager = WorkManager.getInstance(applicationContext)
        slots.forEach { slot ->
            val work = OneTimeWorkRequestBuilder<WorkforceGenericReminderWorker>()
                .setInitialDelay(slot.triggerAt.toEpochMilli() - nowMillis, TimeUnit.MILLISECONDS)
                // No employee, workday, tenant, site, segment, proof or reminder
                // payload is retained in WorkManager input metadata.
                .setInputData(Data.EMPTY)
                .addTag(WORK_TAG)
                .build()
            manager.enqueueUniqueWork(slot.workName, ExistingWorkPolicy.REPLACE, work)
        }
        return WorkforceReminderState.SCHEDULED
    }

    private fun serverSlot(workName: String, value: String): WorkforceReminderSlot? =
        runCatching { Instant.parse(value) }.getOrNull()?.let { WorkforceReminderSlot(workName, it) }

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
        // WorkManager metadata. Both opaque jobs are replaced from fresh server
        // state and their names never contain a tenant/workday/employee ID.
        const val WORK_NAME = "workforce-local-reminder"
        const val END_WORK_NAME = "$WORK_NAME-end"
        const val NEXT_SEGMENT_WORK_NAME = "$WORK_NAME-next-segment"
    }
}

private data class WorkforceReminderSlot(
    val workName: String,
    val triggerAt: Instant,
)

enum class WorkforceReminderState {
    DISABLED,
    PERMISSION_REQUIRED,
    NOTIFICATIONS_DISABLED,
    NO_APPROVED_SCHEDULE,
    WINDOW_PASSED,
    NOT_NEEDED,
    SCHEDULED,
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
