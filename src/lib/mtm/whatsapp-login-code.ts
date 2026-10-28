import { resolveWhatsAppConfig, type WhatsAppConfig } from "@/lib/whatsapp"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Sends the MTM sign-in code to WhatsApp from LeadDrive's own number — the
 * same number the inbox and the demo already use (owner, 2026-09-22: «пусть
 * будут посылаться с номера который у меня уже зарегистрирован») — or, for a
 * company listed in `COMPANY_SENDER_PHONE_NUMBER_IDS`, from that company's own
 * number. Each sending account needs its own approved copy of the template.
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
 * with «not available» for everybody that number sends to, without looking
 * the number up. Remembered per sending number: one company's missing template
 * says nothing about another company's sender.
 */
const TEMPLATE_MISSING = 132001
const TEMPLATE_UNUSABLE = new Set([132015, 132016])
const UNAVAILABLE_FOR_MS = 10 * 60_000
const unavailableUntil = new Map<string, number>()

export function loginCodeTemporarilyUnavailable(sender: Pick<WhatsAppConfig, "phoneNumberId">, now = Date.now()): boolean {
  return now < (unavailableUntil.get(sender.phoneNumberId) ?? 0)
}

/** For tests. */
export function resetLoginCodeAvailability(): void {
  unavailableUntil.clear()
}

type Env = Partial<Record<string, string | undefined>>

/**
 * The number LeadDrive's shared channel sends from — Meta's phone number id,
 * named, not «the first active channel». On 2026-10-29 LeadDrive Inc. had two
 * active WhatsApp channels (…30 65 and …80 49) and Postgres handed back the
 * one whose account has no `leaddrive_login_code`: every code failed as
 * template_missing. …30 65 is the number the codes went from since 2026-10-15
 * (owner, 2026-09-22: «с номера который у меня уже зарегистрирован»).
 */
const SHARED_SENDER_PHONE_NUMBER_ID = "984538588084578" // +994 10 531 30 65, «Lead Drive CRM»

/**
 * Companies whose codes go from their own WhatsApp number, by the company's
 * organization id. The channel is looked up in that same organization, so an
 * entry can only ever send from the company's own number.
 */
const COMPANY_SENDER_PHONE_NUMBER_IDS: Readonly<Record<string, string>> = {
  // Zeytun Pharma, +994 99 301 29 14 (owner, 2026-10-29: «+994 99 301 29 14»).
  cmu9ih71e01vbkpd4fvgjhlba: "1421873671003286",
}

function companySenders(env: Env): Readonly<Record<string, string>> {
  const raw = env.MTM_LOGIN_CODE_COMPANY_SENDERS?.trim()
  if (!raw) return COMPANY_SENDER_PHONE_NUMBER_IDS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && Object.values(parsed).every(value => typeof value === "string" && value.trim())) return parsed as Record<string, string>
  } catch { /* falls through */ }
  // A broken override must not quietly hand a company's codes to another sender.
  throw new Error("MTM_LOGIN_CODE_COMPANY_SENDERS must be a JSON object of organization id → phone number id")
}

/** Which organization's channel, and which of its numbers, sends this company's codes. */
export function loginCodeSenderFor(companyId: string, env: Env = process.env): { organizationId: string; phoneNumberId: string } | null {
  const own = companySenders(env)[companyId]?.trim()
  if (own) return { organizationId: companyId, phoneNumberId: own }
  const organizationId = loginCodeSenderOrganizationId(env)
  if (!organizationId) return null
  return { organizationId, phoneNumberId: env.MTM_LOGIN_CODE_SENDER_PHONE_NUMBER_ID?.trim() || SHARED_SENDER_PHONE_NUMBER_ID }
}

export async function loginCodeSender(companyId: string, env: Env = process.env): Promise<WhatsAppConfig | null> {
  const chosen = loginCodeSenderFor(companyId, env)
  if (!chosen) return null
  const { organizationId, phoneNumberId } = chosen
  // channel_configs is a tenant table; the sender is read by server
  // configuration alone, never from a request.
  return await runWithRlsBypass(async () => {
    const rows = await prisma.channelConfig.findMany({
      where: { organizationId, channelType: "whatsapp", isActive: true, OR: [{ phoneNumberId }, { phoneNumber: phoneNumberId }] },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    })
    for (const row of rows) {
      const sender = await resolveWhatsAppConfig(organizationId, { channelConfigId: row.id })
      if (sender?.phoneNumberId === phoneNumberId) return sender
    }
    // No other channel stands in: a number without the template would only
    // turn «not configured» into a code that never arrives.
    console.warn("[MTM login code] the configured sender number has no active WhatsApp channel", { organizationId, phoneNumberId })
    return null
  })
}

export type LoginCodeDelivery =
  | { status: "sent"; messageId: string | null; language: string }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string }

type Fetch = typeof fetch

export async function sendLoginCodeToWhatsApp(
  sender: WhatsAppConfig,
  input: { to: string; code: string; language: string | null | undefined },
  deps: { fetch?: Fetch; now?: () => number; templateName?: string; signal?: AbortSignal } = {},
): Promise<LoginCodeDelivery> {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const templateName = deps.templateName ?? loginCodeTemplateName()
  const to = input.to.replace(/\D/g, "")
  let missing = 0
  const languages = templateLanguages(input.language)
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
      unavailableUntil.set(sender.phoneNumberId, now() + UNAVAILABLE_FOR_MS)
      return { status: "unavailable", reason: `template_${code}` }
    }
    return { status: "failed", reason: code ? `meta_${code}` : `http_${response.status}` }
  }
  if (missing === languages.length) {
    unavailableUntil.set(sender.phoneNumberId, now() + UNAVAILABLE_FOR_MS)
    return { status: "unavailable", reason: "template_missing" }
  }
  return { status: "failed", reason: "no_language" }
}
