import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { setPhoneOrderPharmacy } from "@/lib/pharmacy-orders/pharmacy-companies"
import { prisma } from "@/lib/prisma"
import {
  applyPhoneOrderAction, getPhoneOrder, PhoneOrderError, phoneOrderActionSchema, phoneOrdersEnabled,
} from "@/lib/pharmacy-orders/orders"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

function failure(error: unknown) {
  if (error instanceof PhoneOrderError) return NextResponse.json({ error: error.code }, { status: error.status })
  throw error
}

export const GET = withRlsAuth("deals", "read", async (_req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  try {
    return NextResponse.json({ data: await getPhoneOrder(auth.orgId, (await params).id) })
  } catch (error) { return failure(error) }
})

/** Naming the pharmacy is allowed on a reviewed order too: it changes no line. */
const setPharmacySchema = z.strictObject({ action: z.literal("set_pharmacy"), revision: z.number().int().positive(),
  companyId: z.string().min(1).max(64) })

/** One manager action (confirm, reject, a line change, the pharmacy) under the order's revision. */
export const PATCH = withRlsAuth("deals", "write", async (req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const body = await req.json().catch(() => null)
  const id = (await params).id
  const pharmacy = setPharmacySchema.safeParse(body)
  if (pharmacy.success) {
    try {
      await setPhoneOrderPharmacy(prisma, auth.orgId, id, pharmacy.data.revision, pharmacy.data.companyId, auth.userId)
      return NextResponse.json({ data: await getPhoneOrder(auth.orgId, id) })
    } catch (error) { return failure(error) }
  }
  const parsed = phoneOrderActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 })
  try {
    return NextResponse.json({ data: await applyPhoneOrderAction(auth.orgId, auth.userId, id, parsed.data) })
  } catch (error) { return failure(error) }
})
