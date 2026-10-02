/**
 * Instagram-Login messaging helpers ("Path B" — "Instagram API with Instagram Login").
 *
 * These target graph.instagram.com with a per-tenant Instagram-Login token (the long-lived token from
 * oauth/instagram/callback, stored raw in ChannelConfig.apiKey where settings.igLogin=true).
 *
 * Distinct from sendInstagramMessage in @/lib/facebook, which targets graph.facebook.com with a
 * Facebook-Login PAGE token — the path Meta retired for IG DMs (returns "(#3) ... does not have the
 * capability"). NOTE: the graph.instagram.com /me/messages send endpoint is under-documented publicly
 * (per research); this is the best-known shape and is written fail-soft so a 4xx never crashes the
 * webhook. Confirm against a live token before relying on it in production.
 */
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

const IG_GRAPH = "https://graph.instagram.com/v21.0"

/**
 * Everything logged from this module goes through here.
 *
 * Both calls below carry the Instagram-Login token as a URL query parameter — the shape Meta's own
 * token endpoints require. That is tolerable while the value never leaves the process, but a thrown
 * fetch error can carry the request URL in its message or `cause`, and this project ships errors to
 * Sentry. An access token reaching an error tracker is a credential disclosure to a subprocessor,
 * so the redactor runs on every log line here rather than on the ones that look risky: the next
 * person to add a `console.error` should not have to notice this.
 */
function safeLogValue(value: unknown): string {
  const text =
    value instanceof Error
      ? `${value.name}: ${value.message}${value.cause ? ` (cause: ${String(value.cause)})` : ""}`
      : String(value)
  return redactOAuthProviderText(text)
}

/**
 * Send an Instagram Direct reply via the Instagram-Login API. Returns true on a 2xx, false otherwise
 * (logged). Never throws.
 */
export async function sendInstagramLoginMessage(
  recipientId: string,
  text: string,
  igToken: string,
): Promise<boolean> {
  if (!recipientId || !text || !igToken) return false
  try {
    const res = await fetch(`${IG_GRAPH}/me/messages?access_token=${encodeURIComponent(igToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    })
    if (!res.ok) {
      console.error(`[ig-login] send failed (${res.status}):`, safeLogValue(await res.text()))
      return false
    }
    return true
  } catch (e) {
    console.error("[ig-login] send error:", safeLogValue(e))
    return false
  }
}

// The one webhook field webhooks/instagram consumes. Deliberately not the app's whole dashboard list:
// `message_reactions` / `messaging_seen` events carry no `message`, and that handler would store each
// of them as a "[media]" inbound message.
const IG_DM_SUBSCRIBED_FIELDS = "messages"

/**
 * Turn on webhook delivery for ONE Instagram professional account connected through Instagram Login.
 *
 * Subscribing the app to `messages` in the dashboard is only half of it: Meta delivers nothing for an
 * account until the app also enables the subscription with that account's own token
 * (`POST /me/subscribed_apps`, "Enable Subscriptions" in the Instagram Platform webhook docs). The
 * dashboard shows the result per account as "Webhooks subscription: on/off". Until 2026-10 nothing in
 * this project made the call, so an account connected here authorized, showed "connected", could be
 * replied from — and never received a single Direct message.
 *
 * This is NOT the Facebook-Login case described in lib/social/inbox-channel: there an Instagram
 * account id has no subscription of its own and rides its linked Page. Here the token is an
 * Instagram User token on graph.instagram.com and the account is the subscriber.
 *
 * The token travels in the Authorization header, never the URL. Fail-soft like
 * `subscribePageToMessages`: returns { success, error? } and never throws; re-subscribing is idempotent.
 */
export async function subscribeInstagramLoginAccount(
  igToken: string,
): Promise<{ success: boolean; error?: string }> {
  if (!igToken) return { success: false, error: "missing token" }
  try {
    const res = await fetch(`${IG_GRAPH}/me/subscribed_apps?subscribed_fields=${IG_DM_SUBSCRIBED_FIELDS}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${igToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } }
    if (!res.ok || data?.success === false) {
      return { success: false, error: safeLogValue(data?.error?.message || `HTTP ${res.status}`) }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: safeLogValue(e) }
  }
}

/**
 * Refresh a long-lived Instagram-Login token (valid ~60 days). Call before expiry (settings
 * .tokenExpiresAt). Returns the new token + expiry, or null on failure (caller keeps the old token).
 */
export async function refreshInstagramLoginToken(
  igToken: string,
): Promise<{ accessToken: string; expiresAt: number | null } | null> {
  if (!igToken) return null
  try {
    const res = await fetch(
      `${IG_GRAPH.replace("/v21.0", "")}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(igToken)}`,
    )
    if (!res.ok) {
      console.error(`[ig-login] refresh failed (${res.status}):`, safeLogValue(await res.text()))
      return null
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) return null
    return {
      accessToken: json.access_token,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    }
  } catch (e) {
    console.error("[ig-login] refresh error:", safeLogValue(e))
    return null
  }
}
