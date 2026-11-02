export const TIKTOK_MESSAGING_PROVIDER = "tiktok_messaging"
export const TIKTOK_MESSAGING_CHANNEL = "tiktok_messaging"
export const TIKTOK_MESSAGING_CALLBACK_PATH = "/api/v1/channels/tiktok-messaging/oauth/callback/"
export const TIKTOK_MESSAGING_WEBHOOK_PATH = "/api/v1/webhooks/tiktok-messaging"
export const TIKTOK_MESSAGING_RETURN_PATH = "/settings/channels/tiktok"
export const TIKTOK_MESSAGING_PURPOSE = "oauth:tiktok-messaging"
export const TIKTOK_MESSAGING_SCOPES = ["message.list.read", "message.list.send", "message.list.manage", "user.account.type"] as const

export type MessagingConfig = {
  clientId: string
  clientSecret: string
  authorizationUrl: string
  redirectUri: string
}

/** Dedicated credentials: never fall back to Login Kit or the comments app. */
export function messagingConfig(): MessagingConfig {
  const clientId = process.env.TIKTOK_MESSAGING_CLIENT_ID?.trim()
  const clientSecret = process.env.TIKTOK_MESSAGING_CLIENT_SECRET?.trim()
  const authorizationUrl = process.env.TIKTOK_MESSAGING_AUTHORIZATION_URL?.trim()
  const redirectUri = process.env.TIKTOK_MESSAGING_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !authorizationUrl || !redirectUri || !process.env.NEXTAUTH_SECRET?.trim()) {
    throw new Error("tiktok_messaging_not_configured")
  }
  let auth: URL, redirect: URL
  try { auth = new URL(authorizationUrl); redirect = new URL(redirectUri) } catch {
    throw new Error("tiktok_messaging_invalid_configuration")
  }
  if (auth.protocol !== "https:" || auth.username || auth.password || auth.port
    || !["business-api.tiktok.com", "www.tiktok.com", "ads.tiktok.com"].includes(auth.hostname)
    || redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.port
    || redirect.search || redirect.hash || redirect.pathname !== TIKTOK_MESSAGING_CALLBACK_PATH) {
    throw new Error("tiktok_messaging_invalid_configuration")
  }
  return { clientId, clientSecret, authorizationUrl, redirectUri }
}

export function messagingConfigured(): boolean {
  try { messagingConfig(); return true } catch { return false }
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function requiredMessagingScopes(scopes: readonly string[]): boolean {
  return TIKTOK_MESSAGING_SCOPES.every(scope => scopes.includes(scope))
}
