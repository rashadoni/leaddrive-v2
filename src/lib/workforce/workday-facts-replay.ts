import { isDateKey } from "@/lib/mtm/mobile-week"
import type { WorkforceWorkdayFactsInput } from "@/lib/workforce/timesheet-calculation"
import type { WorkforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"

export type WorkforceWorkdayEventFact = {
  /** Stable event identity from the canonical append-only workday journal. */
  id: string
  type: "START" | "PAUSE" | "RESUME" | "FINISH"
  /** Canonical UTC instant, never a device-local timestamp. */
  occurredAt: string
}

/** Immutable ledger row fields needed to reconstruct a corrected workday. */
export type WorkforceTimeCorrectionReplayFact = {
  id: string
  beforeFacts: unknown
  afterFacts: unknown
}

export type WorkforceReplayedWorkdayFacts = WorkforceWorkdayFactsInput & {
  /** Projection fields pinned alongside the event-derived pause intervals. */
  pausedAt: string | null
  totalPausedSeconds: number
  /** Exact journal events used to derive the initial facts, in replay order. */
  eventIds: readonly string[]
  /** Immutable correction records applied after the journal, in chain order. */
  correctionIds: readonly string[]
}

/**
 * Confirms that the facts reconstructed from the immutable journal are still
 * the mutable workday projection about to be changed.  A mismatch means the
 * next correction would extend an already-broken chain, so callers must stop
 * before appending a new immutable ledger row.
 */
export function workforceReplayMatchesWorkdayCorrectionFacts(
  replayed: WorkforceReplayedWorkdayFacts,
  workday: WorkforceWorkdayCorrectionFacts,
): boolean {
  return replayed.workdayId === workday.id
    && replayed.status === workday.status
    && replayed.startedAt === workday.startedAt
    && replayed.pausedAt === workday.pausedAt
    && replayed.completedAt === workday.completedAt
    && replayed.totalPausedSeconds === workday.totalPausedSeconds
}

export class WorkforceWorkdayFactsReplayError extends Error {
  readonly code = "WORKFORCE_WORKDAY_EVENTS_AMBIGUOUS"
}

const EVENT_TYPES = new Set<WorkforceWorkdayEventFact["type"]>([
  "START",
  "PAUSE",
  "RESUME",
  "FINISH",
])
const WORKDAY_STATUSES = new Set<WorkforceWorkdayCorrectionFacts["status"]>([
  "STARTED",
  "PAUSED",
  "COMPLETED",
])

type ReplayProjection = Omit<WorkforceWorkdayCorrectionFacts, "workDate"> & {
  /** Raw legacy journal predates the WorkdayCorrectionFacts workDate field. */
  workDate: string | null
}

type ReplayedState = {
  projection: ReplayProjection
  pauseIntervals: Array<{ startedAt: string; endedAt: string | null }>
}

function fail(message: string): never {
  throw new WorkforceWorkdayFactsReplayError(message)
}

function nonBlank(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail(`${name} is required`)
  return value
}

function canonicalUtcInstant(name: string, value: unknown): string {
  const text = nonBlank(name, value)
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) {
    fail(`${name} must be a canonical UTC timestamp`)
  }
  return text
}

function instantMs(name: string, value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) fail(`${name} must be a canonical UTC timestamp`)
  return parsed
}

function nullableCanonicalUtcInstant(name: string, value: unknown): string | null {
  if (value == null) return null
  return canonicalUtcInstant(name, value)
}

function nonNegativeInteger(name: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${name} must be a non-negative integer`)
  }
  return value as number
}

function correctionFacts(
  name: string,
  value: unknown,
  workdayId: string,
): WorkforceWorkdayCorrectionFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`)
  }
  const facts = value as Record<string, unknown>
  const id = nonBlank(`${name}.id`, facts.id)
  if (id !== workdayId) fail(`${name}.id must match workdayId`)
  const workDate = nonBlank(`${name}.workDate`, facts.workDate)
  if (!isDateKey(workDate)) fail(`${name}.workDate must be YYYY-MM-DD`)
  const status = facts.status
  if (typeof status !== "string" || !WORKDAY_STATUSES.has(status as WorkforceWorkdayCorrectionFacts["status"])) {
    fail(`${name}.status is invalid`)
  }
  const startedAt = canonicalUtcInstant(`${name}.startedAt`, facts.startedAt)
  const pausedAt = nullableCanonicalUtcInstant(`${name}.pausedAt`, facts.pausedAt)
  const completedAt = nullableCanonicalUtcInstant(`${name}.completedAt`, facts.completedAt)
  const totalPausedSeconds = nonNegativeInteger(`${name}.totalPausedSeconds`, facts.totalPausedSeconds)

  if (completedAt != null && instantMs(`${name}.completedAt`, completedAt) <= instantMs(`${name}.startedAt`, startedAt)) {
    fail(`${name}.completedAt must be after startedAt`)
  }
  if (pausedAt != null && instantMs(`${name}.pausedAt`, pausedAt) < instantMs(`${name}.startedAt`, startedAt)) {
    fail(`${name}.pausedAt cannot precede startedAt`)
  }
  if (pausedAt != null && completedAt != null && instantMs(`${name}.pausedAt`, pausedAt) > instantMs(`${name}.completedAt`, completedAt)) {
    fail(`${name}.pausedAt cannot follow completedAt`)
  }
  if (status === "COMPLETED" && (pausedAt != null || completedAt == null)) {
    fail(`${name} completed status must have a finish and no open pause`)
  }
  if (status === "PAUSED" && (pausedAt == null || completedAt != null)) {
    fail(`${name} paused status must have an open pause and no finish`)
  }
  if (status === "STARTED" && (pausedAt != null || completedAt != null)) {
    fail(`${name} started status cannot have pause or finish timestamps`)
  }

  return {
    id,
    workDate,
    status: status as WorkforceWorkdayCorrectionFacts["status"],
    startedAt,
    pausedAt,
    completedAt,
    totalPausedSeconds,
  }
}

function closedPauseSeconds(intervals: ReadonlyArray<{ startedAt: string; endedAt: string | null }>): number {
  return intervals.reduce((total, interval) => {
    if (interval.endedAt == null) return total
    return total + Math.floor((instantMs("pause endedAt", interval.endedAt) - instantMs("pause startedAt", interval.startedAt)) / 1000)
  }, 0)
}

function projectionMatchesFacts(
  projection: ReplayProjection,
  facts: WorkforceWorkdayCorrectionFacts,
): boolean {
  return projection.id === facts.id
    && (projection.workDate == null || projection.workDate === facts.workDate)
    && projection.status === facts.status
    && projection.startedAt === facts.startedAt
    && projection.pausedAt === facts.pausedAt
    && projection.completedAt === facts.completedAt
    && projection.totalPausedSeconds === facts.totalPausedSeconds
}

function assertProjectionMatchesIntervals(state: ReplayedState): void {
  const { projection, pauseIntervals } = state
  const start = instantMs("startedAt", projection.startedAt)
  const end = projection.completedAt == null ? null : instantMs("completedAt", projection.completedAt)
  const open = pauseIntervals.filter((interval) => interval.endedAt == null)

  if ((projection.status === "PAUSED" && open.length !== 1) || (projection.status !== "PAUSED" && open.length !== 0)) {
    fail("workday pause intervals do not match its status")
  }
  if (projection.status === "PAUSED" && open[0]?.startedAt !== projection.pausedAt) {
    fail("workday pausedAt does not match its open pause interval")
  }
  if (projection.status === "COMPLETED" && end == null) fail("completed workday is missing completedAt")
  if (projection.status !== "COMPLETED" && end != null) fail("open workday cannot have completedAt")

  for (const interval of pauseIntervals) {
    const pauseStart = instantMs("pause startedAt", interval.startedAt)
    const pauseEnd = interval.endedAt == null ? end : instantMs("pause endedAt", interval.endedAt)
    if (pauseStart < start || (pauseEnd != null && (pauseEnd < pauseStart || (end != null && pauseEnd > end)))) {
      fail("pause interval is outside corrected workday boundaries")
    }
  }
  if (closedPauseSeconds(pauseIntervals) !== projection.totalPausedSeconds) {
    fail("workday totalPausedSeconds does not match the immutable pause journal")
  }
}

function assertCorrectionTransition(
  before: WorkforceWorkdayCorrectionFacts,
  after: WorkforceWorkdayCorrectionFacts,
): void {
  if (before.id !== after.id || before.workDate !== after.workDate) {
    fail("workday correction cannot change identity")
  }
  if (before.status === "COMPLETED" && after.status !== "COMPLETED") {
    fail("completed workday correction cannot reopen the shift")
  }
  if (before.status === "STARTED" && after.status !== "STARTED" && after.status !== "COMPLETED") {
    fail("workday correction cannot change a running shift to paused")
  }
  if (before.status === "PAUSED" && after.status !== "PAUSED" && after.status !== "COMPLETED") {
    fail("workday correction cannot change a paused shift to running")
  }
  if (before.status === "PAUSED" && after.status === "PAUSED" && before.pausedAt !== after.pausedAt) {
    fail("workday correction cannot move an open pause")
  }
}

function applyCorrection(
  state: ReplayedState,
  before: WorkforceWorkdayCorrectionFacts,
  after: WorkforceWorkdayCorrectionFacts,
): ReplayedState {
  if (!projectionMatchesFacts(state.projection, before)) {
    fail("workday correction beforeFacts do not match the prior immutable facts")
  }
  assertCorrectionTransition(before, after)

  const pauseIntervals = state.pauseIntervals.map((interval) => ({ ...interval }))
  if (state.projection.status === "PAUSED" && after.status === "COMPLETED") {
    const openIndex = pauseIntervals.findIndex((interval) => interval.endedAt == null)
    if (openIndex < 0 || after.completedAt == null) fail("paused correction cannot close a missing pause")
    pauseIntervals[openIndex] = { ...pauseIntervals[openIndex]!, endedAt: after.completedAt }
  }

  const next: ReplayedState = {
    projection: { ...after },
    pauseIntervals,
  }
  assertProjectionMatchesIntervals(next)
  return next
}

function replayJournal(input: {
  workdayId: string
  events: ReadonlyArray<WorkforceWorkdayEventFact>
}): { state: ReplayedState; eventIds: string[] } {
  if (input.events.length === 0) fail("at least one workday event is required")

  let status: "NOT_STARTED" | "STARTED" | "PAUSED" | "COMPLETED" = "NOT_STARTED"
  let startedAt: string | null = null
  let completedAt: string | null = null
  let pauseStartedAt: string | null = null
  let previousOccurredAt = Number.NEGATIVE_INFINITY
  const eventIds = new Set<string>()
  const pauseIntervals: Array<{ startedAt: string; endedAt: string | null }> = []

  for (const [index, event] of input.events.entries()) {
    const eventId = nonBlank(`events[${index}].id`, event.id)
    if (eventIds.has(eventId)) fail(`events[${index}].id is duplicated`)
    eventIds.add(eventId)
    if (!EVENT_TYPES.has(event.type)) fail(`events[${index}].type is invalid`)
    const occurredAt = canonicalUtcInstant(`events[${index}].occurredAt`, event.occurredAt)
    const occurredAtMs = instantMs(`events[${index}].occurredAt`, occurredAt)
    if (occurredAtMs <= previousOccurredAt) fail("workday events must be in strict chronological order")
    previousOccurredAt = occurredAtMs

    switch (event.type) {
      case "START":
        if (status !== "NOT_STARTED") fail("START is only valid for a not-started workday")
        status = "STARTED"
        startedAt = occurredAt
        break
      case "PAUSE":
        if (status !== "STARTED") fail("PAUSE is only valid for a started workday")
        status = "PAUSED"
        pauseStartedAt = occurredAt
        break
      case "RESUME":
        if (status !== "PAUSED" || pauseStartedAt == null) fail("RESUME is only valid for a paused workday")
        pauseIntervals.push({ startedAt: pauseStartedAt, endedAt: occurredAt })
        pauseStartedAt = null
        status = "STARTED"
        break
      case "FINISH":
        if (status === "PAUSED" && pauseStartedAt != null) {
          pauseIntervals.push({ startedAt: pauseStartedAt, endedAt: occurredAt })
          pauseStartedAt = null
        } else if (status !== "STARTED") {
          fail("FINISH is only valid for a started or paused workday")
        }
        completedAt = occurredAt
        status = "COMPLETED"
        break
    }
  }

  if (startedAt == null || status === "NOT_STARTED") fail("workday is missing START")
  const replayStatus: Exclude<typeof status, "NOT_STARTED"> = status
  if (replayStatus === "PAUSED") {
    if (pauseStartedAt == null) fail("paused workday is missing its open pause")
    pauseIntervals.push({ startedAt: pauseStartedAt, endedAt: null })
  }

  const projection: ReplayProjection = {
    id: input.workdayId,
    workDate: null,
    status: replayStatus,
    startedAt,
    pausedAt: replayStatus === "PAUSED" ? pauseStartedAt : null,
    completedAt,
    totalPausedSeconds: closedPauseSeconds(pauseIntervals),
  }
  const state = { projection, pauseIntervals }
  assertProjectionMatchesIntervals(state)
  return { state, eventIds: [...eventIds] }
}

/**
 * Derives calculator facts from the append-only state-machine journal and its
 * immutable correction chain. A correction never masquerades as a second
 * legacy START/FINISH event: its beforeFacts must match the prior state, then
 * its afterFacts become the next reproducible state. The chain is inferred
 * from those immutable links rather than caller-supplied ordering.
 */
export function replayWorkforceWorkdayFacts(input: {
  workdayId: string
  events: ReadonlyArray<WorkforceWorkdayEventFact>
  corrections?: ReadonlyArray<WorkforceTimeCorrectionReplayFact>
}): WorkforceReplayedWorkdayFacts {
  const workdayId = nonBlank("workdayId", input.workdayId)
  const journal = replayJournal({ workdayId, events: input.events })
  let state = journal.state
  const correctionIds = new Set<string>()
  const pending = (input.corrections ?? []).map((correction, index) => {
    const id = nonBlank(`corrections[${index}].id`, correction.id)
    if (correctionIds.has(id)) fail(`corrections[${index}].id is duplicated`)
    correctionIds.add(id)
    return {
      id,
      before: correctionFacts(`corrections[${index}].beforeFacts`, correction.beforeFacts, workdayId),
      after: correctionFacts(`corrections[${index}].afterFacts`, correction.afterFacts, workdayId),
    }
  })
  const appliedCorrectionIds: string[] = []

  while (pending.length > 0) {
    const matches = pending.filter((correction) => projectionMatchesFacts(state.projection, correction.before))
    if (matches.length !== 1) {
      fail("workday correction ledger must form one unambiguous before/after chain")
    }
    const correction = matches[0]!
    state = applyCorrection(state, correction.before, correction.after)
    appliedCorrectionIds.push(correction.id)
    pending.splice(pending.indexOf(correction), 1)
  }

  return {
    workdayId,
    status: state.projection.status,
    startedAt: state.projection.startedAt,
    pausedAt: state.projection.pausedAt,
    completedAt: state.projection.completedAt,
    totalPausedSeconds: state.projection.totalPausedSeconds,
    pauseIntervals: state.pauseIntervals,
    eventIds: journal.eventIds,
    correctionIds: appliedCorrectionIds,
  }
}
