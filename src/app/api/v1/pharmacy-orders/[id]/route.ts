import { NextResponse, type NextRequest } from "next/server"

import {
  applyPhoneOrderAction, getPhoneOrder, PhoneOrderError, phoneOrderActionSchema, phoneOrdersEnabled,
} from "@/lib/pharmacy-orders/orders"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

function failure(error: unknown) {
  if (error instanceof PhoneOrderError) return NextResponse.json({ error: error.code }, { status: error.status })
  throw error
}

export const GET = withRlsAuth("mtm", "read", async (_req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  try {
    return NextResponse.json({ data: await getPhoneOrder(auth.orgId, (await params).id) })
  } catch (error) { return failure(error) }
})

/** One manager action (confirm, reject, a line change) under the order's revision. */
export const PATCH = withRlsAuth("mtm", "write", async (req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const parsed = phoneOrderActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 })
  try {
    return NextResponse.json({ data: await applyPhoneOrderAction(auth.orgId, auth.userId, (await params).id, parsed.data) })
  } catch (error) { return failure(error) }
})
