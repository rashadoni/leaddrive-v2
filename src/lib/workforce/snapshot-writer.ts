import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  WorkforcePolicyDefinitionError,
  canonicalWorkforcePolicyJson,
  workforcePolicySnapshotValues,
} from "@/lib/workforce/policy-definition"
import {
  resolveCurrentWorkforcePolicy,
  WorkforcePolicyResolutionError,
} from "@/lib/workforce/policy-resolution"
import { WorkforceShiftDefinitionError } from "@/lib/workforce/shift-definition"
import {
  resolveCurrentWorkforceShift,
  WorkforceShiftResolutionError,
} from "@/lib/workforce/shift-resolution"
import { resolvePersistedWorkforceCalendarDay } from "@/lib/workforce/calendar"

export type WorkforceSnapshotWriteResult =
  | { kind: "created"; policySnapshotId: string; shiftSnapshotId: string; scheduleSnapshotId: string }
  | { kind: "already_present"; policySnapshotId: string; shiftSnapshotId: string; scheduleSnapshotId: string }
  /** Existing H3 pairs are retained as history and never reconstructed from live configuration. */
  | { kind: "legacy_pair"; policySnapshotId: string; shiftSnapshotId: string }
  | { kind: "off_day"; workdayId: string }

export type WorkforceSnapshotWriteAttemptResult = WorkforceSnapshotWriteResult | {
  /** The tenant has not completed the optional H3 setup, so legacy workday
   * semantics remain available and the resulting day is not approval-ready. */
  kind: "not_ready"
  reason: "POLICY_MISSING" | "SHIFT_MISSING" | "POLICY_DEFINITION_INVALID" | "SHIFT_DEFINITION_INVALID"
}

export type WorkforceSnapshotSourceWorkday = {
  id: string
  agentId: string
  workDate: Date
  startedAt: Date
}

export type WorkforceSnapshotWriteInput = {
  organizationId: string
  workdayId: string
  templateId?: string
  resolutionAt?: Date
}

export class WorkforceSnapshotWriterError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SNAPSHOT_WORKDAY_NOT_FOUND"
      | "WORKFORCE_SNAPSHOT_PARTIAL",
    message: string = code,
  ) {
    super(message)
  }
}

function dateKey(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new WorkforceSnapshotWriterError("WORKFORCE_SNAPSHOT_PARTIAL", "Workforce snapshot date is invalid")
  }
  return value.toISOString().slice(0, 10)
}

/** Canonical hash makes the JSON schedule context tamper-evident in audits/exports. */
export function workforceWorkdayScheduleSnapshotHash(value: unknown): string {
  return createHash("sha256").update(canonicalWorkforcePolicyJson(value)).digest("hex")
}

async function snapshotShiftSegmentsAndSites(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; agentId: string; templateId: string; workDate: string },
): Promise<{ segments: Prisma.InputJsonValue; sites: Prisma.InputJsonValue }> {
  const segments = await tx.workforceShiftSegment.findMany({
    where: { organizationId: input.organizationId, templateId: input.templateId },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      mode: true,
      siteId: true,
      startTime: true,
      endTime: true,
      lateGraceSeconds: true,
      proofPolicyReference: true,
    },
  })
  const siteIds = [...new Set(segments.flatMap((segment) => segment.siteId == null ? [] : [segment.siteId]))]
  if (siteIds.length === 0) {
    return {
      segments: segments as unknown as Prisma.InputJsonValue,
      sites: [] as Prisma.InputJsonValue,
    }
  }

  const workDate = new Date(`${input.workDate}T00:00:00.000Z`)
  const [sites, revisions, eligibilityAssignments] = await Promise.all([
    tx.workforceSite.findMany({
      where: { organizationId: input.organizationId, id: { in: siteIds }, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        timezone: true,
        addressLabel: true,
      },
    }),
    tx.workforceSiteGeofenceRevision.findMany({
      where: {
        organizationId: input.organizationId,
        siteId: { in: siteIds },
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      orderBy: [{ siteId: "asc" }, { revision: "asc" }],
      select: {
        id: true,
        siteId: true,
        revision: true,
        kind: true,
        centerLatitude: true,
        centerLongitude: true,
        radiusMeters: true,
        calibrationReference: true,
        definitionHash: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    tx.workforceSiteAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        siteId: { in: siteIds },
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      orderBy: [{ siteId: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }],
      select: {
        id: true,
        siteId: true,
        kind: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
  ])
  if (sites.length !== siteIds.length || revisions.length > siteIds.length) {
    throw new WorkforceSnapshotWriterError(
      "WORKFORCE_SNAPSHOT_PARTIAL",
      "Every scheduled Workforce site must be active with at most one effective geofence revision",
    )
  }
  const revisionBySiteId = new Map(revisions.map((revision) => [revision.siteId, revision]))
  const eligibilityBySiteId = new Map<string, typeof eligibilityAssignments>()
  for (const assignment of eligibilityAssignments) {
    const assignments = eligibilityBySiteId.get(assignment.siteId) ?? []
    assignments.push(assignment)
    eligibilityBySiteId.set(assignment.siteId, assignments)
  }
  if (siteIds.some((siteId) => (eligibilityBySiteId.get(siteId)?.length ?? 0) === 0)) {
    throw new WorkforceSnapshotWriterError(
      "WORKFORCE_SNAPSHOT_PARTIAL",
      "Every scheduled Workforce site must be eligible for the employee on the workday date",
    )
  }
  return {
    segments: segments as unknown as Prisma.InputJsonValue,
    sites: sites.map((site) => {
      const revision = revisionBySiteId.get(site.id)
      const eligibility = eligibilityBySiteId.get(site.id) ?? []
      return {
        ...site,
        eligibilityAssignments: eligibility.map((assignment) => ({
          id: assignment.id,
          kind: assignment.kind,
          effectiveFrom: dateKey(assignment.effectiveFrom),
          effectiveTo: assignment.effectiveTo == null ? null : dateKey(assignment.effectiveTo),
        })),
        geofenceRevision: revision == null ? null : {
          ...revision,
          effectiveFrom: dateKey(revision.effectiveFrom),
          effectiveTo: revision.effectiveTo == null ? null : dateKey(revision.effectiveTo),
        },
      }
    }) as unknown as Prisma.InputJsonValue,
  }
}

/**
 * Pins the current policy and selected/default shift for one already-visible
 * workday using the caller's transaction. Canonical START writers use this
 * form so the just-created workday event and its immutable facts either commit
 * together or roll back together.
 */
export async function writeWorkforceSnapshotsInTransaction(
  tx: Prisma.TransactionClient,
  input: WorkforceSnapshotWriteInput & { workday?: WorkforceSnapshotSourceWorkday },
): Promise<WorkforceSnapshotWriteResult> {
  const resolutionAt = input.resolutionAt ?? new Date()
  const workday = input.workday ?? await tx.mtmAgentWorkday.findFirst({
    where: { id: input.workdayId, organizationId: input.organizationId },
    select: { id: true, agentId: true, workDate: true, startedAt: true },
  })
  if (!workday || workday.id !== input.workdayId) {
    throw new WorkforceSnapshotWriterError(
      "WORKFORCE_SNAPSHOT_WORKDAY_NOT_FOUND",
      "Workforce workday is unavailable",
    )
  }

  const [existingPolicy, existingShift, existingSchedule] = await Promise.all([
    tx.workforcePolicySnapshot.findFirst({
      where: { organizationId: input.organizationId, workdayId: input.workdayId },
      select: { id: true },
    }),
    tx.workforceShiftSnapshot.findFirst({
      where: { organizationId: input.organizationId, workdayId: input.workdayId },
      select: { id: true },
    }),
    tx.workforceWorkdayScheduleSnapshot.findFirst({
      where: { organizationId: input.organizationId, workdayId: input.workdayId },
      select: { id: true },
    }),
  ])
  if (existingPolicy && existingShift && existingSchedule) {
    return {
      kind: "already_present" as const,
      policySnapshotId: existingPolicy.id,
      shiftSnapshotId: existingShift.id,
      scheduleSnapshotId: existingSchedule.id,
    }
  }
  if (existingPolicy && existingShift) {
    // The pair predates C3-008. It is immutable history, not an invitation to
    // reconstruct calendar/site context from today's mutable configuration.
    return {
      kind: "legacy_pair" as const,
      policySnapshotId: existingPolicy.id,
      shiftSnapshotId: existingShift.id,
    }
  }
  if (existingPolicy || existingShift || existingSchedule) {
    throw new WorkforceSnapshotWriterError(
      "WORKFORCE_SNAPSHOT_PARTIAL",
      "Workforce workday has only one immutable snapshot",
    )
  }

  const workDate = dateKey(workday.workDate)
  const calendar = await resolvePersistedWorkforceCalendarDay(tx, {
    organizationId: input.organizationId,
    agentId: workday.agentId,
    date: workDate,
  })
  if (!calendar.attendanceExpected) return { kind: "off_day", workdayId: workday.id }
  const policy = await resolveCurrentWorkforcePolicy(tx, {
    organizationId: input.organizationId,
    agentId: workday.agentId,
    workDate,
    workdayStartedAt: workday.startedAt,
    resolutionAt,
  })
  const shift = await resolveCurrentWorkforceShift(tx, {
    organizationId: input.organizationId,
    agentId: workday.agentId,
    templateId: input.templateId,
    workDate,
    workdayStartedAt: workday.startedAt,
    resolutionAt,
  })
  if (!shift.schedule) return { kind: "off_day", workdayId: workday.id }

  const scheduleContext = await snapshotShiftSegmentsAndSites(tx, {
    organizationId: input.organizationId,
    agentId: workday.agentId,
    templateId: shift.id,
    workDate,
  })

  const policyValues = workforcePolicySnapshotValues({
    definition: policy.definition,
    definitionHash: policy.definitionHash,
  })
  const workDateValue = new Date(workDate + "T00:00:00.000Z")
  const policySnapshot = await tx.workforcePolicySnapshot.create({
    data: {
      organizationId: input.organizationId,
      policyId: policy.id,
      workdayId: workday.id,
      agentId: workday.agentId,
      workDate: workDateValue,
      policyVersion: policy.version,
      definition: policy.definition as Prisma.InputJsonValue,
      definitionHash: policy.definitionHash,
      ...policyValues,
      resolvedAt: resolutionAt,
    },
    select: { id: true },
  })
  const shiftSnapshot = await tx.workforceShiftSnapshot.create({
    data: {
      organizationId: input.organizationId,
      templateId: shift.id,
      assignmentId: shift.assignmentId,
      workdayId: workday.id,
      agentId: workday.agentId,
      workDate: workDateValue,
      templateVersion: shift.version,
      timezone: shift.timezone,
      definition: shift.definition as Prisma.InputJsonValue,
      definitionHash: shift.definitionHash,
      plannedStartAt: new Date(shift.schedule.plannedStartAt),
      plannedEndAt: new Date(shift.schedule.plannedEndAt),
      resolvedAt: resolutionAt,
    },
    select: { id: true },
  })
  const calendarSnapshot = {
    date: calendar.date,
    state: calendar.state,
    calendarKind: calendar.calendarKind,
    attendanceExpected: calendar.attendanceExpected,
    noShowEligible: calendar.noShowEligible,
    excused: calendar.excused,
    source: calendar.source,
    overrideId: calendar.overrideId,
  }
  const schedulePayload = {
    schemaVersion: 1,
    calendar: calendarSnapshot,
    segments: scheduleContext.segments,
    sites: scheduleContext.sites,
    policySnapshotId: policySnapshot.id,
    shiftSnapshotId: shiftSnapshot.id,
  }
  const scheduleSnapshot = await tx.workforceWorkdayScheduleSnapshot.create({
    data: {
      organizationId: input.organizationId,
      workdayId: workday.id,
      agentId: workday.agentId,
      workDate: workDateValue,
      policySnapshotId: policySnapshot.id,
      shiftSnapshotId: shiftSnapshot.id,
      schemaVersion: 1,
      calendarState: calendar.state,
      calendarSnapshot: calendarSnapshot as Prisma.InputJsonValue,
      segments: scheduleContext.segments,
      sites: scheduleContext.sites,
      snapshotHash: workforceWorkdayScheduleSnapshotHash(schedulePayload),
      resolvedAt: resolutionAt,
    },
    select: { id: true },
  })
  return {
    kind: "created",
    policySnapshotId: policySnapshot.id,
    shiftSnapshotId: shiftSnapshot.id,
    scheduleSnapshotId: scheduleSnapshot.id,
  }
}

/**
 * The H3 data model is opt-in. Existing Workforce tenants may have an H5
 * attendance policy but no calculation contract or shift template, and their
 * normal START must remain available until an administrator completes setup.
 */
export async function writeWorkforceSnapshotsIfReadyInTransaction(
  tx: Prisma.TransactionClient,
  input: WorkforceSnapshotWriteInput & { workday?: WorkforceSnapshotSourceWorkday },
): Promise<WorkforceSnapshotWriteAttemptResult> {
  try {
    return await writeWorkforceSnapshotsInTransaction(tx, input)
  } catch (error) {
    if (error instanceof WorkforcePolicyResolutionError && error.code === "WORKFORCE_POLICY_MISSING") {
      return { kind: "not_ready", reason: "POLICY_MISSING" }
    }
    if (error instanceof WorkforceShiftResolutionError && error.code === "WORKFORCE_SHIFT_TEMPLATE_NOT_FOUND") {
      return { kind: "not_ready", reason: "SHIFT_MISSING" }
    }
    if (error instanceof WorkforcePolicyDefinitionError) {
      return { kind: "not_ready", reason: "POLICY_DEFINITION_INVALID" }
    }
    if (error instanceof WorkforceShiftDefinitionError) {
      return { kind: "not_ready", reason: "SHIFT_DEFINITION_INVALID" }
    }
    throw error
  }
}

/**
 * Public service for a standalone administrative/backfill transaction. The
 * canonical workday writers use the in-transaction variant above.
 */
export async function writeWorkforceSnapshots(
  input: WorkforceSnapshotWriteInput,
): Promise<WorkforceSnapshotWriteResult> {
  return prisma.$transaction((tx: Prisma.TransactionClient) => (
    writeWorkforceSnapshotsInTransaction(tx, input)
  ))
}
