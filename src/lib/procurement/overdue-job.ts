import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { procurementNumber } from "@/lib/procurement/numbering"
import { notifyProcurement, purchasersOf } from "@/lib/procurement/notify"
import { emitPurchaseOrderOverdue } from "@/lib/procurement/events"

/**
 * Late suppliers (docs/sales-procurement/README.md, task 3.6). Once an hour:
 * an order whose expected date has passed while goods are still due is marked
 * `overdueAt`, gets a history row and notifies — once — the deal's owner, the
 * person who asked for it and purchasing. Moving the date clears the mark
 * (PATCH /orders/[id]) and the next pass judges the new date.
 */
const LATE_STATUSES = ["approved", "sent", "in_production", "in_transit", "partially_received"]
const BATCH = 200

export async function runProcurementOverdueJob(now = new Date()) {
  return withJobLease({ name: "procurement-overdue", ttlMs: 10 * 60_000 }, () => runWithRlsBypass(async () => {
    const due = await prisma.purchaseOrder.findMany({
      where: { status: { in: LATE_STATUSES }, expectedDeliveryAt: { lt: now }, overdueAt: null },
      select: { id: true, organizationId: true, seq: true, expectedDeliveryAt: true, createdById: true, supplier: { select: { name: true } }, deal: { select: { assignedTo: true } }, request: { select: { requestedById: true } } },
      orderBy: { expectedDeliveryAt: "asc" },
      take: BATCH,
    })
    let marked = 0
    for (const order of due) {
      // Compare-and-set: a date moved or goods received meanwhile wins.
      const claimed = await prisma.purchaseOrder.updateMany({
        where: { id: order.id, overdueAt: null, status: { in: LATE_STATUSES }, expectedDeliveryAt: order.expectedDeliveryAt },
        data: { overdueAt: now, overdueNotifiedAt: now },
      })
      if (claimed.count !== 1) continue
      marked += 1
      await prisma.purchaseOrderEvent.create({
        data: { organizationId: order.organizationId, orderId: order.id, type: "overdue", data: { expectedDeliveryAt: order.expectedDeliveryAt?.toISOString() ?? null } },
      })
      await notifyProcurement({
        orgId: order.organizationId,
        recipients: [order.deal?.assignedTo, order.request?.requestedById, order.createdById, ...(await purchasersOf(order.organizationId))],
        entityType: "purchase_order",
        entityId: order.id,
        event: { kind: "order.overdue", number: procurementNumber("order", order.seq), supplier: order.supplier.name, date: order.expectedDeliveryAt!.toISOString().slice(0, 10) },
      })
      await emitPurchaseOrderOverdue(order.organizationId, order.id)
    }
    return { checked: due.length, marked }
  }))
}
