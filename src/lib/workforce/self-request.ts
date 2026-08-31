import { Prisma } from "@prisma/client"
import { z } from "zod"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import type { WorkforceActor } from "@/lib/workforce/actor"
import { prisma } from "@/lib/prisma"

const WorkforceDateKey = z.string().refine(isDateKey, "must be a real YYYY-MM-DD date")
const WorkforceLocalDateTime = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  "must be a YYYY-MM-DDTHH:mm local date-time",
)

export const WorkforceSelfRequestSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(128),
  type: z.enum(["LEAVE", "ABSENCE", "TIME_CORRECTION"]),
  startDate: WorkforceDateKey,
  endDate: WorkforceDateKey,
  reason: z.string().trim().min(3).max(1000),
  correctionWorkdayId: z.string().trim().min(1).max(128).optional(),
  exceptionCaseId: z.string().trim().min(1).max(128).optional(),
  requestedStartLocal: WorkforceLocalDateTime.optional(),
  requestedEndLocal: WorkforceLocalDateTime.optional(),
}).strict().superRefine((value, context) => {
  if (value.endDate < value.startDate || value.endDate > addDateKeyDays(value.startDate, 366)) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "date range must be 366 days or fewer" })
  }
  if (value.type !== "TIME_CORRECTION") {
    if (value.correctionWorkdayId || value.exceptionCaseId || value.requestedStartLocal || value.requestedEndLocal) {
      context.addIssue({ code: "custom", path: ["type"], message: "correction fields are valid only for a time correction" })
    }
    return
  }
  if (value.startDate !== value.endDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "time correction must cover one workday" })
  }
  if (!value.correctionWorkdayId) {
    context.addIssue({ code: "custom", path: ["correctionWorkdayId"], message: "workday is required for a time correction" })
  }
  if (!value.requestedStartLocal && !value.requestedEndLocal) {
    context.addIssue({ code: "custom", path: ["requestedStartLocal"], message: "requested start or end time is required" })
  }
  if (
    (value.requestedStartLocal && !value.requestedStartLocal.startsWith(value.startDate + "T"))
    || (value.requestedEndLocal && !value.requestedEndLocal.startsWith(value.startDate + "T"))
  ) {
    context.addIssue({ code: "custom", path: ["requestedStartLocal"], message: "requested time must belong to the selected workday date" })
  }
})

export type WorkforceSelfRequestInput = z.infer<typeof WorkforceSelfRequestSchema>

type RequestAudit = {
  ipAddress?: string | null
  userAgent?: string | null
}

type SubmitContext = {
  organizationId: string
  actor: WorkforceActor
  input: WorkforceSelfRequestInput
  timezone: string
  audit?: RequestAudit
}

type CancelContext = {
  organizationId: string
  actor: WorkforceActor
  requestId: string
  audit?: RequestAudit
}

type RequestData = {
  id: string
  type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
  startDate: Date
  endDate: Date
  correctionWorkdayId: string | null
  requestedStartAt: Date | null
  requestedEndAt: Date | null
  submittedAt: Date
  cancelledAt: Date | null
}

export type WorkforceSelfRequestResult =
  | { kind: "success"; data: RequestData; idempotent: boolean }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "conflict"; code: string; message: string; request?: Pick<RequestData, "id" | "type" | "status" | "startDate" | "endDate"> }

function selfAgentId(actor: WorkforceActor): string | null {
  return actor.agentId && actor.role === "AGENT" ? actor.agentId : null
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime()
}

function sameSubmission(
  record: {
    type: string
    startDate: Date
    endDate: Date
    correctionWorkdayId: string | null
    requestedStartAt: Date | null
    requestedEndAt: Date | null
    reason: string
  },
  input: {
    type: string
    startDate: Date
    endDate: Date
    correctionWorkdayId: string | null
    requestedStartAt: Date | null
    requestedEndAt: Date | null
    reason: string
  },
): boolean {
  return record.type === input.type
    && record.startDate.getTime() === input.startDate.getTime()
    && record.endDate.getTime() === input.endDate.getTime()
    && record.correctionWorkdayId === input.correctionWorkdayId
    && sameInstant(record.requestedStartAt, input.requestedStartAt)
    && sameInstant(record.requestedEndAt, input.requestedEndAt)
    && record.reason === input.reason
}

function conflict(
  code: string,
  message: string,
  request?: Pick<RequestData, "id" | "type" | "status" | "startDate" | "endDate">,
): WorkforceSelfRequestResult {
  return { kind: "conflict", code, message, ...(request ? { request } : {}) }
}

function localCorrectionInstant(value: string | undefined, timezone: string): Date | null {
  if (!value) return null
  return localDateTimeToUnambiguousUtc(value, timezone)
}

/**
 * Creates one employee-owned request. It has no route dependency and never
 * edits a workday directly: a manager decision remains the only path to an
 * immutable correction ledger or an availability-calendar fact.
 */
export async function submitWorkforceSelfRequest(
  context: SubmitContext,
): Promise<WorkforceSelfRequestResult> {
  const agentId = selfAgentId(context.actor)
  if (!agentId) return { kind: "forbidden" }

  let requestedStartAt: Date | null
  let requestedEndAt: Date | null
  try {
    requestedStartAt = localCorrectionInstant(context.input.requestedStartLocal, context.timezone)
    requestedEndAt = localCorrectionInstant(context.input.requestedEndLocal, context.timezone)
  } catch {
    return conflict(
      "WORKFORCE_SELF_REQUEST_LOCAL_TIME_INVALID",
      "The requested local time is ambiguous or does not exist in the organization timezone",
    )
  }
  if (requestedStartAt && requestedEndAt && requestedEndAt.getTime() <= requestedStartAt.getTime()) {
    return conflict(
      "WORKFORCE_SELF_REQUEST_TIME_RANGE_INVALID",
      "Requested finish time must be after requested start time",
    )
  }

  const startDate = new Date(context.input.startDate + "T00:00:00.000Z")
  const endDate = new Date(context.input.endDate + "T00:00:00.000Z")
  const correctionWorkdayId = context.input.type === "TIME_CORRECTION"
    ? context.input.correctionWorkdayId ?? null
    : null
  const exceptionCaseId = context.input.type === "TIME_CORRECTION"
    ? context.input.exceptionCaseId ?? null
    : null
  const requestValues = {
    type: context.input.type,
    startDate,
    endDate,
    correctionWorkdayId,
    exceptionCaseId,
    requestedStartAt,
    requestedEndAt,
    reason: context.input.reason,
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.mtmHrmRequest.findFirst({
      where: {
        organizationId: context.organizationId,
        agentId,
        clientRequestId: context.input.clientRequestId,
      },
      select: {
        id: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        correctionWorkdayId: true,
        exceptionCaseId: true,
        requestedStartAt: true,
        requestedEndAt: true,
        reason: true,
        submittedAt: true,
        cancelledAt: true,
      },
    })
    if (existing) {
      if (!sameSubmission(existing, requestValues)) {
        return conflict(
          "WORKFORCE_SELF_REQUEST_IDEMPOTENCY_MISMATCH",
          "This request id was already used for different request details",
        )
      }
      return { kind: "success" as const, data: existing as RequestData, idempotent: true }
    }

    if (context.input.type === "TIME_CORRECTION") {
      const workday = await tx.mtmAgentWorkday.findFirst({
        where: {
          id: correctionWorkdayId ?? undefined,
          organizationId: context.organizationId,
          agentId,
          workDate: startDate,
        },
        select: { id: true },
      })
      if (!workday) {
        return conflict(
          "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND",
          "The selected workday is not available for a time correction",
        )
      }
      if (exceptionCaseId) {
        const exceptionCase = await tx.workforceExceptionCase.findFirst({
          where: {
            id: exceptionCaseId,
            organizationId: context.organizationId,
            agentId,
            workdayId: correctionWorkdayId ?? undefined,
          },
          select: { id: true },
        })
        // Keep a missing, foreign and mismatched case indistinguishable from
        // an unavailable correction workday. The query parameter is only a
        // convenience hint; employee and day ownership stay server-side.
        if (!exceptionCase) {
          return conflict(
            "WORKFORCE_SELF_REQUEST_WORKDAY_NOT_FOUND",
            "The selected workday is not available for a time correction",
          )
        }
      }
    }

    const overlap = await tx.mtmHrmRequest.findFirst({
      where: {
        organizationId: context.organizationId,
        agentId,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...(context.input.type === "TIME_CORRECTION"
          ? { type: "TIME_CORRECTION", correctionWorkdayId }
          : { type: { in: ["LEAVE", "ABSENCE"] } }),
      },
      select: { id: true, type: true, status: true, startDate: true, endDate: true },
    })
    if (overlap) {
      return conflict(
        "WORKFORCE_SELF_REQUEST_OVERLAP",
        "An active Workforce request already covers this time",
        overlap as Pick<RequestData, "id" | "type" | "status" | "startDate" | "endDate">,
      )
    }

    const submittedAt = new Date()
    const created = await tx.mtmHrmRequest.create({
      data: {
        organizationId: context.organizationId,
        agentId,
        clientRequestId: context.input.clientRequestId,
        ...requestValues,
        submittedAt,
      },
      select: {
        id: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        correctionWorkdayId: true,
        requestedStartAt: true,
        requestedEndAt: true,
        submittedAt: true,
        cancelledAt: true,
      },
    })
    await tx.mtmAuditLog.create({
      data: {
        organizationId: context.organizationId,
        agentId,
        action: "WORKFORCE_SELF_REQUEST_SUBMITTED",
        entity: "hrm_request",
        entityId: created.id,
        metadataKind: "workforce_self_request",
        newData: {
          type: created.type,
          startDate: context.input.startDate,
          endDate: context.input.endDate,
          correctionRequested: created.type === "TIME_CORRECTION",
          exceptionCaseLinked: exceptionCaseId !== null,
        },
        ipAddress: context.audit?.ipAddress ?? null,
        userAgent: context.audit?.userAgent ?? null,
      },
    })
    return { kind: "success" as const, data: created as RequestData, idempotent: false }
  })
}

/** Cancels only the employee's own pending request; decided records are never rewritten. */
export async function cancelWorkforceSelfRequest(
  context: CancelContext,
): Promise<WorkforceSelfRequestResult> {
  const agentId = selfAgentId(context.actor)
  if (!agentId) return { kind: "forbidden" }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const request = await tx.mtmHrmRequest.findFirst({
      where: { id: context.requestId, organizationId: context.organizationId, agentId },
      select: {
        id: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        correctionWorkdayId: true,
        requestedStartAt: true,
        requestedEndAt: true,
        submittedAt: true,
        cancelledAt: true,
      },
    })
    if (!request) return { kind: "not_found" as const }
    if (request.status === "CANCELLED") {
      return { kind: "success" as const, data: request as RequestData, idempotent: true }
    }
    if (request.status !== "PENDING") {
      return conflict(
        "WORKFORCE_SELF_REQUEST_ALREADY_DECIDED",
        "A decided Workforce request cannot be cancelled",
        request as Pick<RequestData, "id" | "type" | "status" | "startDate" | "endDate">,
      )
    }

    const cancelledAt = new Date()
    const updated = await tx.mtmHrmRequest.updateMany({
      where: { id: request.id, organizationId: context.organizationId, agentId, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt },
    })
    if (updated.count !== 1) {
      return conflict(
        "WORKFORCE_SELF_REQUEST_CONCURRENT_CHANGE",
        "This Workforce request changed before it could be cancelled",
      )
    }
    const data = { ...request, status: "CANCELLED" as const, cancelledAt }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: context.organizationId,
        agentId,
        action: "WORKFORCE_SELF_REQUEST_CANCELLED",
        entity: "hrm_request",
        entityId: request.id,
        metadataKind: "workforce_self_request",
        oldData: { status: "PENDING" },
        newData: { status: "CANCELLED" },
        ipAddress: context.audit?.ipAddress ?? null,
        userAgent: context.audit?.userAgent ?? null,
      },
    })
    return { kind: "success" as const, data: data as RequestData, idempotent: false }
  })
}
