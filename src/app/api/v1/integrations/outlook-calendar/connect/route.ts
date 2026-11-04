import { NextResponse } from "next/server"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { signCalendarState } from "@/lib/calendar/oauth-state"
import { microsoftAuthorizeUrl, microsoftCalendarConfigured } from "@/lib/calendar/microsoft"

export const GET = withRlsSessionAuth(async (_req, session) => {
  if (!microsoftCalendarConfigured()) return NextResponse.json({ error: "Microsoft OAuth not configured" }, { status: 500 })
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/v1/integrations/outlook-calendar/callback`
  return NextResponse.json({ success: true, url: microsoftAuthorizeUrl(redirectUri, signCalendarState(session.userId, session.orgId)) })
})
