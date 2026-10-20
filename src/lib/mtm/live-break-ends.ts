import { prisma } from "@/lib/prisma"
import {
  MTM_WORKDAY_PAUSE_EVENT_TYPES,
  mtmLastBreakEndedAt,
  mtmWorkdayPauses,
  type MtmWorkdayPauseEvent,
} from "@/lib/mtm/workday-pauses"

/** A row of mtm_agent_workdays as far as this reads it. */
export interface MtmBreakEndsWorkday {
  id: string
  status: string
  totalPausedSeconds?: number | null
}

/**
 * When the latest break of each running shift ended, by workday id — what
 * isMtmPositionHeldByBreak (mtm-types.ts) needs to say whether the newest
 * point is a position at work or still the one left before the break. Asked
 * by every server reader that calls a coordinate live: the managers' roster
 * (GET /api/v1/mtm/locations), the manager's phone (GET
 * /api/v1/mtm/mobile/manager/locations) and the agent's week (GET
 * /api/v1/mtm/week).
 *
 * The workday row keeps only the running break and the sum of the past ones,
 * so the journal is read, with the one reader of what a break is
 * (workday-pauses.ts). Only for a shift that is running (STARTED) and has
 * had a break: the row's own sum is above zero exactly then — RESUME and a
 * FINISH from a break add to it, a REOPEN's gap is added at the RESUME after
 * it, and a correction recomputes it from the closed breaks. A paused shift
 * needs nothing here (all its points are from before the break), and nor
 * does a closed one. One statement for all of them, by the journal's own
 * (workdayId, occurredAt) index; none at all when nobody has come back from
 * a break.
 *
 * Called INSIDE the organization's scope; the statement names the
 * organization itself. Server only: it reads the database.
 */
export async function readMtmLastBreakEnds(input: {
  organizationId: string
  workdays: Iterable<MtmBreakEndsWorkday | null | undefined>
}): Promise<Map<string, Date>> {
  const ids = new Set<string>()
  for (const workday of input.workdays) {
    if (workday && workday.status === "STARTED" && (workday.totalPausedSeconds ?? 0) > 0) ids.add(workday.id)
  }
  const ends = new Map<string, Date>()
  if (ids.size === 0) return ends
  // Typed where it is read: the database client is untyped here.
  const events: Array<MtmWorkdayPauseEvent & { workdayId: string }> = await prisma.mtmAgentWorkdayEvent.findMany({
    where: { organizationId: input.organizationId, workdayId: { in: [...ids] }, type: { in: [...MTM_WORKDAY_PAUSE_EVENT_TYPES] } },
    select: { workdayId: true, type: true, occurredAt: true, appliedAt: true },
  })
  const journals = new Map<string, MtmWorkdayPauseEvent[]>()
  for (const event of events ?? []) {
    if (!ids.has(event.workdayId)) continue
    const journal = journals.get(event.workdayId) ?? []
    journal.push(event)
    journals.set(event.workdayId, journal)
  }
  for (const [workdayId, journal] of journals) {
    const ended = mtmLastBreakEndedAt(mtmWorkdayPauses(journal))
    if (ended) ends.set(workdayId, ended)
  }
  return ends
}
