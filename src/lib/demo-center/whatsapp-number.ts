import { prisma } from "@/lib/prisma"
import { resolveWhatsAppConfig, type WhatsAppConfig } from "@/lib/whatsapp"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * The WhatsApp number a demo prospect writes to: the sales organisation's own
 * one (owner, 2026-09-22 — «пусть будут посылаться с номера который у меня уже
 * зарегистрирован»). Nothing new is registered and no second app is involved;
 * this is the number the inbox already works with.
 *
 * **Which of its numbers is named, not «whichever row comes back».** The sales
 * organisation is LeadDrive Inc., and on 2026-11-09 it gained a third WhatsApp
 * channel: the owner's own working number, connected in coexistence so it stays
 * in the WhatsApp Business app on his phone. `resolveWhatsAppConfig(orgId)`
 * picks with an unordered `findFirst`, so from that day the demo could put the
 * owner's personal number on the screen and send a stranger from the website to
 * write to it. The same shape of bug cost the MTM login codes a day in October
 * (see lib/mtm/whatsapp-login-code.ts, the precedent this follows).
 *
 * One reader for both sides of the demo — the number shown and the channel the
 * welcome is sent from — because showing one number and writing from another is
 * worse than either alone.
 *
 * If the named number has no active channel nothing stands in: the demo keeps
 * its simulated thread and says so, which is what it already does when there is
 * no channel at all. A substitute number would be the bug this prevents.
 *
 * The display number («+994 10 531 30 65») is not in `channel_configs` — only
 * the Cloud API phone-number id is — so it is read from Meta once and cached,
 * exactly like the Telegram bot's @username in ./phone-telegram-bot.ts. Null
 * when the sales organisation has no active WhatsApp channel or Meta does not
 * answer: the demo then keeps the simulated thread and says so.
 */
export interface DemoWhatsAppSender {
  readonly organizationId: string
  readonly channelConfigId: string
  readonly phoneNumberId: string
  /** Digits only, the way wa.me wants them (994105313065). */
  readonly waNumber: string
  /** As Meta prints it, for the screen. */
  readonly displayNumber: string
}

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"
const NUMBER_TTL_MS = 60 * 60_000
/** A failed lookup is retried soon: one Meta hiccup must not hide the channel for an hour. */
const FAILURE_TTL_MS = 60_000
const numbers = new Map<string, { display: string | null; until: number }>()

type Env = Partial<Record<string, string | undefined>>

/** +994 10 531 30 65, «Lead Drive CRM» — the number the demo has always used. */
const DEMO_SENDER_PHONE_NUMBER_ID = "984538588084578"

export function demoWhatsAppSenderPhoneNumberId(env: Env = process.env): string {
  return env.DEMO_WHATSAPP_SENDER_PHONE_NUMBER_ID?.trim() || DEMO_SENDER_PHONE_NUMBER_ID
}

/**
 * The demo's WhatsApp channel, by name. No network: the welcome send needs this
 * and must not wait on Meta for a display number it never uses.
 */
export async function demoWhatsAppChannel(organizationId: string, env: Env = process.env): Promise<WhatsAppConfig | null> {
  const phoneNumberId = demoWhatsAppSenderPhoneNumberId(env)
  const rows = await prisma.channelConfig.findMany({
    where: { organizationId, channelType: "whatsapp", isActive: true, OR: [{ phoneNumberId }, { phoneNumber: phoneNumberId }] },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  })
  for (const row of rows) {
    const config = await resolveWhatsAppConfig(organizationId, { channelConfigId: row.id })
    if (config?.phoneNumberId === phoneNumberId) return config
  }
  console.warn("[Demo WhatsApp] the configured demo number has no active WhatsApp channel", { organizationId, phoneNumberId })
  return null
}

export async function demoWhatsAppSender(now = Date.now()): Promise<DemoWhatsAppSender | null> {
  const entered = await inDemoSalesOrganization(async (organizationId) => await demoWhatsAppChannel(organizationId))
  const config = entered?.value
  if (!config) return null
  const display = await displayNumber(config.phoneNumberId, config.accessToken, now)
  if (!display) return null
  const waNumber = display.replace(/\D/g, "")
  if (waNumber.length < 8) return null
  return {
    organizationId: config.organizationId,
    channelConfigId: config.id,
    phoneNumberId: config.phoneNumberId,
    waNumber,
    displayNumber: display,
  }
}

/** The number as Meta prints it, cached per phone-number id. */
async function displayNumber(phoneNumberId: string, accessToken: string, now: number): Promise<string | null> {
  const cached = numbers.get(phoneNumberId)
  if (cached && now < cached.until) return cached.display
  let display: string | null = null
  try {
    const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}?fields=display_phone_number`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    })
    const data = (await response.json()) as { display_phone_number?: unknown }
    display = typeof data.display_phone_number === "string" && /\d/.test(data.display_phone_number) ? data.display_phone_number : null
  } catch {
    display = null
  }
  numbers.set(phoneNumberId, { display, until: now + (display ? NUMBER_TTL_MS : FAILURE_TTL_MS) })
  return display
}

/** Test seam: forget cached numbers. */
export function resetDemoWhatsAppNumberCache(): void {
  numbers.clear()
}

/** The conversation this phone already has with the sales organisation, if any. */
export async function demoWhatsAppConversationId(organizationId: string, waPhone: string): Promise<string | null> {
  const tail = waPhone.replace(/\D/g, "").slice(-9)
  if (tail.length < 7) return null
  const row = await prisma.channelMessage.findFirst({
    where: {
      organizationId,
      channelType: "whatsapp",
      conversationId: { not: null },
      OR: [{ to: { contains: tail } }, { from: { contains: tail } }, { metadata: { path: ["waPhone"], string_contains: tail } }],
    },
    orderBy: { createdAt: "desc" },
    select: { conversationId: true },
  })
  return row?.conversationId ?? null
}
