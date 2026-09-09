import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  WorkforcePolicyDefinitionError,
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

export type WorkforceSnapshotWriteResult =
  | { kind: "created"; policySnapshotId: string; shiftSnapshotId: string }
  | { kind: "already_present"; policySnapshotId: string; shiftSnapshotId: string }
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

  const [existingPolicy, existingShift] = await Promise.all([
    tx.workforcePolicySnapshot.findFirst({
      where: { organizationId: input.organizationId, workdayId: input.workdayId },
      select: { id: true },
    }),
    tx.workforceShiftSnapshot.findFirst({
      where: { organizationId: input.organizationId, workdayId: input.workdayId },
      select: { id: true },
    }),
  ])
  if (existingPolicy && existingShift) {
    return {
      kind: "already_present" as const,
      policySnapshotId: existingPolicy.id,
      shiftSnapshotId: existingShift.id,
    }
  }
  if (existingPolicy || existingShift) {
    throw new WorkforceSnapshotWriterError(
      "WORKFORCE_SNAPSHOT_PARTIAL",
      "Workforce workday has only one immutable snapshot",
    )
  }

  const workDate = workday.workDate.toISOString().slice(0, 10)
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
  return {
    kind: "created",
    policySnapshotId: policySnapshot.id,
    shiftSnapshotId: shiftSnapshot.id,
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
