import { prisma } from "@/lib/prisma"
import { trustedChatwootBaseUrl } from "@/lib/inbox/chatwoot-trusted-host"
import {
  requestOutboundWebhook,
  validateOutboundWebhookUrl,
} from "@/lib/integrations/webhook-url-guard"

const CHATWOOT_RESPONSE_LIMIT_BYTES = 16 * 1024

function settingsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * Validate a tenant-provided Chatwoot origin before it is persisted.
 *
 * Missing URLs are allowed so an administrator can save an incomplete/disabled
 * draft. Once present, however, the URL must resolve exclusively to public
 * addresses. Delivery repeats the same validation and pins the chosen address.
 */
export async function validateChatwootBaseUrl(settings: unknown): Promise<void> {
  const baseUrl = settingsRecord(settings).baseUrl
  if (baseUrl === undefined || baseUrl === null || baseUrl === "") return
  if (typeof baseUrl !== "string") {
    throw new Error("Chatwoot baseUrl must be a string")
  }
  await validateOutboundWebhookUrl(baseUrl, { allowHttp: false })
}

function chatwootMessagesUrl(
  baseUrl: string,
  accountId: unknown,
  conversationId: string,
): string {
  const target = new URL(baseUrl)
  target.search = ""
  target.hash = ""
  const prefix = target.pathname.replace(/\/+$/, "")
  const account = encodeURIComponent(String(accountId))
  const conversation = encodeURIComponent(conversationId)
  target.pathname = `${prefix}/api/v1/accounts/${account}/conversations/${conversation}/messages`
  return target.toString()
}

const CHATWOOT_SEND_TIMEOUT_MS = 15_000

/**
 * Send an agent reply into a Chatwoot conversation (LeadDrive → Chatwoot → TikTok).
 *
 * Chatwoot is the bidirectional transport: posting an `outgoing` message to a
 * conversation pushes it back out to the original channel (TikTok) via the
 * connector. Resolves the org's Chatwoot ChannelConfig and calls Chatwoot's REST
 * API. Config lives in ChannelConfig(channelType:"chatwoot"):
 *   settings.baseUrl    e.g. "https://app.chatwoot.com" (or a self-hosted origin)
 *   settings.accountId  e.g. 171064
 *   apiKey              the agent's api_access_token (Profile → Access Token)
 *
 * Returns {success:false, error} on any misconfig / HTTP / network failure — the
 * caller persists the outbound ChannelMessage as status:"failed" and surfaces the
 * error in the composer (no throw, mirrors sendWhatsAppMessage's contract).
 */
/**
 * The id Chatwoot assigned to the message we just created, when it says so.
 *
 * A response we cannot parse is not an error: the message was accepted, and
 * losing the id only costs the later failure reconciliation for that one send.
 */
function chatwootMessageId(bodyText: string | null | undefined): { messageId: string } | null {
  if (!bodyText) return null
  try {
    const parsed: unknown = JSON.parse(bodyText)
    const id = (parsed as { id?: unknown })?.id
    if (typeof id === "number" && Number.isFinite(id)) return { messageId: String(id) }
    if (typeof id === "string" && id.trim()) return { messageId: id.trim() }
    return null
  } catch {
    return null
  }
}

export async function sendChatwootMessage(params: {
  conversationId: string
  content: string
  organizationId: string
  /**
   * The config the conversation actually arrived on. Omitting it makes the
   * lookup below fall back to "any active chatwoot config for this org"
   * (`findFirst`, no orderBy) — with two active configs that sends a customer's
   * reply out through the wrong Chatwoot account.
   *
   * Every caller now passes it: the webhook, the inbound poller, the keyword
   * and AI auto-replies, the shared outbound pipeline and the follow-up cron.
   * It stays optional because a caller may legitimately have no config to name
   * (an org with exactly one config, a manual send outside a conversation) —
   * NOT as a licence to drop it where the id is in scope.
   *
   * The parameter's own history is the reason to assert it in tests rather than
   * trust the type: when it did not exist here, tsc reported every call site
   * that tried to pass it (TS2353 at chatwoot-inbound.ts 243, 279, 287) and the
   * calls kept compiling, because the typecheck step is advisory in CI. A
   * required parameter would not have gated it either. The regression lives in
   * lib-chatwoot-send.test.ts ("two active configs") and in a per-call-site
   * forwarding assertion in each caller's suite.
   */
  channelConfigId?: string | null
}): Promise<{
  success: boolean
  error?: string
  deliveryUnknown?: boolean
  /**
   * Chatwoot's id for the message this call created.
   *
   * A 2xx here means Chatwoot stored the message, NOT that the provider behind
   * the inbox delivered it — TikTok can reject it seconds later and Chatwoot
   * then flips that message to status "failed". Without this id the poller,
   * which already reads those statuses, has no way to say which of our rows
   * the failure belongs to: identical retry texts in one conversation make
   * content matching actively wrong. Callers persist it as ChannelMessage
   * .externalId so the reconciliation is exact.
   */
  messageId?: string
}> {
  const { conversationId, content, organizationId, channelConfigId } = params

  if (!conversationId) return { success: false, error: "Missing Chatwoot conversation id" }

  const cfg = await prisma.channelConfig.findFirst({
    // organizationId stays in the where even with an explicit id: the id alone
    // would let a stale/foreign config id read another tenant's credentials.
    where: {
      organizationId,
      channelType: "chatwoot",
      isActive: true,
      ...(channelConfigId ? { id: channelConfigId } : {}),
    },
    select: { apiKey: true, settings: true },
  })
  if (!cfg) return { success: false, error: "Chatwoot not configured" }

  const settings = settingsRecord(cfg.settings)
  const accountId = settings.accountId
  const token = cfg.apiKey
  if (!settings.baseUrl || accountId == null || !token) {
    return { success: false, error: "Chatwoot config incomplete (baseUrl/accountId/token)" }
  }

  // The host allowlist is separate from the SSRF guard inside
  // requestOutboundWebhook and cannot be replaced by it: that guard blocks
  // internal addresses, while this request carries the tenant's Chatwoot token
  // and the customer's message to whatever public host the config names.
  // Dropped from this path in 22bda1339 when raw fetch became
  // requestOutboundWebhook; restored here — see chatwoot-trusted-host.ts.
  const trusted = trustedChatwootBaseUrl(settings.baseUrl)
  if (!trusted) {
    return { success: false, error: "Chatwoot config baseUrl is not trusted" }
  }
  const baseUrl = trusted.toString().replace(/\/+$/, "")

  try {
    const res = await requestOutboundWebhook(
      chatwootMessagesUrl(baseUrl, accountId, conversationId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", api_access_token: token },
        body: JSON.stringify({ content, message_type: "outgoing", private: false }),
        allowHttp: false,
        timeoutMs: CHATWOOT_SEND_TIMEOUT_MS,
        maxResponseBytes: CHATWOOT_RESPONSE_LIMIT_BYTES,
        // Chatwoot tokens must never cross an origin boundary on redirect.
        sensitiveHeaders: ["api_access_token"],
      },
    )
    if (!res.ok) {
      const txt = res.bodyText ?? ""
      const deliveryUnknown = res.status === 408 || res.status >= 500
      return {
        success: false,
        error: `Chatwoot ${res.status}: ${txt.slice(0, 200)}`,
        ...(deliveryUnknown ? { deliveryUnknown: true } : {}),
      }
    }
    return { success: true, ...(chatwootMessageId(res.bodyText) ?? {}) }
  } catch (e) {
    // Any transport exception after fetch started is ambiguous: the POST may
    // already have reached Chatwoot even though its response did not make it
    // back. Callers must not blindly retry because this endpoint has no
    // provider-side idempotency key.
    const message = e instanceof Error ? e.message : String(e)
    const timeout = /timed out|deadline exceeded/i.test(message)
    return {
      success: false,
      error: timeout ? "Chatwoot request timed out" : "Chatwoot transport result unknown",
      deliveryUnknown: true,
    }
  }
}
