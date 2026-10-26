/**
 * A deal's product lines (src/lib/deals/line-items.ts). GET reads them with the
 * deal's currency and total; PUT replaces them all and, when there are any,
 * sets the deal's amount to their sum.
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { dealLinesInputSchema, DealLinesError, readDealLines, replaceDealLines } from "@/lib/deals/line-items"

type Ctx = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("deals", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const data = await readDealLines(orgId, id)
  if (!data) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  return NextResponse.json({ success: true, data })
})

export const PUT = withRlsAuth("deals", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const parsed = dealLinesInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid lines", code: "INVALID_LINES" }, { status: 400 })
  try {
    return NextResponse.json({ success: true, data: await replaceDealLines(orgId, userId ?? null, id, parsed.data.lines) })
  } catch (error) {
    if (error instanceof DealLinesError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "DEAL_NOT_FOUND" ? 404 : 400 })
    throw error
  }
})
