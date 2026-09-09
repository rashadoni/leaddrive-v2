import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

/**
 * A2 — Inbound SMS / email ingestion into the unified inbox.
 *
 * Covers:
 *  SMS-1  Non-STOP inbound → ChannelMessage(inbound, sms) + ensureConversation + notify
 *  SMS-2  STOP keyword    → surveyUnsubscribe created, NO ChannelMessage
 *  SMS-3  Missing externalId → still ingests (idempotency guard skipped)
 *  SMS-4  Duplicate externalMsgId → read-then-write guard skips create
 *  SMS-5  Concurrent-retry race → create() throws P2002 → skip quietly, NO notify
 *  EMAIL-1 kind=contact → ChannelMessage(inbound, email) + ensure + notify
 *  EMAIL-2 kind=ticket  → ticket path unchanged, NO ChannelMessage for inbox
 *  EMAIL-3 kind=contact + duplicate messageId → read-then-write guard skips create
 *  EMAIL-4 kind=contact + create() throws P2002 → skip quietly, NO notify
 */

// ── Shared state ─────────────────────────────────────────────────────────────
const db: {
  unsubscribes: any[]
  messages: any[]
  existingMessageId: string | null
  throwP2002OnCreate: boolean
} = { unsubscribes: [], messages: [], existingMessageId: null, throwP2002OnCreate: false }

const ensureSpy = vi.fn(async () => ({ id: "sc_1", assignedTo: "u_agent", wasCreated: true }))
const notifySpy = vi.fn(async () => {})
const emitEventsSpy = vi.fn(async () => ({}))

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ id: "org_1" })),
    },
    // The inbound secret lives on the org's sms channel. Returning it here is
    // what makes the requests below authenticated rather than rejected.
    channelConfig: {
      findFirst: vi.fn(async () => ({ settings: { inboundSecret: "sms-inbound-secret" } })),
    },
    surveyUnsubscribe: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: any) => {
        db.unsubscribes.push(args.data)
        return args.data
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: any) => {
        // Idempotency check: return existing row if externalId matches
        if (db.existingMessageId && where?.externalId === db.existingMessageId) {
          return { id: "msg_existing" }
        }
        return null
      }),
      create: vi.fn(async ({ data }: any) => {
        // Simulate the partial-unique-index race: the concurrent retry that lost
        // the race gets a P2002 on INSERT.
        if (db.throwP2002OnCreate) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          })
        }
        const row = { id: `msg_${db.messages.length + 1}`, ...data }
        db.messages.push(row)
        return row
      }),
    },
    contact: {
      findFirst: vi.fn(async () => ({ id: "contact_1", organizationId: "org_1", fullName: "Test Contact" })),
    },
    ticket: {
      findFirst: vi.fn(async () => ({ id: "ticket_1", organizationId: "org_1", contactId: "contact_1" })),
    },
    ticketComment: {
      create: vi.fn(async () => ({})),
    },
    emailLog: {
      findFirst: vi.fn(async () => null), // [P3] dedup guard — no existing log → proceed to create
      create: vi.fn(async () => ({})),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

vi.mock("@/lib/inbox-ensure-conversation", () => ({
  ensureConversation: ensureSpy,
}))

vi.mock("@/lib/social/notify-recipients", () => ({
  notifyConversationRecipients: notifySpy,
}))

vi.mock("@/lib/inbox/conversation-events", () => ({
  emitConversationIngestEvents: emitEventsSpy,
}))

vi.mock("@/lib/email-reply-address", () => ({
  extractReplyToFromToHeader: vi.fn(() => null),
  parseReplyTo: vi.fn((to: string) => {
    if (to === "reply-ticket@mail.leaddrivecrm.org") return { ok: true, kind: "ticket", id: "ticket_1" }
    if (to === "reply-contact@mail.leaddrivecrm.org") return { ok: true, kind: "contact", id: "contact_1" }
    return { ok: false, reason: "unrecognized" }
  }),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  RATE_LIMIT_CONFIG: { webhook: {} },
}))

vi.mock("@/lib/ticket-reopen", () => ({
  reopenTicketForCustomerReply: vi.fn(async () => ({ reopened: false })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
// F-26: `orgId` is routing information, not a credential — the route now also
// requires the secret the provider was configured with. The header is the
// preferred carrier; the query-parameter fallback exists for providers that
// cannot attach one and is covered separately below.
export const SMS_INBOUND_TEST_SECRET = "sms-inbound-secret"

function smsRequest(fields: Record<string, string>, orgId = "org_1") {
  const body = new URLSearchParams(fields).toString()
  return new NextRequest(`http://localhost/api/v1/webhooks/sms-inbound?orgId=${orgId}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-webhook-secret": SMS_INBOUND_TEST_SECRET,
    },
    body,
  })
}

function emailRequest(fields: {
  to: string
  from: string
  subject?: string
  text?: string
  messageId?: string
}) {
  return new NextRequest("http://localhost/api/v1/public/email-inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cf-inbound-secret": "test-secret",
    },
    body: JSON.stringify({ text: "Hi", ...fields }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  db.unsubscribes.length = 0
  db.messages.length = 0
  db.existingMessageId = null
  db.throwP2002OnCreate = false
  ensureSpy.mockClear()
  notifySpy.mockClear()
  emitEventsSpy.mockClear()
  emitEventsSpy.mockResolvedValue({})
  process.env.CF_INBOUND_SECRET = "test-secret"
})

// ╔══════════════════════════════════════════════════════════════╗
// ║  SMS                                                         ║
// ╚══════════════════════════════════════════════════════════════╝

describe("A2 SMS inbound", () => {
  it("SMS-1: non-STOP → creates inbound ChannelMessage + ensureConversation + notify", async () => {
    const { POST } = await import("../app/api/v1/webhooks/sms-inbound/route")
    const req = smsRequest({ From: "+99412345678", Body: "Hello!", To: "+99400000001", MessageSid: "SM_abc" })
    const res = await POST(req)

    expect(res.status).toBe(200)
    // TwiML 200 returned synchronously; async iife fires in background — wait a tick
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(1)
    expect(db.messages[0]).toMatchObject({
      organizationId: "org_1",
      direction: "inbound",
      channelType: "sms",
      from: "+99412345678",
      to: "+99400000001",
      body: "Hello!",
      externalId: "SM_abc",
      contactId: "contact_1",
    })

    expect(ensureSpy).toHaveBeenCalledOnce()
    expect(ensureSpy).toHaveBeenCalledWith("org_1", expect.objectContaining({
      channel: "sms",
      contactId: "contact_1",
      contactPhone: "+99412345678",
      messageIds: ["msg_1"],
    }))

    expect(notifySpy).toHaveBeenCalledOnce()
    expect(notifySpy).toHaveBeenCalledWith("org_1", "sc_1", "u_agent", expect.objectContaining({
      kind: "inbox.message",
      entityType: "inbox_message",
    }))
    expect(emitEventsSpy).toHaveBeenCalledOnce()
    expect(emitEventsSpy).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "sc_1",
      wasCreated: true,
    })
  })

  it("SMS-2: STOP keyword → surveyUnsubscribe created, NO ChannelMessage created", async () => {
    vi.resetModules()
    const { POST } = await import("../app/api/v1/webhooks/sms-inbound/route")
    const req = smsRequest({ From: "+99412345678", Body: "STOP", MessageSid: "SM_stop1" })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.unsubscribes).toHaveLength(1)
    expect(db.messages).toHaveLength(0)
    expect(ensureSpy).not.toHaveBeenCalled()
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it("SMS-3: no externalId → still ingests (guard skipped)", async () => {
    vi.resetModules()
    const { POST } = await import("../app/api/v1/webhooks/sms-inbound/route")
    const req = smsRequest({ From: "+99412345678", Body: "No ID" }) // no MessageSid
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(1)
    expect(db.messages[0].externalId).toBeUndefined()
  })

  it("SMS-4: duplicate MessageSid → read-then-write guard skips create", async () => {
    vi.resetModules()
    db.existingMessageId = "SM_dup"
    const { POST } = await import("../app/api/v1/webhooks/sms-inbound/route")
    const req = smsRequest({ From: "+99412345678", Body: "Retry", MessageSid: "SM_dup" })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(0)
    expect(ensureSpy).not.toHaveBeenCalled()
  })

  it("SMS-5: concurrent-retry race → create() throws P2002 → skip quietly, NO notify, still 200", async () => {
    vi.resetModules()
    db.throwP2002OnCreate = true // race-loser: passed the findFirst guard, hit the unique index
    const { POST } = await import("../app/api/v1/webhooks/sms-inbound/route")
    const req = smsRequest({ From: "+99412345678", Body: "Dup race", MessageSid: "SM_race" })
    const res = await POST(req)

    // TwiML 200 returned regardless (fire-and-forget); the P2002 is swallowed, not surfaced.
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(0) // create threw — no row recorded by the mock
    expect(ensureSpy).not.toHaveBeenCalled() // skipped before ensure/notify
    expect(notifySpy).not.toHaveBeenCalled()
    expect(emitEventsSpy).not.toHaveBeenCalled()
  })

  it("SMS-6: conversation-flow event failure does not break persisted inbound message or notify", async () => {
    vi.resetModules()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    emitEventsSpy.mockRejectedValueOnce(new Error("flow boom"))
    const { POST } = await import("../app/api/v1/webhooks/sms-inbound/route")
    const req = smsRequest({ From: "+99412345678", Body: "Hello!", To: "+99400000001", MessageSid: "SM_event_fail" })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(1)
    expect(notifySpy).toHaveBeenCalledOnce()
    expect(emitEventsSpy).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})

// ╔══════════════════════════════════════════════════════════════╗
// ║  EMAIL                                                       ║
// ╚══════════════════════════════════════════════════════════════╝

// Importing the full public email route cold-loads a large dependency graph.
// Cached CI runners can legitimately need more than Vitest's 5s default even
// though the assertions themselves remain fast and deterministic.
describe("A2 email inbound", { timeout: 20_000 }, () => {
  it("EMAIL-1: kind=contact → creates inbound ChannelMessage + ensure + notify", async () => {
    vi.resetModules()
    const { POST } = await import("../app/api/v1/public/email-inbound/route")
    const req = emailRequest({
      to: "reply-contact@mail.leaddrivecrm.org",
      from: "customer@example.com",
      subject: "Re: hello",
      text: "Thanks for reaching out",
      messageId: "<msg-abc@example.com>",
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(1)
    expect(db.messages[0]).toMatchObject({
      direction: "inbound",
      channelType: "email",
      from: "customer@example.com",
      contactId: "contact_1",
      externalId: "<msg-abc@example.com>",
    })

    expect(ensureSpy).toHaveBeenCalledOnce()
    expect(ensureSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      channel: "email",
      contactId: "contact_1",
      contactEmail: "customer@example.com",
    }))

    expect(notifySpy).toHaveBeenCalledOnce()
    expect(notifySpy).toHaveBeenCalledWith(expect.any(String), "sc_1", "u_agent", expect.objectContaining({
      kind: "inbox.message",
      entityType: "inbox_message",
    }))
    expect(emitEventsSpy).toHaveBeenCalledOnce()
    expect(emitEventsSpy).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "sc_1",
      wasCreated: true,
      // E2 — the sender travels with the ingest event so cadence auto-exit
      // can tell the enrolled person's reply from a third party's
      senderEmail: "customer@example.com",
    })
  })

  it("EMAIL-2: kind=ticket → ticket path unchanged, NO inbox ChannelMessage", async () => {
    vi.resetModules()
    const { POST } = await import("../app/api/v1/public/email-inbound/route")
    const req = emailRequest({
      to: "reply-ticket@mail.leaddrivecrm.org",
      from: "customer@example.com",
      text: "Reply to ticket",
      messageId: "<msg-ticket@example.com>",
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    // ChannelMessage should NOT have been created by the email-inbound A2 code
    // (ticket path is separate — no inbox ingestion)
    expect(db.messages).toHaveLength(0)
    expect(ensureSpy).not.toHaveBeenCalled()
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it("EMAIL-3: duplicate messageId → read-then-write guard skips create", async () => {
    vi.resetModules()
    db.existingMessageId = "<msg-dup@example.com>"
    const { POST } = await import("../app/api/v1/public/email-inbound/route")
    const req = emailRequest({
      to: "reply-contact@mail.leaddrivecrm.org",
      from: "customer@example.com",
      text: "Retry email",
      messageId: "<msg-dup@example.com>",
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(0)
    expect(ensureSpy).not.toHaveBeenCalled()
  })

  it("EMAIL-4: concurrent-retry race → create() throws P2002 → skip quietly, NO notify", async () => {
    vi.resetModules()
    db.throwP2002OnCreate = true // race-loser: passed findFirst, hit the unique index on INSERT
    const { POST } = await import("../app/api/v1/public/email-inbound/route")
    const req = emailRequest({
      to: "reply-contact@mail.leaddrivecrm.org",
      from: "customer@example.com",
      text: "Dup race email",
      messageId: "<msg-race@example.com>",
    })
    const res = await POST(req)

    // The contact path still returns its 200; the P2002 in the fire-and-forget ingest is swallowed.
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(db.messages).toHaveLength(0)
    expect(ensureSpy).not.toHaveBeenCalled()
    expect(notifySpy).not.toHaveBeenCalled()
    expect(emitEventsSpy).not.toHaveBeenCalled()
  })
})
