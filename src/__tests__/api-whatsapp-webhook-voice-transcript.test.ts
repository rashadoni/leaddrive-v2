vi.mock("@/lib/integrations/whatsapp-events", () => ({ publishWhatsAppIntegrationEvent: vi.fn().mockResolvedValue(undefined) }))
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * A WhatsApp voice note arrives as words (owner, 2026-11-10: «Да» to transcribing voice messages on
 * every messenger). The audio downloaded for the thread is transcribed before the message is saved,
 * so the body the manager reads — and the text the booking agent, rules and AI are handed — is
 * «[Səsli mesaj]» and what the customer said. No key or a failed transcription leaves the voice note
 * as it was: stored, playable, its placeholder in place.
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
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), resolveWhatsAppConfig: vi.fn(async () => ({ accessToken: "wa-token" })) }))
const media = vi.hoisted(() => vi.fn())
vi.mock("@/lib/whatsapp-media", () => ({ fetchAndStoreWaMedia: media }))
const transcribe = vi.hoisted(() => vi.fn())
const transcriptionClient = vi.hoisted(() => ({ available: true }))
vi.mock("@/lib/transcription/transcribe", () => ({
  resolveTranscriptionClient: vi.fn(async () => (transcriptionClient.available ? { transcribe } : null)),
}))
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

const VOICE_BYTES = Buffer.from("OggS-voice-note")

function voiceRequest(): NextRequest {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "waba_1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "phone_1", display_phone_number: "994105313065" },
          contacts: [{ profile: { name: "Leyla" }, wa_id: "994501234567" }],
          messages: [{
            id: "wamid.voice1", from: "994501234567", timestamp: "1794207600", type: "audio",
            audio: { id: "media_1", mime_type: "audio/ogg; codecs=opus", voice: true },
          }],
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

const savedInbound = () => db.created.find((row) => row.direction === "inbound")

beforeEach(() => {
  vi.clearAllMocks()
  db.settings = { embeddedSignup: true }
  db.created = []
  transcriptionClient.available = true
  media.mockResolvedValue({ url: "/uploads/whatsapp/org_1/abc.ogg", mime: "audio/ogg", bytes: VOICE_BYTES })
  transcribe.mockResolvedValue({ transcript: " Sabah saat 11-ə yazılmaq istəyirəm. ", provider: "openai-whisper", language: "az", durationSeconds: 4.2 })
})
afterEach(() => {
  delete process.env.WHATSAPP_APP_SECRET
})

describe("a WhatsApp voice note", () => {
  it("is saved with what the customer said, under the voice note's file", async () => {
    expect((await POST(voiceRequest())).status).toBe(200)

    const row = savedInbound()
    expect(row?.mediaUrl).toBe("/uploads/whatsapp/org_1/abc.ogg")
    expect(row?.body).toBe("[Səsli mesaj]\nSabah saat 11-ə yazılmaq istəyirəm.")
    expect(row?.metadata?.transcription).toEqual({
      text: "Sabah saat 11-ə yazılmaq istəyirəm.", provider: "openai-whisper", language: "az", durationSeconds: 4.2,
    })
  })

  it("is transcribed from the downloaded file itself — no second download", async () => {
    await POST(voiceRequest())
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(transcribe.mock.calls[0][0]).toMatchObject({ audio: { bytes: VOICE_BYTES, contentType: "audio/ogg" } })
  })

  it("reaches the agent as words, like a typed message", async () => {
    await POST(voiceRequest())
    expect(bookingTurn).toHaveBeenCalledTimes(1)
    expect((bookingTurn.mock.calls[0] as unknown[])[0]).toMatchObject({ text: "[Səsli mesaj]\nSabah saat 11-ə yazılmaq istəyirəm." })
  })

  it("stays as it arrived when transcription is not available", async () => {
    transcriptionClient.available = false
    await POST(voiceRequest())
    const row = savedInbound()
    expect(row?.body).toBe("[Аудио сообщение]")
    expect(row?.mediaUrl).toBe("/uploads/whatsapp/org_1/abc.ogg")
    expect(row?.metadata?.transcription).toBeUndefined()
  })

  it("stays as it arrived when the provider fails", async () => {
    transcribe.mockRejectedValue(new Error("Whisper 500"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await POST(voiceRequest())).status).toBe(200)
    expect(savedInbound()?.body).toBe("[Аудио сообщение]")
  })

  it("leaves a picture alone", async () => {
    media.mockResolvedValue({ url: "/uploads/whatsapp/org_1/p.jpg", mime: "image/jpeg", bytes: Buffer.from("jpg") })
    const req = voiceRequest()
    const raw = (await req.text()).replace('"type":"audio"', '"type":"image"').replace('"audio":{', '"image":{')
    await POST({ ...req, text: async () => raw, headers: { get: (k: string) => (k === "x-hub-signature-256" ? sign(raw) : null) } } as unknown as NextRequest)
    expect(transcribe).not.toHaveBeenCalled()
  })
})
