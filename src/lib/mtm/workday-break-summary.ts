/**
 * A day's breaks in one line: how many, and how long in total.
 *
 * Field UX audit 2026-09-05, A7 tail. "On a break" answers *what* is happening
 * right now; the manager reading a card at the end of the day is asking
 * something else — how the day actually went. Two breaks of twenty minutes and
 * one break of two hours are the same word and different days.
 *
 * An open break (started, not yet ended) counts toward the total up to the
 * moment being rendered. Leaving it out would show "1 break, 0 minutes" to
 * someone who is on that break right now.
 */

export type MtmWorkdayBreak = { from: string; to: string | null }

export type MtmWorkdayBreakSummary = {
  count: number
  /** Whole minutes, rounded down; a break shorter than a minute still counts. */
  minutes: number
  /** True while one of them has no end yet. */
  ongoing: boolean
}

export function mtmWorkdayBreakSummary(
  breaks: readonly MtmWorkdayBreak[] | null | undefined,
  now: Date,
): MtmWorkdayBreakSummary {
  let count = 0
  let ms = 0
  let ongoing = false
  for (const entry of breaks ?? []) {
    const from = new Date(entry.from).getTime()
    if (!Number.isFinite(from)) continue
    const to = entry.to ? new Date(entry.to).getTime() : now.getTime()
    if (!Number.isFinite(to)) continue
    // A correction tool can leave `to` before `from`; counting a negative
    // stretch would silently shorten the day's total.
    if (to < from) continue
    count += 1
    ms += to - from
    if (!entry.to) ongoing = true
  }
  return { count, minutes: Math.floor(ms / 60000), ongoing }
}
