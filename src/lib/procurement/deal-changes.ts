import { prisma } from "@/lib/prisma"
import { procurementNumber } from "@/lib/procurement/numbering"
import { notifyProcurement, purchasersOf } from "@/lib/procurement/notify"

/**
 * A line of a customer order changed after purchasing started on it
 * (docs/sales-procurement/README.md, rule 4 and task 5.2): its name, its
 * quantity, or it was removed. Open purchase requests and orders for that line
 * get `dealChangedAt` («the deal changed — check it»), the order a history
 * row, and purchasing a notice. A sent order does not change by itself —
 * purchasing decides whether a new one is needed.
 */
export type DealLineChange = { id: string; name: string; change: "name" | "quantity" | "removed" }

const OPEN_REQUEST = ["submitted", "in_progress", "ordered"]
const OPEN_ORDER = ["draft", "pending_approval", "approved", "rejected", "sent", "in_production", "in_transit", "partially_received"]

export async function markPurchasesOfChangedLines(orgId: string, actorId: string | null, dealId: string, dealName: string, changes: readonly DealLineChange[]): Promise<void> {
  if (changes.length === 0) return
  await markPurchases(orgId, actorId, dealId, dealName, changes.map((change) => `${change.name} (${change.change})`).join(", "), changes.map((change) => change.id), { changes: changes.map((c) => ({ ...c })) })
}

/**
 * The customer agreed to a change of the whole order (task 5.2: a layout, a
 * size, a date): every open purchase of the deal is flagged, whatever line.
 */
export async function markPurchasesOfChangedDeal(orgId: string, actorId: string | null, dealId: string, dealName: string, summary: string): Promise<void> {
  await markPurchases(orgId, actorId, dealId, dealName, summary, null, { approval: summary })
}

async function markPurchases(orgId: string, actorId: string | null, dealId: string, dealName: string, summary: string, lineIds: string[] | null, eventData: Record<string, unknown>): Promise<void> {
  try {
    const lines = lineIds ? { items: { some: { dealLineItemId: { in: lineIds } } } } : {}
    const now = new Date()
    const [requests, orders]: [{ id: string; seq: number; assignedToId: string | null }[], { id: string; seq: number; createdById: string | null }[]] = await Promise.all([
      prisma.purchaseRequest.findMany({
        where: { organizationId: orgId, dealId, status: { in: OPEN_REQUEST }, ...lines },
        select: { id: true, seq: true, assignedToId: true },
      }),
      prisma.purchaseOrder.findMany({
        where: { organizationId: orgId, dealId, status: { in: OPEN_ORDER }, ...lines },
        select: { id: true, seq: true, createdById: true },
      }),
    ])
    if (requests.length === 0 && orders.length === 0) return
    await prisma.$transaction(async (tx) => {
      if (requests.length > 0) await tx.purchaseRequest.updateMany({ where: { id: { in: requests.map((r) => r.id) } }, data: { dealChangedAt: now } })
      if (orders.length > 0) {
        await tx.purchaseOrder.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { dealChangedAt: now } })
        await tx.purchaseOrderEvent.createMany({
          data: orders.map((order) => ({ organizationId: orgId, orderId: order.id, type: "deal_changed", actorId, data: eventData })),
        })
      }
    })
    const purchasers = await purchasersOf(orgId)
    for (const request of requests) {
      await notifyProcurement({ orgId, actorId, recipients: [request.assignedToId, ...purchasers], entityType: "purchase_request", entityId: request.id, event: { kind: "deal.changed", number: procurementNumber("request", request.seq), deal: dealName, change: summary } })
    }
    for (const order of orders) {
      await notifyProcurement({ orgId, actorId, recipients: [order.createdById, ...purchasers], entityType: "purchase_order", entityId: order.id, event: { kind: "deal.changed", number: procurementNumber("order", order.seq), deal: dealName, change: summary } })
    }
  } catch (error) {
    // The deal is saved either way; a missed mark is logged, not thrown at the salesperson.
    console.error("[procurement] marking purchases of a changed deal failed", error)
  }
}
