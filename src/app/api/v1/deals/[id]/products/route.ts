import { NextResponse } from "next/server"
import { z } from "zod"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

// This route had no schema at all: `const { productId, name, price, currency } =
// body` went verbatim into deal.metadata.products[]. `price` accepted -99999, a
// string, an object or 1e308, and GET reads it straight back out. The catalog
// itself is bounded (src/lib/products/pricing.ts), so the same field concept
// was validated on Product and unvalidated here — the bypass the 2026-08 re-test
// found for finding 15.
//
// Bounded rather than merely typed: the array lives in a JSON column with no
// row-level cap, so MAX_DEAL_PRODUCTS keeps one deal's metadata from growing
// without limit.
const MAX_DEAL_PRODUCTS = 200

const addProductSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  price: nonNegativeFinancialAmountSchema,
  currency: z.string().trim().min(1).max(10).optional(),
}).strict()

// GET — list products attached to deal (stored in deal.metadata.products)
export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const deal = await prisma.deal.findFirst({
    where: { id, organizationId: orgId },
    select: { metadata: true },
  })
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

  const products = (deal.metadata as any)?.products || []

  return NextResponse.json({ success: true, data: products })
})

// POST — add product to deal
export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const deal = await prisma.deal.findFirst({
    where: { id, organizationId: orgId },
    select: { metadata: true },
  })
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = addProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { productId, name, price, currency } = parsed.data

  const metadata = (deal.metadata as any) || {}
  const products = metadata.products || []

  // Don't add duplicates
  if (products.some((p: any) => p.productId === productId)) {
    return NextResponse.json({ error: "Product already added" }, { status: 409 })
  }

  if (products.length >= MAX_DEAL_PRODUCTS) {
    return NextResponse.json(
      { error: `A deal cannot hold more than ${MAX_DEAL_PRODUCTS} products` },
      { status: 400 },
    )
  }

  products.push({
    productId,
    name,
    price,
    currency: currency || DEFAULT_CURRENCY,
    addedAt: new Date().toISOString(),
  })

  await prisma.deal.updateMany({
    where: { id, organizationId: orgId },
    data: { metadata: { ...metadata, products } },
  })

  return NextResponse.json({ success: true, data: products })
})

// DELETE — remove product from deal
export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json()
  const { productId } = body

  const deal = await prisma.deal.findFirst({
    where: { id, organizationId: orgId },
    select: { metadata: true },
  })
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

  const metadata = (deal.metadata as any) || {}
  const products = (metadata.products || []).filter((p: any) => p.productId !== productId)

  await prisma.deal.updateMany({
    where: { id, organizationId: orgId },
    data: { metadata: { ...metadata, products } },
  })

  return NextResponse.json({ success: true, data: products })
})
