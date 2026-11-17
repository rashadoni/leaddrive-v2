import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { procurementNumber } from "@/lib/procurement/numbering"
import { SUPPLIER_CATEGORY } from "@/lib/procurement/suppliers"
import { EDITABLE_STATUSES, CLOSED_STATUSES, type PurchaseOrderStatus } from "@/lib/procurement/order-status"
import { badRequest, canSeeProcurementCosts, conflict, notFound, readJsonBody, withoutPrices } from "@/lib/procurement/access"
import { ORDER_DETAIL_INCLUDE, isLate, orderLines, orderTotal, presentOrder, recordOrderEvent } from "@/lib/procurement/orders"
import { notifyProcurement } from "@/lib/procurement/notify"

type Ctx = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("procurement", "read", async (_req, { orgId, role }, { params }: Ctx) => {
  const { id } = await params
  const order = await prisma.purchaseOrder.findFirst({ where: { id, organizationId: orgId }, include: ORDER_DETAIL_INCLUDE })
  if (!order) return notFound()
  const data = { ...presentOrder(order), late: isLate(order) }
  return NextResponse.json({ success: true, data: canSeeProcurementCosts(role) ? data : withoutPrices(data) })
})

const patchSchema = z.object({
  /** Document fields — only while the order is a draft or was rejected. */
  supplierId: z.string().min(1).max(64).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  note: z.string().trim().max(4000).optional().nullable(),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(300),
    unit: z.string().trim().max(40).optional().nullable(),
    quantity: z.number().positive().max(1e9),
    unitPrice: z.number().min(0).max(1e12),
    requestItemId: z.string().max(64).optional().nullable(),
    dealLineItemId: z.string().max(64).optional().nullable(),
  })).min(1).max(200).optional(),
  /** The expected delivery date — any time until the goods are in; a move after sending needs a reason. */
  expectedDeliveryAt: z.string().max(40).nullable().optional(),
  deliveryNote: z.string().trim().max(500).optional(),
  /** Purchasing saw the change in the deal. */
  acknowledgeDealChange: z.boolean().optional(),
}).strict()

export const PATCH = withRlsAuth("procurement", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = patchSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const input = parsed.data

  const order = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, seq: true, status: true, revision: true, expectedDeliveryAt: true, dealId: true, requestId: true, createdById: true, deal: { select: { assignedTo: true } }, request: { select: { requestedById: true } }, supplier: { select: { name: true } } },
  })
  if (!order) return notFound()
  const status = order.status as PurchaseOrderStatus
  const editsDocument = input.supplierId !== undefined || input.currency !== undefined || input.items !== undefined || input.note !== undefined
  if (editsDocument && !EDITABLE_STATUSES.includes(status)) {
    return conflict("Only a draft or a rejected order is edited; cancel it and make a new one", "NOT_EDITABLE")
  }
  if (input.expectedDeliveryAt !== undefined && CLOSED_STATUSES.includes(status)) {
    return conflict("The order is closed", "ORDER_CLOSED")
  }
  const movesSentDate = input.expectedDeliveryAt !== undefined && !EDITABLE_STATUSES.includes(status) && status !== "pending_approval" && status !== "approved"
  if (movesSentDate && !input.deliveryNote) return badRequest("Say why the date moved", "REASON_REQUIRED")
  if (input.supplierId) {
    const supplier = await prisma.company.findFirst({ where: { id: input.supplierId, organizationId: orgId, category: SUPPLIER_CATEGORY }, select: { id: true } })
    if (!supplier) return badRequest("Not a supplier of this organization", "NOT_A_SUPPLIER")
  }
  if (input.items && order.dealId && input.items.some((item) => item.dealLineItemId)) {
    const own = new Set((await prisma.dealLineItem.findMany({ where: { dealId: order.dealId, organizationId: orgId }, select: { id: true } })).map((line) => line.id))
    if (input.items.some((item) => item.dealLineItemId && !own.has(item.dealLineItemId))) return badRequest("A line refers to another deal", "FOREIGN_LINE")
  }
  if (input.items && input.items.some((item) => item.requestItemId)) {
    const own = new Set(order.requestId ? (await prisma.purchaseRequestItem.findMany({ where: { requestId: order.requestId, organizationId: orgId }, select: { id: true } })).map((line) => line.id) : [])
    if (input.items.some((item) => item.requestItemId && !own.has(item.requestItemId))) return badRequest("A line is not on the request", "FOREIGN_LINE")
  }

  const newDate = input.expectedDeliveryAt === undefined ? undefined : input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt) : null
  if (newDate && Number.isNaN(newDate.getTime())) return badRequest("Invalid date")

  const updated = await prisma.$transaction(async (tx) => {
    const stored = input.items ? orderLines(orgId, input.items) : null
    // A rejected order that is edited starts a new revision: the old chain stays as history.
    const nextRevision = editsDocument && status === "rejected" ? order.revision + 1 : order.revision
    const moved = await tx.purchaseOrder.updateMany({
      where: { id, organizationId: orgId, status: order.status, revision: order.revision },
      data: {
        ...(input.supplierId ? { supplierId: input.supplierId, quoteId: null } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
        ...(stored ? { totalAmount: orderTotal(stored) } : {}),
        ...(newDate !== undefined ? { expectedDeliveryAt: newDate, overdueAt: null, overdueNotifiedAt: null } : {}),
        ...(input.acknowledgeDealChange ? { dealChangedAt: null } : {}),
        ...(editsDocument && status === "rejected" ? { status: "draft", revision: nextRevision } : {}),
      },
    })
    if (moved.count !== 1) return null
    if (stored) {
      await tx.purchaseOrderItem.deleteMany({ where: { orderId: id, organizationId: orgId } })
      await tx.purchaseOrderItem.createMany({ data: stored.map((line) => ({ ...line, orderId: id })) })
    }
    if (editsDocument) {
      await recordOrderEvent(tx, { orgId, orderId: id, type: "edited", actorId: userId, fromStatus: order.status, toStatus: status === "rejected" ? "draft" : order.status, data: { revision: nextRevision } })
    }
    if (newDate !== undefined) {
      await recordOrderEvent(tx, {
        orgId, orderId: id, type: "delivery_date", actorId: userId,
        data: { from: order.expectedDeliveryAt?.toISOString() ?? null, to: newDate?.toISOString() ?? null, note: input.deliveryNote ?? null },
      })
    }
    return true
  })
  if (!updated) return conflict("The order changed meanwhile — reload it", "STALE")
  const number = procurementNumber("order", order.seq)
  logAudit(orgId, "update", "purchase_order", id, number, { oldValue: { status: order.status }, newValue: input, userId })
  if (movesSentDate && newDate) {
    await notifyProcurement({
      orgId, actorId: userId, entityType: "purchase_order", entityId: id,
      recipients: [order.deal?.assignedTo, order.request?.requestedById, order.createdById],
      event: { kind: "order.delivery_moved", number, supplier: order.supplier.name, date: newDate.toISOString().slice(0, 10) },
    })
  }
  return NextResponse.json({ success: true })
})
