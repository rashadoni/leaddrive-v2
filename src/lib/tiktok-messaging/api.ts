import { messagingConfig, record } from "./config"

const API_ROOT = "https://business-api.tiktok.com/open_api/v1.3"
export class TikTokMessagingError extends Error {
  constructor(public readonly reason: string, public readonly deliveryUnknown = false) { super(reason) }
}

/** Fixed provider origin, bounded calls, no redirect following or raw provider errors. */
export async function messagingApi(path: string, options: {
  token?: string
  body?: Record<string, unknown>
  query?: Record<string, string>
  send?: boolean
} = {}): Promise<Record<string, unknown>> {
  const url = new URL(`${API_ROOT}${path}`)
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: options.body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(options.token ? { "Access-Token": options.token } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch { throw new TikTokMessagingError("tiktok_request_failed", options.send === true) }
  const payload = record(await response.json().catch(() => null))
  if (!response.ok || payload.code !== 0) {
    const uncertain = response.status >= 500 || (response.ok && typeof payload.code !== "number")
    throw new TikTokMessagingError(response.status === 429 ? "tiktok_rate_limited" : "tiktok_request_rejected", options.send === true && uncertain)
  }
  return record(payload.data)
}

export type MessagingTokens = {
  accessToken: string
  refreshToken: string
  openId: string
  expiresIn: number
  refreshExpiresIn: number
  scopes: string[]
}

function tokens(data: Record<string, unknown>): MessagingTokens {
  if (typeof data.access_token !== "string" || !data.access_token
    || typeof data.refresh_token !== "string" || !data.refresh_token
    || typeof data.open_id !== "string" || !data.open_id
    || typeof data.expires_in !== "number" || data.expires_in <= 0 || !Number.isFinite(data.expires_in)
    || typeof data.refresh_token_expires_in !== "number" || data.refresh_token_expires_in <= 0 || !Number.isFinite(data.refresh_token_expires_in)) {
    throw new TikTokMessagingError("tiktok_invalid_token_response")
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    openId: data.open_id,
    expiresIn: Math.min(data.expires_in, 86_400),
    refreshExpiresIn: Math.min(data.refresh_token_expires_in, 365 * 86_400),
    scopes: typeof data.scope === "string" ? data.scope.split(/[ ,]+/).filter(Boolean) : [],
  }
}

export async function verifyMessagingGrant(accessToken: string, openId: string): Promise<string[]> {
  const config = messagingConfig()
  const data = await messagingApi("/tt_user/token_info/get/", { body: { app_id: config.clientId, access_token: accessToken } })
  if (data.app_id !== config.clientId || data.creator_id !== openId || typeof data.scope !== "string") {
    throw new TikTokMessagingError("tiktok_account_binding_mismatch")
  }
  return data.scope.split(/[ ,]+/).filter(Boolean)
}

export async function verifyMessagingAccountAccess(accessToken: string, openId: string): Promise<void> {
  const data = await messagingApi("/business/get/", { token: accessToken, query: {
    business_id: openId, fields: JSON.stringify(["has_advanced_access"]),
  } })
  if (data.has_advanced_access !== true) throw new TikTokMessagingError("tiktok_advanced_access_required")
}

export async function subscribeMessagingWebhook(callbackUrl: string): Promise<void> {
  const config = messagingConfig()
  await messagingApi("/business/webhook/update/", { body: {
    app_id: config.clientId, secret: config.clientSecret, event_type: "DIRECT_MESSAGE", callback_url: callbackUrl,
  } })
}

export async function exchangeMessagingCode(authCode: string): Promise<MessagingTokens> {
  const config = messagingConfig()
  return tokens(await messagingApi("/tt_user/oauth2/token/", { body: {
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code",
    auth_code: authCode, redirect_uri: config.redirectUri,
  } }))
}

export async function refreshMessagingToken(refreshToken: string): Promise<MessagingTokens> {
  const config = messagingConfig()
  return tokens(await messagingApi("/tt_user/oauth2/refresh_token/", { body: {
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken,
  } }))
}

export async function revokeMessagingToken(accessToken: string): Promise<void> {
  const config = messagingConfig()
  await messagingApi("/tt_user/oauth2/revoke/", { body: { client_id: config.clientId, client_secret: config.clientSecret, access_token: accessToken } })
}

export async function sendMessagingText(accessToken: string, businessId: string, conversationId: string, body: string): Promise<string> {
  if (!body.trim() || body.length > 6000) throw new TikTokMessagingError("tiktok_invalid_text")
  const data = await messagingApi("/business/message/send/", {
    token: accessToken, send: true,
    body: { business_id: businessId, recipient_type: "CONVERSATION", recipient: conversationId, message_type: "TEXT", text: { body } },
  })
  const message = record(data.message)
  if (typeof message.message_id !== "string" || !message.message_id) throw new TikTokMessagingError("tiktok_send_result_unknown", true)
  return message.message_id
}
