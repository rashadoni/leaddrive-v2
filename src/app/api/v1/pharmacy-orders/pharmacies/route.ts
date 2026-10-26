import { NextResponse, type NextRequest } from "next/server"

import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { listPharmacies, PHARMACY_FILTERS, type PharmacyFilter } from "@/lib/pharmacy-orders/pharmacy-companies"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/** The pharmacies loaded from 1C with their order figures («Телефонные заказы → Аптеки»). */
export const GET = withRlsAuth("mtm", "read", async (req: NextRequest, auth) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const asked = req.nextUrl.searchParams.get("filter") ?? "all"
  const filter = (PHARMACY_FILTERS as readonly string[]).includes(asked) ? asked as PharmacyFilter : "all"
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80)
  return NextResponse.json({ data: await listPharmacies(prisma, auth.orgId, { filter, q }) })
})
