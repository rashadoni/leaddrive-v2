import { resolveMtmTaskTenantLocalDateTime } from "@/lib/mtm/task-recurrence"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"

/**
 * The deadline of a task given in three fields — «Сегодня / Завтра / Без срока
 * / Дата…» (owner-approved mockup, 2026-10-20: «максимально облегчи»).
 *
 * A day is not an instant. An open task is late once its due date has passed
 * (task-overdue.ts), so a day stored as its midnight would be late the moment
 * that day began. The day therefore means its working evening, 18:00 in the
 * organization's timezone — what the agent reads as «срок завтра до 18:00».
 * «Сегодня» given after 17:00 means the end of today instead, so a task is
 * never born late.
 *
 * Pure: the panel computes it in the browser, the manager's phone sends the
 * choice and the server computes it — one rule for both.
 */

export const QUICK_TASK_DUE_TIME = "18:00"
const END_OF_DAY = "23:59"
/** «Сегодня» needs at least this much of the working day left to mean 18:00. */
const TODAY_MARGIN_MS = 60 * 60 * 1000

export type QuickTaskDueChoice = "today" | "tomorrow" | "none" | string

const DAY = /^\d{4}-\d{2}-\d{2}$/

function nextDay(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function at(dayKey: string, time: string, timezone: string): Date {
  return resolveMtmTaskTenantLocalDateTime(`${dayKey}T${time}`, timezone).instant
}

/** Whether `choice` is one this module understands; a date must be a real calendar day. */
export function isQuickTaskDueChoice(choice: unknown): choice is QuickTaskDueChoice {
  if (choice === "today" || choice === "tomorrow" || choice === "none") return true
  if (typeof choice !== "string" || !DAY.test(choice)) return false
  const date = new Date(`${choice}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === choice
}

/**
 * The instant a choice stands for, or null for «Без срока». A date before
 * today is refused (RangeError): a task is not given late on purpose.
 */
export function quickTaskDueDate(choice: QuickTaskDueChoice, now: Date, timezone: string): Date | null {
  if (!isQuickTaskDueChoice(choice)) throw new RangeError("unknown due choice")
  if (choice === "none") return null
  const zone = isValidTimezone(timezone) ? timezone : "UTC"
  const today = dateInputValueInTimezone(now, zone)
  if (choice === "today") {
    const evening = at(today, QUICK_TASK_DUE_TIME, zone)
    return evening.getTime() - now.getTime() >= TODAY_MARGIN_MS ? evening : at(today, END_OF_DAY, zone)
  }
  const day = choice === "tomorrow" ? nextDay(today) : choice
  if (day < today) throw new RangeError("due date is in the past")
  if (day === today) return quickTaskDueDate("today", now, zone)
  return at(day, QUICK_TASK_DUE_TIME, zone)
}
