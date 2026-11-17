import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Versions of a commercial offer (docs/sales-procurement/README.md, task 5.1).
 * Every version is its own quote row with the same number and the next
 * `version`; the earlier ones stay as they were — what the customer was sent
 * is never rewritten.
 *
 * GET  — all versions of this quote's number, newest first, with their lines
 *        (the screen compares two of them).
 * POST — a new draft version copied from this one: lines, prices, discounts,
 *        notes, the deal. Taken under an advisory lock on the number, so two
 *        clicks give two numbers, not a unique-key error.
 *
 * Scope `offers`, as the other quote routes (see quotes/[id]/pdf).
 */
type Ctx = { params: Promise<{ id: string }> }

type LineRow = {
  productId: string | null; productName: string; description: string | null; sku: string | null; productType: string
  quantity: { toString(): string }; unitPrice: { toString(): string }; lineDiscountAmount: { toString(): string }; lineDiscountPct: { toString(): string } | null
  lineTotal: { toString(): string }; sortOrder: number
}

export const GET = withRlsAuth("offers", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const quote = await prisma.quote.findFirst({ where: { id, organizationId: orgId }, select: { quoteNumber: true } })
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  const versions = await prisma.quote.findMany({
    where: { organizationId: orgId, quoteNumber: quote.quoteNumber },
    orderBy: { version: "desc" },
    select: {
      id: true, version: true, status: true, currency: true, subtotal: true, discountAmount: true, totalAmount: true, createdAt: true, sentAt: true, acceptedAt: true,
      lineItems: { orderBy: { sortOrder: "asc" }, select: { productName: true, quantity: true, unitPrice: true, lineTotal: true } },
    },
  })
  return NextResponse.json({ success: true, data: versions })
})

export const POST = withRlsAuth("offers", "write", async (_req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const source = await prisma.quote.findFirst({
    where: { id, organizationId: orgId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  })
  if (!source) return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-version:${orgId}:${source.quoteNumber}`})::bigint)`
    const latest = await tx.quote.aggregate({ where: { organizationId: orgId, quoteNumber: source.quoteNumber }, _max: { version: true } })
    const version = (latest._max.version ?? source.version) + 1
    return tx.quote.create({
      data: {
        organizationId: orgId,
        quoteNumber: source.quoteNumber,
        version,
        dealId: source.dealId,
        status: "draft",
        validUntil: source.validUntil,
        currency: source.currency,
        subtotal: source.subtotal,
        discountAmount: source.discountAmount,
        discountPct: source.discountPct,
        totalAmount: source.totalAmount,
        notes: source.notes,
        customerName: source.customerName,
        createdBy: userId,
        lineItems: {
          create: (source.lineItems as LineRow[]).map((line) => ({
            productId: line.productId,
            productName: line.productName,
            description: line.description,
            sku: line.sku,
            productType: line.productType,
            quantity: line.quantity.toString(),
            unitPrice: line.unitPrice.toString(),
            lineDiscountAmount: line.lineDiscountAmount.toString(),
            lineDiscountPct: line.lineDiscountPct === null ? null : line.lineDiscountPct.toString(),
            lineTotal: line.lineTotal.toString(),
            sortOrder: line.sortOrder,
          })),
        },
      },
      select: { id: true, quoteNumber: true, version: true },
    })
  })
  logAudit(orgId, "new_version", "quote", created.id, `${created.quoteNumber} v${created.version}`, { newValue: { from: id, version: created.version }, userId })
  return NextResponse.json({ success: true, data: created }, { status: 201 })
})
