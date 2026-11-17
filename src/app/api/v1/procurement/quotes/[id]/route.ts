import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { badRequest, conflict, notFound, readJsonBody } from "@/lib/procurement/access"

/** Choose or reject a supplier quote; delete one that no order came from. */
type Ctx = { params: Promise<{ id: string }> }

const patchSchema = z.object({ status: z.enum(["received", "selected", "rejected"]) }).strict()

export const PATCH = withRlsAuth("procurement", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = patchSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const quote = await prisma.supplierQuote.findFirst({ where: { id, organizationId: orgId }, select: { id: true, status: true } })
  if (!quote) return notFound()
  await prisma.supplierQuote.update({ where: { id }, data: { status: parsed.data.status } })
  logAudit(orgId, "update", "supplier_quote", id, id, { oldValue: { status: quote.status }, newValue: parsed.data, userId })
  return NextResponse.json({ success: true })
})

export const DELETE = withRlsAuth("procurement", "delete", async (_req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const quote = await prisma.supplierQuote.findFirst({ where: { id, organizationId: orgId }, select: { id: true, _count: { select: { orders: true } } } })
  if (!quote) return notFound()
  if (quote._count.orders > 0) return conflict("An order was made from this quote", "QUOTE_HAS_ORDERS")
  await prisma.supplierQuote.delete({ where: { id } })
  logAudit(orgId, "delete", "supplier_quote", id, id, { userId })
  return NextResponse.json({ success: true })
})
