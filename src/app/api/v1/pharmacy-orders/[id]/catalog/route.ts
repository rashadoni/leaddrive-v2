import { NextResponse, type NextRequest } from "next/server"

import { PhoneOrderError, phoneOrdersEnabled, searchPhoneOrderCatalog } from "@/lib/pharmacy-orders/orders"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

/** The order's catalog for the manager's "pick a product": newest snapshot, eight items. */
export const GET = withRlsAuth("deals", "read", async (req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const text = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (text.length < 2) return NextResponse.json({ data: { items: [] } })
  try {
    return NextResponse.json({ data: await searchPhoneOrderCatalog(auth.orgId, (await params).id, text) })
  } catch (error) {
    if (error instanceof PhoneOrderError) return NextResponse.json({ error: error.code }, { status: error.status })
    throw error
  }
})
