import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { replaceCalendar } from "@/lib/calendar/connection"
import { readCalendarState } from "@/lib/calendar/oauth-state"
import { exchangeMicrosoftCode, microsoftCalendarConfigured, microsoftIdentity } from "@/lib/calendar/microsoft"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")
  const appUrl = process.env.NEXTAUTH_URL || "https://app.leaddrivecrm.org"
  const back = (reason: string) => NextResponse.redirect(`${appUrl}/settings/integrations?outlook=error&reason=${reason}`)

  if (error) return back(error)
  if (!code || !state) return back("missing_params")
  const verified = readCalendarState(state)
  if (!verified) return back("invalid_state")
  // The state says who consented; the database says whether that person still
  // works here. Both must agree before a credential is stored for them.
  const user = await runWithRlsBypass(() => prisma.user.findFirst({
    where: { id: verified.userId, organizationId: verified.orgId, isActive: true, organization: { isActive: true } },
    select: { id: true },
  }))
  if (!user) return back("invalid_state")
  if (!microsoftCalendarConfigured()) return back("not_configured")

  try {
    const tokens = await exchangeMicrosoftCode(code, `${appUrl}/api/v1/integrations/outlook-calendar/callback`)
    const identity = await microsoftIdentity(tokens.access_token)
    await runWithRlsBypass(() => prisma.$transaction((tx: Prisma.TransactionClient) => replaceCalendar(tx, verified.orgId, verified.userId, "microsoft", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expires_at === null ? null : tokens.expires_at * 1000,
      scope: tokens.scope,
    }, identity)))
    return NextResponse.redirect(`${appUrl}/settings/integrations?outlook=success`)
  } catch {
    console.error("[Outlook] OAuth callback failed", { code: "CALENDAR_CONNECT_FAILED" })
    return back("token_exchange")
  }
}
