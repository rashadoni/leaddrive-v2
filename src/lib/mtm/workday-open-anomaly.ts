/**
 * One manager-facing answer to "is this person's shift open?".
 *
 * Prod 2026-09-14, agent Anar Mammadov: his workday was started on 11 Sep at
 * 20:57 and never closed. Three screens gave three answers for the same row —
 * the Panel said today «Başlamayıb» and showed a yellow box telling the reader
 * to close or continue the shift, the live map said «İş günü aktivdir», and the
 * agents list said "not started". Each was true about something (no row for
 * today; the row is STARTED; the list only looks at today's row), and together
 * they told an office manager nothing.
 *
 * A shift that has been running for more than {@link MTM_WORKDAY_OPEN_ANOMALY_HOURS}
 * hours is not "active" in any
 * sense a manager can act on: nobody works three days straight. It is an
 * anomaly — the agent did not close the shift — and it gets its own state so
 * every screen can say the same sentence:
 * «Növbə 11 sen 20:57-dən açıqdır (3 gün) — agent bağlamayıb».
 *
 * Pure: no database, no clock of its own. Callers pass `now` and today's key.
 */

/** Longer than any real field shift, shorter than a working day plus a night. */
export const MTM_WORKDAY_OPEN_ANOMALY_HOURS = 16

export type MtmWorkdayRow = {
  status: string
  /** Tenant-local work date as a UTC-midnight Date or a YYYY-MM-DD key. */
  workDate?: string | Date | null
  startedAt?: string | Date | null
  pausedAt?: string | Date | null
  completedAt?: string | Date | null
}

export type MtmManagerWorkdayState =
  | { kind: "not-started" }
  | { kind: "working"; since: string | null }
  | { kind: "paused"; since: string | null }
  | { kind: "finished"; at: string | null }
  /**
   * STARTED or PAUSED for more than 16 h. `days` is 0 until 24 h have
   * elapsed (the label then uses hours), afterwards the tenant-local calendar
   * days from the work date to today; `hours` is the elapsed time since start.
   */
  | {
      kind: "left-open"
      since: string | null
      workDate: string | null
      days: number
      hours: number
      status: "STARTED" | "PAUSED"
    }

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function dateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = iso(value)
  return parsed ? parsed.slice(0, 10) : null
}

function calendarDaysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00.000Z`)
  const to = Date.parse(`${toKey}T00:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/**
 * Is an open (STARTED/PAUSED) row an anomaly? Exported so a caller that only
 * has a status and a start can ask the same question.
 */
export function isMtmWorkdayLeftOpen(row: MtmWorkdayRow, now: Date, _todayKey?: string | null): boolean {
  if (row.status !== "STARTED" && row.status !== "PAUSED") return false
  // Review of #210: crossing midnight alone is not an anomaly — a 22:00 start
  // read «açıqdır (1 gün) — agent bağlamayıb» at 00:05. Only elapsed time
  // counts. A row with no start moment cannot be judged and is not flagged.
  const started = iso(row.startedAt)
  if (!started) return false
  return now.getTime() - Date.parse(started) > MTM_WORKDAY_OPEN_ANOMALY_HOURS * 3_600_000
}

/**
 * The state a manager should read. `today` is today's row (if any); `active`
 * is the newest STARTED/PAUSED row regardless of date (if the caller has it).
 * An open anomaly wins over everything: it is the one thing on which somebody
 * has to act, and "not started today" is only true because of it.
 */
export function mtmManagerWorkdayState(input: {
  today?: MtmWorkdayRow | null
  active?: MtmWorkdayRow | null
  now: Date
  todayKey?: string | null
}): MtmManagerWorkdayState {
  const { now, todayKey } = input
  const candidates = [input.active, input.today].filter((row): row is MtmWorkdayRow => Boolean(row))
  const open = candidates.find((row) => isMtmWorkdayLeftOpen(row, now, todayKey))
  if (open) {
    const since = iso(open.startedAt)
    const workKey = dateKey(open.workDate) ?? (since ? since.slice(0, 10) : null)
    const hours = since ? Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 3_600_000)) : 0
    // Days are shown only once a full day has elapsed, and then as calendar
    // days (11 Sep → 14 Sep = 3), which is how a manager reads the date.
    const days = hours < 24
      ? 0
      : todayKey && workKey
        ? Math.max(1, calendarDaysBetween(workKey, todayKey))
        : Math.floor(hours / 24)
    return {
      kind: "left-open",
      since,
      workDate: workKey,
      days,
      hours,
      status: open.status === "PAUSED" ? "PAUSED" : "STARTED",
    }
  }
  // A shift started at 22:00 is still being worked at 00:05: without a row
  // for today, a not-yet-anomalous open row speaks for the day.
  const day = input.today ?? input.active ?? null
  if (!day) return { kind: "not-started" }
  // COMPLETED first: a closed day can still remember its last break.
  if (day.status === "COMPLETED") return { kind: "finished", at: iso(day.completedAt) }
  if (day.status === "PAUSED") return { kind: "paused", since: iso(day.pausedAt) }
  return { kind: "working", since: iso(day.startedAt) }
}
