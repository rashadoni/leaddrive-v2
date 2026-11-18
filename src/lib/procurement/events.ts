import { prisma } from "@/lib/prisma"
import { fireWebhooks } from "@/lib/webhooks"
import { executeWorkflows } from "@/lib/workflow-engine"
import { procurementNumber } from "@/lib/procurement/numbering"

/**
 * Automations (Settings → Automations) on purchasing, task 6.4: the rules an
 * administrator wrote for `purchase_request` / `purchase_order`. The entity a
 * rule sees carries the fields its conditions and templates can use; `assignedTo`
 * is whom a «create task» action gives the task to by default — the deal's owner
 * for an order, the person who asked for a request. No action can change a
 * purchase: the engine updates only whitelisted fields of CRM records, and
 * purchases are not among them — their statuses move through the order's own
 * rules (approval, receipt).
 */
type OrderForRules = {
  id: string; seq: number; status: string; currency: string; totalAmount: { toString(): string }
  expectedDeliveryAt: Date | null; dealId: string | null; requestId: string | null
  supplier: { id: string; name: string }; deal: { name: string; assignedTo: string | null } | null; createdById: string | null
}

const ORDER_FOR_RULES = {
  id: true, seq: true, status: true, currency: true, totalAmount: true, expectedDeliveryAt: true, dealId: true, requestId: true, createdById: true,
  supplier: { select: { id: true, name: true } },
  deal: { select: { name: true, assignedTo: true } },
} as const

function orderEntity(order: OrderForRules, extra: Record<string, unknown> = {}) {
  const number = procurementNumber("order", order.seq)
  return {
    id: order.id,
    number,
    name: `${number} · ${order.supplier.name}`,
    status: order.status,
    currency: order.currency,
    amount: Number(order.totalAmount.toString()),
    supplier: order.supplier.name,
    supplierId: order.supplier.id,
    dealId: order.dealId,
    dealName: order.deal?.name ?? null,
    requestId: order.requestId,
    expectedDeliveryAt: order.expectedDeliveryAt?.toISOString().slice(0, 10) ?? null,
    assignedTo: order.deal?.assignedTo ?? order.createdById ?? null,
    ...extra,
  }
}

/** A purchase order the hourly job just marked late (overdue-job.ts). */
export async function emitPurchaseOrderOverdue(orgId: string, orderId: string): Promise<void> {
  try {
    const order: OrderForRules | null = await prisma.purchaseOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: ORDER_FOR_RULES })
    if (order) await executeWorkflows(orgId, "purchase_order", "overdue", orderEntity(order))
  } catch (error) {
    console.error("[procurement] automations purchase_order.overdue failed", error)
  }
}

/**
 * Purchasing for the organization's own systems (task 6.4): an outgoing webhook
 * on a sent request and on every status of a purchase order — the accounting
 * program or a warehouse tool can follow an order without polling. The
 * organization's admin chose to send its data to that address, so the order's
 * total travels with it. A failed delivery never fails the purchase.
 */
export async function emitPurchaseOrderStatus(orgId: string, orderId: string, from: string | null, to: string): Promise<void> {
  try {
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, organizationId: orgId },
      select: { id: true, seq: true, status: true, currency: true, totalAmount: true, expectedDeliveryAt: true, dealId: true, requestId: true, supplier: { select: { id: true, name: true, voen: true } } },
    })
    if (!order) return
    await fireWebhooks(orgId, "purchase_order.status_changed", {
      id: order.id,
      number: procurementNumber("order", order.seq),
      from,
      to,
      currency: order.currency,
      total: order.totalAmount.toString(),
      expectedDeliveryAt: order.expectedDeliveryAt?.toISOString() ?? null,
      dealId: order.dealId,
      requestId: order.requestId,
      supplier: order.supplier,
    })
  } catch (error) {
    console.error("[procurement] webhook purchase_order.status_changed failed", error)
  }
  // Automations run apart from the webhook: one failing never stops the other.
  try {
    const order: OrderForRules | null = await prisma.purchaseOrder.findFirst({ where: { id: orderId, organizationId: orgId }, select: ORDER_FOR_RULES })
    if (order) await executeWorkflows(orgId, "purchase_order", "status_changed", orderEntity(order, { from, to }))
  } catch (error) {
    console.error("[procurement] automations purchase_order.status_changed failed", error)
  }
}

export async function emitPurchaseRequestSubmitted(orgId: string, requestId: string): Promise<void> {
  try {
    const request = await prisma.purchaseRequest.findFirst({
      where: { id: requestId, organizationId: orgId },
      select: { id: true, seq: true, title: true, neededBy: true, dealId: true, items: { select: { name: true, quantity: true, unit: true } } },
    })
    if (!request) return
    await fireWebhooks(orgId, "purchase_request.submitted", {
      id: request.id,
      number: procurementNumber("request", request.seq),
      title: request.title,
      neededBy: request.neededBy?.toISOString() ?? null,
      dealId: request.dealId,
      items: request.items.map((item: { name: string; quantity: { toString(): string }; unit: string | null }) => ({ name: item.name, quantity: item.quantity.toString(), unit: item.unit })),
    })
  } catch (error) {
    console.error("[procurement] webhook purchase_request.submitted failed", error)
  }
  try {
    const request = await prisma.purchaseRequest.findFirst({
      where: { id: requestId, organizationId: orgId },
      select: { id: true, seq: true, title: true, status: true, neededBy: true, dealId: true, requestedById: true, deal: { select: { name: true } }, _count: { select: { items: true } } },
    })
    if (request) {
      const number = procurementNumber("request", request.seq)
      await executeWorkflows(orgId, "purchase_request", "submitted", {
        id: request.id,
        number,
        name: `${number} · ${request.title}`,
        title: request.title,
        status: request.status,
        neededBy: request.neededBy?.toISOString().slice(0, 10) ?? null,
        dealId: request.dealId,
        dealName: request.deal?.name ?? null,
        lines: request._count.items,
        assignedTo: request.requestedById,
      })
    }
  } catch (error) {
    console.error("[procurement] automations purchase_request.submitted failed", error)
  }
}
