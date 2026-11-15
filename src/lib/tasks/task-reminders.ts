/**
 * «Напомнить» — a task's own reminder (owner, 2026-11-15: the inbox panel's reminder card).
 *
 * Until now a task had a due date and nobody was told when it came: the bell knew «created»,
 * «assigned», «completed». A task now carries `remindAt`; this tick tells its assignee (bell +
 * push, in his language) once, and stamps `remindedAt` in the same transaction as the bell row, so
 * a re-run, an overlap or a retry cannot remind twice — and a failed write leaves the stamp empty
 * for the next tick.
 *
 * Skipped without a word, but stamped: a task already finished or deleted, and a reminder older
 * than STALE_AFTER_MS (a job that was down for days must not wake everyone with last week's
 * reminders). A task without an assignee stays unstamped — assigning it later makes the next tick
 * deliver.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createNotification, deliverNotificationPush } from "@/lib/notifications"
import { TASK_REMINDER_NOTIFICATION_KIND } from "@/lib/notifications/prefs"
import { taskNotificationLocale, taskNotificationText } from "@/lib/tasks/task-notification-text"
import { CLOSED_TASK_STATUSES } from "@/lib/tasks/my-work"

const BATCH = 200
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export type TaskReminderRun = { scanned: number; reminded: number; skipped: number }

type DueReminder = {
  id: string
  organizationId: string
  title: string
  remindAt: Date | null
  assignedTo: string | null
  status: string
  completedAt: Date | null
}

/**
 * Runs across every organization: the caller is inside `runWithRlsBypass` and a job lease — the
 * minute tick of `/api/cron/commitment-escalation`, which carries it.
 */
export async function runTaskReminders(now: Date = new Date()): Promise<TaskReminderRun> {
  const due: DueReminder[] = await prisma.task.findMany({
    where: { remindAt: { lte: now }, remindedAt: null, deletedAt: null, assignedTo: { not: null } },
    select: { id: true, organizationId: true, title: true, remindAt: true, assignedTo: true, status: true, completedAt: true },
    orderBy: { remindAt: "asc" },
    take: BATCH,
  })

  const result: TaskReminderRun = { scanned: due.length, reminded: 0, skipped: 0 }
  for (const task of due) {
    if (!task.remindAt || !task.assignedTo) continue
    const finished = task.completedAt !== null || (CLOSED_TASK_STATUSES as readonly string[]).includes(task.status)
    const stale = now.getTime() - task.remindAt.getTime() > STALE_AFTER_MS
    if (finished || stale) {
      await prisma.task.updateMany({
        where: { id: task.id, organizationId: task.organizationId, remindAt: task.remindAt, remindedAt: null },
        data: { remindedAt: now },
      })
      result.skipped += 1
      continue
    }
    if (await remind(task as DueReminder & { remindAt: Date; assignedTo: string }, now)) result.reminded += 1
  }
  return result
}

async function remind(task: DueReminder & { remindAt: Date; assignedTo: string }, now: Date): Promise<boolean> {
  const recipient = await prisma.user.findFirst({
    where: { id: task.assignedTo, organizationId: task.organizationId },
    select: { preferredLanguage: true },
  }).catch(() => null)
  const text = taskNotificationText("reminder", taskNotificationLocale(recipient?.preferredLanguage, null), task)
  const notice = {
    organizationId: task.organizationId,
    userId: task.assignedTo,
    type: "info" as const,
    title: text.title,
    message: text.message,
    entityType: "task",
    entityId: task.id,
    kind: TASK_REMINDER_NOTIFICATION_KIND,
    idempotencyKey: `task-reminder:v1:${task.id}:${task.remindAt.toISOString()}:${task.assignedTo}`,
  }

  const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // The stamp and the bell row commit together. A task rescheduled, reassigned, finished or
    // deleted between the scan and here no longer matches and is left for the next tick.
    const claimed = await tx.task.updateMany({
      where: {
        id: task.id,
        organizationId: task.organizationId,
        remindAt: task.remindAt,
        remindedAt: null,
        assignedTo: task.assignedTo,
        deletedAt: null,
        completedAt: null,
      },
      data: { remindedAt: now },
    })
    if (claimed.count !== 1) return { sent: false, push: false }
    const row = await createNotification({ ...notice, push: false, client: tx })
    if (!row) throw new Error("task_reminder_notification_not_persisted")
    return { sent: true, push: !("createdNow" in row) || row.createdNow === true }
  })
  // A push leaves the building and cannot join the commit; the bell row is the durable part.
  if (outcome.push) await deliverNotificationPush(notice).catch(() => undefined)
  return outcome.sent
}
