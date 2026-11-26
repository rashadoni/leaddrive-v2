/**
 * Ending a contract — termination, cancellation, and «Вернуть в черновик»
 * (owner 2026-11-26, mock «Расторжение», «Давай»). Until then «Расторгнут» and
 * «Отменён» were filter tabs no button could reach, and a rejected contract
 * was a dead end: it could be neither fixed nor sent for approval again.
 *
 *  - Termination — a contract in force (`active`, `renewing`). The day named
 *    is the first day it no longer applies: today or earlier, the contract is
 *    «Расторгнут» at once; later, it stays in force and the finance deadline
 *    job (src/lib/contract-lifecycle/terminate-scheduled.ts) moves it on that
 *    day. A scheduled termination can be withdrawn until then. The day is not
 *    after the contract's own end date — it would have run out first.
 *  - Cancellation — a contract that never took effect (`draft`,
 *    `pending_approval`, `approved`): «Отменён», with a reason.
 *  - Reopen — `rejected` → `draft`; the old approval round is superseded.
 *
 * Who: anyone who may edit contracts; each is written to the audit log with
 * who did it. Pure: the routes under src/app/api/v1/contracts/[id]/ do the I/O.
 */

export const TERMINATION_REASONS = ["mutual_agreement", "our_initiative", "counterparty_initiative", "breach", "other"] as const
export type TerminationReason = (typeof TERMINATION_REASONS)[number]

export const TERMINABLE_STATUSES = ["active", "renewing"] as const
export const CANCELLABLE_STATUSES = ["draft", "pending_approval", "approved"] as const

export const TERMINATION_COPY_PURPOSE = "termination_copy"
export const CLOSE_NOTE_MAX = 1000

export function isTerminationReason(value: unknown): value is TerminationReason {
  return typeof value === "string" && (TERMINATION_REASONS as readonly string[]).includes(value)
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** "YYYY-MM-DD" → that day at 00:00 UTC, the way contract dates are stored. */
export function parseCalendarDay(raw: unknown): { ok: true; date: Date; day: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return { ok: false }
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d) || Number(y) < 1990) {
    return { ok: false }
  }
  return { ok: true, date, day: `${y}-${m}-${d}` }
}

export type TerminationRefusal =
  | "NOT_TERMINABLE"
  | "ALREADY_SCHEDULED"
  | "TERMINATION_DATE_INVALID"
  | "AFTER_END_DATE"
  | "REASON_REQUIRED"
  | "NOTE_TOO_LONG"

/** What a termination request means, or why it is refused. */
export function planTermination(
  contract: { status: string; endDate: Date | null; terminationDate: Date | null },
  input: { terminationDate: unknown; reason: unknown; note: unknown },
  now: Date = new Date(),
):
  | { ok: true; date: Date; day: string; reason: TerminationReason; note: string | null; immediate: boolean }
  | { ok: false; code: TerminationRefusal } {
  if (!(TERMINABLE_STATUSES as readonly string[]).includes(contract.status)) return { ok: false, code: "NOT_TERMINABLE" }
  if (contract.terminationDate) return { ok: false, code: "ALREADY_SCHEDULED" }
  const day = parseCalendarDay(input.terminationDate)
  if (!day.ok) return { ok: false, code: "TERMINATION_DATE_INVALID" }
  if (!isTerminationReason(input.reason)) return { ok: false, code: "REASON_REQUIRED" }
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null
  if (note && note.length > CLOSE_NOTE_MAX) return { ok: false, code: "NOTE_TOO_LONG" }
  // endDate is the last valid day; the first day without the contract is the day after it.
  if (contract.endDate && day.date.getTime() > contract.endDate.getTime() + 86_400_000) return { ok: false, code: "AFTER_END_DATE" }
  return { ok: true, date: day.date, day: day.day, reason: input.reason, note, immediate: day.date.getTime() <= startOfUtcDay(now).getTime() }
}

export type CancelRefusal = "NOT_CANCELLABLE" | "REASON_REQUIRED" | "NOTE_TOO_LONG"

export function planCancellation(status: string, reason: unknown): { ok: true; note: string } | { ok: false; code: CancelRefusal } {
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(status)) return { ok: false, code: "NOT_CANCELLABLE" }
  const note = typeof reason === "string" ? reason.trim() : ""
  if (!note) return { ok: false, code: "REASON_REQUIRED" }
  if (note.length > CLOSE_NOTE_MAX) return { ok: false, code: "NOTE_TOO_LONG" }
  return { ok: true, note }
}

/** A scheduled termination may be withdrawn while the contract is still in force and the day has not come. */
export function canWithdrawTermination(
  contract: { status: string; terminationDate: Date | null },
  now: Date = new Date(),
): boolean {
  return Boolean(
    contract.terminationDate &&
      (TERMINABLE_STATUSES as readonly string[]).includes(contract.status) &&
      contract.terminationDate.getTime() > startOfUtcDay(now).getTime(),
  )
}
