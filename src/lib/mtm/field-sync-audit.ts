import type { Prisma } from "@prisma/client"

/**
 * Activity-journal rows for what the field app does offline.
 *
 * Prod 2026-09-14: /mtm/activity showed «Check-in 0, Check-out 0» for seven
 * days while two visits had been opened and closed that very day. The journal
 * counts audit rows, and only the web visit endpoints wrote them; the phone
 * syncs through /mtm/mobile/sync/push (and the PWA through /mtm/sync/push),
 * which wrote the visit and nothing else.
 *
 * Exactly once per operation: the row is written with the same transaction
 * client as the entity write AND the `MtmSyncOperation` pin. A retried
 * operationId either replays from the pin without entering the transaction, or
 * loses the (organizationId, operationId) unique race and rolls back — this
 * row included. No separate dedupe table is needed, and a transaction that
 * fails for any other reason leaves no orphaned "check-in" behind.
 *
 * Never at the cost of the operation. The rows are written inside a SAVEPOINT:
 * if an insert fails, only the savepoint is rolled back, the error is logged,
 * and the visit plus its pin still commit. Without it a failed insert aborts
 * the whole Postgres transaction and the phone gets "Internal error, retry"
 * for the same check-in forever (review of #211).
 *
 * Time: the row carries WHEN it happened, not when the phone came online. An
 * offline check-in at 18:40 synced the next morning belongs to yesterday's
 * journal and counters, so `createdAt` is the occurrence time (clamped to now:
 * a device clock in the future must not push a row ahead of the feed) and
 * `newData.syncedAt` keeps the arrival.
 *
 * RLS: the caller's transaction runs inside the route's tenant scope, so the
 * insert carries app.org_id like the visit it describes. Never call this with
 * the global `prisma` — outside the transaction the row could commit while the
 * visit rolls back.
 */

export type FieldSyncAuditAction = "CHECK_IN" | "CHECK_IN_FORCED" | "CHECK_OUT" | "ROUTE_START" | "ROUTE_COMPLETE"

export type FieldSyncAuditSource = "mobile_sync" | "web_sync"

export interface FieldSyncAuditInput {
  organizationId: string
  agentId: string
  action: FieldSyncAuditAction
  operationId: string
  source: FieldSyncAuditSource
  visitId?: string | null
  routeId?: string | null
  customerId?: string | null
  customerName?: string | null
  metadataKind?: string | null
  /** When it happened on the device/server (checkInAt, checkOutAt). */
  occurredAt?: Date | string | null
  extra?: Record<string, unknown>
}

type AuditTx = Pick<Prisma.TransactionClient, "mtmAuditLog" | "$executeRaw">

/** Occurrence time, or now when missing, invalid or in the future. */
export function fieldSyncOccurredAt(value: Date | string | null | undefined, now: Date = new Date()): Date {
  if (value === null || value === undefined) return now
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) return now
  return parsed
}

export function fieldSyncAuditData(input: FieldSyncAuditInput, now: Date = new Date()): Prisma.MtmAuditLogUncheckedCreateInput {
  const isRoute = input.action === "ROUTE_START" || input.action === "ROUTE_COMPLETE"
  const customerName = typeof input.customerName === "string" && input.customerName.trim() ? input.customerName.trim() : null
  return {
    organizationId: input.organizationId,
    agentId: input.agentId,
    action: input.action,
    entity: isRoute ? "route" : "visit",
    entityId: (isRoute ? input.routeId : input.visitId) ?? null,
    metadataKind: input.metadataKind ?? "field_sync",
    createdAt: fieldSyncOccurredAt(input.occurredAt, now),
    newData: {
      ...(input.extra ?? {}),
      source: input.source,
      operationId: input.operationId,
      visitId: input.visitId ?? null,
      routeId: input.routeId ?? null,
      customerId: input.customerId ?? null,
      customerName,
      occurredAt: fieldSyncOccurredAt(input.occurredAt, now).toISOString(),
      syncedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  }
}

/**
 * Returns whether the rows were written. A failure is logged and swallowed;
 * only a failure to roll back to the savepoint (the transaction itself is
 * broken) is rethrown, and then the operation stays unpinned and retryable.
 */
export async function writeFieldSyncAudit(tx: AuditTx, inputs: FieldSyncAuditInput[]): Promise<boolean> {
  if (inputs.length === 0) return true
  const now = new Date()
  try {
    await tx.$executeRaw`SAVEPOINT field_sync_audit`
  } catch (error) {
    console.error("[MTM/field-sync-audit] savepoint unavailable, activity rows skipped", error)
    return false
  }
  try {
    for (const input of inputs) {
      await tx.mtmAuditLog.create({ data: fieldSyncAuditData(input, now) })
    }
    await tx.$executeRaw`RELEASE SAVEPOINT field_sync_audit`
    return true
  } catch (error) {
    console.error(
      `[MTM/field-sync-audit] activity rows not written operationId=${inputs[0]?.operationId} actions=${inputs.map((input) => input.action).join(",")}`,
      error,
    )
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT field_sync_audit`
    await tx.$executeRaw`RELEASE SAVEPOINT field_sync_audit`
    return false
  }
}

/**
 * Route transitions caused by closing a visit, read from the route before and
 * after `completeMtmVisit` in the same transaction.
 */
export function routeTransitionActions(
  before: string | null | undefined,
  after: string | null | undefined,
): Array<"ROUTE_START" | "ROUTE_COMPLETE"> {
  if (!before || !after || before === after) return []
  const out: Array<"ROUTE_START" | "ROUTE_COMPLETE"> = []
  if (before === "PLANNED" && (after === "IN_PROGRESS" || after === "COMPLETED")) out.push("ROUTE_START")
  if (after === "COMPLETED") out.push("ROUTE_COMPLETE")
  return out
}
