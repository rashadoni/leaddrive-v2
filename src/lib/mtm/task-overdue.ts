/**
 * When a field task is late.
 *
 * Nobody stores OVERDUE: the phone refuses to write it («Overdue status is
 * computed by the server») and the phone and «Today» derive it from the due
 * date. The web list filtered on the stored status, so on 24 September 2026
 * «Overdue» showed 0 while all 243 open tasks were weeks past their date.
 * One rule for everyone: an open task whose due date has passed.
 */
export const MTM_OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "OVERDUE"] as const

/** Prisma filter for late tasks, for lists and counts. */
export function mtmOverdueTaskWhere(now: Date) {
  return { status: { in: [...MTM_OPEN_TASK_STATUSES] }, dueDate: { lt: now } }
}

/** Whole days past the due date for a late task, else null. */
export function mtmTaskOverdueDays(
  task: { status: string; dueDate: Date | string | null | undefined },
  now: number,
): number | null {
  if (!task.dueDate || !(MTM_OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) return null
  const due = new Date(task.dueDate).getTime()
  if (!Number.isFinite(due) || due >= now) return null
  return Math.max(1, Math.floor((now - due) / 86_400_000))
}
