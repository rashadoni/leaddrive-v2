import { resolveWhatsAppConfig, type WhatsAppConfig } from "@/lib/whatsapp"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Sends the MTM sign-in code to WhatsApp from LeadDrive's own number, for every
 * company — the same number the inbox and the demo already use (owner,
 * 2026-09-22: «пусть будут посылаться с номера который у меня уже
 * зарегистрирован»).
 *
 * WhatsApp lets a business write first only with a template Meta approved.
 * The code goes in an «Authentication» template with a «Copy code» button
 * (owner creates it in WhatsApp Manager; the channel's token cannot): the code
 * is passed twice, once for the text and once for the button.
 *
 * Deliberately not `sendWhatsAppTemplate`: that one writes every message into
 * the sending organization's inbox log, and a Zeytun employee's number has no
 * business in LeadDrive Inc.'s inbox. Nothing here is stored, and the code is
 * never logged.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"
const SEND_TIMEOUT_MS = 8_000

/** Which organization's WhatsApp channel sends the codes. */
export function loginCodeSenderOrganizationId(env: Partial<Record<string, string | undefined>> = process.env): string | null {
  return env.MTM_LOGIN_CODE_SENDER_ORGANIZATION_ID?.trim() || env.VOICE_AGENT_ORGANIZATION_ID?.trim() || null
}

export function loginCodeTemplateName(env: Partial<Record<string, string | undefined>> = process.env): string {
  return env.MTM_LOGIN_CODE_TEMPLATE?.trim() || "leaddrive_login_code"
}

/**
 * Template languages in the order to try. The app asks in its own language;
 * when the template has no such translation Meta answers 132001 and the next
 * one is tried, so a missing language costs a retry, not the code.
 */
export function templateLanguages(preferred: string | null | undefined): string[] {
  const order = ["az", "ru", "en", "en_US"]
  const first = preferred && order.includes(preferred) ? [preferred] : []
  return [...first, ...order.filter(code => !first.includes(code))]
}

/**
 * Meta's answers that mean «this template cannot be sent at all» — not
 * «this number cannot be reached». While one is fresh the button is answered
 * with «not available» for everybody, without looking the number up.
 */
const TEMPLATE_MISSING = 132001
const TEMPLATE_UNUSABLE = new Set([132015, 132016])
const UNAVAILABLE_FOR_MS = 10 * 60_000
let unavailableUntil = 0

export function loginCodeTemporarilyUnavailable(now = Date.now()): boolean {
  return now < unavailableUntil
}

/** For tests. */
export function resetLoginCodeAvailability(): void {
  unavailableUntil = 0
}

export async function loginCodeSender(): Promise<WhatsAppConfig | null> {
  const organizationId = loginCodeSenderOrganizationId()
  if (!organizationId) return null
  // channel_configs is a tenant table; the sender is read by server
  // configuration alone, never from a request.
  return await runWithRlsBypass(() => resolveWhatsAppConfig(organizationId))
}

export type LoginCodeDelivery =
  | { status: "sent"; messageId: string | null; language: string }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string }

type Fetch = typeof fetch

export async function sendLoginCodeToWhatsApp(
  sender: WhatsAppConfig,
  input: { to: string; code: string; language: string | null | undefined },
  deps: { fetch?: Fetch; now?: () => number; templateName?: string; signal?: AbortSignal; singleAttempt?: boolean } = {},
): Promise<LoginCodeDelivery> {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const templateName = deps.templateName ?? loginCodeTemplateName()
  const to = input.to.replace(/\D/g, "")
  let missing = 0
  const languages = deps.singleAttempt ? templateLanguages(input.language).slice(0, 1) : templateLanguages(input.language)
  for (const language of languages) {
    if (deps.signal?.aborted) return { status: "failed", reason: "timeout" }
    let response: Response
    try {
      response = await doFetch(`${GRAPH_API_BASE}/${sender.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: language },
            components: [
              { type: "body", parameters: [{ type: "text", text: input.code }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: input.code }] },
            ],
          },
        }),
        signal: deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]) : AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
    } catch (error) {
      return { status: "failed", reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" }
    }
    const body = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { code?: number } } | null
    if (response.ok) return { status: "sent", messageId: body?.messages?.[0]?.id ?? null, language }
    const code = body?.error?.code
    if (code === TEMPLATE_MISSING) { missing++; continue }
    if (code !== undefined && TEMPLATE_UNUSABLE.has(code)) {
      unavailableUntil = now() + UNAVAILABLE_FOR_MS
      return { status: "unavailable", reason: `template_${code}` }
    }
    return { status: "failed", reason: code ? `meta_${code}` : `http_${response.status}` }
  }
  if (missing === languages.length) {
    if (deps.singleAttempt) return { status: "unavailable", reason: "template_language_missing" }
    unavailableUntil = now() + UNAVAILABLE_FOR_MS
    return { status: "unavailable", reason: "template_missing" }
  }
  return { status: "failed", reason: "no_language" }
}
