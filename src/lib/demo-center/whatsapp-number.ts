import { prisma } from "@/lib/prisma"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * The WhatsApp number a demo prospect writes to: the sales organisation's own
 * one (owner, 2026-09-22 — «пусть будут посылаться с номера который у меня уже
 * зарегистрирован»). Nothing new is registered and no second app is involved;
 * this is the number the inbox already works with.
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

export async function demoWhatsAppSender(now = Date.now()): Promise<DemoWhatsAppSender | null> {
  const entered = await inDemoSalesOrganization(async (organizationId) => await resolveWhatsAppConfig(organizationId))
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
