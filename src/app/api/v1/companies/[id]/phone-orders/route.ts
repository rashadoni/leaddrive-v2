import { NextResponse, type NextRequest } from "next/server"

import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { companyPhoneOrders } from "@/lib/pharmacy-orders/pharmacy-companies"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

/** A pharmacy's phone orders for its card's «Заказы» tab. */
export const GET = withRlsAuth("mtm", "read", async (_req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ data: await companyPhoneOrders(prisma, auth.orgId, (await params).id) })
})
