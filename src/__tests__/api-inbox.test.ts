import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ── Mocks ────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    socialConversation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    conversationParticipant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findFirst: vi.fn(),
    },
    conversationNote: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    inboxFolder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    channelConfig: {
      findFirst: vi.fn(),
    },
    callLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock("@/lib/constants", () => ({
  PAGE_SIZE: { DEFAULT: 50, INBOX: 100 },
}))

vi.mock("@/lib/chat-store", () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  addVisitorMessage: vi.fn(),
  setReplyMapping: vi.fn(),
}))

vi.mock("@/lib/inbox/customer-stage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbox/customer-stage")>()
  return {
    ...actual,
    setCustomerStage: vi.fn().mockResolvedValue({ changed: true, previous: null }),
    markMarketingContacted: vi.fn().mockResolvedValue(true),
  }
})

// ── Imports ──────────────────────────────────────────────

import {
  GET as GET_INBOX,
  POST as POST_INBOX,
  PATCH as PATCH_INBOX,
  DELETE as DELETE_INBOX,
} from "@/app/api/v1/inbox/route"
import { GET as GET_CONVERSATIONS } from "@/app/api/v1/inbox/conversations/route"
import {
  GET as GET_CONVERSATION_BY_ID,
  PATCH as PATCH_CONVERSATION,
} from "@/app/api/v1/inbox/conversations/[id]/route"
import { POST as POST_CONVERSATION_MSG } from "@/app/api/v1/inbox/conversations/[id]/messages/route"
import { GET as GET_NOTES, POST as POST_NOTES } from "@/app/api/v1/inbox/conversations/[id]/notes/route"
import { GET as GET_FOLDERS, POST as POST_FOLDERS } from "@/app/api/v1/inbox/folders/route"
import { DELETE as DELETE_FOLDER } from "@/app/api/v1/inbox/folders/[id]/route"
import { GET as GET_CHAT_MESSAGES } from "@/app/api/chat/messages/route"
import { POST as POST_CHAT_SEND } from "@/app/api/chat/send/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { sendEmail } from "@/lib/email"
import { getSession as getChatSession, addVisitorMessage, setReplyMapping, createSession } from "@/lib/chat-store"
import { markMarketingContacted, setCustomerStage } from "@/lib/inbox/customer-stage"

const ORG_ID = "org-1"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(null as never)
  const resolveTestOperator = async (req: NextRequest) => {
    const session = await getSession(req)
    if (session) return session
    const orgId = await getOrgId(req)
    return orgId
      ? { orgId, userId: "support-1", role: "support", email: "support@example.test", name: "Support" }
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  vi.mocked(requireAuth).mockImplementation(resolveTestOperator as never)
  vi.mocked(requireSessionAuth).mockImplementation(resolveTestOperator as never)
})

// ---------------------------------------------------------------------------
// GET /api/v1/inbox
// ---------------------------------------------------------------------------
describe("GET /api/v1/inbox", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(401)
  })

  it("returns conversations grouped from messages", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      {
        id: "m1",
        organizationId: ORG_ID,
        direction: "inbound",
        channelType: "email",
        from: "client@test.com",
        to: "crm@test.com",
        body: "Hello there",
        status: "new",
        contactId: null,
        createdAt: new Date("2025-01-01"),
        metadata: {},
      },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.conversations.length).toBeGreaterThanOrEqual(1)
    expect(body.data.stats.totalMessages).toBe(1)
    expect(body.data.stats.inbound).toBe(1)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })

  // Option-D slice-1: threads backed by a SocialConversation row surface its
  // status / assignment / snooze, fetched org-scoped.
  it("surfaces SocialConversation status/assignee/snooze for a thread with a conversationId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      {
        id: "m1", organizationId: ORG_ID, direction: "inbound", channelType: "facebook",
        from: "fb-user", to: "page", body: "Hi", status: "new", contactId: null,
        conversationId: "sc-1", createdAt: new Date("2025-01-02"), metadata: {},
      },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])
    vi.mocked(prisma.socialConversation.findMany)
      .mockResolvedValueOnce([
        { id: "sc-1", status: "resolved", assignedTo: "user-9", snoozedUntil: new Date("2025-02-01"), folderId: "fold-1", tags: ["VIP", "needs-manager"] },
      ] as any)
      .mockResolvedValueOnce([] as any) // final soft-delete lookup: this row is live

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const conv = body.data.conversations.find((c: any) => c.socialConversationId === "sc-1")
    expect(conv).toBeTruthy()
    expect(conv.status).toBe("resolved")
    expect(conv.assignedTo).toBe("user-9")
    expect(conv.snoozedUntil).toBeTruthy()
    expect(conv.folderId).toBe("fold-1")
    expect(conv.conversationTags).toEqual(["VIP", "needs-manager"])
    expect(conv.lastDirection).toBe("inbound")
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, conversationId: { in: ["sc-1"] } },
      }),
    )
    // join must be org-scoped
    expect(prisma.socialConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_ID, id: { in: ["sc-1"] } }) }),
    )
  })

  it("embeds org-scoped call logs for a thread with a conversationId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      {
        id: "m1", organizationId: ORG_ID, direction: "inbound", channelType: "whatsapp",
        from: "+994111", to: "crm", body: "Call me", status: "new", contactId: null,
        conversationId: "sc-call", createdAt: new Date("2025-01-03T09:00:00Z"), metadata: {},
      },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])
    vi.mocked(prisma.socialConversation.findMany)
      .mockResolvedValueOnce([
        { id: "sc-call", status: "open", assignedTo: null, snoozedUntil: null, folderId: null, tags: [] },
      ] as any)
      .mockResolvedValueOnce([] as any) // final soft-delete lookup: this row is live
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      {
        id: "call-1",
        conversationId: "sc-call",
        direction: "outbound",
        fromNumber: "+100",
        toNumber: "+994111",
        status: "completed",
        duration: 42,
        provider: "twilio",
        recordingUrl: "https://recordings.example/call-1.mp3",
        transcription: "hello transcript",
        insightsAt: new Date("2025-01-03T09:06:00Z"),
        startedAt: new Date("2025-01-03T09:05:00Z"),
        endedAt: new Date("2025-01-03T09:05:42Z"),
        createdAt: new Date("2025-01-03T09:05:00Z"),
      },
    ] as any)

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const conv = body.data.conversations.find((c: any) => c.socialConversationId === "sc-call")
    expect(conv.callLogs).toEqual([
      expect.objectContaining({
        id: "call-1",
        direction: "outbound",
        toNumber: "+994111",
        status: "completed",
        duration: 42,
        provider: "twilio",
        hasRecording: true,
        recordingPlaybackUrl: "/api/v1/calls/call-1/recording",
        transcription: "hello transcript",
        insightsAt: expect.any(String),
      }),
    ])
    expect(conv.callLogs[0]).not.toHaveProperty("recordingUrl")
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, conversationId: { in: ["sc-call"] } },
      }),
    )
  })

  it("surfaces WhatsApp call-only conversations even when no channel messages exist yet", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([])
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])
    // The call-only row is appended after the ordinary message-backed
    // enrichment query, so this sole findMany is the final soft-delete lookup.
    vi.mocked(prisma.socialConversation.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.callLog.findMany)
      .mockResolvedValueOnce([
        {
          id: "call-wa-1",
          conversationId: "sc-wa-call",
          direction: "inbound",
          fromNumber: "994501234567",
          toNumber: "13175551399",
          status: "ringing",
          provider: "whatsapp",
          startedAt: new Date("2026-06-26T10:00:00Z"),
          endedAt: null,
          createdAt: new Date("2026-06-26T10:00:00Z"),
          conversation: {
            id: "sc-wa-call",
            platform: "whatsapp",
            externalId: "994501234567",
            contactId: null,
            contactName: "Aysel",
            status: "open",
            assignedTo: null,
            snoozedUntil: null,
            folderId: null,
            tags: ["vip"],
            lastMessage: "WhatsApp call incoming (ringing)",
            lastMessageAt: new Date("2026-06-26T10:00:00Z"),
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "call-wa-1",
          conversationId: "sc-wa-call",
          direction: "inbound",
          fromNumber: "994501234567",
          toNumber: "13175551399",
          status: "ringing",
          duration: null,
          provider: "whatsapp",
          recordingUrl: null,
          transcription: null,
          insightsAt: null,
          notes: "[WhatsApp Calling] 2026-06-26T10:00:00.000Z webhook call (event=connect)",
          startedAt: new Date("2026-06-26T10:00:00Z"),
          endedAt: null,
          createdAt: new Date("2026-06-26T10:00:00Z"),
        },
      ])

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      data: {
        conversations: Array<{
          socialConversationId?: string | null
          callLogs?: Array<{ id: string; provider: string; status: string }>
        }>
      }
    }
    const conv = body.data.conversations.find((c) => c.socialConversationId === "sc-wa-call")
    expect(conv).toMatchObject({
      socialConversationId: "sc-wa-call",
      contactName: "Aysel",
      contactPhone: "994501234567",
      lastChannel: "whatsapp",
      messageCount: 0,
      messages: [],
      conversationTags: ["vip"],
    })
    expect(conv?.callLogs).toHaveLength(1)
    expect(conv?.callLogs?.[0]).toMatchObject({
      id: "call-wa-1",
      provider: "whatsapp",
      status: "ringing",
      notes: expect.stringContaining("webhook call"),
    })
  })

  it("does NOT query SocialConversation when no thread carries a conversationId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      {
        id: "m1", organizationId: ORG_ID, direction: "inbound", channelType: "email",
        from: "a@b.com", to: "crm@test.com", body: "Hi", status: "new", contactId: null,
        conversationId: null, createdAt: new Date("2025-01-01"), metadata: {},
      },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([])

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(200)
    expect(prisma.socialConversation.findMany).not.toHaveBeenCalled()
  })

  // Regression guard (architect-flagged): a message carrying BOTH contactId and
  // conversationId must STILL group by contact (legacy cross-channel merge), not
  // split into a separate conv_ thread — while still surfacing the conv state.
  it("does NOT split a contact thread that has both contactId and conversationId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      { id: "m1", organizationId: ORG_ID, direction: "inbound", channelType: "telegram",
        from: "Jane", to: "bot", body: "tg", status: "new", contactId: "c1",
        conversationId: "sc-1", createdAt: new Date("2025-01-02"), metadata: { chatId: "123" } },
      { id: "m2", organizationId: ORG_ID, direction: "inbound", channelType: "email",
        from: "jane@test.com", to: "crm@test.com", body: "em", status: "new", contactId: "c1",
        conversationId: null, createdAt: new Date("2025-01-01"), metadata: {} },
    ] as any)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: "c1", fullName: "Jane", email: "jane@test.com", phone: null, phones: [], lifecycleStage: "customer" },
    ] as any)
    vi.mocked(prisma.socialConversation.findMany)
      .mockResolvedValueOnce([
        { id: "sc-1", status: "open", assignedTo: null, snoozedUntil: null, folderId: null, tags: ["retention"] },
      ] as any)
      .mockResolvedValueOnce([] as any) // final soft-delete lookup: this row is live

    const res = await GET_INBOX(makeRequest("http://localhost:3000/api/v1/inbox"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const c1 = body.data.conversations.filter((c: any) => c.contactId === "c1")
    expect(c1).toHaveLength(1) // ONE thread, not split by conversationId
    expect(c1[0].channels).toEqual(expect.arrayContaining(["telegram", "email"]))
    expect(c1[0].contactId).toBe("c1") // contact identity preserved (not nulled by a conv_ key)
    expect(c1[0].socialConversationId).toBe("sc-1") // conv state still surfaced
    expect(c1[0].status).toBe("open")
    expect(c1[0].contactLifecycleStage).toBe("customer")
    expect(c1[0].conversationTags).toEqual(["retention"])
    expect(c1[0].lastDirection).toBe("inbound")
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/inbox (send message)
// ---------------------------------------------------------------------------
describe("POST /api/v1/inbox", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await POST_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({ to: "a@b.com", body: "Hi", channel: "email" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when validation fails (missing body)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)

    const res = await POST_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({ to: "a@b.com" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("sends email and saves message to DB", async () => {
    vi.mocked(getSession).mockResolvedValue({
      orgId: ORG_ID,
      userId: "marketing-1",
      role: "support",
      email: "marketing@example.test",
      name: "Marketing",
    } as never)
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "conversation-1" } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.channelMessage.create).mockResolvedValue({
      id: "msg-new",
      direction: "outbound",
      channelType: "email",
      to: "client@test.com",
      body: "Hello",
      status: "delivered",
    } as any)

    const res = await POST_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({
          to: "client@test.com",
          body: "Hello",
          channel: "email",
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(sendEmail).toHaveBeenCalled()
    expect(markMarketingContacted).not.toHaveBeenCalled()
  })

  it("returns 400 for email channel with invalid address", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)

    const res = await POST_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "POST",
        body: JSON.stringify({ to: "not-an-email", body: "Hi", channel: "email" }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/inbox (mark as read)
// ---------------------------------------------------------------------------
describe("PATCH /api/v1/inbox", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await PATCH_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "PATCH",
        body: JSON.stringify({ messageIds: ["m1"] }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when messageIds is missing or empty", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)

    const res = await PATCH_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "PATCH",
        body: JSON.stringify({ messageIds: [] }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("marks messages as read", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.channelMessage.updateMany).mockResolvedValue({ count: 2 } as any)

    const res = await PATCH_INBOX(
      makeRequest("http://localhost:3000/api/v1/inbox", {
        method: "PATCH",
        body: JSON.stringify({ messageIds: ["m1", "m2"] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(prisma.channelMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "read" },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/inbox/conversations
// ---------------------------------------------------------------------------
describe("GET /api/v1/inbox/conversations", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET_CONVERSATIONS(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations"),
    )
    expect(res.status).toBe(401)
  })

  it("returns paginated social conversations", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.findMany).mockResolvedValue([
      { id: "conv1", platform: "whatsapp", status: "open", organizationId: ORG_ID },
    ] as any)
    vi.mocked(prisma.socialConversation.count).mockResolvedValue(1)

    const res = await GET_CONVERSATIONS(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.conversations).toHaveLength(1)
    expect(body.data.total).toBe(1)
  })

  it("filters conversations by normalized tag inside the org scope", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.socialConversation.count).mockResolvedValue(0)

    const res = await GET_CONVERSATIONS(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations?tag=%20VIP%20Lead%20"),
    )

    expect(res.status).toBe(200)
    expect(prisma.socialConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          tags: { has: "VIP Lead" },
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/inbox/conversations/:id
// ---------------------------------------------------------------------------
describe("GET /api/v1/inbox/conversations/:id", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET_CONVERSATION_BY_ID(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1"),
      makeParams("conv1"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when conversation not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue(null)

    const res = await GET_CONVERSATION_BY_ID(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/nonexistent"),
      makeParams("nonexistent"),
    )
    expect(res.status).toBe(404)
  })

  it("returns conversation with messages without mutating state through a read-scoped GET", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
      id: "conv1",
      platform: "telegram",
      organizationId: ORG_ID,
    } as any)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      { id: "m1", body: "Hello", direction: "inbound" },
    ] as any)

    const res = await GET_CONVERSATION_BY_ID(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1"),
      makeParams("conv1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.messages).toHaveLength(1)
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/v1/inbox/conversations/:id", () => {
  it("allows the Inbox to record only a marketing contact", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH",
        body: JSON.stringify({
          customerStage: "marketing_contacted",
          customerStageReason: "Marketing replied in chat",
        }),
      }),
      makeParams("conv1"),
    )

    expect(res.status).toBe(200)
    expect(setCustomerStage).toHaveBeenCalledWith(prisma, expect.objectContaining({
      organizationId: ORG_ID,
      conversationId: "conv1",
      stage: "marketing_contacted",
      source: "agent",
      reason: "Marketing replied in chat",
    }))
  })

  it("requires salesperson outcomes to be reported from the assigned lead", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
      contactId: null,
      metadata: {},
      messages: [{ from: "visitor", body: "Qiyməti deyin" }],
    } as any)

    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH",
        body: JSON.stringify({ customerStage: "potential" }),
      }),
      makeParams("conv1"),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "sales_stage_lead_only" })
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
    expect(setCustomerStage).not.toHaveBeenCalled()
  })

  it("rejects an invalid status with 400 (whitelist), no DB write", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ status: "banana" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(400)
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("accepts a valid status and writes it org-scoped", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ status: "resolved" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(200)
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv1", organizationId: ORG_ID },
        data: expect.objectContaining({ status: "resolved" }),
      }),
    )
  })

  it("rejects an invalid snoozedUntil with 400, no DB write", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ snoozedUntil: "not-a-date" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(400)
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("accepts snoozedUntil = null (unsnooze)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ snoozedUntil: null }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(200)
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ snoozedUntil: null }) }),
    )
  })

  it("rejects assignedTo for a user not in the org (cross-tenant guard), no write", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ assignedTo: "outsider" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(400)
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("accepts assignedTo for an in-org user", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "agent1" } as any)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ assignedTo: "agent1" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(200)
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedTo: "agent1" }) }),
    )
  })

  it("rejects folderId for a folder not in the org (cross-tenant guard), no write", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.inboxFolder.findFirst).mockResolvedValue(null)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ folderId: "outsider-folder" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(400)
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("files into an in-org folder", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.inboxFolder.findFirst).mockResolvedValue({ id: "f1" } as any)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ folderId: "f1" }),
      }),
      makeParams("conv1"),
    )
    expect(res.status).toBe(200)
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ folderId: "f1" }) }),
    )
  })

  it("rejects non-array tags with 400, no DB write", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)

    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ tags: "vip" }),
      }),
      makeParams("conv1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("normalizes and writes conversation tags org-scoped", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await PATCH_CONVERSATION(
      makeRequest("http://localhost:3000/api/v1/inbox/conversations/conv1", {
        method: "PATCH", body: JSON.stringify({ tags: [" vip ", "VIP", "vip", "needs   manager"] }),
      }),
      makeParams("conv1"),
    )

    expect(res.status).toBe(200)
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv1", organizationId: ORG_ID },
        data: expect.objectContaining({ tags: ["vip", "VIP", "needs manager"] }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Phase 3b — conversation notes
// ---------------------------------------------------------------------------
describe("notes /api/v1/inbox/conversations/:id/notes", () => {
  const sess = { orgId: ORG_ID, userId: "u1", name: "Agent A", email: "agent@example.test", role: "support" }

  it("GET returns notes org-scoped, newest first", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.conversationNote.findMany).mockResolvedValue([{ id: "n1", body: "hi" }] as any)
    const res = await GET_NOTES(makeRequest("http://localhost:3000/api/v1/inbox/conversations/sc1/notes"), makeParams("sc1"))
    expect(res.status).toBe(200)
    expect(prisma.conversationNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_ID, socialConversationId: "sc1" }, orderBy: { createdAt: "desc" } }),
    )
  })

  it("POST rejects an empty note with 400, no write", async () => {
    vi.mocked(getSession).mockResolvedValue(sess as any)
    const res = await POST_NOTES(makeRequest("http://localhost:3000/api/v1/inbox/conversations/sc1/notes", { method: "POST", body: JSON.stringify({ body: "   " }) }), makeParams("sc1"))
    expect(res.status).toBe(400)
    expect(prisma.conversationNote.create).not.toHaveBeenCalled()
  })

  it("POST 404s when the conversation is not in the org (cross-tenant guard)", async () => {
    vi.mocked(getSession).mockResolvedValue(sess as any)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue(null)
    const res = await POST_NOTES(makeRequest("http://localhost:3000/api/v1/inbox/conversations/sc1/notes", { method: "POST", body: JSON.stringify({ body: "note" }) }), makeParams("sc1"))
    expect(res.status).toBe(404)
    expect(prisma.conversationNote.create).not.toHaveBeenCalled()
  })

  it("POST creates a note for an in-org conversation", async () => {
    vi.mocked(getSession).mockResolvedValue(sess as any)
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "sc1" } as any)
    vi.mocked(prisma.conversationNote.create).mockResolvedValue({ id: "n1", body: "note" } as any)
    const res = await POST_NOTES(makeRequest("http://localhost:3000/api/v1/inbox/conversations/sc1/notes", { method: "POST", body: JSON.stringify({ body: "note" }) }), makeParams("sc1"))
    expect(res.status).toBe(201)
    expect(prisma.conversationNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_ID, socialConversationId: "sc1", authorId: "u1", body: "note" }) }),
    )
  })
})

// ---------------------------------------------------------------------------
// Phase 5 — team folders
// ---------------------------------------------------------------------------
describe("folders /api/v1/inbox/folders", () => {
  it("GET lists folders org-scoped", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.inboxFolder.findMany).mockResolvedValue([{ id: "f1", name: "Design" }] as any)
    const res = await GET_FOLDERS(makeRequest("http://localhost:3000/api/v1/inbox/folders"))
    expect(res.status).toBe(200)
    expect(prisma.inboxFolder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG_ID } }))
  })

  it("POST rejects an empty name with 400, no write", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    const res = await POST_FOLDERS(makeRequest("http://localhost:3000/api/v1/inbox/folders", { method: "POST", body: JSON.stringify({ name: "  " }) }))
    expect(res.status).toBe(400)
    expect(prisma.inboxFolder.create).not.toHaveBeenCalled()
  })

  it.each([
    "<script>alert(1)</script>",
    "{{7*7}}",
    "\"><h1>sa</h1>",
  ])("POST rejects a markup-like folder name (%s)", async (name) => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    const res = await POST_FOLDERS(makeRequest("http://localhost:3000/api/v1/inbox/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }))

    expect(res.status).toBe(400)
    expect(prisma.inboxFolder.create).not.toHaveBeenCalled()
  })

  it("POST creates a folder org-scoped", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.inboxFolder.create).mockResolvedValue({ id: "f1", name: "Design" } as any)
    const res = await POST_FOLDERS(makeRequest("http://localhost:3000/api/v1/inbox/folders", { method: "POST", body: JSON.stringify({ name: "Design" }) }))
    expect(res.status).toBe(201)
    expect(prisma.inboxFolder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_ID, name: "Design" }) }))
  })

  it("DELETE 404s when not in org; otherwise removes + orphans its conversations", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.inboxFolder.findFirst).mockResolvedValue(null)
    const res404 = await DELETE_FOLDER(makeRequest("http://localhost:3000/api/v1/inbox/folders/f9", { method: "DELETE" }), makeParams("f9"))
    expect(res404.status).toBe(404)

    vi.mocked(prisma.inboxFolder.findFirst).mockResolvedValue({ name: "Design" } as any)
    vi.mocked(prisma.inboxFolder.deleteMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 2 } as any)
    const res = await DELETE_FOLDER(makeRequest("http://localhost:3000/api/v1/inbox/folders/f1", { method: "DELETE" }), makeParams("f1"))
    expect(res.status).toBe(200)
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_ID, folderId: "f1" }, data: { folderId: null } }),
    )
  })

  it("protects the system Gözləmədə folder from deletion", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
    vi.mocked(prisma.inboxFolder.findFirst).mockResolvedValue({ name: "Gözləmədə" } as any)

    const res = await DELETE_FOLDER(makeRequest("http://localhost:3000/api/v1/inbox/folders/pending", { method: "DELETE" }), makeParams("pending"))

    expect(res.status).toBe(409)
    expect(prisma.inboxFolder.deleteMany).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /api/chat/messages (marketing chat widget)
// ---------------------------------------------------------------------------
describe("GET /api/chat/messages", () => {
  it("returns 400 when sessionId is missing", async () => {
    const res = await GET_CHAT_MESSAGES(
      makeRequest("http://localhost:3000/api/chat/messages") as any,
    )
    expect(res.status).toBe(400)
  })

  it("returns empty messages when session not found", async () => {
    vi.mocked(getChatSession).mockReturnValue(undefined)

    const res = await GET_CHAT_MESSAGES(
      makeRequest("http://localhost:3000/api/chat/messages?sessionId=abc123") as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toEqual([])
  })

  it("returns messages after the given timestamp", async () => {
    const now = Date.now()
    vi.mocked(getChatSession).mockReturnValue({
      id: "abc123",
      messages: [
        { id: "m1", from: "visitor", text: "Old", timestamp: now - 5000 },
        { id: "m2", from: "operator", text: "New", timestamp: now + 1000 },
      ],
      createdAt: now - 10000,
      lastActivity: now,
    })

    const res = await GET_CHAT_MESSAGES(
      makeRequest(`http://localhost:3000/api/chat/messages?sessionId=abc123&after=${now}`) as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].text).toBe("New")
  })
})

// ---------------------------------------------------------------------------
// POST /api/chat/send (marketing chat widget)
// ---------------------------------------------------------------------------
describe("POST /api/chat/send", () => {
  it("returns 400 when sessionId or text is missing", async () => {
    const res = await POST_CHAT_SEND(
      makeRequest("http://localhost:3000/api/chat/send", {
        method: "POST",
        body: JSON.stringify({ sessionId: "" }),
      }) as any,
    )
    expect(res.status).toBe(400)
  })

  it("sends message to Telegram and stores in chat-store", async () => {
    const mockMsg = { id: "v_123", from: "visitor" as const, text: "Hello", timestamp: Date.now() }
    vi.mocked(addVisitorMessage).mockReturnValue(mockMsg)
    vi.mocked(getChatSession).mockReturnValue(undefined)
    vi.mocked(createSession).mockReturnValue({ id: "sess1", messages: [], createdAt: Date.now(), lastActivity: Date.now() } as any)

    // Mock global fetch for Telegram API
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
    })

    const res = await POST_CHAT_SEND(
      makeRequest("http://localhost:3000/api/chat/send", {
        method: "POST",
        body: JSON.stringify({ sessionId: "sess1", text: "Hello", visitorName: "John" }),
      }) as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(addVisitorMessage).toHaveBeenCalledWith("sess1", "Hello")
    expect(setReplyMapping).toHaveBeenCalledWith(42, "sess1")

    globalThis.fetch = originalFetch
  })
})
