/**
 * PATCH /api/v1/users/me/availability
 *
 * Lets any authenticated user toggle their own isAvailable flag without
 * requiring the settings/write permission that PUT /api/v1/users/[id] needs.
 * Used by the Agent Desktop availability toggle.
 *
 * Body: { isAvailable: boolean }
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

const schema = z.object({
  isAvailable: z.boolean(),
})

export const PATCH = withRlsSessionAuth(async (req, session) => {
  const { orgId, userId } = session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const user = await prisma.user.updateMany({
      where: { id: userId, organizationId: orgId },
      data: { isAvailable: parsed.data.isAvailable },
    })

    if (user.count === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { isAvailable: parsed.data.isAvailable } })
  } catch (e) {
    console.error("[me/availability]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
