import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Check for standalone google-calendar first, then SSO google
  const account = await prisma.account.findFirst({
    where: {
      userId: session.userId,
      provider: { in: ["google-calendar", "google"] },
      access_token: { not: null },
    },
    select: { provider: true, scope: true, expires_at: true, refresh_token: true },
    orderBy: { provider: "asc" }, // "google-calendar" before "google"
  })

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

  await prisma.account.deleteMany({
    where: { userId: session.userId, provider: "google-calendar" },
  })

  return NextResponse.json({ success: true })
})
