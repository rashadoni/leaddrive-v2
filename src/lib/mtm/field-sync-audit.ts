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
  extra?: Record<string, unknown>
}

type AuditTx = Pick<Prisma.TransactionClient, "mtmAuditLog">

export function fieldSyncAuditData(input: FieldSyncAuditInput): Prisma.MtmAuditLogUncheckedCreateInput {
  const isRoute = input.action === "ROUTE_START" || input.action === "ROUTE_COMPLETE"
  const customerName = typeof input.customerName === "string" && input.customerName.trim() ? input.customerName.trim() : null
  return {
    organizationId: input.organizationId,
    agentId: input.agentId,
    action: input.action,
    entity: isRoute ? "route" : "visit",
    entityId: (isRoute ? input.routeId : input.visitId) ?? null,
    metadataKind: input.metadataKind ?? "field_sync",
    newData: {
      ...(input.extra ?? {}),
      source: input.source,
      operationId: input.operationId,
      visitId: input.visitId ?? null,
      routeId: input.routeId ?? null,
      customerId: input.customerId ?? null,
      customerName,
    } as Prisma.InputJsonValue,
  }
}

export async function writeFieldSyncAudit(tx: AuditTx, inputs: FieldSyncAuditInput[]): Promise<void> {
  for (const input of inputs) {
    await tx.mtmAuditLog.create({ data: fieldSyncAuditData(input) })
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
