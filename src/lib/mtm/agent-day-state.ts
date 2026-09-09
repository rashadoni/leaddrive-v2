/**
 * What an agent is doing right now, for the web list of agents.
 *
 * Field UX audit 2026-09-05, task A7 tail. The list showed one thing: a green
 * dot when a GPS point arrived recently, grey otherwise. Since the same audit
 * made the server refuse GPS points recorded during a break (A7 server half),
 * a rep who goes to lunch stops updating `lastSeenAt` and fades to grey —
 * exactly like a rep whose phone died in a basement.
 *
 * The manager cannot tell those apart, and they call the second one. So the
 * workday's own state has to reach the screen, and it has to win over the dot:
 * "on a break since 13:05" is a fact, "not seen for 40 minutes" is an
 * inference from the absence of one.
 *
 * The state is read straight off `MtmAgentWorkday` — status, pausedAt,
 * completedAt are already stored there. Nothing is reconstructed from the
 * event log; the one place that does that (`workday-pauses.ts`) exists to
 * draw historical segments, which is a different question.
 */

export type MtmAgentDayRecord = {
  status: "STARTED" | "PAUSED" | "COMPLETED"
  startedAt?: string | Date | null
  pausedAt?: string | Date | null
  completedAt?: string | Date | null
} | null | undefined

export type MtmAgentPresence =
  /** No workday row for today: the shift has not begun. */
  | { kind: "not-started" }
  /** Working. Whether the phone reported recently is a separate question. */
  | { kind: "working"; since: string | null }
  /** On a break. `since` is null when the row lost the moment. */
  | { kind: "paused"; since: string | null }
  /** The day was closed, and closing is final and once per day. */
  | { kind: "finished"; at: string | null }

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function mtmAgentPresence(day: MtmAgentDayRecord): MtmAgentPresence {
  if (!day) return { kind: "not-started" }
  // COMPLETED is checked first on purpose: a day can be finished while
  // `pausedAt` still holds the last break, and "finished" is the newer truth.
  if (day.status === "COMPLETED") return { kind: "finished", at: iso(day.completedAt) }
  if (day.status === "PAUSED") return { kind: "paused", since: iso(day.pausedAt) }
  return { kind: "working", since: iso(day.startedAt) }
}

/**
 * Whether the workday explains the silence, so the caller can stop inferring
 * from `lastSeenAt`. A break and a closed day both stop GPS by design; only a
 * running shift leaves the absence of points meaning something.
 */
export function mtmAgentSilenceExplained(presence: MtmAgentPresence): boolean {
  return presence.kind === "paused" || presence.kind === "finished" || presence.kind === "not-started"
}
