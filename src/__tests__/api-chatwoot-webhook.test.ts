import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Chatwoot → LeadDrive inbound bridge (Phase 1).
 *
 * Chatwoot is the transport for TikTok DMs/video-share events; its inbound
 * `message_created` events are mirrored into our omnichannel inbox under the
 * existing "tiktok" channel. Social Monitoring remains reserved for public
 * TikTok comments under owned publications.
 *
 * Covers:
 *  CW-1  incoming message_created → ChannelMessage(inbound, tiktok) + upsertSocialConversation + notify
 *  CW-2  non-message_created event (conversation_created) → ignored, NO message
 *  CW-3  outgoing message_type (our own reply re-emitted) → ignored, NO message
 *  CW-4  missing ?token → 400
 *  CW-5  unknown token (no ChannelConfig) → 200, NO message
 *  CW-6  duplicate message id → read-then-write dedup skips create
 *  CW-7  payload account.id ≠ configured accountId → rejected, NO message
 */

// ── Shared state ─────────────────────────────────────────────────────────────
type ChannelConfigRow = {
  id: string
  organizationId: string
  settings: {
    accountId: number
    webhookSecret: string
    replyMode?: string
    escalateKeywords?: string[]
  }
}
type ChannelMessageRow = { id: string } & Record<string, unknown>
type ChannelMessageFindFirstInput = {
  where?: {
    externalId?: string
    body?: unknown
    contactId?: unknown
  }
}
type ChannelMessageCreateInput = { data: Record<string, unknown> }
type ChatbotAutoReplyResult = { sent?: boolean; skipped?: string }
type ChatbotMaybeReplyResult = { matched: boolean; sent: boolean; skipped?: string; ruleId?: string }
type ChatwootPayload = Record<string, unknown>

const db: {
  config: ChannelConfigRow | null
  messages: ChannelMessageRow[]
  existingMessageId: string | null
  priorContactId: string | null
  duplicateContent: boolean
  uniqueViolation: boolean
  duplicateConfig: boolean
} = {
  config: { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123" } },
  messages: [],
  existingMessageId: null,
  priorContactId: null,
  duplicateContent: false,
  uniqueViolation: false,
  duplicateConfig: false,
}

const upsertSpy = vi.fn(async () => ({ id: "sc_tiktok", assignedTo: "u_agent" }))
const notifySpy = vi.fn(async () => {})
const emitEventsSpy = vi.fn(async () => ({}))
const mirrorMentionSpy = vi.fn(async () => ({ id: "mention_1", created: true }))
const phoneLeadSpy = vi.fn(async () => ({ status: "lead_created", leadId: "lead_1" }))

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      // The route resolves the org by webhook secret with findFirst. Unmocked it
      // threw, the webhook caught it and still answered 200, and every
      // assertion below ran against an untouched db — which is why 19 cases
      // failed on "expected [] to have length 1" rather than on anything real.
      findFirst: vi.fn(async () => db.config ?? null),
      findMany: vi.fn(async () => {
        if (!db.config) return []
        if (!db.duplicateConfig) return [db.config]
        return [
          db.config,
          { ...db.config, id: "cfg_cw_duplicate", organizationId: "org_2" },
        ]
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: ChannelMessageFindFirstInput) => {
        // externalId dedup guard (where.externalId present)
        if (where?.externalId !== undefined) {
          return db.existingMessageId && where.externalId === db.existingMessageId ? { id: "msg_dup" } : null
        }
        // content dedup guard (where.body present — same text, same conv, recent window)
        if (where?.body !== undefined) {
          return db.duplicateContent ? { id: "msg_content_dup" } : null
        }
        // contact-match guard (where.contactId = { not: null })
        if (where?.contactId) {
          return db.priorContactId ? { contactId: db.priorContactId } : null
        }
        return null
      }),
      create: vi.fn(async ({ data }: ChannelMessageCreateInput) => {
        // Simulate the partial unique index rejecting a same-id duplicate that raced past
        // the read-checks (Postgres 23505 → Prisma P2002).
        if (db.uniqueViolation) {
          const err = new Error("Unique constraint failed") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        const row = { id: `msg_${db.messages.length + 1}`, ...data }
        db.messages.push(row)
        return row
      }),
      update: vi.fn(async () => ({})),
    },
    contact: {
      updateMany: vi.fn(async () => ({})),
    },
  },
}))

// upsertSocialConversation is dynamically imported inside the route — vi.mock intercepts both.
vi.mock("@/lib/facebook", () => ({
  upsertSocialConversation: upsertSpy,
}))

vi.mock("@/lib/social/notify-recipients", () => ({
  notifyConversationRecipients: notifySpy,
}))

vi.mock("@/lib/inbox/conversation-events", () => ({
  emitConversationIngestEvents: emitEventsSpy,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult: mirrorMentionSpy,
}))

vi.mock("@/lib/social/phone-lead", () => ({
  processSocialPhoneLead: phoneLeadSpy,
}))

vi.mock("@/lib/sanitize", () => ({
  sanitizeLog: (s: string) => s,
}))

// Pass-through tenant frame: invoke the handler body directly (no AsyncLocalStorage / DB).
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

// Per-channel AI auto-reply (replyMode "ai") — dynamically imported in the route.
type AiReplyStubInput = {
  send: (reply: string) => Promise<boolean | "unknown">
  [key: string]: unknown
}
const aiReplySpy = vi.fn(async (input: AiReplyStubInput) => {
  void input
  return { replied: true, escalated: false }
})
vi.mock("@/lib/social/ai-autoreply", () => ({ maybeAiAutoReply: aiReplySpy }))
const { sendChatwootSpy } = vi.hoisted(() => ({
  sendChatwootSpy: vi.fn(async (): Promise<{ success: boolean; deliveryUnknown?: boolean }> => ({ success: true })),
}))
vi.mock("@/lib/chatwoot", () => ({ sendChatwootMessage: sendChatwootSpy }))
const { tiktokAudioSpy } = vi.hoisted(() => ({
  tiktokAudioSpy: vi.fn(async (input: {
    onTranscript: (text: string) => Promise<void>
    // captured so CW-19b can drive the transcription-unavailable branch itself
    sendFallback: (text: string) => Promise<unknown>
  }) => {
    await input.onTranscript("TikTok audio transcript")
    return "transcribed"
  }),
}))
vi.mock("@/lib/social/instagram-inbound-audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social/instagram-inbound-audio")>()
  return { ...actual, handleTikTokInboundAudio: tiktokAudioSpy }
})
// Keyword rules engine — dynamically imported in the route. Default: no rule matched
// (ownership stays open) so the AI branch behaves exactly as before. `chatbotTookOwnership`
// keeps its real semantics (only an actually sent rule reply owns the turn).
const { kwReplySpy } = vi.hoisted(() => ({
  kwReplySpy: vi.fn(async (): Promise<ChatbotMaybeReplyResult> => ({ matched: false, sent: false })),
}))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: kwReplySpy,
  chatbotTookOwnership: (r: ChatbotAutoReplyResult) => r.sent || r.skipped === "send-unknown",
}))
// Keyword auto-escalation — mock so the webhook test controls match/skip without the real
// prisma.user.findMany + createNotification path (covered in lib-inbox-escalation.test.ts).
const { escalationMatch, notifyEsc } = vi.hoisted(() => ({
  escalationMatch: vi.fn(() => null as string | null),
  notifyEsc: vi.fn(async () => {}),
}))
vi.mock("@/lib/inbox/escalation", () => ({ matchEscalationKeyword: escalationMatch, notifyEscalationTeam: notifyEsc }))
// Delivery-health gate. Default open (channel healthy) so every existing case
// behaves exactly as before; one case below closes it.
const { deliveryGate } = vi.hoisted(() => ({
  deliveryGate: vi.fn(async () => false),
}))
vi.mock("@/lib/inbox/chatwoot-delivery-health", () => ({
  stopAutoReplyForBrokenDelivery: deliveryGate,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function cwRequest(body: unknown, token: string | null = "secret123") {
  const url = token == null
    ? "http://localhost/api/v1/webhooks/chatwoot"
    : `http://localhost/api/v1/webhooks/chatwoot?token=${token}`
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function incomingPayload(over: ChatwootPayload = {}) {
  return {
    event: "message_created",
    id: 555,
    content: "Salam, qiymət neçə?",
    message_type: "incoming",
    conversation: { id: 42, inbox_id: 115298, account_id: 171064 },
    inbox: { id: 115298, name: "aac gobustone" },
    sender: { id: 777, name: "Aysel" },
    account: { id: 171064, name: "AAC" },
    attachments: [],
    ...over,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123" } }
  db.messages.length = 0
  db.existingMessageId = null
  db.priorContactId = null
  db.duplicateContent = false
  db.uniqueViolation = false
  db.duplicateConfig = false
  upsertSpy.mockClear()
  notifySpy.mockClear()
  emitEventsSpy.mockClear()
  emitEventsSpy.mockResolvedValue({ terminal: false })
  mirrorMentionSpy.mockClear()
  mirrorMentionSpy.mockResolvedValue({ id: "mention_1", created: true })
  phoneLeadSpy.mockClear()
  phoneLeadSpy.mockResolvedValue({ status: "lead_created", leadId: "lead_1" })
  aiReplySpy.mockClear()
  tiktokAudioSpy.mockClear()
  sendChatwootSpy.mockClear()
  kwReplySpy.mockClear()
  kwReplySpy.mockResolvedValue({ matched: false, sent: false }) // no keyword rule by default
  escalationMatch.mockReset()
  escalationMatch.mockReturnValue(null) // no keyword match by default
  notifyEsc.mockClear()
})

describe("Chatwoot inbound webhook (Phase 1)", () => {
  it("CW-1: incoming message_created → inbound ChannelMessage(tiktok) + upsert + notify", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(1)
    expect(db.messages[0]).toMatchObject({
      organizationId: "org_1",
      channelConfigId: "cfg_cw",
      direction: "inbound",
      channelType: "tiktok",
      from: "Aysel",
      to: "chatwoot",
      body: "Salam, qiymət neçə?",
      externalId: "555",
    })
    expect(db.messages[0].metadata).toMatchObject({
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
      source: "chatwoot",
      chatwootConversationId: "42",
      chatwootContactId: "777",
    })
    expect(mirrorMentionSpy).not.toHaveBeenCalled()

    expect(upsertSpy).toHaveBeenCalledOnce()
    expect(upsertSpy).toHaveBeenCalledWith("org_1", "tiktok", "42", "Aysel", "Salam, qiymət neçə?", "cfg_cw")

    expect(notifySpy).toHaveBeenCalledOnce()
    expect(notifySpy).toHaveBeenCalledWith("org_1", "sc_tiktok", "u_agent", expect.objectContaining({
      kind: "inbox.message",
      entityType: "inbox_message",
    }))
    expect(emitEventsSpy).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "sc_tiktok", wasCreated: undefined })
  })

  it("CW-2: non-message_created event → ignored, no message", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({ event: "conversation_created" })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it("CW-3: outgoing message_type (our own reply) → ignored, no message", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({ message_type: "outgoing" })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(mirrorMentionSpy).not.toHaveBeenCalled()
  })

  it("CW-4: missing token → 400", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload(), null))

    expect(res.status).toBe(400)
    expect(db.messages).toHaveLength(0)
  })

  it("CW-5: unknown token (no config) → 200, no message", async () => {
    db.config = null
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload(), "wrong-token"))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("CW-5b: duplicate active configs for one secret fail closed without ingesting or replying", async () => {
    db.duplicateConfig = true
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(notifySpy).not.toHaveBeenCalled()
    expect(kwReplySpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled()
    expect(sendChatwootSpy).not.toHaveBeenCalled()
  })

  it("CW-6: duplicate message id → dedup skips create", async () => {
    db.existingMessageId = "555"
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("CW-7: payload account.id ≠ configured accountId → rejected, no message", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({ account: { id: 999999 } })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it("CW-8: replyMode 'ai' → triggers AI auto-reply for tiktok with the right context", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))

    expect(aiReplySpy).toHaveBeenCalledOnce()
    expect(aiReplySpy).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      channelConfigId: "cfg_cw",
      platform: "tiktok",
      conversationId: "sc_tiktok",
      externalId: "42",
      userMessage: "Salam, qiymət neçə?",
      inboundMessageId: "msg_1",
      send: expect.any(Function),
    }))
  })

  it("CW-8a: a channel that stopped delivering silences BOTH bots, not just the AI", async () => {
    // The customer wrote "Salam qiymət" three times because TikTok refused all
    // three price tables. Another generated answer reaches nobody; it only
    // makes the silence longer and the spend larger.
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    deliveryGate.mockResolvedValueOnce(true)
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(aiReplySpy).not.toHaveBeenCalled()
    expect(kwReplySpy).not.toHaveBeenCalled()
    // The inbound is still mirrored — going quiet must never cost us the message.
    expect(db.messages).toHaveLength(1)
  })

  it("CW-8b: maps an ambiguous Chatwoot timeout to the AI no-retry outcome", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    sendChatwootSpy.mockResolvedValueOnce({ success: false, deliveryUnknown: true })
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))

    const send = aiReplySpy.mock.calls[0]?.[0].send
    expect(send).toBeDefined()
    if (!send) throw new Error("AI reply send callback was not provided")
    await expect(send("Salam")).resolves.toBe("unknown")
  })

  it("CW-8c: a terminal conversation flow suppresses keyword and AI replies", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    emitEventsSpy.mockResolvedValueOnce({ terminal: true })
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, terminal: true })
    expect(kwReplySpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled()
    expect(tiktokAudioSpy).not.toHaveBeenCalled()
    expect(sendChatwootSpy).not.toHaveBeenCalled()
  })

  it("CW-8d: a terminal-marker check exception fails closed before every reply path", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    emitEventsSpy.mockRejectedValueOnce(new Error("terminal marker lookup unavailable"))
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      terminal: true,
      reason: "flow_safety_unavailable",
    })
    expect(kwReplySpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled()
    expect(tiktokAudioSpy).not.toHaveBeenCalled()
    expect(sendChatwootSpy).not.toHaveBeenCalled()
  })

  it("CW-8e: a conversation-link exception also fails closed when no marker can be checked", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    upsertSpy.mockRejectedValueOnce(new Error("conversation database unavailable"))
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    const res = await POST(cwRequest(incomingPayload({
      content: null,
      content_attributes: { is_unsupported: true },
      attachments: [],
    })))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      terminal: true,
      reason: "flow_safety_unavailable",
    })
    expect(emitEventsSpy).not.toHaveBeenCalled()
    expect(kwReplySpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled()
    expect(tiktokAudioSpy).not.toHaveBeenCalled()
    expect(sendChatwootSpy).not.toHaveBeenCalled()
  })

  it("CW-8f: the AI reply goes out on the config the webhook was authenticated against", async () => {
    // The webhook already resolved this org by THIS config's webhook secret, so
    // it knows exactly which Chatwoot account the customer is talking to.
    // Dropping the id here handed the sender back to its "any active chatwoot
    // config for this org" fallback (lib-chatwoot-send CWL-9), and an org with
    // two accounts answered on the wrong one.
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))

    const send = aiReplySpy.mock.calls[0]?.[0].send
    if (!send) throw new Error("AI reply send callback was not provided")
    await send("Salam")

    expect(sendChatwootSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "42",
      organizationId: "org_1",
      channelConfigId: "cfg_cw",
    }))
  })

  it("CW-9: default replyMode (agent) → NO auto-reply (pure mirror)", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))
    expect(aiReplySpy).not.toHaveBeenCalled()
  })

  it("CW-10: connector duplicate (same body, different id, within window) → deduped, no 2nd mirror/AI", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    db.duplicateContent = true // an identical inbound body already exists for this conversation
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    // different message id than any prior, but same body → content dedup must catch it
    const res = await POST(cwRequest(incomingPayload({ id: 700604874 })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(0) // no second mirror
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled() // and crucially no second AI reply
  })

  it("CW-11: same-id duplicate races past the read-check → unique index P2002 → deduped, no upsert/AI", async () => {
    // The read-then-write externalId/content checks find nothing (a truly-simultaneous retry),
    // but the partial unique index rejects the INSERT. The webhook must treat P2002 as a dedup.
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    db.uniqueViolation = true
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ deduped: "unique" })
    expect(db.messages).toHaveLength(0) // nothing recorded despite passing the read-checks
    expect(upsertSpy).not.toHaveBeenCalled() // no conversation upsert
    expect(mirrorMentionSpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled() // and no AI reply — the whole tail is skipped
  })

  it("CW-12: inbound hits an escalate keyword → notify team, skip AI (even in 'ai' mode), escalated", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai", escalateKeywords: ["жалоба"] } }
    escalationMatch.mockReturnValue("жалоба") // the message matches a configured keyword
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ escalated: "жалоба" })
    expect(db.messages).toHaveLength(1) // the inbound IS still mirrored (the human needs to see it)
    expect(notifyEsc).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_1", conversationId: "sc_tiktok", keyword: "жалоба", platform: "tiktok" }))
    expect(aiReplySpy).not.toHaveBeenCalled() // crucially: the AI does NOT answer a complaint
  })

  it("CW-13: keyword rule engine runs for tiktok with channel 'tiktok' + conversation id as `to`", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))

    expect(kwReplySpy).toHaveBeenCalledOnce()
    expect(kwReplySpy).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1",
      channelConfigId: "cfg_cw",
      channelType: "tiktok",
      conversationId: "sc_tiktok",
      to: "42", // the Chatwoot conversation id = the reply target (bridges back via sendChatwootMessage)
      inboundText: "Salam, qiymət neçə?",
      // Singular only. The webhook handles ONE message, so it has one id;
      // `inboundMessageIds` is the batched poller's concept and this route has
      // never passed it. 7356bb302 added that expectation here while its actual
      // work was in chatwoot-inbound — wrong file, red ever since.
      inboundMessageId: "msg_1",
    }))
  })

  it("CW-14: keyword rule takes ownership → AI is NOT also called (no double reply), even in 'ai' mode", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    kwReplySpy.mockResolvedValue({ matched: true, sent: true, ruleId: "r1" }) // a keyword rule fired
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))

    expect(kwReplySpy).toHaveBeenCalledOnce()
    expect(aiReplySpy).not.toHaveBeenCalled() // ownership taken → AI skipped
  })

  it("CW-14b: keyword cooldown falls through to AI instead of silently dropping a new turn", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    kwReplySpy.mockResolvedValue({ matched: true, sent: false, ruleId: "r1", skipped: "rate-limited" })
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload()))

    expect(aiReplySpy).toHaveBeenCalledOnce()
  })

  it("CW-14c: an unconfirmed keyword delivery owns the turn and blocks AI fallback", async () => {
    db.config = { id: "cfg_cw", organizationId: "org_1", settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" } }
    kwReplySpy.mockResolvedValue({ matched: true, sent: false, ruleId: "r1", skipped: "send-unknown" })
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    await POST(cwRequest(incomingPayload()))

    expect(kwReplySpy).toHaveBeenCalledOnce()
    expect(aiReplySpy).not.toHaveBeenCalled()
  })

  it("CW-15: disabled SocialMention mirror does not block inbox ingestion", async () => {
    mirrorMentionSpy.mockRejectedValueOnce(new Error("social mention unavailable"))
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload()))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(1)
    expect(upsertSpy).toHaveBeenCalledOnce()
    expect(mirrorMentionSpy).not.toHaveBeenCalled()
  })

  it("CW-16: phone number in TikTok DM stays in the inbox; comment phone leads stay in Social Monitoring", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({ content: "Nomrem 050 111 22 33" })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(1)
    expect(db.messages[0].body).toBe("Nomrem 050 111 22 33")
    expect(phoneLeadSpy).not.toHaveBeenCalled()
  })

  it("CW-17: comment-like Chatwoot payload remains TikTok DM, not a public comment", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({ source_type: "comment" })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(1)
    expect(db.messages[0].metadata).toMatchObject({
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
    })
    expect(mirrorMentionSpy).not.toHaveBeenCalled()
  })

  it("CW-18: attachment-only inbound keeps media on the inbox row without Social Monitoring mirror", async () => {
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({
      content: "",
      attachments: [{ data_url: "https://cdn.chatwoot.test/photo.jpg", file_type: "image" }],
    })))

    expect(res.status).toBe(200)
    expect(db.messages).toHaveLength(1)
    expect(db.messages[0]).toMatchObject({
      body: "[attachment]",
      mediaUrl: "https://cdn.chatwoot.test/photo.jpg",
      messageType: "image",
    })
    expect(mirrorMentionSpy).not.toHaveBeenCalled()
    expect(kwReplySpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled()
  })

  it("CW-19: TikTok audio is transcribed and passed into the AI reply pipeline", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({
      content: "",
      attachments: [{
        data_url: "https://cdn.chatwoot.test/customer-voice.ogg",
        file_type: "audio",
      }],
    })))

    expect(res.status).toBe(200)
    expect(db.messages[0]).toMatchObject({
      mediaUrl: "https://cdn.chatwoot.test/customer-voice.ogg",
      messageType: "audio",
    })
    expect(tiktokAudioSpy).toHaveBeenCalledOnce()
    expect(kwReplySpy).toHaveBeenCalledWith(expect.objectContaining({
      channelType: "tiktok",
      inboundText: "TikTok audio transcript",
    }))
    expect(aiReplySpy).toHaveBeenCalledWith(expect.objectContaining({
      platform: "tiktok",
      userMessage: "TikTok audio transcript",
    }))
  })

  it("CW-19b: the audio fallback reply is routed to the webhook's own Chatwoot config", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    await POST(cwRequest(incomingPayload({
      content: "",
      attachments: [{ data_url: "https://cdn.chatwoot.test/customer-voice.ogg", file_type: "audio" }],
    })))

    // handleTikTokInboundAudio calls this when transcription is unavailable;
    // the apology has to reach the same inbox the voice note came from.
    const sendFallback = tiktokAudioSpy.mock.calls[0]?.[0].sendFallback
    if (!sendFallback) throw new Error("audio sendFallback was not provided")
    await sendFallback("Bağışlayın, səsi tanıya bilmədik.")

    expect(sendChatwootSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "42",
      organizationId: "org_1",
      channelConfigId: "cfg_cw",
    }))
  })

  it("CW-20: unsupported TikTok voice message asks the customer to send text", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")
    const res = await POST(cwRequest(incomingPayload({
      content: null,
      content_attributes: { is_unsupported: true },
      attachments: [],
    })))

    expect(res.status).toBe(200)
    expect(db.messages[0]).toMatchObject({
      body: "[unsupported attachment]",
      messageType: "text",
    })
    expect(tiktokAudioSpy).not.toHaveBeenCalled()
    expect(sendChatwootSpy).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "42",
      organizationId: "org_1",
      content: expect.stringContaining("mətn şəklində"),
      // routed, not left to the sender's "any active chatwoot config" fallback
      channelConfigId: "cfg_cw",
    }))
  })

  it("CW-20b: a terminal flow suppresses the unsupported-media fallback reply", async () => {
    db.config = {
      id: "cfg_cw",
      organizationId: "org_1",
      settings: { accountId: 171064, webhookSecret: "secret123", replyMode: "ai" },
    }
    emitEventsSpy.mockResolvedValueOnce({ terminal: true })
    const { POST } = await import("../app/api/v1/webhooks/chatwoot/route")

    const res = await POST(cwRequest(incomingPayload({
      content: null,
      content_attributes: { is_unsupported: true },
      attachments: [],
    })))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, terminal: true })
    expect(sendChatwootSpy).not.toHaveBeenCalled()
    expect(tiktokAudioSpy).not.toHaveBeenCalled()
    expect(kwReplySpy).not.toHaveBeenCalled()
    expect(aiReplySpy).not.toHaveBeenCalled()
  })
})
