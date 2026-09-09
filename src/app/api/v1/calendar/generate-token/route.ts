import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import crypto from "crypto"
import { withRlsSessionAuth } from "@/lib/with-rls"

export const POST = withRlsSessionAuth(async (_req, auth) => {
  const user = await prisma.user.findFirst({
    where: { id: auth.userId, organizationId: auth.orgId, isActive: true },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const token = crypto.randomBytes(32).toString("base64url")

  await prisma.user.update({
    where: { id: user.id },
    data: { calendarToken: token },
  })

  const baseUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"

  return NextResponse.json({
    success: true,
    data: {
      token,
      feedUrl: `${baseUrl}/api/v1/calendar/feed/${token}`,
    },
  })
})
