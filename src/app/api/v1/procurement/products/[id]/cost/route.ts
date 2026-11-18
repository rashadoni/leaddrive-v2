import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { badRequest, canSeeProcurementCosts, notFound, readJsonBody } from "@/lib/procurement/access"
import { ProductCostError, productCostInputSchema, readProductCost, saveProductCost } from "@/lib/procurement/product-costs"

/**
 * A product's purchase price, default supplier and lead time (task 2.2).
 * Read: `procurement-costs`. Change: purchasing work (`procurement` write) by
 * someone who may see what it costs — management and purchasing, not finance
 * (reads only) and never sales.
 */
type Ctx = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("procurement-costs", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const cost = await readProductCost(orgId, id)
  if (!cost) return notFound()
  return NextResponse.json({ success: true, data: cost })
})

export const PUT = withRlsAuth("procurement", "write", async (req, { orgId, userId, role }, { params }: Ctx) => {
  if (!canSeeProcurementCosts(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = productCostInputSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  try {
    return NextResponse.json({ success: true, data: await saveProductCost(orgId, userId ?? null, id, parsed.data) })
  } catch (error) {
    if (error instanceof ProductCostError) {
      return error.code === "PRODUCT_NOT_FOUND" ? notFound() : badRequest(error.message, error.code)
    }
    throw error
  }
})
