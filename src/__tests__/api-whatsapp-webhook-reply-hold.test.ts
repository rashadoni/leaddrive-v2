vi.mock("@/lib/integrations/whatsapp-events", () => ({ publishWhatsAppIntegrationEvent: vi.fn().mockResolvedValue(undefined) }))
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * On a number that stays in the WhatsApp Business app, nothing of ours answers first.
 *
 * Our reply leaves inside the webhook request; a person holding the phone answers half a minute
 * later. There is no "a human is typing" signal to wait for, so the only way to avoid two answers is
 * to send none now — and the thing worth testing is that EVERY automatic sender honours it. One that
 * did not would defeat the rest: the customer does not care which of our features answered twice.
 *
 * What must keep working is just as important: the message is still stored and still becomes a
 * ticket. A held channel is quiet, not blind.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  created: [] as Row[],
}))

const bookingTurn = vi.hoisted(() => vi.fn(async () => ({ handled: true })))
const ticketHook = vi.hoisted(() => vi.fn(async () => ({ ticketId: "t1", ticketNumber: "TS-1", created: true, reopened: false, commentAdded: true })))
const ruleBot = vi.hoisted(() => vi.fn(async () => ({ replied: true })))
const reopenNotice = vi.hoisted(() => vi.fn(async () => undefined))
const aiPolicy = vi.hoisted(() => vi.fn(async () => undefined))
const demoHook = vi.hoisted(() => vi.fn(async () => ({ handled: false })))

vi.mock("@/lib/booking/whatsapp-agent", () => ({ handleWhatsAppBookingTurn: bookingTurn }))
vi.mock("@/lib/inbox/whatsapp-inbound-ticket", () => ({ ensureInboundWhatsAppTicket: ticketHook }))
vi.mock("@/lib/chatbot-autoreply", () => ({ maybeAutoReply: ruleBot, chatbotTookOwnership: () => true }))
vi.mock("@/lib/inbox/whatsapp-reopen-notification", () => ({ sendGuardedWhatsAppReopenNotification: reopenNotice }))
vi.mock("@/lib/inbox/whatsapp-ai-test", () => ({ withWhatsAppAiPolicy: aiPolicy, hasWhatsAppAiTest: () => false }))
vi.mock("@/lib/demo-center/demo-whatsapp-agent", () => ({ handleDemoWhatsAppInbound: demoHook, fileDemoWhatsAppMedia: vi.fn(async () => false) }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async ({ where }: Row) => (where.slug === "acme" ? { id: "org_1" } : null)) },
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) => {
        if (where?.organizationId === "org_1" && !where.OR) return { id: "cfg_wa", verifyToken: "V", appSecret: "SECRET" }
        const phoneId = where?.OR?.[0]?.phoneNumberId || where?.OR?.[1]?.phoneNumber
        return phoneId === "phone_1"
          ? { id: "cfg_wa", organizationId: "org_1", settings: db.settings, phoneNumberId: "phone_1", appSecret: "SECRET" }
          : null
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: `m_${db.created.length + 1}`, ...data }
        db.created.push(row)
        return row
      }),
      count: vi.fn(async () => 0),
    },
    contact: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    lead: { findFirst: vi.fn(async () => null) },
    socialConversation: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn(async () => ({ id: "sc_1", assignedTo: null, wasCreated: false })) }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), resolveWhatsAppConfig: vi.fn(async () => null) }))
vi.mock("@/lib/whatsapp-media", () => ({ fetchAndStoreWaMedia: vi.fn() }))
vi.mock("@/lib/ai/support-feature", () => ({ isSupportAiEnabled: vi.fn(async () => true) }))
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: vi.fn() }))
vi.mock("@/lib/ai/pii-masker", () => ({ PiiMasker: class { mask(s: string) { return s } unmask(s: string) { return s } } }))
vi.mock("@/lib/complaint-ai", () => ({ enrichComplaintInBackground: vi.fn() }))
vi.mock("@/lib/ticket-factory", () => ({ createTicketWithAssignment: vi.fn() }))
vi.mock("@/lib/ticket-reopen", () => ({ reopenTicketForCustomerReply: vi.fn() }))
vi.mock("@/lib/sla-resolver", () => ({ resolveTicketSla: vi.fn(), normalizeTicketPriority: (p: string) => p }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn() }))
vi.mock("@/lib/inbox/reply-mode", () => ({ aiReplyEnabled: vi.fn(() => true) }))
vi.mock("@/lib/ai/support-agent", () => ({ getSupportAgentConfig: vi.fn() }))
vi.mock("@/lib/inbox/ticket-sync", () => ({ syncWhatsAppExchangeToTicket: vi.fn(), appendWhatsAppBotReplyToTicket: vi.fn() }))
vi.mock("@/lib/inbox/complaint-register", () => ({ ensureComplaintRegistered: vi.fn(), notifyComplaintRegistered: vi.fn() }))
vi.mock("@/lib/auto-assign", () => ({ autoAssignTicket: vi.fn() }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn() }))
vi.mock("@/lib/inbox/whatsapp-opt-out", () => ({
  isWhatsAppOptOut: () => false,
  recordWhatsAppOptOut: vi.fn(),
  recordWhatsAppConversationOptOut: vi.fn(),
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

import { POST } from "@/app/api/v1/webhooks/whatsapp/route"

const URL_T = "https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp?t=acme"
const sign = (body: string) => "sha256=" + createHmac("sha256", "SECRET").update(body).digest("hex")

function inboundRequest(text: string): NextRequest {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba_1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "phone_1", display_phone_number: "994103180049" },
          contacts: [{ profile: { name: "Leyla" }, wa_id: "994501234567" }],
          messages: [{ id: "wamid.in1", from: "994501234567", timestamp: "1794207600", type: "text", text: { body: text } }],
        },
      }],
    }],
  })
  return {
    url: URL_T,
    nextUrl: new URL(URL_T),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sign(body) : null) },
  } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  db.settings = {}
  db.created = []
  ticketHook.mockResolvedValue({ ticketId: "t1", ticketNumber: "TS-1", created: true, reopened: false, commentAdded: true })
})
afterEach(() => {
  delete process.env.WHATSAPP_APP_SECRET
})

describe("a message to a number that also lives in the WhatsApp Business app", () => {
  beforeEach(() => {
    db.settings = { embeddedSignup: true, coexistence: true }
  })

  it("answers with nothing — no booking agent, no rule bot, no support AI", async () => {
    expect((await POST(inboundRequest("Sabah 11:30 olar?"))).status).toBe(200)

    // The booking agent is the dangerous one: it reads neither the conversation's assignment nor its
    // status, so without this it would offer times over a human who has already agreed one.
    expect(bookingTurn).not.toHaveBeenCalled()
    expect(ruleBot).not.toHaveBeenCalled()
    expect(aiPolicy).not.toHaveBeenCalled()
    expect(demoHook).not.toHaveBeenCalled()
  })

  it("still stores the message and still files the ticket", async () => {
    await POST(inboundRequest("Sabah 11:30 olar?"))

    // Held, not blind: the operator sees this in the inbox and the ticket exists.
    expect(db.created.some((row) => row.direction === "inbound" && row.body === "Sabah 11:30 olar?")).toBe(true)
    expect(ticketHook).toHaveBeenCalledTimes(1)
  })

  it("does not send the ticket-reopen notice either", async () => {
    ticketHook.mockResolvedValue({ ticketId: "t1", ticketNumber: "TS-7", created: false, reopened: true, commentAdded: true })

    await POST(inboundRequest("всё ещё жду"))

    // This one is easy to forget: it is not an AI reply, but it is a real message to the customer.
    expect(reopenNotice).not.toHaveBeenCalled()
  })

  it("answers as usual once the owner switches the hold off for this channel", async () => {
    db.settings = { embeddedSignup: true, coexistence: true, replyHold: "never" }

    await POST(inboundRequest("Sabah 11:30 olar?"))

    expect(bookingTurn).toHaveBeenCalledTimes(1)
  })
})

describe("every other number", () => {
  it("keeps answering immediately, exactly as before", async () => {
    db.settings = { embeddedSignup: true }

    expect((await POST(inboundRequest("Sabah 11:30 olar?"))).status).toBe(200)

    expect(bookingTurn).toHaveBeenCalledTimes(1)
    expect(ticketHook).not.toHaveBeenCalled() // the booking agent owned the turn, as it always has
  })

  it("can be held by the owner on its own, without being a coexistence number", async () => {
    db.settings = { embeddedSignup: true, replyHold: "always" }

    await POST(inboundRequest("Sabah 11:30 olar?"))

    expect(bookingTurn).not.toHaveBeenCalled()
    expect(ticketHook).toHaveBeenCalledTimes(1)
  })
})
