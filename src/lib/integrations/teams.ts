/**
 * Microsoft Teams Incoming-Webhook sender.
 *
 * Teams Incoming Webhooks accept a MessageCard or Adaptive Card JSON payload.
 * We use the Legacy MessageCard format (universally supported, no app install
 * required for incoming webhooks).
 *
 * https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
 */
import { assertSafeWebhookUrl } from "@/lib/integrations/webhook-url-guard"

export interface TeamsMessageCard {
  /** Card summary — shown in the activity feed / notification toast. */
  summary: string
  /** Top-level card sections. */
  sections?: TeamsSection[]
  /** Optional URL that the card title links to. */
  potentialAction?: unknown[]
}

export interface TeamsSection {
  activityTitle?: string
  activitySubtitle?: string
  facts?: Array<{ name: string; value: string }>
  markdown?: boolean
}

/**
 * POST a Teams Incoming Webhook MessageCard JSON payload to `webhookUrl`.
 *
 * Returns `true` on HTTP 200–299, `false` on any failure (timeout, network,
 * non-2xx). NEVER throws — designed for best-effort fire-and-forget calls.
 *
 * Teams Incoming Webhooks respond with plain-text "1" on success (HTTP 200).
 */
export async function sendTeamsNotification(
  webhookUrl: string,
  card: TeamsMessageCard,
): Promise<boolean> {
  // Defense-in-depth SSRF guard — skip + log rather than throw (best-effort sender)
  try {
    assertSafeWebhookUrl(webhookUrl, "teams")
  } catch (guardErr) {
    console.error("[Teams] Blocked unsafe webhook URL:", (guardErr as Error).message)
    return false
  }
  try {
    const body = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      summary: card.summary,
      sections: card.sections ?? [],
      ...(card.potentialAction ? { potentialAction: card.potentialAction } : {}),
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Never follow redirects — a 30x from an allowlisted host to an internal IP
      // would bypass the pre-flight SSRF guard (P1 fix 2026-06-08).
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    })
    return response.ok
  } catch (error) {
    console.error("[Teams] Notification failed:", error)
    return false
  }
}
