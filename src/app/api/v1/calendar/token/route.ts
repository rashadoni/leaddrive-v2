import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

export const GET = withRlsSessionAuth(async (_req, auth) => {
  const user = await prisma.user.findFirst({
    where: { id: auth.userId, organizationId: auth.orgId, isActive: true },
    select: { calendarToken: true },
  })

  const baseUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"

  return NextResponse.json({
    success: true,
    data: {
      token: user?.calendarToken || null,
      feedUrl: user?.calendarToken ? `${baseUrl}/api/v1/calendar/feed/${user.calendarToken}` : null,
    },
  })
})
