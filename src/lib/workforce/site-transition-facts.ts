import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS,
  WORKFORCE_WORKDAY_OFFLINE_HORIZON_MS,
  workforceAttendanceClaimReview,
} from "@/lib/mtm/workday"

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const ID = z.string().trim().min(1).max(100)
const CURRENT_SCHEMA_VERSION = 1

export const WorkforceSiteTransitionClaimSchema = z.object({
  workdayId: ID,
  segmentId: ID,
  clientTransitionId: ID,
  kind: z.enum(["ARRIVAL", "DEPARTURE"]),
  claimedAt: z.coerce.date(),
  capturedAt: z.coerce.date(),
  queuedAt: z.coerce.date(),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
}).strict().superRefine((value, context) => {
  if (Number.isNaN(value.claimedAt.getTime()) || Number.isNaN(value.capturedAt.getTime()) || Number.isNaN(value.queuedAt.getTime())) {
    context.addIssue({ code: "custom", message: "transition provenance timestamps are invalid" })
  }
  if (value.claimedAt > value.queuedAt || value.capturedAt > value.queuedAt) {
    context.addIssue({
      code: "custom",
      path: ["queuedAt"],
      message: "queuedAt must not be earlier than claimedAt or capturedAt",
    })
  }
})

export type WorkforceSiteTransitionClaim = z.infer<typeof WorkforceSiteTransitionClaimSchema>

export type WorkforceSiteTransitionResult =
  | {
      status: "recorded"
      transition: Record<string, unknown>
      idempotent: false
    }
  | {
      status: "recorded"
      transition: Record<string, unknown>
      idempotent: true
    }
  | {
      status: "conflict"
      code: string
      message: string
    }

export class WorkforceSiteTransitionError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SITE_TRANSITION_WORKDAY_NOT_FOUND"
      | "WORKFORCE_SITE_TRANSITION_SEGMENT_NOT_FOUND"
      | "WORKFORCE_SITE_TRANSITION_SEGMENT_NOT_SCHEDULED"
      | "WORKFORCE_SITE_TRANSITION_OFFLINE_HORIZON"
      | "WORKFORCE_SITE_TRANSITION_FUTURE_TIME"
      | "WORKFORCE_SITE_TRANSITION_IDEMPOTENCY_MISMATCH"
      | "WORKFORCE_SITE_TRANSITION_DUPLICATE_FACT",
    message: string = code,
  ) {
    super(message)
  }
}

type TransitionDb = Pick<
  PrismaClient,
  | "$transaction"
  | "$executeRaw"
  | "mtmAgentWorkday"
  | "workforceShiftSegment"
  | "workforceWorkdayScheduleSnapshot"
  | "workforceSiteTransition"
  | "mtmAuditLog"
>

const transitionSelect = {
  id: true,
  workdayId: true,
  segmentId: true,
  kind: true,
  clientTransitionId: true,
  claimedAt: true,
  capturedAt: true,
  queuedAt: true,
  serverReceivedAt: true,
  appliedAt: true,
  schemaVersion: true,
  requestHash: true,
  attendanceReviewState: true,
  attendanceReviewReasonCode: true,
  createdAt: true,
} as const

export function workforceSiteTransitionRequestHash(
  scope: { organizationId: string; agentId: string },
  claim: WorkforceSiteTransitionClaim,
): string {
  return createHash("sha256").update(JSON.stringify({
    version: CURRENT_SCHEMA_VERSION,
    organizationId: scope.organizationId,
    agentId: scope.agentId,
    clientTransitionId: claim.clientTransitionId,
    workdayId: claim.workdayId,
    segmentId: claim.segmentId,
    kind: claim.kind,
    claimedAt: claim.claimedAt.toISOString(),
    capturedAt: claim.capturedAt.toISOString(),
    queuedAt: claim.queuedAt.toISOString(),
    schemaVersion: claim.schemaVersion,
  })).digest("hex")
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code
}

function assertSupportedClaimWindow(claim: WorkforceSiteTransitionClaim, now: Date): void {
  for (const value of [claim.claimedAt, claim.capturedAt, claim.queuedAt]) {
    if (value.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
      throw new WorkforceSiteTransitionError(
        "WORKFORCE_SITE_TRANSITION_FUTURE_TIME",
        "Workforce site transition provenance time is too far in the future",
      )
    }
  }
  if (claim.claimedAt.getTime() < now.getTime() - WORKFORCE_WORKDAY_OFFLINE_HORIZON_MS) {
    throw new WorkforceSiteTransitionError(
      "WORKFORCE_SITE_TRANSITION_OFFLINE_HORIZON",
      "Workforce site transition is beyond the supported seven-day offline horizon",
    )
  }
}

function transitionAuditData(
  claim: WorkforceSiteTransitionClaim,
  result: { id: string; requestHash: string; attendanceReviewState: string; attendanceReviewReasonCode: string | null },
): Prisma.InputJsonObject {
  return {
    clientTransitionId: claim.clientTransitionId,
    kind: claim.kind,
    segmentId: claim.segmentId,
    schemaVersion: claim.schemaVersion,
    claimedAt: claim.claimedAt.toISOString(),
    capturedAt: claim.capturedAt.toISOString(),
    queuedAt: claim.queuedAt.toISOString(),
    transitionId: result.id,
    requestHash: result.requestHash,
    attendanceReviewState: result.attendanceReviewState,
    attendanceReviewReasonCode: result.attendanceReviewReasonCode,
  }
}

function isScheduledSiteSegment(value: unknown, segmentId: string): boolean {
  if (!Array.isArray(value)) return false
  return value.some((segment) => (
    segment != null
    && typeof segment === "object"
    && (segment as { id?: unknown }).id === segmentId
    && (segment as { mode?: unknown }).mode === "SITE"
    && typeof (segment as { siteId?: unknown }).siteId === "string"
  ))
}

/**
 * Adds a claimed arrival/departure fact without deciding that the employee was
 * physically present. The later C4 assessment owns location/QR/device proof;
 * this C2 ledger only gives it a tenant-scoped, idempotent subject.
 */
export async function recordWorkforceSiteTransition(input: {
  db: TransitionDb
  organizationId: string
  agentId: string
  claim: WorkforceSiteTransitionClaim
  now?: Date
  audit?: { ipAddress?: string | null; userAgent?: string | null }
}): Promise<WorkforceSiteTransitionResult> {
  const now = input.now ?? new Date()
  assertSupportedClaimWindow(input.claim, now)
  const scope = { organizationId: input.organizationId, agentId: input.agentId }
  const hash = workforceSiteTransitionRequestHash(scope, input.claim)

  try {
    return await input.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${[
        "workforce-site-transition",
        input.organizationId,
        input.agentId,
        input.claim.workdayId,
        input.claim.segmentId,
      ].join(":")}))`
      const replay = await tx.workforceSiteTransition.findFirst({
        where: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          clientTransitionId: input.claim.clientTransitionId,
        },
        select: transitionSelect,
      })
      if (replay) {
        if (replay.requestHash !== hash) {
          return {
            status: "conflict",
            code: "WORKFORCE_SITE_TRANSITION_IDEMPOTENCY_MISMATCH",
            message: "clientTransitionId was already used for a different Workforce site transition",
          }
        }
        return { status: "recorded", transition: replay as Record<string, unknown>, idempotent: true }
      }

      const [workday, segment, scheduleSnapshot] = await Promise.all([
        tx.mtmAgentWorkday.findFirst({
          where: {
            id: input.claim.workdayId,
            organizationId: input.organizationId,
            agentId: input.agentId,
          },
          select: { id: true },
        }),
        tx.workforceShiftSegment.findFirst({
          where: { id: input.claim.segmentId, organizationId: input.organizationId },
          select: { id: true },
        }),
        tx.workforceWorkdayScheduleSnapshot.findFirst({
          where: {
            organizationId: input.organizationId,
            workdayId: input.claim.workdayId,
            agentId: input.agentId,
          },
          select: { id: true, segments: true },
        }),
      ])
      if (!workday) {
        throw new WorkforceSiteTransitionError(
          "WORKFORCE_SITE_TRANSITION_WORKDAY_NOT_FOUND",
          "The Workforce workday is unavailable for this employee",
        )
      }
      if (!segment) {
        throw new WorkforceSiteTransitionError(
          "WORKFORCE_SITE_TRANSITION_SEGMENT_NOT_FOUND",
          "The Workforce shift segment is unavailable in this tenant",
        )
      }
      if (!scheduleSnapshot || !isScheduledSiteSegment(scheduleSnapshot.segments, input.claim.segmentId)) {
        throw new WorkforceSiteTransitionError(
          "WORKFORCE_SITE_TRANSITION_SEGMENT_NOT_SCHEDULED",
          "The Workforce site transition segment is not scheduled for this employee workday",
        )
      }

      const review = workforceAttendanceClaimReview(input.claim.claimedAt, now)
      const transition = await tx.workforceSiteTransition.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          workdayId: input.claim.workdayId,
          segmentId: input.claim.segmentId,
          kind: input.claim.kind,
          clientTransitionId: input.claim.clientTransitionId,
          claimedAt: input.claim.claimedAt,
          capturedAt: input.claim.capturedAt,
          queuedAt: input.claim.queuedAt,
          serverReceivedAt: now,
          appliedAt: now,
          schemaVersion: input.claim.schemaVersion,
          requestHash: hash,
          attendanceReviewState: review.state,
          attendanceReviewReasonCode: review.reasonCode,
        },
        select: transitionSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          action: `WORKFORCE_SITE_TRANSITION_${input.claim.kind}`,
          entity: "workforce_site_transition",
          entityId: transition.id,
          metadataKind: "workforce_site_transition",
          newData: transitionAuditData(input.claim, transition),
          ipAddress: input.audit?.ipAddress ?? null,
          userAgent: input.audit?.userAgent ?? null,
        },
      })
      return { status: "recorded", transition: transition as Record<string, unknown>, idempotent: false }
    })
  } catch (error) {
    if (error instanceof WorkforceSiteTransitionError) throw error
    if (isPrismaCode(error, "P2002") || isPrismaCode(error, "P2004") || isPrismaCode(error, "P2010")) {
      throw new WorkforceSiteTransitionError(
        "WORKFORCE_SITE_TRANSITION_DUPLICATE_FACT",
        "This Workforce segment already has the requested transition fact or its required arrival is missing",
      )
    }
    throw error
  }
}

export const WORKFORCE_SITE_TRANSITION_DELAY_REVIEW_MS = WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS
