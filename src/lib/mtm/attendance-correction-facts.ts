// Server-only adapter: the pure report and its client consumers must not import
// replay's retained workday state machine (which uses node:crypto).
import type { MtmAttendanceCorrection, MtmAttendanceCorrectionProjection } from "@/lib/mtm/attendance-report"
import { AttendanceCorrectionBasisSchema } from "@/lib/mtm/attendance-request-contract"
import { mtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import { workforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"
import { clipWorkdayPauseIntervals, replayWorkforceWorkdayFacts, workforceReplayMatchesWorkdayCorrectionFacts, workforceWorkdayEventFact } from "@/lib/workforce/workday-facts-replay"

type CorrectionRecord = { id: string; requestId: string | null; source: string; occurredAt: Date; beforeFacts: unknown; afterFacts: unknown; actorUser: { id: string; name: string | null } }
type CorrectionWorkday = Parameters<typeof workforceWorkdayCorrectionFacts>[0] & {
  events: Array<Parameters<typeof workforceWorkdayEventFact>[0]>
}

/** Prove current columns from immutable facts; malformed history yields unknown time. */
export function projectAttendanceCorrectionFacts(workday: CorrectionWorkday, corrections: readonly CorrectionRecord[], now: Date): MtmAttendanceCorrectionProjection | undefined {
  if (!corrections.length) return undefined
  try {
    const replayed = replayWorkforceWorkdayFacts({ workdayId: workday.id, events: workday.events.map(workforceWorkdayEventFact), corrections })
    const facts = workforceWorkdayCorrectionFacts(workday)
    if (!workforceReplayMatchesWorkdayCorrectionFacts(replayed, facts)) return { valid: false }
    const byId = new Map(corrections.map((correction) => [correction.id, correction]))
    // Exactly one parser for real pause events. Only a ledger-backed closure
    // may close its last open interval; later boundary amendments do not move
    // that historical closure to the newest finish time.
    const pauses = mtmWorkdayPauses(workday.events)
    const history: MtmAttendanceCorrection[] = []
    for (const id of replayed.correctionIds) {
      const correction = byId.get(id)!
      const beforeValue = correction.beforeFacts as { kind?: unknown } | null
      const before = AttendanceCorrectionBasisSchema.parse(beforeValue?.kind === "MISSING" ? beforeValue : { kind: "WORKDAY", facts: beforeValue })
      const afterBasis = AttendanceCorrectionBasisSchema.parse({ kind: "WORKDAY", facts: correction.afterFacts })
      if (afterBasis.kind !== "WORKDAY" || (correction.source !== "REQUEST_APPROVAL" && correction.source !== "DIRECT_MANAGER")
        || !correction.actorUser.id || !Number.isFinite(correction.occurredAt.getTime()) || correction.occurredAt > now) return { valid: false }
      const after = afterBasis.facts
      if (before.kind === "WORKDAY" && before.facts.status === "PAUSED" && after.status === "COMPLETED") {
        const open = pauses.filter((pause) => pause.to === null)
        if (open.length !== 1 || after.completedAt === null) return { valid: false }
        open[0].to = new Date(after.completedAt)
      }
      history.push({ id: correction.id, requestId: correction.requestId, source: correction.source, occurredAt: correction.occurredAt.toISOString(),
        reviewer: { id: correction.actorUser.id, name: correction.actorUser.name }, before, after })
    }
    // A corrected day ends where its correction says: marks outside its start–finish
    // stay in the journal, not in its time (owner, 2026-10-18) — the replay's own rule.
    const inside = clipWorkdayPauseIntervals(pauses.map((pause) => ({ startedAt: pause.from.toISOString(), endedAt: pause.to?.toISOString() ?? null })),
      facts.startedAt, facts.status === "COMPLETED" ? facts.completedAt : null).map((pause) => ({ from: new Date(pause.startedAt), to: pause.endedAt === null ? null : new Date(pause.endedAt) }))
    const closedSeconds = inside.reduce((total, pause) => total + (pause.to === null ? 0 : Math.floor((pause.to.getTime() - pause.from.getTime()) / 1000)), 0)
    if (closedSeconds !== facts.totalPausedSeconds || inside.some((pause) => pause.from < new Date(facts.startedAt)
      || (pause.to !== null && (pause.to < pause.from || (facts.completedAt !== null && pause.to > new Date(facts.completedAt)))))
      || (facts.status === "COMPLETED" && inside.some((pause) => pause.to === null))) return { valid: false }
    return { valid: true, facts, pauseIntervals: inside.map((pause) => ({ startedAt: pause.from.toISOString(), endedAt: pause.to?.toISOString() ?? null })), history }
  } catch { return { valid: false } }
}
