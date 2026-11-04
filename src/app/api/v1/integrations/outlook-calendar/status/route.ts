import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { disconnectCalendar } from "@/lib/calendar/connection"
import { MICROSOFT_ACCOUNT_PROVIDER } from "@/lib/calendar/providers"
import { microsoftCalendarConfigured } from "@/lib/calendar/microsoft"

export const GET = withRls(async (_req, { session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const account = await prisma.account.findFirst({
    where: { userId: session.userId, provider: MICROSOFT_ACCOUNT_PROVIDER, access_token: { not: null } },
    select: { expires_at: true, refresh_token: true },
  })
  // A connection with no refresh token dies when the hour is up, so it counts
  // as connected only while its token is still good.
  const expired = account?.expires_at ? account.expires_at * 1000 < Date.now() : false
  return NextResponse.json({ success: true, data: { connected: Boolean(account) && (Boolean(account?.refresh_token) || !expired), expired, configured: microsoftCalendarConfigured() } })
})

export const DELETE = withRls(async (_req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await prisma.$transaction((tx: Prisma.TransactionClient) => disconnectCalendar(tx, orgId, session.userId, "microsoft"))
  return NextResponse.json({ success: true })
})
