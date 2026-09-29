import {
  calculateWorkforceTimesheetDay,
  type WorkforceTimesheetCalculationV2,
  WorkforceTimesheetCalculationError,
} from "@/lib/workforce/timesheet-calculation"
import {
  workforcePolicySnapshotValues,
  WorkforcePolicyDefinitionError,
} from "@/lib/workforce/policy-definition"
import {
  parseWorkforceShiftDefinition,
  resolveWorkforceShiftDay,
  workforceShiftDefinitionHash,
  WorkforceShiftDefinitionError,
} from "@/lib/workforce/shift-definition"
import {
  verifyWorkforceTimesheetScheduleSnapshot,
  type WorkforceWorkdayScheduleSnapshotForCalculation,
  WorkforceTimesheetScheduleSnapshotError,
} from "@/lib/workforce/timesheet-schedule-snapshot"
import {
  replayWorkforceWorkdayFacts,
  workforceReplayMatchesWorkdayCorrectionFacts,
  type WorkforceTimeCorrectionReplayFact,
  type WorkforceWorkdayEventFact,
  WorkforceWorkdayFactsReplayError,
} from "@/lib/workforce/workday-facts-replay"
import {
  workforceWorkdayCorrectionFacts,
  type WorkforceWorkdayCorrectionFacts,
} from "@/lib/workforce/workday-correction-facts"

export type WorkforceTimesheetWorkday = {
  id: string
  agentId: string
  workDate: Date
  status: string
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
}

export type WorkforcePolicySnapshotForCalculation = {
  id: string
  workdayId: string
  agentId: string
  workDate: Date
  definition: unknown
  definitionHash: string
  expectedWorkSeconds: number
  lateGraceSeconds: number
  undertimeToleranceSeconds: number
  overtimeThresholdSeconds: number
  longPauseThresholdSeconds: number | null
}

export type WorkforceShiftSnapshotForCalculation = {
  id: string
  workdayId: string
  agentId: string
  workDate: Date
  definition: unknown
  definitionHash: string
  timezone: string
  plannedStartAt: Date
  plannedEndAt: Date
}

export type WorkforceTimesheetRehydrationResult = {
  facts: ReturnType<typeof replayWorkforceWorkdayFacts>
  calculation: WorkforceTimesheetCalculationV2
}

/** Raised when immutable inputs cannot reproduce the current workday row. */
export class WorkforceTimesheetRehydrationError extends Error {
  readonly code = "WORKFORCE_TIMESHEET_REHYDRATION_INVALID"
}

export const WORKFORCE_REHYDRATED_TIMESHEET_CALCULATION_VERSION = 2 as const

function fail(message: string): never {
  throw new WorkforceTimesheetRehydrationError(message)
}

function dateKey(name: string, value: Date): string {
  return instant(name, value).slice(0, 10)
}

function instant(name: string, value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail(`${name} must be a valid date`)
  }
  return value.toISOString()
}

function assertSnapshotIdentity(
  snapshotName: string,
  snapshot: { workdayId: string; agentId: string; workDate: Date },
  workday: WorkforceTimesheetWorkday,
  workDate: string,
): void {
  if (snapshot.workdayId !== workday.id || snapshot.agentId !== workday.agentId) {
    fail(`${snapshotName} does not belong to this workday and employee`)
  }
  if (dateKey(`${snapshotName}.workDate`, snapshot.workDate) !== workDate) {
    fail(`${snapshotName} does not belong to this workday date`)
  }
}

function assertPolicySnapshotDefinition(snapshot: WorkforcePolicySnapshotForCalculation): void {
  try {
    const values = workforcePolicySnapshotValues({
      definition: snapshot.definition,
      definitionHash: snapshot.definitionHash,
    })
    if (
      values.expectedWorkSeconds !== snapshot.expectedWorkSeconds
      || values.lateGraceSeconds !== snapshot.lateGraceSeconds
      || values.undertimeToleranceSeconds !== snapshot.undertimeToleranceSeconds
      || values.overtimeThresholdSeconds !== snapshot.overtimeThresholdSeconds
      || values.longPauseThresholdSeconds !== snapshot.longPauseThresholdSeconds
    ) {
      fail("Policy snapshot values do not match its immutable definition")
    }
  } catch (error) {
    if (error instanceof WorkforcePolicyDefinitionError) {
      fail(`Policy snapshot definition is invalid: ${error.message}`)
    }
    throw error
  }
}

function verifiedShiftDefinition(
  snapshot: WorkforceShiftSnapshotForCalculation,
  workDate: string,
) {
  try {
    const definition = parseWorkforceShiftDefinition(snapshot.definition)
    if (
      !/^[a-f0-9]{64}$/i.test(snapshot.definitionHash)
      || workforceShiftDefinitionHash(definition) !== snapshot.definitionHash.toLowerCase()
    ) {
      fail("Shift snapshot does not match its immutable definition hash")
    }
    const resolved = resolveWorkforceShiftDay({
      workDate,
      definition,
      templateTimezone: snapshot.timezone,
    })
    if (
      resolved == null
      || resolved.timezone !== snapshot.timezone
      || resolved.plannedStartAt !== instant("shiftSnapshot.plannedStartAt", snapshot.plannedStartAt)
      || resolved.plannedEndAt !== instant("shiftSnapshot.plannedEndAt", snapshot.plannedEndAt)
    ) {
      fail("Shift snapshot values do not match its immutable definition")
    }
    return definition
  } catch (error) {
    if (error instanceof WorkforceShiftDefinitionError) {
      fail(`Shift snapshot definition is invalid: ${error.message}`)
    }
    throw error
  }
}

/**
 * Rebuilds a timesheet day from records that are already immutable. It does
 * not choose a live policy, team or shift: callers must supply the snapshots
 * previously pinned to this exact workday. That lets calculation, approval and
 * export paths fail closed until the unresolved team-policy resolver exists.
 */
export function rehydrateWorkforceTimesheetDay(input: {
  asOf: Date
  workday: WorkforceTimesheetWorkday
  policySnapshot: WorkforcePolicySnapshotForCalculation
  shiftSnapshot: WorkforceShiftSnapshotForCalculation
  scheduleSnapshot: WorkforceWorkdayScheduleSnapshotForCalculation
  events: ReadonlyArray<WorkforceWorkdayEventFact>
  corrections?: ReadonlyArray<WorkforceTimeCorrectionReplayFact>
}): WorkforceTimesheetRehydrationResult {
  const workDate = dateKey("workday.workDate", input.workday.workDate)
  assertSnapshotIdentity("policy snapshot", input.policySnapshot, input.workday, workDate)
  assertSnapshotIdentity("shift snapshot", input.shiftSnapshot, input.workday, workDate)
  assertSnapshotIdentity("schedule snapshot", input.scheduleSnapshot, input.workday, workDate)
  assertPolicySnapshotDefinition(input.policySnapshot)
  const shiftDefinition = verifiedShiftDefinition(input.shiftSnapshot, workDate)

  let immutableSchedule: WorkforceTimesheetCalculationV2["immutableSchedule"]
  try {
    immutableSchedule = verifyWorkforceTimesheetScheduleSnapshot({
      snapshot: input.scheduleSnapshot,
      workDate,
      policySnapshotId: input.policySnapshot.id,
      policyDefinitionHash: input.policySnapshot.definitionHash,
      shiftSnapshotId: input.shiftSnapshot.id,
      shiftDefinitionHash: input.shiftSnapshot.definitionHash,
      shiftDefinition,
    })
  } catch (error) {
    if (error instanceof WorkforceTimesheetScheduleSnapshotError) {
      fail(`Immutable schedule snapshot is invalid: ${error.message}`)
    }
    throw error
  }

  const currentProjection: WorkforceWorkdayCorrectionFacts = workforceWorkdayCorrectionFacts(input.workday)
  let facts: ReturnType<typeof replayWorkforceWorkdayFacts>
  try {
    facts = replayWorkforceWorkdayFacts({
      workdayId: input.workday.id,
      events: input.events,
      corrections: input.corrections,
    })
  } catch (error) {
    if (error instanceof WorkforceWorkdayFactsReplayError) {
      fail(`Immutable workday journal is not replayable: ${error.message}`)
    }
    throw error
  }
  if (!workforceReplayMatchesWorkdayCorrectionFacts(facts, currentProjection)) {
    fail("Immutable workday journal does not match the current workday projection")
  }

  try {
    const coreCalculation = calculateWorkforceTimesheetDay({
      asOf: instant("asOf", input.asOf),
      schedule: {
        shiftSnapshotId: input.shiftSnapshot.id,
        workDate,
        timezone: input.shiftSnapshot.timezone,
        plannedStartAt: instant("shiftSnapshot.plannedStartAt", input.shiftSnapshot.plannedStartAt),
        plannedEndAt: instant("shiftSnapshot.plannedEndAt", input.shiftSnapshot.plannedEndAt),
      },
      policySnapshot: {
        snapshotId: input.policySnapshot.id,
        expectedWorkSeconds: input.policySnapshot.expectedWorkSeconds,
        lateGraceSeconds: input.policySnapshot.lateGraceSeconds,
        undertimeToleranceSeconds: input.policySnapshot.undertimeToleranceSeconds,
        overtimeThresholdSeconds: input.policySnapshot.overtimeThresholdSeconds,
        longPauseThresholdSeconds: input.policySnapshot.longPauseThresholdSeconds,
      },
      facts,
    })
    return {
      facts,
      calculation: {
        ...coreCalculation,
        calculationVersion: WORKFORCE_REHYDRATED_TIMESHEET_CALCULATION_VERSION,
        coreCalculationVersion: coreCalculation.calculationVersion,
        immutableSchedule,
      },
    }
  } catch (error) {
    if (error instanceof WorkforceTimesheetCalculationError) {
      fail(`Immutable Workforce snapshots cannot be calculated: ${error.message}`)
    }
    throw error
  }
}
