import { prisma } from "@/lib/prisma"
import { fireWebhooks } from "@/lib/webhooks"
import { procurementNumber } from "@/lib/procurement/numbering"

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
}
