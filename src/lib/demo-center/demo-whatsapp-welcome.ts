import type { WhatsAppConfig } from "@/lib/whatsapp"

/**
 * The demo's first WhatsApp message to the prospect's own phone (owner,
 * 2026-10-18: «по номеру, который он прошёл регистрацию, ему приходит
 * сообщение»).
 *
 * WhatsApp lets a business write first only with a template Meta approved.
 * This one was created in WhatsApp Manager on 2026-10-18, in Azerbaijani only
 * (owner: «текст на азербайджанском»), category Marketing — Meta refused it
 * as Utility. Its text is fixed by Meta; the one variable is the first name.
 * The stored copy of the message is this exact text, so the demo thread shows
 * what the phone shows.
 *
 * Sent straight to the Graph API, like the MTM login code, rather than through
 * `sendWhatsAppTemplate`: that one logs «[template:…]» as the body and knows
 * nothing about the demo. The caller writes the row.
 */
export const DEMO_WHATSAPP_WELCOME = {
  name: "leaddrive_demo_welcome",
  language: "az",
  /** What a prospect who gave no usable name is called in the greeting. */
  fallbackName: "dost",
  body: (firstName: string) =>
    `Salam, ${firstName}! Siz LeadDrive CRM demosunu istədiniz. Bu mesaj demonun WhatsApp hissəsidir: ona cavab yazın — yazdığınız demo ekranında görünəcək, AI agent isə sizə burada cavab verəcək.`,
} as const

/**
 * What the prospect agrees to by pressing the button — recorded with the
 * thread. A template to a typed number reaches whoever holds that number, so
 * the wording says exactly what will happen.
 */
export const DEMO_WHATSAPP_CONSENT_TEXT =
  "Sorğuda göstərdiyim nömrəyə LeadDrive-dan bir WhatsApp mesajı gəlsin; cavablarıma bu gün sonuna qədər AI agent cavab verəcək."
export const DEMO_WHATSAPP_CONSENT_VERSION = "2026-10-18"

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"
const SEND_TIMEOUT_MS = 8_000

/** Meta answers that mean the template itself cannot be sent (not approved yet, paused, disabled). */
const TEMPLATE_UNAVAILABLE = new Set([132000, 132001, 132015, 132016])

export type DemoWelcomeDelivery =
  | { status: "sent"; messageId: string | null }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string }

type Fetch = typeof fetch

export async function sendDemoWhatsAppWelcomeTemplate(
  sender: Pick<WhatsAppConfig, "phoneNumberId" | "accessToken">,
  input: { to: string; firstName: string },
  deps: { fetch?: Fetch } = {},
): Promise<DemoWelcomeDelivery> {
  const doFetch = deps.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${GRAPH_API_BASE}/${sender.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sender.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to.replace(/\D/g, ""),
        type: "template",
        template: {
          name: DEMO_WHATSAPP_WELCOME.name,
          language: { code: DEMO_WHATSAPP_WELCOME.language },
          components: [{ type: "body", parameters: [{ type: "text", text: input.firstName }] }],
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (error) {
    return { status: "failed", reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" }
  }
  const body = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { code?: number } } | null
  if (response.ok) return { status: "sent", messageId: body?.messages?.[0]?.id ?? null }
  const code = body?.error?.code
  if (code !== undefined && TEMPLATE_UNAVAILABLE.has(code)) return { status: "unavailable", reason: `template_${code}` }
  return { status: "failed", reason: code ? `meta_${code}` : `http_${response.status}` }
}

const BAKU_OFFSET_MS = 4 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000
/** WhatsApp's own free-text window, in hours: the same 23 `sendWhatsAppText` uses. */
const WINDOW_MS = 23 * 60 * 60_000

/**
 * When the demo's agent stops answering a thread proved at `provenAt`: the end
 * of that day in Baku (owner: «в конце дня отвязка»), and never past
 * WhatsApp's own window. Baku keeps UTC+4 all year; the server's own zone
 * (Europe/Berlin on production) plays no part.
 */
export function demoWhatsAppThreadEnds(provenAt: Date): Date {
  const bakuMidnightAfter = Math.floor((provenAt.getTime() + BAKU_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - BAKU_OFFSET_MS
  return new Date(Math.min(bakuMidnightAfter - 1, provenAt.getTime() + WINDOW_MS))
}
