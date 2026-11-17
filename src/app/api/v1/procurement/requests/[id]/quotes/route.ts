import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { SUPPLIER_CATEGORY } from "@/lib/procurement/suppliers"
import { badRequest, conflict, notFound, readJsonBody } from "@/lib/procurement/access"

/**
 * A supplier's answer to a purchase request (task 3.2): a price and a lead time
 * for each line it quotes. Several quotes make the comparison table; one is
 * then chosen and becomes a purchase order.
 */
type Ctx = { params: Promise<{ id: string }> }

const quoteSchema = z.object({
  supplierId: z.string().min(1).max(64),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("AZN"),
  validUntil: z.string().max(40).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  terms: z.string().trim().max(2000).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  items: z.array(z.object({
    requestItemId: z.string().min(1).max(64),
    quantity: z.number().positive().max(1e9),
    unitPrice: z.number().min(0).max(1e12),
    leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
  })).min(1).max(200),
}).strict()

export const POST = withRlsAuth("procurement", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = quoteSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const input = parsed.data

  const request = await prisma.purchaseRequest.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, items: { select: { id: true } } },
  })
  if (!request) return notFound()
  if (["draft", "closed", "cancelled"].includes(request.status)) return conflict(`A ${request.status} request takes no quotes`, "REQUEST_NOT_OPEN")
  const supplier = await prisma.company.findFirst({ where: { id: input.supplierId, organizationId: orgId, category: SUPPLIER_CATEGORY }, select: { id: true, name: true } })
  if (!supplier) return badRequest("Not a supplier of this organization", "NOT_A_SUPPLIER")
  const lines = new Set(request.items.map((item) => item.id))
  if (input.items.some((item) => !lines.has(item.requestItemId))) return badRequest("A line is not on this request", "FOREIGN_LINE")
  if (new Set(input.items.map((item) => item.requestItemId)).size !== input.items.length) return badRequest("A line is quoted twice", "DUPLICATE_LINE")

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierQuote.create({
      data: {
        organizationId: orgId,
        requestId: id,
        supplierId: supplier.id,
        currency: input.currency,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        leadTimeDays: input.leadTimeDays ?? null,
        terms: input.terms || null,
        note: input.note || null,
        createdById: userId,
        items: {
          create: input.items.map((item) => ({
            organizationId: orgId,
            requestItemId: item.requestItemId,
            quantity: new Prisma.Decimal(item.quantity),
            unitPrice: new Prisma.Decimal(item.unitPrice),
            leadTimeDays: item.leadTimeDays ?? null,
            note: item.note || null,
          })),
        },
      },
      select: { id: true },
    })
    // Purchasing working on quotes is purchasing having taken the request.
    await tx.purchaseRequest.updateMany({ where: { id, organizationId: orgId, status: "submitted" }, data: { status: "in_progress", assignedToId: userId } })
    return created
  })
  logAudit(orgId, "create", "supplier_quote", quote.id, supplier.name, { newValue: { requestId: id, lines: input.items.length }, userId })
  return NextResponse.json({ success: true, data: quote }, { status: 201 })
})
