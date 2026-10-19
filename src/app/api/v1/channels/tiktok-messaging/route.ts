import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { gateChannelsAccess } from "@/lib/channels-access"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { auditChannelChange } from "@/lib/channels/channel-credential-audit"
import { messagingConfigured, messagingConfig, record, TIKTOK_MESSAGING_CHANNEL } from "@/lib/tiktok-messaging/config"
import { messagingIdentity, disconnectMessaging, retryMessagingSubscription } from "@/lib/tiktok-messaging/store"

export const GET = withRlsSessionAuth(async (request: NextRequest, session) => {
  const gate = await gateChannelsAccess(request)
  if (gate instanceof NextResponse) return gate
  if (gate.orgId !== session.orgId || gate.userId !== session.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const connection = await prisma.channelConnection.findUnique({
    where: { organizationId_platform_surface_provider: messagingIdentity(gate.orgId) },
    select: { status: true, settings: true, capabilities: true, tokenExpiresAt: true, lastInboundAt: true },
  })
  const settings = record(connection?.settings)
  const refreshValid = settings.grantVerified === true && typeof settings.refreshExpiresAt === "string" && Date.parse(settings.refreshExpiresAt) > Date.now()
  return NextResponse.json({
    configured: messagingConfigured() && new URL(messagingConfig().redirectUri).origin === request.nextUrl.origin,
    status: connection?.status === "connected" && !refreshValid ? "needs_access" : connection?.status ?? "needs_access",
    capabilities: connection?.capabilities ?? {},
    webhookSubscribed: settings.webhookSubscribed === true,
    lastInboundAt: connection?.lastInboundAt ?? null,
    tokenExpiresAt: connection?.tokenExpiresAt ?? null,
  }, { headers: { "Cache-Control": "no-store" } })
})

export const POST = withRlsSessionAuth(async (request: NextRequest, session) => {
  const gate = await gateChannelsAccess(request)
  if (gate instanceof NextResponse) return gate
  if (gate.orgId !== session.orgId || gate.userId !== session.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body || !["disconnect", "subscribe"].includes(body.action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  const connection = await prisma.channelConnection.findUnique({ where: { organizationId_platform_surface_provider: messagingIdentity(gate.orgId) } })
  if (!connection) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (body.action === "disconnect") {
    const revokeConfirmed = await disconnectMessaging(gate.orgId)
    await auditChannelChange({ req: request, orgId: gate.orgId, userId: gate.userId, action: "disconnect", channelId: connection.channelConfigId ?? connection.id, channelType: TIKTOK_MESSAGING_CHANNEL })
    return NextResponse.json({ success: true, revokeConfirmed })
  }
  if (connection.status !== "connected") return NextResponse.json({ error: "Not connected" }, { status: 409 })
  try {
    await retryMessagingSubscription(gate.orgId)
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: "tiktok_webhook_subscription_failed" }, { status: 502 }) }
})
