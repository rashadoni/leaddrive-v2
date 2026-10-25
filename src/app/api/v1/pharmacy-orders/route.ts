import { NextResponse, type NextRequest } from "next/server"

import { listPhoneOrders, phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { withRlsAuth } from "@/lib/with-rls"

const STATUSES = new Set(["pending_review", "confirmed", "rejected"])

/** Phone orders the AI operator took, newest first. */
export const GET = withRlsAuth("mtm", "read", async (req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const status = req.nextUrl.searchParams.get("status")
  return NextResponse.json({ data: await listPhoneOrders(auth.orgId, status && STATUSES.has(status) ? status : undefined) })
})
