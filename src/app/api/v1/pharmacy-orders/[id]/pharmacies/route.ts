import { NextResponse, type NextRequest } from "next/server"

import { PhoneOrderError, phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { orderPharmacyCandidates } from "@/lib/pharmacy-orders/pharmacy-companies"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

/** Pharmacies to name the order with: the caller's number's ones, or a search (`q`). */
export const GET = withRlsAuth("deals", "read", async (req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  try {
    const query = req.nextUrl.searchParams.get("q") ?? ""
    return NextResponse.json({ data: await orderPharmacyCandidates(prisma, auth.orgId, (await params).id, query) })
  } catch (error) {
    if (error instanceof PhoneOrderError) return NextResponse.json({ error: error.code }, { status: error.status })
    throw error
  }
})
