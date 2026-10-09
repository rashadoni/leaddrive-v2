/**
 * Since when — for the states of the live map that have a recorded beginning.
 *
 * Navixy's card says how long a state has lasted («стоит 5 ч 34 мин»). Ours
 * says it only where somebody pressed a button and the moment was written
 * down: the visit he is in, the break he is on, the shift he closed. «Стоит N
 * минут» outside a visit is NOT here: the map knows only that there has been
 * no movement for about five minutes, and a gap in tracking is not standing
 * still. How old the last coordinate is has its own column («Сигнал»).
 *
 * Pure: no React, no fetch.
 */

export type LiveMapStateSinceBasis = "VISIT" | "BREAK" | "SHIFT_CLOSED"

export interface LiveMapStateSince {
  basis: LiveMapStateSinceBasis
  /** ISO moment the state began (or, for a closed shift, the moment it was closed). */
  since: string
  /** The state is still going on, so how long it has lasted is worth saying. */
  ongoing: boolean
}

export interface LiveMapStateSinceSource {
  fieldStatus: string
  workdayState: string
  openVisitSince?: string | null
  workdayPausedAt?: string | null
  workdayCompletedAt?: string | null
}

function moment(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function liveMapStateSince(agent: LiveMapStateSinceSource): LiveMapStateSince[] {
  const facts: LiveMapStateSince[] = []
  const visit = agent.fieldStatus === "CHECKED_IN" ? moment(agent.openVisitSince) : null
  if (visit) facts.push({ basis: "VISIT", since: visit, ongoing: true })
  const pause = agent.workdayState === "PAUSED" ? moment(agent.workdayPausedAt) : null
  if (pause) facts.push({ basis: "BREAK", since: pause, ongoing: true })
  const closed = agent.workdayState === "CLOSED" ? moment(agent.workdayCompletedAt) : null
  if (closed) facts.push({ basis: "SHIFT_CLOSED", since: closed, ongoing: false })
  return facts
}

export type LiveMapDuration =
  | { unit: "moment" }
  | { unit: "minutes"; minutes: number }
  | { unit: "hours"; hours: number; minutes: number }
  | { unit: "days"; days: number; hours: number }

/** How long ago `since` was, in the two units that read at a glance. Null when either moment is unknown. */
export function liveMapDuration(since: string | null | undefined, nowMs: number): LiveMapDuration | null {
  const sinceMs = since ? Date.parse(since) : Number.NaN
  if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return null
  // A phone clock a little ahead of the server must not read as a negative duration.
  const totalMinutes = Math.floor(Math.max(0, nowMs - sinceMs) / 60_000)
  if (totalMinutes < 1) return { unit: "moment" }
  if (totalMinutes < 60) return { unit: "minutes", minutes: totalMinutes }
  if (totalMinutes < 48 * 60) return { unit: "hours", hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
  return { unit: "days", days: Math.floor(totalMinutes / 1_440), hours: Math.floor((totalMinutes % 1_440) / 60) }
}
