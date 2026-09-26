import { prisma } from "@/lib/prisma"
import { sendWhatsAppText } from "@/lib/whatsapp"
import { normalizeDemoPhone } from "./phone-verification"
import { inDemoSalesOrganization } from "./sales-org"
import { demoWhatsAppConversationId, demoWhatsAppSender } from "./whatsapp-number"

/**
 * The demo's live WhatsApp thread.
 *
 * Owner, 2026-09-22: «пусть будут посылаться с номера который у меня уже
 * зарегистрирован». LeadDrive Inc.'s own Cloud API number is live and its
 * webhook works (checked on production the same day: messages in and out at
 * 15:47–15:53 UTC), so the demo does not have to pretend here.
 *
 * The prospect starts it, never us. WhatsApp only lets a business write
 * first with a template approved by Meta, and this account's token carries
 * `whatsapp_business_messaging` alone — it cannot even list templates. So the
 * demo shows a wa.me link and a QR to the sales number: the prospect writes
 * from their own phone, their message arrives in the real inbox, and that
 * inbound both proves the number and opens WhatsApp's 24-hour window in which
 * free text is allowed. Only then can the demo answer, from that same number.
 *
 * What is guarded:
 *   - the grant must be active and allowed live contact (the same admin
 *     switch as the AI call — there is no separate one, and a prospect the
 *     owner trusts with a call is trusted with a reply);
 *   - the only number ever written to is the one on the prospect's own demo
 *     request, so a session cannot make our number message a stranger;
 *   - at most DEMO_WHATSAPP_MAX_SENDS five answers per grant, counted from
 *     the messages themselves, so a reload hands out no more;
 *   - free text only inside WhatsApp's window, which `sendWhatsAppText`
 *     checks again on its own.
 */

/** Owner, 2026-09-22: «и то с ограничением на 5 сообщений». */
export const DEMO_WHATSAPP_MAX_SENDS = 5
/** Nothing longer than this is worth sending from a demo. */
export const DEMO_WHATSAPP_MAX_CHARS = 700
/** How much of the thread the demo shows. */
const THREAD_LIMIT = 12

export interface DemoWhatsAppMessage {
  readonly id: string
  readonly direction: "inbound" | "outbound"
  readonly text: string
  readonly at: string
}

export interface DemoWhatsAppState {
  /** The live thread is available in this session at all. */
  readonly enabled: boolean
  /** The number to write to, as Meta prints it. */
  readonly displayNumber: string | null
  /** wa.me link with the opening line already written. */
  readonly link: string | null
  /** The prospect has written, so free text is allowed back. */
  readonly windowOpen: boolean
  readonly sent: number
  readonly left: number
  readonly messages: readonly DemoWhatsAppMessage[]
}

export type SendDemoWhatsAppResult =
  | { ok: true; state: DemoWhatsAppState }
  | { ok: false; code: "not_enabled" | "empty" | "too_long" | "too_many" | "no_inbound" | "failed" }

interface Grant {
  readonly id: string
  readonly status: string
  readonly liveCallEnabled: boolean
  readonly sessionExpiresAt: Date | null
}

const OFF: DemoWhatsAppState = { enabled: false, displayNumber: null, link: null, windowOpen: false, sent: 0, left: 0, messages: [] }

/** WhatsApp's own window, in hours: the same 23 `sendWhatsAppText` uses. */
const WINDOW_HOURS = 23

function usable(grant: Grant, now: Date): boolean {
  return grant.status === "ACTIVE" && grant.liveCallEnabled && (!grant.sessionExpiresAt || grant.sessionExpiresAt > now)
}

/** The line the prospect's WhatsApp opens with, so we can recognise a demo thread at a glance. */
export function demoWhatsAppOpener(company: string | null): string {
  const who = company?.trim() ? ` (${company.trim()})` : ""
  return `LeadDrive demo${who}: salam! Bu mesajı demo səhifəsindən yazıram.`
}

export async function demoWhatsAppState(params: {
  grant: Grant
  requestPhone: string | null
  company?: string | null
  now?: Date
}): Promise<DemoWhatsAppState> {
  const now = params.now ?? new Date()
  if (!usable(params.grant, now)) return OFF
  const phone = normalizeDemoPhone(params.requestPhone ?? "")
  if (!phone) return OFF
  const sender = await demoWhatsAppSender(now.getTime())
  if (!sender) return OFF

  // The one door into the tenant (./sales-org.ts): demo code never picks an
  // organisation itself, and the boundary test holds that.
  const entered = await inDemoSalesOrganization((organizationId) => readThread(organizationId, phone.e164, params.grant.id, now))
  const thread = entered?.value ?? { messages: [], windowOpen: false, sent: 0 }
  return {
    enabled: true,
    displayNumber: sender.displayNumber,
    link: `https://wa.me/${sender.waNumber}?text=${encodeURIComponent(demoWhatsAppOpener(params.company ?? null))}`,
    windowOpen: thread.windowOpen,
    sent: thread.sent,
    left: Math.max(0, DEMO_WHATSAPP_MAX_SENDS - thread.sent),
    messages: thread.messages,
  }
}

export async function sendDemoWhatsApp(params: {
  grant: Grant
  requestPhone: string | null
  text: string
  company?: string | null
  now?: Date
}): Promise<SendDemoWhatsAppResult> {
  const now = params.now ?? new Date()
  const text = params.text.trim()
  if (!usable(params.grant, now)) return { ok: false, code: "not_enabled" }
  if (!text) return { ok: false, code: "empty" }
  if (text.length > DEMO_WHATSAPP_MAX_CHARS) return { ok: false, code: "too_long" }
  const phone = normalizeDemoPhone(params.requestPhone ?? "")
  if (!phone) return { ok: false, code: "not_enabled" }
  const sender = await demoWhatsAppSender(now.getTime())
  if (!sender) return { ok: false, code: "not_enabled" }

  const entered = await inDemoSalesOrganization(async (organizationId) => {
    const before = await readThread(organizationId, phone.e164, params.grant.id, now)
    if (before.sent >= DEMO_WHATSAPP_MAX_SENDS) return { refused: "too_many" as const }
    // Business-initiated messages need a template this account cannot even
    // list, so without the prospect's own inbound there is nothing to send.
    if (!before.windowOpen) return { refused: "no_inbound" as const }

    const sentResult = await sendWhatsAppText({ to: phone.e164, body: text, organizationId, skipLog: true })
    if (!sentResult.success) return { refused: "failed" as const }

    await prisma.channelMessage.create({
      data: {
        organizationId,
        channelConfigId: sender.channelConfigId,
        conversationId: await demoWhatsAppConversationId(organizationId, phone.e164),
        direction: "outbound",
        channelType: "whatsapp",
        from: sender.phoneNumberId,
        to: phone.e164.replace(/^\+/, ""),
        body: text,
        status: "delivered",
        externalId: sentResult.messageId,
        // `demoGrantId` is what counts the five: it is written here and
        // nowhere else, so an operator's own reply in the inbox never eats
        // the prospect's allowance, and a reload cannot hand out more.
        metadata: { channel: "whatsapp", sentVia: "demo", demoGrantId: params.grant.id, waMessageId: sentResult.messageId },
      },
    })
    return { refused: null }
  })
  if (!entered) return { ok: false, code: "not_enabled" }
  if (entered.value.refused) return { ok: false, code: entered.value.refused }

  return {
    ok: true,
    state: await demoWhatsAppState({ grant: params.grant, requestPhone: params.requestPhone, company: params.company, now }),
  }
}

/** Inside the tenant already: the door above put us there. */
async function readThread(
  organizationId: string,
  phoneE164: string,
  grantId: string,
  now: Date,
): Promise<{ messages: DemoWhatsAppMessage[]; windowOpen: boolean; sent: number }> {
  const tail = phoneE164.replace(/\D/g, "").slice(-9)
  const rows = await prisma.channelMessage.findMany({
      where: {
        organizationId,
        channelType: "whatsapp",
        OR: [{ to: { contains: tail } }, { from: { contains: tail } }, { metadata: { path: ["waPhone"], string_contains: tail } }],
      },
      orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, direction: true, body: true, createdAt: true, metadata: true },
  })
  const lastInbound = rows.find((row) => row.direction === "inbound")
  const windowOpen = Boolean(lastInbound && now.getTime() - lastInbound.createdAt.getTime() < WINDOW_HOURS * 60 * 60_000)
  const sent = rows.filter((row) => (row.metadata as { demoGrantId?: unknown } | null)?.demoGrantId === grantId).length
  const messages = rows
    .slice(0, THREAD_LIMIT)
    .reverse()
    .map((row) => ({
      id: row.id,
      direction: row.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
      text: row.body,
      at: row.createdAt.toISOString(),
    }))
  return { messages, windowOpen, sent }
}
