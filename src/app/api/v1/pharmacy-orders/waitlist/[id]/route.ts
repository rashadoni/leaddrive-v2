import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { prisma } from "@/lib/prisma"
import { setWaitlistDismissed } from "@/lib/voice-agent/pharmacy/zeytun-waitlist"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }
const bodySchema = z.strictObject({ dismissed: z.boolean() })

/** A manager takes a product off the waiting list, or puts it back. */
export const PATCH = withRlsAuth("deals", "write", async (req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const done = await setWaitlistDismissed(prisma, { organizationId: auth.orgId, id: (await params).id,
    userId: auth.userId, dismissed: parsed.data.dismissed })
  return done ? NextResponse.json({ data: { ok: true } }) : NextResponse.json({ error: "not_found" }, { status: 404 })
})
