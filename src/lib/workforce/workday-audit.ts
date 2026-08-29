import type { Prisma } from "@prisma/client"
import type { MtmWorkdayEventInput } from "@/lib/mtm/workday"

type WorkdayScope = { organizationId: string; agentId: string }
type AuditWorkday = Record<string, unknown> & { id: string }
type AuditEvent = Record<string, unknown> & { id: string }

export type WorkforceAuditRequestMetadata = {
  ipAddress?: string | null
  userAgent?: string | null
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
