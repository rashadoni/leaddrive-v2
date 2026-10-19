import { NextRequest, NextResponse } from "next/server"
import { gateChannelsAccess } from "@/lib/channels-access"
import { auditChannelChange } from "@/lib/channels/channel-credential-audit"
import { messagingConfig, requiredMessagingScopes, TIKTOK_MESSAGING_CHANNEL, TIKTOK_MESSAGING_RETURN_PATH, TIKTOK_MESSAGING_WEBHOOK_PATH } from "@/lib/tiktok-messaging/config"
import { exchangeMessagingCode, verifyMessagingAccountAccess, subscribeMessagingWebhook, verifyMessagingGrant, TikTokMessagingError } from "@/lib/tiktok-messaging/api"
import { consumeMessagingAuthorization, saveMessagingConnection } from "@/lib/tiktok-messaging/store"
import { messagingStateFingerprint, verifyMessagingState } from "@/lib/tiktok-messaging/oauth-state"

export async function GET(request: NextRequest) {
  const gate = await gateChannelsAccess(request)
  if (gate instanceof NextResponse) return gate
  const finish = (result: string) => {
    // Fixed relative path; never echo provider error text or auth codes.
    const url = new URL(TIKTOK_MESSAGING_RETURN_PATH, request.nextUrl.origin)
    url.searchParams.set("result", result)
    const response = NextResponse.redirect(url)
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Referrer-Policy", "no-referrer")
    return response
  }
  const rawState = request.nextUrl.searchParams.get("state") ?? ""
  const state = verifyMessagingState(rawState)
  if (!state || state.organizationId !== gate.orgId || state.userId !== gate.userId) return finish("invalid_state")
  try {
    if (!await consumeMessagingAuthorization(gate.orgId, messagingStateFingerprint(rawState))) return finish("expired_state")
    if (request.nextUrl.searchParams.has("error")) return finish("access_denied")
    const code = request.nextUrl.searchParams.get("code") ?? request.nextUrl.searchParams.get("auth_code")
    if (!code || code.length > 2048) return finish("missing_code")
    const config = messagingConfig()
    const token = await exchangeMessagingCode(code)
    const scopes = await verifyMessagingGrant(token.accessToken, token.openId)
    if (!requiredMessagingScopes(scopes)) return finish("required_scopes_missing")
    await verifyMessagingAccountAccess(token.accessToken, token.openId)
    let subscribed = false
    try {
      await subscribeMessagingWebhook(new URL(TIKTOK_MESSAGING_WEBHOOK_PATH, config.redirectUri).toString())
      subscribed = true
    } catch { /* Save the valid grant; report webhook setup failure separately. */ }
    const connectionId = await saveMessagingConnection(gate.orgId, gate.userId, token, scopes, subscribed, messagingStateFingerprint(rawState))
    await auditChannelChange({ req: request, orgId: gate.orgId, userId: gate.userId, action: "create", channelId: connectionId, channelType: TIKTOK_MESSAGING_CHANNEL, credentialFields: ["accessToken", "refreshToken"] })
    return finish(subscribed ? "connected" : "webhook_pending")
  } catch (error) {
    const known = error instanceof TikTokMessagingError ? error.reason : "connection_failed"
    return finish(["tiktok_advanced_access_required", "tiktok_account_already_connected", "tiktok_different_account_requires_new_workspace", "tiktok_required_scopes_missing"].includes(known) ? known : "connection_failed")
  }
}
