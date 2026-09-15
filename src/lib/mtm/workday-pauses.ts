/**
 * When a shift was paused, reconstructed from its own events.
 *
 * Field UX audit 2026-09-05, task A7. The workday row carries only the current
 * pause (`pausedAt`) and the total (`totalPausedSeconds`) — enough to compute
 * worked time, useless for answering "was the agent on a break at 13:40?".
 * That question has two callers who must answer it identically:
 *
 *   - GPS ingestion, which must not bank a point recorded during a break as
 *     work. The agent is at lunch, not on route.
 *   - The agent's own GPS history and the manager's agent card, which show the
 *     day as segments. A gap with no explanation reads as "the app lost me".
 *
 * The events are the record: START, PAUSE, RESUME, FINISH, each with the
 * moment it happened, plus REOPEN when a manager reopened today's finished
 * shift. This file turns them into closed intervals plus, when the shift is
 * paused right now, one open interval.
 */

/**
 * The event types that shape breaks. Callers that read the journal for this
 * file must select exactly these: without REOPEN a reopened shift's gap
 * between its first FINISH and RESUME would silently read as work.
 */
export const MTM_WORKDAY_PAUSE_EVENT_TYPES = ["PAUSE", "RESUME", "FINISH", "REOPEN"] as const

export type MtmWorkdayPauseEvent = {
  type: string
  occurredAt: Date | string
  /**
   * When the server applied the event. Instants alone order the journal except
   * around a REOPEN, which is recorded at the instant of the FINISH it reopens
   * (as is a manager's undo FINISH); there application order decides. Rows
   * without it sort first among events sharing an instant.
   */
  appliedAt?: Date | string | null
}

/** A break. `to === null` means it is still running. */
export type MtmWorkdayPause = { from: Date; to: Date | null }

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Pauses in the order they happened.
 *
 * Deliberately forgiving about the shapes real data takes:
 *   - two PAUSEs in a row (a retried request, an offline replay) keep the
 *     first moment, because that is when the break actually began;
 *   - a RESUME with no PAUSE before it is ignored rather than treated as a
 *     break that started at the beginning of time;
 *   - FINISH closes an open pause: a shift finished from the paused state
 *     ends the break at the same moment, which is what `applyMtmWorkdayEvent`
 *     records in `totalPausedSeconds`;
 *   - REOPEN opens a break at its own instant, which is the instant of the
 *     FINISH it reopens: the workday row counts that gap as pause when the
 *     agent resumes. When that FINISH itself closed a break, the break simply
 *     never ended, so it continues as one interval instead of two touching at
 *     the finish moment. An undo FINISH at the same instant closes it again,
 *     leaving the day's breaks exactly as they were before the reopen.
 */
export function mtmWorkdayPauses(events: readonly MtmWorkdayPauseEvent[]): MtmWorkdayPause[] {
  const pauses: MtmWorkdayPause[] = []
  let open: Date | null = null
  const ordered = [...events]
    .map((event, index) => ({
      type: event.type,
      at: toDate(event.occurredAt),
      appliedAtMs: event.appliedAt == null ? Number.NEGATIVE_INFINITY : toDate(event.appliedAt)?.getTime() ?? Number.NEGATIVE_INFINITY,
      index,
    }))
    .filter((event): event is { type: string; at: Date; appliedAtMs: number; index: number } => event.at !== null)
    .sort((a, b) => (
      a.at.getTime() - b.at.getTime()
      || (a.appliedAtMs === b.appliedAtMs ? 0 : a.appliedAtMs < b.appliedAtMs ? -1 : 1)
      || a.index - b.index
    ))

  for (const event of ordered) {
    if (event.type === "PAUSE") {
      if (!open) open = event.at
    } else if (event.type === "RESUME" || event.type === "FINISH") {
      if (open) {
        // A zero-length pause is real (paused and resumed in the same second)
        // but says nothing; keeping it would only add noise to the timeline.
        if (event.at.getTime() > open.getTime()) pauses.push({ from: open, to: event.at })
        open = null
      }
    } else if (event.type === "REOPEN") {
      if (!open) {
        const previous = pauses.at(-1)
        if (previous?.to && previous.to.getTime() === event.at.getTime()) {
          pauses.pop()
          open = previous.from
        } else {
          open = event.at
        }
      }
    }
  }
  if (open) pauses.push({ from: open, to: null })
  return pauses
}

/**
 * True when the moment falls inside a break.
 *
 * The boundary belongs to work on both ends: the point captured at the very
 * second of PAUSE was taken before the agent stopped, and the one at RESUME
 * is the first of the new leg. Refusing them would drop real work over a
 * rounding coincidence.
 */
export function isDuringMtmWorkdayPause(moment: Date, pauses: readonly MtmWorkdayPause[]): boolean {
  const at = moment.getTime()
  return pauses.some((pause) => at > pause.from.getTime() && (pause.to === null || at < pause.to.getTime()))
}

/** Serialisable form for API responses. */
export function serializeMtmWorkdayPauses(pauses: readonly MtmWorkdayPause[]): Array<{ from: string; to: string | null }> {
  return pauses.map((pause) => ({ from: pause.from.toISOString(), to: pause.to?.toISOString() ?? null }))
}
