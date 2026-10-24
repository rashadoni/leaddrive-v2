import { calendarAccount } from "@/lib/google-calendar-account"
import type { Prisma } from "@prisma/client"
import { disconnectCalendarConnection } from "@/lib/google-calendar-connection"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const selected = await calendarAccount(prisma, session.userId)
  const account = selected ? await prisma.account.findFirst({
    where: {
      userId: session.userId,
      id: selected.id,
      access_token: { not: null },
    },
    select: { provider: true, scope: true, expires_at: true, refresh_token: true },
  }) : null

  // Consider connected only if has refresh_token OR token not expired
  const hasRefreshToken = !!account?.refresh_token
  const expired = account?.expires_at ? account.expires_at * 1000 < Date.now() : false
  const connected = !!account && (hasRefreshToken || !expired)

  return NextResponse.json({
    success: true,
    data: { connected, expired, provider: account?.provider || null },
  })
})

export const DELETE = withRls(async (_req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await prisma.$transaction((tx: Prisma.TransactionClient) => disconnectCalendarConnection(tx, orgId, session.userId))

  return NextResponse.json({ success: true })
})
