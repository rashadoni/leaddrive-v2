import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { hmacToken } from "@/lib/secure-token"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { DEMO_WHATSAPP_MAX_AI_REPLIES } from "./demo-whatsapp-agent"
import {
  DEMO_WHATSAPP_CONSENT_VERSION,
  DEMO_WHATSAPP_WELCOME,
  sendDemoWhatsAppWelcomeTemplate,
} from "./demo-whatsapp-welcome"
import { demoCallFirstName } from "./call-prompt"
import { normalizeDemoPhone } from "./phone-verification"
import { inDemoSalesOrganization } from "./sales-org"
import { DEMO_WHATSAPP_TICKET_MESSAGES, demoWhatsAppTicketView, type DemoWhatsAppTicketView } from "./demo-whatsapp-ticket-view"
import { demoWhatsAppConversationId, demoWhatsAppSender } from "./whatsapp-number"

/**
 * The demo's live WhatsApp thread: the prospect's own phone and the demo's AI
 * agent (owner, 2026-09-22: «пусть будут посылаться с номера который у меня
 * уже зарегистрирован»; 2026-10-18: «ему приходит сообщение… он отвечает…
 * AI agent отвечает… в конце дня отвязка»).
 *
 * LeadDrive Inc.'s own Cloud API number does the talking. Two ways in:
 *   - they write first: a wa.me link and QR with the opening line written —
 *     open to every prospect, since their own message is the proof;
 *   - we write first: «WhatsApp-a mesaj göndərin» sends the Meta-approved
 *     welcome template (demo-whatsapp-welcome.ts) to the request's phone. A
 *     template to a typed number reaches whoever holds it, and anyone can
 *     fill the public form with a stranger's number, so this needs the
 *     owner's switch on the request (`liveCallEnabled`: he has seen who
 *     asked), the prospect's press with the consent line, and stays within
 *     once per grant, once a week per phone and DEMO_WHATSAPP_WELCOMES_PER_DAY
 *     for the whole line — blocks from strangers lower the quality rating of
 *     the only sales number;
 * Either way the thread opens only when a message comes from exactly that
 * phone carrying the session's code — which only this demo page shows. The
 * phone on a request is typed, not proved: until 2026-10-18 a prospect who
 * typed somebody else's number could read that person's conversation with
 * LeadDrive, and a phone that merely writes proves nothing about who is
 * looking at the demo. After the proof the demo's agent answers on WhatsApp
 * (demo-whatsapp-agent.ts, called from the webhook) until the end of the day
 * in Baku.
 *
 * The thread is offered to every prospect (`liveWhatsAppEnabled`, on for
 * every grant the form issues); a grant the owner issued with the call
 * switch has it too.
 */

/** How much of the thread the demo shows. */
const THREAD_LIMIT = 12
/** One welcome to a phone per week, whichever demo asked. */
const WELCOME_COOLDOWN_MS = 7 * 24 * 60 * 60_000
/** Welcomes the sales number sends in any 24 hours, whoever asks: a ceiling, not a target. */
export const DEMO_WHATSAPP_WELCOMES_PER_DAY = 20

export interface DemoWhatsAppMessage {
  readonly id: string
  readonly direction: "inbound" | "outbound"
  /** Who wrote an outbound message: our welcome, the demo's AI agent, or a person in the team. */
  readonly by: "prospect" | "welcome" | "ai" | "team"
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
  /** This session's code, already inside the link's opening line; shown so it can be typed by hand. */
  readonly code: string | null
  /** The request's phone, masked, for «we send to …». */
  readonly phoneMasked: string | null
  /** Our number may write first to that phone: the owner's switch is on. Otherwise the prospect writes first. */
  readonly canWelcome: boolean
  /** When our welcome went to that phone, if it did. */
  readonly welcomeSentAt: string | null
  /** The code came from that phone: the thread is this session's. */
  readonly proven: boolean
  /** The demo's agent is answering now. */
  readonly agentActive: boolean
  readonly agentRepliesLeft: number
  /** When the agent stops: the end of the day in Baku. */
  readonly agentEndsAt: string | null
  readonly closed: boolean
  readonly messages: readonly DemoWhatsAppMessage[]
  /** The prospect pressed «Mesajımdan bilet açılsın»: their next message opens a real ticket. */
  readonly ticketMode: boolean
  /** Ticket mode, but the agent's day ended before any ticket opened: there will be none. */
  readonly ticketModeEnded: boolean
  /** The real ticket this demo opened, as its customer sees it. */
  readonly ticket: DemoWhatsAppTicketView | null
}

export type SendDemoWelcomeResult =
  | { ok: true; state: DemoWhatsAppState }
  | { ok: false; code: "not_enabled" | "consent_required" | "already_sent" | "cooldown" | "busy" | "unavailable" | "failed" }

interface Grant {
  readonly id: string
  /** The thread starts here: nothing older is ever shown. */
  readonly createdAt: Date
  readonly status: string
  readonly liveCallEnabled: boolean
  readonly liveWhatsAppEnabled?: boolean
  readonly sessionExpiresAt: Date | null
}

const OFF: DemoWhatsAppState = {
  enabled: false,
  displayNumber: null,
  link: null,
  code: null,
  phoneMasked: null,
  canWelcome: false,
  welcomeSentAt: null,
  proven: false,
  agentActive: false,
  agentRepliesLeft: 0,
  agentEndsAt: null,
  closed: false,
  messages: [],
  ticketMode: false,
  ticketModeEnded: false,
  ticket: null,
}

function usable(grant: Grant, now: Date): boolean {
  return grant.status === "ACTIVE"
    && (Boolean(grant.liveWhatsAppEnabled) || grant.liveCallEnabled)
    && (!grant.sessionExpiresAt || grant.sessionExpiresAt > now)
}

/**
 * This session's code: six characters derived from the grant, shown only on
 * its own demo page. A message carrying it from the request's phone is what
 * proves that the person looking at the demo holds that phone.
 */
export function demoWhatsAppCode(grantId: string): string {
  return `LD-${hmacToken(grantId, "demo-whatsapp-code").slice(0, 6).toUpperCase()}`
}

/** The line the prospect's WhatsApp opens with: recognisable at a glance, and carrying the session's code. */
export function demoWhatsAppOpener(company: string | null, code: string): string {
  const who = company?.trim() ? ` (${company.trim()})` : ""
  return `LeadDrive demo${who}: salam! Bu mesajı demo səhifəsindən yazıram. Kod: ${code}`
}

function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} ** *** ${e164.slice(-4, -2)} ${e164.slice(-2)}`
}

/** The thread's row: created the first time the demo page asks, never changed but by its own steps. */
async function ensureThread(grant: Grant, phoneE164: string) {
  return await runWithRlsBypass(() =>
    prisma.demoWhatsAppThread.upsert({
      where: { grantId: grant.id },
      create: { grantId: grant.id, phoneE164, code: demoWhatsAppCode(grant.id) },
      update: {},
      select: { id: true, phoneE164: true, welcomeSentAt: true, provenAt: true, expiresAt: true, aiReplies: true, closedAt: true, ticketModeAt: true, ticketId: true },
    }),
  )
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
  const thread = await ensureThread(params.grant, phone.e164)
  // A thread is the phone it was made for; a request whose phone was edited since gets nothing.
  if (thread.phoneE164 !== phone.e164) return OFF
  const code = demoWhatsAppCode(params.grant.id)

  // The one door into the tenant (./sales-org.ts): demo code never picks an
  // organisation itself, and the boundary test holds that.
  // From our welcome if it went first, and a minute before the proof either
  // way: the message carrying the code is stored just before it is seen.
  const since = thread.provenAt
    ? new Date(Math.min(thread.welcomeSentAt?.getTime() ?? Infinity, thread.provenAt.getTime() - 60_000))
    : null
  // The ticket is the one the thread holds — by its id, never found by the phone.
  const ticketId = thread.provenAt && thread.ticketModeAt ? thread.ticketId : null
  const entered = since
    ? await inDemoSalesOrganization(async (organizationId) => ({
      messages: await readThread(organizationId, phone.e164, since),
      ticket: ticketId ? await readTicket(organizationId, ticketId) : null,
    }))
    : null
  const messages = entered?.value.messages ?? []
  const ticket = entered?.value.ticket ?? null
  const agentActive = Boolean(
    thread.provenAt && !thread.closedAt && thread.expiresAt && thread.expiresAt > now && thread.aiReplies < DEMO_WHATSAPP_MAX_AI_REPLIES,
  )
  const ticketMode = Boolean(thread.provenAt && thread.ticketModeAt)
  return {
    enabled: true,
    displayNumber: sender.displayNumber,
    link: `https://wa.me/${sender.waNumber}?text=${encodeURIComponent(demoWhatsAppOpener(params.company ?? null, code))}`,
    code,
    phoneMasked: maskPhone(phone.e164),
    canWelcome: params.grant.liveCallEnabled,
    welcomeSentAt: thread.welcomeSentAt?.toISOString() ?? null,
    proven: Boolean(thread.provenAt),
    agentActive,
    agentRepliesLeft: Math.max(0, DEMO_WHATSAPP_MAX_AI_REPLIES - thread.aiReplies),
    agentEndsAt: thread.expiresAt?.toISOString() ?? null,
    closed: Boolean(thread.closedAt),
    messages,
    ticketMode,
    ticketModeEnded: ticketMode && !agentActive && !ticket,
    ticket,
  }
}

export type StartDemoTicketModeResult =
  | { ok: true; state: DemoWhatsAppState }
  | { ok: false; code: "not_enabled" | "not_proven" | "agent_done" }

/**
 * «Mesajımdan bilet açılsın»: from the prospect's next message on, what they
 * write on WhatsApp goes into a real ticket in LeadDrive's Service Desk (owner,
 * 2026-10-18: only on the prospect's own press). Only on a proven thread whose
 * agent still answers; once.
 */
export async function startDemoWhatsAppTicketMode(params: {
  grant: Grant
  requestPhone: string | null
  company?: string | null
  now?: Date
}): Promise<StartDemoTicketModeResult> {
  const now = params.now ?? new Date()
  if (!usable(params.grant, now)) return { ok: false, code: "not_enabled" }
  const phone = normalizeDemoPhone(params.requestPhone ?? "")
  if (!phone) return { ok: false, code: "not_enabled" }
  const thread = await ensureThread(params.grant, phone.e164)
  if (thread.phoneE164 !== phone.e164) return { ok: false, code: "not_enabled" }
  if (!thread.provenAt) return { ok: false, code: "not_proven" }
  const answering = !thread.closedAt && thread.expiresAt !== null && thread.expiresAt > now && thread.aiReplies < DEMO_WHATSAPP_MAX_AI_REPLIES
  if (!answering) return { ok: false, code: "agent_done" }
  await runWithRlsBypass(() =>
    prisma.demoWhatsAppThread.updateMany({
      where: { id: thread.id, ticketModeAt: null, provenAt: { not: null }, closedAt: null },
      data: { ticketModeAt: now },
    }),
  )
  return { ok: true, state: await demoWhatsAppState({ grant: params.grant, requestPhone: params.requestPhone, company: params.company, now }) }
}

/** Inside the tenant already: the demo's own ticket by its id, in its customer's view. */
async function readTicket(organizationId: string, ticketId: string): Promise<DemoWhatsAppTicketView | null> {
  const row = await prisma.ticket.findFirst({
    where: { id: ticketId, organizationId },
    select: {
      ticketNumber: true,
      subject: true,
      status: true,
      createdAt: true,
      slaFirstResponseDueAt: true,
      firstResponseAt: true,
      slaDueAt: true,
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "desc" },
        take: DEMO_WHATSAPP_TICKET_MESSAGES,
        select: { comment: true, userId: true, createdAt: true },
      },
      _count: { select: { comments: { where: { isInternal: false } } } },
    },
  })
  if (!row) return null
  return demoWhatsAppTicketView({ ...row, publicCommentCount: row._count.comments })
}

/**
 * «WhatsApp-a mesaj göndərin»: our first message to the request's phone.
 * Only on a request the owner switched on, on the prospect's own press with
 * the consent line, once per grant, once a week per phone and within the
 * line's daily ceiling — a template to a typed number reaches whoever holds
 * it, and blocks there lower the quality rating of the only sales number.
 */
export async function sendDemoWhatsAppWelcome(params: {
  grant: Grant
  requestPhone: string | null
  requestName: string | null
  company?: string | null
  consent: boolean
  now?: Date
}): Promise<SendDemoWelcomeResult> {
  const now = params.now ?? new Date()
  // We write first only where the owner has seen the request; anyone else writes first.
  if (!usable(params.grant, now) || !params.grant.liveCallEnabled) return { ok: false, code: "not_enabled" }
  if (!params.consent) return { ok: false, code: "consent_required" }
  const phone = normalizeDemoPhone(params.requestPhone ?? "")
  if (!phone) return { ok: false, code: "not_enabled" }
  const thread = await ensureThread(params.grant, phone.e164)
  if (thread.phoneE164 !== phone.e164) return { ok: false, code: "not_enabled" }
  if (thread.welcomeSentAt) return { ok: false, code: "already_sent" }

  // Claimed before sending — two presses send one message — and decided one
  // at a time for the whole line, so neither the phone's week nor the day's
  // ceiling can be raced by parallel demos.
  const outcome = await runWithRlsBypass(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"demo-whatsapp-welcome"}))`
      const recent = await tx.demoWhatsAppThread.findFirst({
        where: { phoneE164: phone.e164, id: { not: thread.id }, welcomeSentAt: { gt: new Date(now.getTime() - WELCOME_COOLDOWN_MS) } },
        select: { id: true },
      })
      if (recent) return "cooldown" as const
      const today = await tx.demoWhatsAppThread.count({ where: { welcomeSentAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } } })
      if (today >= DEMO_WHATSAPP_WELCOMES_PER_DAY) return "busy" as const
      const claimed = await tx.demoWhatsAppThread.updateMany({ where: { id: thread.id, welcomeSentAt: null }, data: { welcomeSentAt: now } })
      return claimed.count ? ("claimed" as const) : ("already_sent" as const)
    }),
  )
  if (outcome !== "claimed") return { ok: false, code: outcome }
  const release = () => runWithRlsBypass(() =>
    prisma.demoWhatsAppThread.updateMany({ where: { id: thread.id, welcomeSentAt: now, welcomeWaMessageId: null }, data: { welcomeSentAt: null } }),
  )

  const firstName = demoCallFirstName(params.requestName) ?? DEMO_WHATSAPP_WELCOME.fallbackName
  const entered = await inDemoSalesOrganization(async (organizationId) => {
    const config = await resolveWhatsAppConfig(organizationId)
    if (!config) return { status: "failed" as const }
    const delivery = await sendDemoWhatsAppWelcomeTemplate(config, { to: phone.e164, firstName })
    if (delivery.status !== "sent") return delivery
    await prisma.channelMessage.create({
      data: {
        organizationId,
        channelConfigId: config.id,
        conversationId: await demoWhatsAppConversationId(organizationId, phone.e164),
        direction: "outbound",
        channelType: "whatsapp",
        from: config.phoneNumberId,
        to: phone.e164.replace(/^\+/, ""),
        body: DEMO_WHATSAPP_WELCOME.body(firstName),
        status: "sent",
        externalId: delivery.messageId,
        metadata: {
          channel: "whatsapp",
          sentVia: "demo_welcome",
          template: DEMO_WHATSAPP_WELCOME.name,
          consentVersion: DEMO_WHATSAPP_CONSENT_VERSION,
          demoGrantId: params.grant.id,
          waMessageId: delivery.messageId,
        },
      },
    })
    return delivery
  })
  const delivery = entered?.value ?? { status: "failed" as const }
  if (delivery.status === "unknown") {
    // The request may have reached Meta (we stopped waiting): it may be on the
    // phone already, so the claim stays and the page says to look.
    await runWithRlsBypass(() =>
      prisma.demoAccessEvent.create({ data: { grantId: params.grant.id, eventType: "WHATSAPP_WELCOME_SENT", metadata: { consentVersion: DEMO_WHATSAPP_CONSENT_VERSION, confirmed: false } } }),
    ).catch(() => {})
    return { ok: true, state: await demoWhatsAppState({ grant: params.grant, requestPhone: params.requestPhone, company: params.company, now }) }
  }
  if (delivery.status !== "sent") {
    await release()
    return { ok: false, code: delivery.status === "unavailable" ? "unavailable" : "failed" }
  }
  await runWithRlsBypass(async () => {
    await prisma.demoWhatsAppThread.updateMany({ where: { id: thread.id }, data: { welcomeWaMessageId: delivery.messageId ?? "unknown" } })
    await prisma.demoAccessEvent.create({ data: { grantId: params.grant.id, eventType: "WHATSAPP_WELCOME_SENT", metadata: { consentVersion: DEMO_WHATSAPP_CONSENT_VERSION } } })
  })
  return { ok: true, state: await demoWhatsAppState({ grant: params.grant, requestPhone: params.requestPhone, company: params.company, now }) }
}

/**
 * Inside the tenant already: the door above put us there. Only messages since
 * the proof, matched by the exact number — an inbound row by its `waPhone`, an
 * outbound row by its `to` — never by a part of a number or by `from`, which
 * on an inbound row is the sender's own profile name.
 */
async function readThread(organizationId: string, phoneE164: string, since: Date): Promise<DemoWhatsAppMessage[]> {
  const digits = phoneE164.replace(/\D/g, "")
  const rows = await prisma.channelMessage.findMany({
    where: {
      organizationId,
      channelType: "whatsapp",
      createdAt: { gte: since },
      OR: [
        { direction: "inbound", metadata: { path: ["waPhone"], equals: digits } },
        { direction: "outbound", to: { in: [digits, `+${digits}`] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: THREAD_LIMIT,
    select: { id: true, direction: true, body: true, createdAt: true, metadata: true },
  })
  return rows.reverse().map((row) => {
    const metadata = row.metadata as { sentVia?: unknown; aiAutoReply?: unknown } | null
    // The product's own AI (after the demo's day) marks its replies too.
    const ai = metadata?.sentVia === "demo_ai" || metadata?.aiAutoReply === true
    const by = row.direction === "inbound" ? "prospect" : ai ? "ai" : metadata?.sentVia === "demo_welcome" ? "welcome" : "team"
    return {
      id: row.id,
      direction: row.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
      by,
      // A template is logged as its name, not its words: say what it is instead.
      text: /^\[template:[^\]]+\]$/.test(row.body.trim()) ? "WhatsApp şablon mesajı" : row.body,
      at: row.createdAt.toISOString(),
    }
  })
}
