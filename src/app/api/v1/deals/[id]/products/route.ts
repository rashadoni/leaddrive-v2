/**
 * «Next best offers» on a deal. POST adds the product as a line of the deal
 * (src/lib/deals/line-items.ts), so it counts in the deal's amount. Until
 * 2026-10-26 it was appended to deal.metadata.products, which no screen read
 * and which changed nothing. GET lists the lines; DELETE removes the product's
 * lines.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { addProductLine, DealLinesError, readDealLines, replaceDealLines } from "@/lib/deals/line-items"

type Ctx = { params: Promise<{ id: string }> }
const productSchema = z.object({ productId: z.string().trim().min(1).max(200) })

export const GET = withRlsAuth("deals", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const data = await readDealLines(orgId, id)
  if (!data) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: data.lines })
})

export const POST = withRlsAuth("deals", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const parsed = productSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "productId is required" }, { status: 400 })
  const current = await readDealLines(orgId, id)
  if (!current) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  if (current.lines.some((line) => line.productId === parsed.data.productId)) {
    return NextResponse.json({ error: "Product already added" }, { status: 409 })
  }
  try {
    return NextResponse.json({ success: true, data: await addProductLine(orgId, userId ?? null, id, parsed.data.productId) })
  } catch (error) {
    if (error instanceof DealLinesError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "DEAL_NOT_FOUND" ? 404 : 400 })
    throw error
  }
})

export const DELETE = withRlsAuth("deals", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const parsed = productSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "productId is required" }, { status: 400 })
  const current = await readDealLines(orgId, id)
  if (!current) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  const lines = current.lines
    .filter((line) => line.productId !== parsed.data.productId)
    .map(({ productId, name, sku, quantity, unitPrice, discountPct }) => ({ productId, name, sku, quantity, unitPrice, discountPct }))
  return NextResponse.json({ success: true, data: await replaceDealLines(orgId, userId ?? null, id, lines) })
})
