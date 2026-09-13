import type { PrismaClient } from "@prisma/client"
import { availableWorkdayActions } from "@/lib/mtm/operational-week"
import type { MtmWorkdayAction } from "@/lib/mtm/workday"
import {
  workforceAttendancePolicyManifest,
  WorkforceAttendancePolicyError,
  type WorkforceAttendanceAction,
} from "@/lib/workforce/attendance-policy"
import {
  resolveCurrentWorkforcePolicy,
  WorkforcePolicyResolutionError,
} from "@/lib/workforce/policy-resolution"
import {
  resolveCurrentWorkforceShift,
  WorkforceShiftResolutionError,
} from "@/lib/workforce/shift-resolution"

export type WorkforceEmployeeTodayStatus = "NOT_STARTED" | "STARTED" | "PAUSED" | "COMPLETED"

export type WorkforceEmployeeTodaySegment = {
  sequence: number
  mode: string
  startTime: string
  endTime: string
  siteName: string | null
  transition: {
    state: "NOT_RECORDED" | "ARRIVED" | "DEPARTED" | "PENDING_REVIEW"
    arrivalAt: string | null
    departureAt: string | null
  }
}

export type WorkforceEmployeeTodayAssignment = {
  state: "ASSIGNED" | "NON_WORKING_DAY" | "UNAVAILABLE"
  templateName: string | null
  timezone: string
  plannedStartAt: string | null
  plannedEndAt: string | null
  segments: WorkforceEmployeeTodaySegment[]
}

export type WorkforceEmployeeTodayEvidence = {
  state: "NOT_REQUIRED" | "REQUIRED" | "UNAVAILABLE"
  methods: Array<"QR" | "TRUSTED_DEVICE" | "LOCAL_BIOMETRIC">
}

export type WorkforceEmployeeTodayAction = {
  primary: MtmWorkdayAction | null
  endpoint: "/api/v1/workforce/today/action"
  enabled: boolean
  blockedReason:
    | "PREVIOUS_WORKDAY_OPEN"
    | "NON_WORKING_DAY"
    | "ASSIGNMENT_UNAVAILABLE"
    | "WEB_PROOF_REQUIRED"
    | "POLICY_UNAVAILABLE"
    | "WORKDAY_COMPLETED"
    | null
}

export type WorkforceEmployeeTodayServerOutcome = {
  state: "APPLIED" | "PENDING_REVIEW" | "LEGACY_APPLIED"
  action: MtmWorkdayAction
  serverReceivedAt: string
  appliedAt: string
} | null

export type WorkforceEmployeeToday = {
  assignment: WorkforceEmployeeTodayAssignment
  evidence: WorkforceEmployeeTodayEvidence
  action: WorkforceEmployeeTodayAction
  serverOutcome: WorkforceEmployeeTodayServerOutcome
}

type EmployeeTodayDb = Pick<
  PrismaClient,
  | "$queryRaw"
  | "mtmAgent"
  | "mtmAgentWorkdayEvent"
  | "workforcePolicy"
  | "workforcePolicySnapshot"
  | "workforceShiftAssignment"
  | "workforceShiftDefaultAssignment"
  | "workforceShiftTeamDefaultAssignment"
  | "workforceShiftTemplate"
  | "workforceShiftSnapshot"
  | "workforceShiftSegment"
  | "workforceSiteTransition"
  | "workforceWorkdayScheduleSnapshot"
>

type EmployeeTodayWorkday = {
  id: string
  status: "STARTED" | "PAUSED" | "COMPLETED"
  workDate: Date
  startedAt: Date
}

type EmployeeTodayCalendar = {
  attendanceExpected: boolean
}

type LoadedAssignment = {
  assignment: WorkforceEmployeeTodayAssignment
  policyDefinition: unknown | null
  policyUnavailable: boolean
}

type EmployeeTodayTransition = {
  segmentId: string
  kind: "ARRIVAL" | "DEPARTURE"
  claimedAt: Date
  attendanceReviewState: "LEGACY_UNKNOWN" | "NOT_REQUIRED" | "PENDING_REVIEW"
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function workforceEmployeeSegmentTransition(
  segmentId: string,
  transitions: readonly EmployeeTodayTransition[],
): WorkforceEmployeeTodaySegment["transition"] {
  const arrival = transitions.find((transition) => transition.segmentId === segmentId && transition.kind === "ARRIVAL")
  const departure = transitions.find((transition) => transition.segmentId === segmentId && transition.kind === "DEPARTURE")
  const pendingReview = arrival?.attendanceReviewState === "PENDING_REVIEW"
    || departure?.attendanceReviewState === "PENDING_REVIEW"
  return {
    state: pendingReview ? "PENDING_REVIEW" : departure ? "DEPARTED" : arrival ? "ARRIVED" : "NOT_RECORDED",
    arrivalAt: arrival?.claimedAt.toISOString() ?? null,
    departureAt: departure?.claimedAt.toISOString() ?? null,
  }
}

function snapshotSegments(
  segments: unknown,
  sites: unknown,
  transitions: readonly EmployeeTodayTransition[],
): WorkforceEmployeeTodaySegment[] {
  if (!Array.isArray(segments)) return []
  const siteNames = new Map<string, string>()
  if (Array.isArray(sites)) {
    for (const candidate of sites) {
      const site = record(candidate)
      if (typeof site?.id === "string" && typeof site.name === "string") siteNames.set(site.id, site.name)
    }
  }
  return segments.flatMap<WorkforceEmployeeTodaySegment>((candidate) => {
    const segment = record(candidate)
    if (
      typeof segment?.sequence !== "number"
      || !Number.isSafeInteger(segment.sequence)
      || typeof segment.mode !== "string"
      || typeof segment.startTime !== "string"
      || typeof segment.endTime !== "string"
      || (segment.siteId !== null && typeof segment.siteId !== "string")
    ) return []
    return [{
      sequence: segment.sequence,
      mode: segment.mode,
      startTime: segment.startTime,
      endTime: segment.endTime,
      siteName: typeof segment.siteId === "string" ? siteNames.get(segment.siteId) ?? null : null,
      transition: typeof segment.id === "string"
        ? workforceEmployeeSegmentTransition(segment.id, transitions)
        : { state: "NOT_RECORDED", arrivalAt: null, departureAt: null },
    }]
  }).sort((left, right) => left.sequence - right.sequence)
}

function primaryAction(input: {
  status: WorkforceEmployeeTodayStatus
  plannedEndAt: string | null
  now: Date
}): MtmWorkdayAction | null {
  if (input.status === "NOT_STARTED") return "START"
  if (input.status === "COMPLETED") return null
  // A legacy active workday without a schedule must remain closable. Do not
  // trap the employee in a PAUSE/RESUME loop while honestly showing that its
  // historical assignment is unavailable.
  if (!input.plannedEndAt) return "FINISH"
  if (input.plannedEndAt && input.now.getTime() >= Date.parse(input.plannedEndAt)) return "FINISH"
  return input.status === "PAUSED" ? "RESUME" : "PAUSE"
}

export function workforceEmployeeTodayProjection(input: {
  status: WorkforceEmployeeTodayStatus
  previousOpen: boolean
  calendar: EmployeeTodayCalendar
  assignment: WorkforceEmployeeTodayAssignment
  policyDefinition: unknown | null
  policyUnavailable: boolean
  serverOutcome: WorkforceEmployeeTodayServerOutcome
  now: Date
}): WorkforceEmployeeToday {
  const primary = primaryAction({
    status: input.status,
    plannedEndAt: input.assignment.plannedEndAt,
    now: input.now,
  })
  let evidence: WorkforceEmployeeTodayEvidence
  try {
    const policy = workforceAttendancePolicyManifest(input.policyDefinition)
    const methods: WorkforceEmployeeTodayEvidence["methods"] = []
    if (primary && policy?.qrRequiredActions.includes(primary as WorkforceAttendanceAction)) methods.push("QR")
    if (primary && policy?.deviceTrustRequiredActions.includes(primary as WorkforceAttendanceAction)) methods.push("TRUSTED_DEVICE")
    if (primary && policy?.biometricRequiredActions.includes(primary as WorkforceAttendanceAction)) methods.push("LOCAL_BIOMETRIC")
    evidence = { state: methods.length > 0 ? "REQUIRED" : "NOT_REQUIRED", methods }
  } catch (error) {
    if (!(error instanceof WorkforceAttendancePolicyError)) throw error
    evidence = { state: "UNAVAILABLE", methods: [] }
  }

  let blockedReason: WorkforceEmployeeTodayAction["blockedReason"] = null
  if (input.status === "COMPLETED") blockedReason = "WORKDAY_COMPLETED"
  else if (input.previousOpen && input.status === "NOT_STARTED") blockedReason = "PREVIOUS_WORKDAY_OPEN"
  else if (!input.calendar.attendanceExpected && input.status === "NOT_STARTED") blockedReason = "NON_WORKING_DAY"
  else if (input.assignment.state === "UNAVAILABLE" && input.status === "NOT_STARTED") blockedReason = "ASSIGNMENT_UNAVAILABLE"
  else if (input.assignment.state === "NON_WORKING_DAY" && input.status === "NOT_STARTED") blockedReason = "NON_WORKING_DAY"
  else if (input.policyUnavailable || evidence.state === "UNAVAILABLE") blockedReason = "POLICY_UNAVAILABLE"
  else if (evidence.state === "REQUIRED") blockedReason = "WEB_PROOF_REQUIRED"

  const canonicalActions = availableWorkdayActions(input.status === "NOT_STARTED" ? null : input.status)
  const enabled = primary != null && blockedReason == null && canonicalActions.includes(primary)
  return {
    assignment: input.assignment,
    evidence,
    action: {
      primary,
      endpoint: "/api/v1/workforce/today/action",
      enabled,
      blockedReason,
    },
    serverOutcome: input.serverOutcome,
  }
}

async function activeAssignment(
  db: EmployeeTodayDb,
  input: { organizationId: string; agentId: string; workday: EmployeeTodayWorkday; timezone: string; now: Date },
): Promise<LoadedAssignment> {
  const [shift, schedule, policy, transitions] = await Promise.all([
    db.workforceShiftSnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workdayId: input.workday.id,
      },
      select: {
        timezone: true,
        plannedStartAt: true,
        plannedEndAt: true,
        template: { select: { name: true } },
      },
    }),
    db.workforceWorkdayScheduleSnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workdayId: input.workday.id,
      },
      select: { segments: true, sites: true },
    }),
    db.workforcePolicySnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workdayId: input.workday.id,
      },
      select: { definition: true },
    }),
    db.workforceSiteTransition.findMany({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workdayId: input.workday.id,
      },
      orderBy: [{ claimedAt: "asc" }, { id: "asc" }],
      select: {
        segmentId: true,
        kind: true,
        claimedAt: true,
        attendanceReviewState: true,
      },
    }),
  ])
  let policyDefinition: unknown | null = policy?.definition ?? null
  let policyUnavailable = false
  if (!policy) {
    try {
      const historicalPolicy = await resolveCurrentWorkforcePolicy(db, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workDate: input.workday.workDate.toISOString().slice(0, 10),
        workdayStartedAt: input.workday.startedAt,
        resolutionAt: input.now,
      })
      policyDefinition = historicalPolicy.definition
    } catch (error) {
      if (!(error instanceof WorkforcePolicyResolutionError)) throw error
      if (error.code !== "WORKFORCE_POLICY_MISSING") policyUnavailable = true
    }
  }
  if (!shift || !schedule) {
    return {
      assignment: {
        state: "UNAVAILABLE",
        templateName: null,
        timezone: input.timezone,
        plannedStartAt: null,
        plannedEndAt: null,
        segments: [],
      },
      policyDefinition,
      policyUnavailable,
    }
  }
  return {
    assignment: {
      state: "ASSIGNED",
      templateName: shift.template.name,
      timezone: shift.timezone,
      plannedStartAt: shift.plannedStartAt.toISOString(),
      plannedEndAt: shift.plannedEndAt.toISOString(),
      segments: snapshotSegments(schedule.segments, schedule.sites, transitions),
    },
    policyDefinition,
    policyUnavailable,
  }
}

async function plannedAssignment(
  db: EmployeeTodayDb,
  input: { organizationId: string; agentId: string; date: string; timezone: string; now: Date },
): Promise<LoadedAssignment> {
  let policyDefinition: unknown | null = null
  let policyUnavailable = false
  try {
    const policy = await resolveCurrentWorkforcePolicy(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      workDate: input.date,
      workdayStartedAt: input.now,
      resolutionAt: input.now,
    })
    policyDefinition = policy.definition
  } catch (error) {
    if (!(error instanceof WorkforcePolicyResolutionError)) throw error
    if (error.code !== "WORKFORCE_POLICY_MISSING") policyUnavailable = true
  }

  try {
    const shift = await resolveCurrentWorkforceShift(db, {
      organizationId: input.organizationId,
      agentId: input.agentId,
      workDate: input.date,
      workdayStartedAt: input.now,
      resolutionAt: input.now,
    })
    if (!shift.schedule) {
      return {
        assignment: {
          state: "NON_WORKING_DAY",
          templateName: shift.name,
          timezone: shift.timezone,
          plannedStartAt: null,
          plannedEndAt: null,
          segments: [],
        },
        policyDefinition,
        policyUnavailable,
      }
    }
    const segments = await db.workforceShiftSegment.findMany({
      where: { organizationId: input.organizationId, templateId: shift.id },
      orderBy: { sequence: "asc" },
      select: {
        sequence: true,
        mode: true,
        startTime: true,
        endTime: true,
        site: { select: { name: true } },
      },
    })
    return {
      assignment: {
        state: "ASSIGNED",
        templateName: shift.name,
        timezone: shift.timezone,
        plannedStartAt: shift.schedule.plannedStartAt,
        plannedEndAt: shift.schedule.plannedEndAt,
        segments: segments.map((segment) => ({
          sequence: segment.sequence,
          mode: segment.mode,
          startTime: segment.startTime,
          endTime: segment.endTime,
          siteName: segment.site?.name ?? null,
          transition: {
            state: "NOT_RECORDED",
            arrivalAt: null,
            departureAt: null,
          },
        })),
      },
      policyDefinition,
      policyUnavailable,
    }
  } catch (error) {
    if (!(error instanceof WorkforceShiftResolutionError)) throw error
    return {
      assignment: {
        state: "UNAVAILABLE",
        templateName: null,
        timezone: input.timezone,
        plannedStartAt: null,
        plannedEndAt: null,
        segments: [],
      },
      policyDefinition,
      policyUnavailable,
    }
  }
}

export async function loadWorkforceEmployeeToday(
  db: EmployeeTodayDb,
  input: {
    organizationId: string
    agentId: string
    date: string
    timezone: string
    status: WorkforceEmployeeTodayStatus
    workday: EmployeeTodayWorkday | null
    previousOpen: boolean
    calendar: EmployeeTodayCalendar
    now?: Date
  },
): Promise<WorkforceEmployeeToday> {
  const now = input.now ?? new Date()
  const loaded = input.workday
    ? await activeAssignment(db, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        workday: input.workday,
        timezone: input.timezone,
        now,
      })
    : await plannedAssignment(db, {
        organizationId: input.organizationId,
        agentId: input.agentId,
        date: input.date,
        timezone: input.timezone,
        now,
      })
  const lastEvent = input.workday
    ? await db.mtmAgentWorkdayEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          workdayId: input.workday.id,
        },
        orderBy: [{ appliedAt: "desc" }, { id: "desc" }],
        select: {
          type: true,
          attendanceReviewState: true,
          serverReceivedAt: true,
          appliedAt: true,
        },
      })
    : null
  const serverOutcome: WorkforceEmployeeTodayServerOutcome = lastEvent
    && lastEvent.serverReceivedAt
    && lastEvent.appliedAt
    && (lastEvent.type === "START" || lastEvent.type === "PAUSE" || lastEvent.type === "RESUME" || lastEvent.type === "FINISH")
    ? {
        state: lastEvent.attendanceReviewState === "PENDING_REVIEW"
          ? "PENDING_REVIEW"
          : lastEvent.attendanceReviewState === "LEGACY_UNKNOWN" || lastEvent.attendanceReviewState == null
            ? "LEGACY_APPLIED"
            : "APPLIED",
        action: lastEvent.type,
        serverReceivedAt: lastEvent.serverReceivedAt.toISOString(),
        appliedAt: lastEvent.appliedAt.toISOString(),
      }
    : null
  return workforceEmployeeTodayProjection({
    status: input.status,
    previousOpen: input.previousOpen,
    calendar: input.calendar,
    assignment: loaded.assignment,
    policyDefinition: loaded.policyDefinition,
    policyUnavailable: loaded.policyUnavailable,
    serverOutcome,
    now,
  })
}
