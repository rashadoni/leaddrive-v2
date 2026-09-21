import type { Prisma } from "@prisma/client"
import type { MtmWorkdayEventInput } from "@/lib/mtm/workday"
import type { WorkforceWorkdayCorrectionFacts } from "@/lib/workforce/workday-correction-facts"

type WorkdayScope = { organizationId: string; agentId: string }
type AuditWorkday = Record<string, unknown> & { id: string }
type AuditEvent = Record<string, unknown> & { id: string }

export type WorkforceAuditRequestMetadata = {
  ipAddress?: string | null
  userAgent?: string | null
  /**
   * Whether the acting manager had an enrolled mandatory 2FA factor. Recorded
   * on the manager's workday actions, where 2FA is recommended, not required
   * (owner decision 2026-09-21); null when the lookup failed.
   */
  mfaEnrolled?: boolean | null
}

export function workforceAuditRequestMetadata(headers: Headers): WorkforceAuditRequestMetadata {
  return {
    ipAddress: headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || headers.get("x-real-ip")
      || null,
    userAgent: headers.get("user-agent") || null,
  }
}

function workdaySummary(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return { exists: false }
  return {
    exists: true,
    id: value.id ?? null,
    workDate: value.workDate ?? null,
    status: value.status ?? null,
    startedAt: value.startedAt ?? null,
    pausedAt: value.pausedAt ?? null,
    completedAt: value.completedAt ?? null,
    totalPausedSeconds: value.totalPausedSeconds ?? 0,
  }
}

/**
 * Writes the ordinary workday audit projection through the caller's exact
 * transaction. If this fails, the immutable event, visible workday projection
 * and sync idempotency result all roll back together rather than reporting an
 * accepted attendance mutation with an audit gap.
 *
 * Exact coordinates, raw QR tokens, device signatures and other transient
 * proof material are intentionally excluded. The immutable event and its
 * dedicated verification ledger remain the reconstructable source of truth.
 */
export async function writeWorkforceWorkdayAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    scope: WorkdayScope
    workdayInput: MtmWorkdayEventInput
    beforeWorkday?: Record<string, unknown> | null
    workday: AuditWorkday
    event: AuditEvent
    channel: "web" | "mobile_sync"
    requestMetadata?: WorkforceAuditRequestMetadata
  },
): Promise<void> {
  const { scope, workdayInput, event } = input
  await tx.mtmAuditLog.create({
    data: {
      organizationId: scope.organizationId,
      agentId: scope.agentId,
      action: `WORKDAY_${workdayInput.action}`,
      entity: "workday",
      entityId: input.workday.id,
      metadataKind: "workday_transition",
      oldData: workdaySummary(input.beforeWorkday) as Prisma.InputJsonValue,
      newData: {
        channel: input.channel,
        clientEventId: workdayInput.clientEventId,
        action: workdayInput.action,
        schemaVersion: workdayInput.schemaVersion,
        segmentId: workdayInput.segmentId ?? null,
        claimedAt: workdayInput.claimedAt.toISOString(),
        capturedAt: workdayInput.capturedAt.toISOString(),
        queuedAt: workdayInput.queuedAt?.toISOString() ?? null,
        serverReceivedAt: workdayInput.serverReceivedAt.toISOString(),
        eventId: event.id,
        requestHash: typeof event.requestHash === "string" ? event.requestHash : null,
        workday: workdaySummary(input.workday),
      } as Prisma.InputJsonValue,
      ipAddress: input.requestMetadata?.ipAddress ?? null,
      userAgent: input.requestMetadata?.userAgent ?? null,
    },
  })
}

/**
 * Writes the manager reopen of a finished workday into the same audit stream
 * as the employee's own transitions, through the caller's transaction: the
 * REOPEN event, the immutable reopen ledger, the paused projection and this
 * record commit or roll back together, so a reopen can never exist without
 * its actor, reason and before/after facts.
 */
export async function writeWorkforceWorkdayReopenAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    scope: WorkdayScope
    reopenId: string
    eventId: string
    actorUserId: string
    operationId: string
    reason: string
    authorizationSource: string
    beforeWorkday: WorkforceWorkdayCorrectionFacts
    afterWorkday: WorkforceWorkdayCorrectionFacts
    requestMetadata?: WorkforceAuditRequestMetadata
  },
): Promise<void> {
  await tx.mtmAuditLog.create({
    data: {
      organizationId: input.scope.organizationId,
      agentId: input.scope.agentId,
      action: "WORKDAY_REOPEN",
      entity: "workday",
      entityId: input.afterWorkday.id,
      metadataKind: "workforce_workday_reopen",
      oldData: { workday: input.beforeWorkday } as Prisma.InputJsonValue,
      newData: {
        workday: input.afterWorkday,
        reopenId: input.reopenId,
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        operationId: input.operationId,
        reason: input.reason,
        authorizationSource: input.authorizationSource,
        ...(input.requestMetadata?.mfaEnrolled !== undefined ? { mfaEnrolled: input.requestMetadata.mfaEnrolled } : {}),
      } as Prisma.InputJsonValue,
      ipAddress: input.requestMetadata?.ipAddress ?? null,
      userAgent: input.requestMetadata?.userAgent ?? null,
    },
  })
}

/**
 * Records a manager undoing a mistaken reopen in the same transaction as the
 * restoring FINISH event and the completed projection. The journal event has
 * no actor column, so this record is where the manager, the undone reopen and
 * the exact before/after facts are kept.
 */
export async function writeWorkforceWorkdayReopenUndoAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    scope: WorkdayScope
    reopenId: string
    reopenEventId: string
    eventId: string
    actorUserId: string
    operationId: string
    reason: string
    authorizationSource: string
    beforeWorkday: WorkforceWorkdayCorrectionFacts
    afterWorkday: WorkforceWorkdayCorrectionFacts
    requestMetadata?: WorkforceAuditRequestMetadata
  },
): Promise<void> {
  await tx.mtmAuditLog.create({
    data: {
      organizationId: input.scope.organizationId,
      agentId: input.scope.agentId,
      action: "WORKDAY_REOPEN_UNDO",
      entity: "workday",
      entityId: input.afterWorkday.id,
      metadataKind: "workforce_workday_reopen_undo",
      oldData: { workday: input.beforeWorkday } as Prisma.InputJsonValue,
      newData: {
        workday: input.afterWorkday,
        reopenId: input.reopenId,
        reopenEventId: input.reopenEventId,
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        operationId: input.operationId,
        reason: input.reason,
        authorizationSource: input.authorizationSource,
        ...(input.requestMetadata?.mfaEnrolled !== undefined ? { mfaEnrolled: input.requestMetadata.mfaEnrolled } : {}),
      } as Prisma.InputJsonValue,
      ipAddress: input.requestMetadata?.ipAddress ?? null,
      userAgent: input.requestMetadata?.userAgent ?? null,
    },
  })
}

/**
 * Records a manager closing a shift the employee left open, in the same
 * transaction as the FINISH event and the completed projection. The journal
 * event has no actor column; this record keeps the manager, the reason, the
 * finish the form suggested and the exact before/after facts.
 */
export async function writeWorkforceWorkdayCloseAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    scope: WorkdayScope
    eventId: string
    actorUserId: string
    operationId: string
    reason: string
    authorizationSource: string
    suggestedFinishAt: string
    beforeWorkday: WorkforceWorkdayCorrectionFacts
    afterWorkday: WorkforceWorkdayCorrectionFacts
    requestMetadata?: WorkforceAuditRequestMetadata
  },
): Promise<void> {
  await tx.mtmAuditLog.create({
    data: {
      organizationId: input.scope.organizationId,
      agentId: input.scope.agentId,
      action: "WORKDAY_CLOSE_LEFT_OPEN",
      entity: "workday",
      entityId: input.afterWorkday.id,
      metadataKind: "workforce_workday_close_left_open",
      oldData: { workday: input.beforeWorkday } as Prisma.InputJsonValue,
      newData: {
        workday: input.afterWorkday,
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        operationId: input.operationId,
        reason: input.reason,
        authorizationSource: input.authorizationSource,
        ...(input.requestMetadata?.mfaEnrolled !== undefined ? { mfaEnrolled: input.requestMetadata.mfaEnrolled } : {}),
        suggestedFinishAt: input.suggestedFinishAt,
      } as Prisma.InputJsonValue,
      ipAddress: input.requestMetadata?.ipAddress ?? null,
      userAgent: input.requestMetadata?.userAgent ?? null,
    },
  })
}
