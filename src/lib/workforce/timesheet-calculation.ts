import { isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

export type WorkforceTimesheetStatus = "NOT_STARTED" | "STARTED" | "PAUSED" | "COMPLETED"

export type WorkforcePolicySnapshotInput = {
  /** Opaque immutable snapshot identity; this does not prescribe persistence. */
  snapshotId: string
  expectedWorkSeconds: number
  lateGraceSeconds: number
  undertimeToleranceSeconds: number
  overtimeThresholdSeconds: number
  longPauseThresholdSeconds: number | null
}

export type WorkforceShiftScheduleInput = {
  /** Identity of the resolved immutable shift snapshot, not a live template. */
  shiftSnapshotId: string
  workDate: string
  /** Audit metadata only; arithmetic uses the resolved UTC instants below. */
  timezone: string
  plannedStartAt: string
  plannedEndAt: string
}

export type WorkforceWorkdayFactsInput = {
  workdayId: string
  status: Exclude<WorkforceTimesheetStatus, "NOT_STARTED">
  startedAt: string
  completedAt: string | null
  /** Immutable event-derived intervals. A PAUSED workday has one open tail. */
  pauseIntervals: ReadonlyArray<{
    startedAt: string
    endedAt: string | null
  }>
}

export type WorkforceAttendanceExceptionType =
  | "LATE_START"
  | "UNDERTIME"
  | "OVERTIME"
  | "LONG_PAUSE"

export type WorkforceAttendanceException = {
  type: WorkforceAttendanceExceptionType
  valueSeconds: number
  thresholdSeconds: number
  excessSeconds: number
  provisional: boolean
}

export type WorkforceTimesheetCalculationInput = {
  asOf: string
  schedule: WorkforceShiftScheduleInput
  policySnapshot: WorkforcePolicySnapshotInput
  facts: WorkforceWorkdayFactsInput | null
}

export type WorkforceTimesheetCalculation = {
  calculationVersion: number
  policySnapshotId: string
  shiftSnapshotId: string
  status: WorkforceTimesheetStatus
  isFinal: boolean
  plan: {
    plannedStartAt: string
    plannedEndAt: string
    expectedWorkSeconds: number
    workDate: string
    timezone: string
  }
  fact: {
    workdayId: string | null
    startedAt: string | null
    completedAt: string | null
    workedSeconds: number
    pausedSeconds: number
    longestPauseSeconds: number
  }
  deviations: {
    lateStartSeconds: number
    undertimeSeconds: number
    overtimeSeconds: number
    longPauseSeconds: number
  }
  exceptions: WorkforceAttendanceException[]
}

export class WorkforceTimesheetCalculationError extends Error {
  readonly code = "WORKFORCE_TIMESHEET_FACTS_INVALID"
}

const SECOND_MS = 1000
export const WORKFORCE_TIMESHEET_CALCULATION_VERSION = 1
const WORKDAY_STATUSES = new Set<WorkforceWorkdayFactsInput["status"]>(["STARTED", "PAUSED", "COMPLETED"])

function instant(name: string, value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new WorkforceTimesheetCalculationError(`${name} must be a canonical UTC timestamp`)
  }
  return parsed
}

function duration(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkforceTimesheetCalculationError(`${name} must be a non-negative integer`)
  }
  return value
}

function elapsedSeconds(start: number, end: number): number {
  return Math.floor((end - start) / SECOND_MS)
}

function exception(
  type: WorkforceAttendanceExceptionType,
  valueSeconds: number,
  thresholdSeconds: number,
  provisional: boolean,
): WorkforceAttendanceException | null {
  if (valueSeconds <= thresholdSeconds) return null
  return {
    type,
    valueSeconds,
    thresholdSeconds,
    excessSeconds: valueSeconds - thresholdSeconds,
    provisional,
  }
}

/**
 * Deterministically derives one plan/fact row from immutable schedule, policy
 * snapshot and workday facts. Persistence, approval and payroll remain outside
 * this function, so an eventual schema can store the exact input and replay it.
 */
export function calculateWorkforceTimesheetDay(
  input: WorkforceTimesheetCalculationInput,
): WorkforceTimesheetCalculation {
  const asOf = instant("asOf", input.asOf)
  const plannedStart = instant("plannedStartAt", input.schedule.plannedStartAt)
  const plannedEnd = instant("plannedEndAt", input.schedule.plannedEndAt)
  if (plannedEnd <= plannedStart) {
    throw new WorkforceTimesheetCalculationError("plannedEndAt must be after plannedStartAt")
  }

  // This value is pinned by the snapshot rather than derived from elapsed UTC
  // span: a contractual DST shift may intentionally expect a different amount.
  const expectedWorkSeconds = duration("expectedWorkSeconds", input.policySnapshot.expectedWorkSeconds)
  const lateGraceSeconds = duration("lateGraceSeconds", input.policySnapshot.lateGraceSeconds)
  const undertimeToleranceSeconds = duration("undertimeToleranceSeconds", input.policySnapshot.undertimeToleranceSeconds)
  const overtimeThresholdSeconds = duration("overtimeThresholdSeconds", input.policySnapshot.overtimeThresholdSeconds)
  const longPauseThresholdSeconds = input.policySnapshot.longPauseThresholdSeconds == null
    ? null
    : duration("longPauseThresholdSeconds", input.policySnapshot.longPauseThresholdSeconds)
  if (typeof input.policySnapshot.snapshotId !== "string" || !input.policySnapshot.snapshotId.trim()) {
    throw new WorkforceTimesheetCalculationError("snapshotId is required")
  }
  if (typeof input.schedule.shiftSnapshotId !== "string" || !input.schedule.shiftSnapshotId.trim()) {
    throw new WorkforceTimesheetCalculationError("shiftSnapshotId is required")
  }
  if (!isDateKey(input.schedule.workDate)) {
    throw new WorkforceTimesheetCalculationError("workDate must be YYYY-MM-DD")
  }
  if (!isValidTimezone(input.schedule.timezone)) {
    throw new WorkforceTimesheetCalculationError("timezone audit metadata must be a valid IANA timezone")
  }

  const facts = input.facts
  let status: WorkforceTimesheetStatus = "NOT_STARTED"
  let startedAt: number | null = null
  let completedAt: number | null = null
  let pausedSeconds = 0
  let longestPauseSeconds = 0
  let workedSeconds = 0

  if (facts) {
    if (typeof facts.workdayId !== "string" || !facts.workdayId.trim()) {
      throw new WorkforceTimesheetCalculationError("workdayId is required")
    }
    if (!WORKDAY_STATUSES.has(facts.status)) {
      throw new WorkforceTimesheetCalculationError("workday status is invalid")
    }
    status = facts.status
    startedAt = instant("startedAt", facts.startedAt)
    if (startedAt > asOf) throw new WorkforceTimesheetCalculationError("startedAt cannot be after asOf")

    completedAt = facts.completedAt == null ? null : instant("completedAt", facts.completedAt)
    if (status === "COMPLETED" && completedAt == null) {
      throw new WorkforceTimesheetCalculationError("completedAt is required for a completed workday")
    }
    if (status !== "COMPLETED" && completedAt != null) {
      throw new WorkforceTimesheetCalculationError("completedAt is only valid for a completed workday")
    }

    const observationEnd = completedAt ?? asOf
    if (observationEnd < startedAt || observationEnd > asOf) {
      throw new WorkforceTimesheetCalculationError("workday timestamps are outside the calculation window")
    }

    const pauses = facts.pauseIntervals.map((pause, index) => {
      const pauseStart = instant(`pauseIntervals[${index}].startedAt`, pause.startedAt)
      const pauseEnd = pause.endedAt == null
        ? observationEnd
        : instant(`pauseIntervals[${index}].endedAt`, pause.endedAt)
      if (pauseStart < startedAt || pauseStart > observationEnd || pauseEnd < pauseStart || pauseEnd > observationEnd) {
        throw new WorkforceTimesheetCalculationError(`pauseIntervals[${index}] is outside the workday`)
      }
      return { start: pauseStart, end: pauseEnd, open: pause.endedAt == null }
    }).sort((left, right) => left.start - right.start || left.end - right.end)

    const openPauseCount = pauses.filter((pause) => pause.open).length
    if ((status === "PAUSED" && openPauseCount !== 1) || (status !== "PAUSED" && openPauseCount !== 0)) {
      throw new WorkforceTimesheetCalculationError("open pause state does not match the workday status")
    }
    for (let index = 0; index < pauses.length; index += 1) {
      const pause = pauses[index]!
      const previous = pauses[index - 1]
      if (previous && pause.start < previous.end) {
        throw new WorkforceTimesheetCalculationError("pause intervals cannot overlap")
      }
      const pauseSeconds = elapsedSeconds(pause.start, pause.end)
      pausedSeconds += pauseSeconds
      longestPauseSeconds = Math.max(longestPauseSeconds, pauseSeconds)
    }
    const totalElapsedSeconds = elapsedSeconds(startedAt, observationEnd)
    workedSeconds = totalElapsedSeconds - pausedSeconds
  }

  const lateObservation = startedAt ?? Math.min(asOf, plannedEnd)
  const lateStartSeconds = Math.max(0, elapsedSeconds(plannedStart, lateObservation))
  const assessWorkedTime = status === "COMPLETED" || asOf >= plannedEnd
  const undertimeSeconds = assessWorkedTime ? Math.max(0, expectedWorkSeconds - workedSeconds) : 0
  const overtimeSeconds = Math.max(0, workedSeconds - expectedWorkSeconds)
  const longPauseSeconds = longPauseThresholdSeconds == null
    ? 0
    : Math.max(0, longestPauseSeconds - longPauseThresholdSeconds)
  const isFinal = status === "COMPLETED"

  const exceptions = [
    exception("LATE_START", lateStartSeconds, lateGraceSeconds, startedAt == null),
    assessWorkedTime ? exception("UNDERTIME", undertimeSeconds, undertimeToleranceSeconds, !isFinal) : null,
    // Operational variance only. Payroll eligibility/authorization is outside this engine.
    exception("OVERTIME", overtimeSeconds, overtimeThresholdSeconds, !isFinal),
    longPauseThresholdSeconds == null
      ? null
      : exception("LONG_PAUSE", longestPauseSeconds, longPauseThresholdSeconds, !isFinal),
  ].filter((item): item is WorkforceAttendanceException => item != null)

  return {
    calculationVersion: WORKFORCE_TIMESHEET_CALCULATION_VERSION,
    policySnapshotId: input.policySnapshot.snapshotId,
    shiftSnapshotId: input.schedule.shiftSnapshotId,
    status,
    isFinal,
    plan: {
      plannedStartAt: input.schedule.plannedStartAt,
      plannedEndAt: input.schedule.plannedEndAt,
      expectedWorkSeconds,
      workDate: input.schedule.workDate,
      timezone: input.schedule.timezone,
    },
    fact: {
      workdayId: facts?.workdayId ?? null,
      startedAt: facts?.startedAt ?? null,
      completedAt: facts?.completedAt ?? null,
      workedSeconds,
      pausedSeconds,
      longestPauseSeconds,
    },
    deviations: {
      lateStartSeconds,
      undertimeSeconds,
      overtimeSeconds,
      longPauseSeconds,
    },
    exceptions,
  }
}
