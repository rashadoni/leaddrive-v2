import { NextResponse, type NextRequest } from "next/server"

import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { prisma } from "@/lib/prisma"
import { listWaitlist } from "@/lib/voice-agent/pharmacy/zeytun-waitlist"
import { withRlsAuth } from "@/lib/with-rls"

/** «Телефонные заказы → Лист ожидания»: what pharmacies wanted on the line while it was sold out. */
export const GET = withRlsAuth("deals", "read", async (_req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ data: await listWaitlist(prisma, auth.orgId) })
})
