import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { procurementNumber } from "@/lib/procurement/numbering"
import { RECEIVABLE_STATUSES, type PurchaseOrderStatus } from "@/lib/procurement/order-status"
import { badRequest, conflict, notFound, readJsonBody } from "@/lib/procurement/access"
import { recordOrderEvent } from "@/lib/procurement/orders"
import { notifyProcurement } from "@/lib/procurement/notify"
import { emitPurchaseOrderStatus } from "@/lib/procurement/events"

/**
 * Goods in (task 3.5): the quantity that arrived now, per line. A line never
 * receives more than was ordered (also a CHECK in the table). Everything in —
 * the order is received; part of it — partially received. Receipt is a status
 * of the order, not a stock movement: the warehouse is the ERP card process.
 */
type Ctx = { params: Promise<{ id: string }> }

const receiveSchema = z.object({
  items: z.array(z.object({ itemId: z.string().min(1).max(64), quantity: z.number().positive().max(1e9) })).min(1).max(200),
  note: z.string().trim().max(500).optional(),
}).strict()

type Outcome = { ok: false; response: Response } | { ok: true; seq: number; to: string; supplier: string; recipients: (string | null)[] }

export const POST = withRlsAuth("procurement", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = receiveSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const input = parsed.data
  if (new Set(input.items.map((item) => item.itemId)).size !== input.items.length) return badRequest("A line is listed twice", "DUPLICATE_LINE")

  const outcome: Outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "purchase_orders" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
    if (locked.length === 0) return { ok: false, response: notFound() }
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: { seq: true, status: true, createdById: true, supplier: { select: { name: true } }, deal: { select: { assignedTo: true } }, request: { select: { requestedById: true } }, items: { select: { id: true, name: true, quantity: true, receivedQuantity: true } } },
    })
    if (!RECEIVABLE_STATUSES.includes(order.status as PurchaseOrderStatus)) {
      return { ok: false, response: conflict(`A ${order.status} order takes no goods`, "NOT_RECEIVABLE") }
    }
    type Line = { id: string; name: string; quantity: Prisma.Decimal; receivedQuantity: Prisma.Decimal }
    const lines = new Map<string, Line>(order.items.map((item: Line) => [item.id, item]))
    for (const entry of input.items) {
      const line = lines.get(entry.itemId)
      if (!line) return { ok: false, response: badRequest("A line is not on this order", "FOREIGN_LINE") }
      const after = line.receivedQuantity.add(new Prisma.Decimal(entry.quantity))
      if (after.greaterThan(line.quantity)) {
        return { ok: false, response: conflict(`More than ordered for «${line.name}»`, "OVER_RECEIPT") }
      }
    }
    for (const entry of input.items) {
      await tx.purchaseOrderItem.update({ where: { id: entry.itemId }, data: { receivedQuantity: { increment: new Prisma.Decimal(entry.quantity) } } })
    }
    const after = await tx.purchaseOrderItem.findMany({ where: { orderId: id }, select: { quantity: true, receivedQuantity: true } })
    const complete = after.every((line: { quantity: Prisma.Decimal; receivedQuantity: Prisma.Decimal }) => line.receivedQuantity.greaterThanOrEqualTo(line.quantity))
    const to = complete ? "received" : "partially_received"
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: to, ...(complete ? { receivedAt: new Date(), overdueAt: null } : {}) },
    })
    await recordOrderEvent(tx, { orgId, orderId: id, type: "receipt", actorId: userId, fromStatus: order.status, toStatus: to, data: { items: input.items, note: input.note ?? null } })
    return { ok: true, seq: order.seq, to, supplier: order.supplier.name, recipients: [order.deal?.assignedTo ?? null, order.request?.requestedById ?? null, order.createdById] }
  })
  if (!outcome.ok) return outcome.response
  const number = procurementNumber("order", outcome.seq)
  logAudit(orgId, "receive", "purchase_order", id, number, { newValue: { status: outcome.to, items: input.items }, userId })
  await notifyProcurement({
    orgId, actorId: userId, recipients: outcome.recipients, entityType: "purchase_order", entityId: id,
    event: { kind: "order.received", number, supplier: outcome.supplier, partial: outcome.to !== "received" },
  })
  await emitPurchaseOrderStatus(orgId, id, null, outcome.to)
  return NextResponse.json({ success: true, data: { status: outcome.to } })
})
