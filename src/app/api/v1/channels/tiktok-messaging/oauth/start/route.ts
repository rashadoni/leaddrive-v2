import { NextRequest, NextResponse } from "next/server"
import { gateChannelsAccess } from "@/lib/channels-access"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { messagingConfig } from "@/lib/tiktok-messaging/config"
import { createMessagingState, messagingStateFingerprint } from "@/lib/tiktok-messaging/oauth-state"
import { beginMessagingAuthorization } from "@/lib/tiktok-messaging/store"

export const POST = withRlsSessionAuth(async (request: NextRequest, session) => {
  // The channel gate's grandfather query needs tenant RLS before it runs.
  const gate = await gateChannelsAccess(request)
  if (gate instanceof NextResponse) return gate
  if (gate.orgId !== session.orgId || gate.userId !== session.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  try {
    const config = messagingConfig()
    if (new URL(config.redirectUri).origin !== request.nextUrl.origin) throw new Error("tiktok_callback_origin_mismatch")
    const state = createMessagingState(gate.orgId, gate.userId)
    await beginMessagingAuthorization(gate.orgId, messagingStateFingerprint(state))
    const url = new URL(config.authorizationUrl)
    url.searchParams.set("state", state)
    url.searchParams.set("redirect_uri", config.redirectUri)
    url.searchParams.set("disable_auto_auth", "1")
    return NextResponse.json({ authorizationUrl: url.toString() }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "tiktok_messaging_connection_unavailable" }, { status: 503 })
  }
})
