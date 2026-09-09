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
const IG_GRAPH = "https://graph.instagram.com/v21.0"

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
      console.error(`[ig-login] send failed (${res.status}):`, await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error("[ig-login] send error:", e)
    return false
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
      console.error(`[ig-login] refresh failed (${res.status}):`, await res.text())
      return null
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) return null
    return {
      accessToken: json.access_token,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    }
  } catch (e) {
    console.error("[ig-login] refresh error:", e)
    return null
  }
}
