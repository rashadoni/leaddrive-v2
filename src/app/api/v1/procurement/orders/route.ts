import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { nextProcurementSeq, procurementNumber } from "@/lib/procurement/numbering"
import { SUPPLIER_CATEGORY } from "@/lib/procurement/suppliers"
import { isPurchaseOrderStatus } from "@/lib/procurement/order-status"
import { badRequest, canSeeProcurementCosts, conflict, notFound, readJsonBody, withoutPrices } from "@/lib/procurement/access"
import { isLate, orderLines, orderTotal, recordOrderEvent, type OrderLineInput } from "@/lib/procurement/orders"

/**
 * Purchase orders (task 3.3). Made from the quote purchasing chose — its lines,
 * prices and lead time — or by hand. A new order is a draft; it goes to the
 * supplier only after approval (`/orders/[id]/actions`).
 */

export const GET = withRlsAuth("procurement", "read", async (req, { orgId, role }) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const where: Prisma.PurchaseOrderWhereInput = {
    organizationId: orgId,
    ...(isPurchaseOrderStatus(status) ? { status } : {}),
    ...(status === "open" ? { status: { notIn: ["received", "cancelled"] } } : {}),
    ...(searchParams.get("dealId") ? { dealId: searchParams.get("dealId")! } : {}),
    ...(searchParams.get("supplierId") ? { supplierId: searchParams.get("supplierId")! } : {}),
    ...(searchParams.get("requestId") ? { requestId: searchParams.get("requestId")! } : {}),
    ...(searchParams.get("late") === "1" ? { overdueAt: { not: null }, status: { notIn: ["received", "cancelled"] } } : {}),
  }
  const rows = await prisma.purchaseOrder.findMany({
    where,
    orderBy: [{ seq: "desc" }],
    take: 300,
    select: {
      id: true, seq: true, status: true, currency: true, totalAmount: true, expectedDeliveryAt: true, overdueAt: true,
      createdAt: true, sentAt: true, receivedAt: true, revision: true, dealChangedAt: true,
      supplier: { select: { id: true, name: true } },
      deal: { select: { id: true, name: true } },
      request: { select: { id: true, seq: true } },
    },
  })
  const now = new Date()
  const orders = rows.map((row) => ({
    ...row,
    number: procurementNumber("order", row.seq),
    request: row.request ? { ...row.request, number: procurementNumber("request", row.request.seq) } : null,
    late: isLate(row, now),
  }))
  return NextResponse.json({ success: true, data: { orders: canSeeProcurementCosts(role) ? orders : withoutPrices(orders) } })
})

const lineSchema = z.object({
  name: z.string().trim().min(1).max(300),
  unit: z.string().trim().max(40).optional().nullable(),
  quantity: z.number().positive().max(1e9),
  unitPrice: z.number().min(0).max(1e12),
  requestItemId: z.string().max(64).optional().nullable(),
  dealLineItemId: z.string().max(64).optional().nullable(),
})

const createSchema = z.union([
  z.object({
    quoteId: z.string().min(1).max(64),
    expectedDeliveryAt: z.string().max(40).optional().nullable(),
    note: z.string().trim().max(4000).optional().nullable(),
  }).strict(),
  z.object({
    supplierId: z.string().min(1).max(64),
    requestId: z.string().max(64).optional().nullable(),
    dealId: z.string().max(64).optional().nullable(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default("AZN"),
    expectedDeliveryAt: z.string().max(40).optional().nullable(),
    note: z.string().trim().max(4000).optional().nullable(),
    items: z.array(lineSchema).min(1).max(200),
  }).strict(),
])

export const POST = withRlsAuth("procurement", "write", async (req, { orgId, userId }) => {
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = createSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const input = parsed.data

  let supplierId: string
  let requestId: string | null = null
  let dealId: string | null = null
  let quoteId: string | null = null
  let currency: string
  let lines: OrderLineInput[]
  let expected = input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt) : null

  if ("quoteId" in input) {
    const quote = await prisma.supplierQuote.findFirst({
      where: { id: input.quoteId, organizationId: orgId },
      include: { request: { select: { id: true, dealId: true, status: true } }, items: { include: { requestItem: true } } },
    })
    if (!quote) return notFound()
    if (["closed", "cancelled"].includes(quote.request.status)) return conflict("The request is closed", "REQUEST_NOT_OPEN")
    supplierId = quote.supplierId
    requestId = quote.requestId
    dealId = quote.request.dealId
    quoteId = quote.id
    currency = quote.currency
    lines = quote.items.map((item) => ({
      name: item.requestItem.name,
      unit: item.requestItem.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      requestItemId: item.requestItemId,
      dealLineItemId: item.requestItem.dealLineItemId,
    }))
    if (!expected && quote.leadTimeDays !== null) expected = new Date(Date.now() + quote.leadTimeDays * 86_400_000)
  } else {
    const supplier = await prisma.company.findFirst({ where: { id: input.supplierId, organizationId: orgId, category: SUPPLIER_CATEGORY }, select: { id: true } })
    if (!supplier) return badRequest("Not a supplier of this organization", "NOT_A_SUPPLIER")
    supplierId = supplier.id
    currency = input.currency
    lines = input.items
    if (input.requestId) {
      const request = await prisma.purchaseRequest.findFirst({ where: { id: input.requestId, organizationId: orgId }, select: { id: true, dealId: true, items: { select: { id: true } } } })
      if (!request) return badRequest("Unknown request", "UNKNOWN_REQUEST")
      requestId = request.id
      dealId = request.dealId
      const own = new Set(request.items.map((item) => item.id))
      if (lines.some((line) => line.requestItemId && !own.has(line.requestItemId))) return badRequest("A line is not on the request", "FOREIGN_LINE")
    } else if (lines.some((line) => line.requestItemId)) {
      return badRequest("Request lines need the request", "FOREIGN_LINE")
    }
    if (input.dealId && !dealId) {
      const deal = await prisma.deal.findFirst({ where: { id: input.dealId, organizationId: orgId }, select: { id: true } })
      if (!deal) return badRequest("Unknown deal", "UNKNOWN_DEAL")
      dealId = deal.id
    }
    if (dealId && lines.some((line) => line.dealLineItemId)) {
      const own = new Set((await prisma.dealLineItem.findMany({ where: { dealId, organizationId: orgId }, select: { id: true } })).map((line) => line.id))
      if (lines.some((line) => line.dealLineItemId && !own.has(line.dealLineItemId))) return badRequest("A line refers to another deal", "FOREIGN_LINE")
    } else if (!dealId && lines.some((line) => line.dealLineItemId)) {
      return badRequest("Deal lines need the deal", "FOREIGN_LINE")
    }
  }

  const stored = orderLines(orgId, lines)
  const order = await prisma.$transaction(async (tx) => {
    const seq = await nextProcurementSeq(tx, orgId, "order")
    const created = await tx.purchaseOrder.create({
      data: {
        organizationId: orgId,
        seq,
        supplierId,
        requestId,
        dealId,
        quoteId,
        currency,
        totalAmount: orderTotal(stored),
        expectedDeliveryAt: expected,
        note: input.note || null,
        createdById: userId,
        items: { create: stored },
      },
      select: { id: true, seq: true, status: true },
    })
    await recordOrderEvent(tx, { orgId, orderId: created.id, type: "created", actorId: userId, toStatus: "draft", data: { quoteId } })
    if (quoteId) await tx.supplierQuote.update({ where: { id: quoteId }, data: { status: "selected" } })
    if (requestId) {
      await tx.purchaseRequest.updateMany({ where: { id: requestId, organizationId: orgId, status: { in: ["submitted", "in_progress"] } }, data: { status: "ordered" } })
    }
    return created
  })
  const number = procurementNumber("order", order.seq)
  logAudit(orgId, "create", "purchase_order", order.id, number, { newValue: { supplierId, requestId, dealId, quoteId }, userId })
  return NextResponse.json({ success: true, data: { ...order, number } }, { status: 201 })
})
