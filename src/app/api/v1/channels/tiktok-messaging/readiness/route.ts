import { NextRequest, NextResponse } from "next/server"
import { gateChannelsAccess } from "@/lib/channels-access"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readTikTokAccountReadiness } from "@/lib/tiktok-messaging/account-readiness"

/**
 * What still stands between this workspace and TikTok direct messages.
 *
 * Read-only, admin-only and behind the same channels gate as the connection status beside it: it
 * reports on a third-party grant, and it reaches TikTok with the workspace's own token.
 */
export const GET = withRlsSessionAuth(async (request: NextRequest, session) => {
  const gate = await gateChannelsAccess(request)
  if (gate instanceof NextResponse) return gate
  if (gate.orgId !== session.orgId || gate.userId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const readiness = await readTikTokAccountReadiness(gate.orgId)
  return NextResponse.json(
    { ready: readiness.ready, items: readiness.items, facts: readiness.facts },
    { headers: { "Cache-Control": "no-store" } },
  )
})
