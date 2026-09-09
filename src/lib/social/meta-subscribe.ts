/**
 * Subscribe a Facebook Page (and any linked Instagram business account, which inherits the page
 * subscription) to THIS app's webhook for inbound DMs. Without this call Meta will NOT deliver
 * `messages` events to /api/v1/webhooks/facebook — even when a ChannelConfig exists — so a tenant's
 * Messenger/Direct messages would never reach their inbox.
 *
 * Multi-tenant: one Meta app, many pages across many orgs. Each page is subscribed individually with
 * its own page access token. Fail-soft — returns { success, error? }; callers (OAuth callback /
 * backfill) log but never block on a subscription failure (the page is still usable once subscribed
 * manually, and re-subscribe is idempotent).
 *
 * SECURITY: the page access token is sent in the POST BODY (form-encoded), never the URL, so it
 * can't leak into request logs. Never log the token.
 */

const META_GRAPH_BASE = process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0"

// DM-relevant fields. `messages` is the inbound-message event the inbox webhook consumes;
// `messaging_postbacks` covers button/quick-reply taps.
const DM_SUBSCRIBED_FIELDS = "messages,messaging_postbacks"

export async function subscribePageToMessages(
  pageId: string,
  pageAccessToken: string,
): Promise<{ success: boolean; error?: string }> {
  if (!pageId || !pageAccessToken) return { success: false, error: "missing pageId or token" }
  try {
    const res = await fetch(`${META_GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: DM_SUBSCRIBED_FIELDS,
        access_token: pageAccessToken,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } }
    if (!res.ok || data?.success === false) {
      return { success: false, error: data?.error?.message || `HTTP ${res.status}` }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error)?.message || "network error" }
  }
}
