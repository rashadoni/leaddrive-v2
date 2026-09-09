import { afterEach, describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  findWidget: vi.fn(),
  findMessages: vi.fn(),
  updateSession: vi.fn(),
  createMessage: vi.fn(),
  countMessages: vi.fn(),
  findUsers: vi.fn(),
  createInteractionLog: vi.fn(),
  convFindFirst: vi.fn(),
  convUpdateMany: vi.fn(),
  getAnthropicClient: vi.fn(),
  ensureConversation: vi.fn(),
  notifyRecipients: vi.fn(),
  emitEvents: vi.fn(),
  sendPush: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webChatSession: {
      findUnique: mocks.findSession,
      update: mocks.updateSession,
    },
    webChatWidget: {
      findUnique: mocks.findWidget,
    },
    webChatMessage: {
      create: mocks.createMessage,
      count: mocks.countMessages,
      findMany: mocks.findMessages,
    },
    user: {
      findMany: mocks.findUsers,
    },
    // A1 — the route now meters web-chat AI generation (+ the response-scorer judge) here.
    aiInteractionLog: {
      create: mocks.createInteractionLog,
    },
    // A2 — draft path stores metadata.aiDraft on the ensured SocialConversation.
    socialConversation: {
      findFirst: mocks.convFindFirst,
      updateMany: mocks.convUpdateMany,
    },
    // A6 — granular limits read org settings (defaults) before generation.
    organization: {
      findUnique: vi.fn(async () => ({ settings: {} })),
    },
  },
}))

// A2 — the route imports the draft store (→ notifications → next-auth chain); keep hermetic.
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_organizationId: string, fn: () => unknown) => fn()),
  runWithRlsBypass: vi.fn(async (fn: () => unknown) => fn()),
}))

vi.mock("@/lib/widget-cors", () => ({
  buildWidgetCorsHeaders: vi.fn(async () => ({})),
  isOriginAllowed: vi.fn(() => true),
}))

vi.mock("@/lib/web-chat-escalate", () => ({
  escalateWebChatToTicket: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
}))

vi.mock("@/lib/push-send", () => ({
  sendPushToUser: mocks.sendPush,
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
}))

vi.mock("@/lib/inbox-ensure-conversation", () => ({
  ensureConversation: mocks.ensureConversation,
}))

vi.mock("@/lib/social/notify-recipients", () => ({
  notifyConversationRecipients: mocks.notifyRecipients,
}))

vi.mock("@/lib/inbox/conversation-events", () => ({
  emitConversationIngestEvents: mocks.emitEvents,
}))

import { POST } from "@/app/api/v1/public/web-chat/message/route"

const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

function request(text = "Hello from visitor") {
  return new NextRequest("http://localhost/api/v1/public/web-chat/message", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://site.example" },
    body: JSON.stringify({ sessionId: "sess_1", text, lang: "en" }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY
  }
  mocks.findSession.mockResolvedValue({
    id: "sess_1",
    organizationId: "org_1",
    status: "open",
    assignedUserId: "u_agent",
    visitorName: "Visitor",
    visitorEmail: "visitor@example.com",
    ticketId: null,
    aiPaused: false,
  })
  mocks.findWidget.mockResolvedValue({
    organizationId: "org_1",
    enabled: true,
    allowedOrigins: ["https://site.example"],
    escalateToTicket: false,
    aiEnabled: false,
  })
  mocks.createMessage.mockImplementation(async ({ data }) => ({
    id: data.fromRole === "bot" ? "wm_bot" : "wm_1",
    fromRole: data.fromRole,
    text: data.text,
    createdAt: new Date("2026-06-23T00:00:00.000Z"),
  }))
  mocks.findMessages.mockResolvedValue([])
  mocks.getAnthropicClient.mockReturnValue({
    messages: {
      create: vi.fn(),
    },
  })
  mocks.updateSession.mockResolvedValue({})
  mocks.countMessages.mockResolvedValue(1)
  mocks.findUsers.mockResolvedValue([])
  mocks.ensureConversation.mockResolvedValue({ id: "sc_1", assignedTo: "u_agent", wasCreated: true })
  mocks.notifyRecipients.mockResolvedValue({})
  mocks.emitEvents.mockResolvedValue({})
  mocks.sendPush.mockResolvedValue({})
  mocks.createInteractionLog.mockResolvedValue({})
  mocks.convFindFirst.mockResolvedValue({ metadata: {}, assignedTo: null, platform: "web-chat" })
  mocks.convUpdateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY
  }
})

describe("POST /api/v1/public/web-chat/message conversation events", () => {
  it("emits inbox conversation events after visitor message ensure+notify", async () => {
    const res = await POST(request())

    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(mocks.createMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        sessionId: "sess_1",
        fromRole: "visitor",
        text: "Hello from visitor",
      }),
    })
    expect(mocks.ensureConversation).toHaveBeenCalledWith("org_1", expect.objectContaining({
      channel: "web-chat",
      webChatSessionId: "sess_1",
      contactName: "Visitor",
    }))
    expect(mocks.notifyRecipients).toHaveBeenCalledWith("org_1", "sc_1", "u_agent", expect.objectContaining({
      kind: "inbox.message",
      entityType: "inbox_message",
    }))
    expect(mocks.emitEvents).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "sc_1",
      wasCreated: true,
    })
  })

  it("keeps the visitor response successful if conversation event emission fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.emitEvents.mockRejectedValueOnce(new Error("flow boom"))

    const res = await POST(request())
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))

    expect(mocks.notifyRecipients).toHaveBeenCalledOnce()
    expect(mocks.emitEvents).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it("masks visitor PII before sending public web-chat history to AI", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Your email is [EMAIL_1]." }],
    })
    mocks.getAnthropicClient.mockReturnValue({ messages: { create } })
    mocks.findWidget.mockResolvedValueOnce({
      organizationId: "org_1",
      enabled: true,
      allowedOrigins: ["https://site.example"],
      escalateToTicket: false,
      aiEnabled: true,
    })
    mocks.findMessages.mockResolvedValueOnce([
      {
        fromRole: "visitor",
        text: "My email is alice@example.com and phone is +994501234567.",
      },
    ])

    const res = await POST(request("My email is alice@example.com and phone is +994501234567."))
    const json = await res.json()
    const aiPayload = create.mock.calls[0][0]
    const serializedMessages = JSON.stringify(aiPayload.messages)

    expect(res.status).toBe(200)
    expect(serializedMessages).not.toContain("alice@example.com")
    expect(serializedMessages).not.toContain("+994501234567")
    expect(serializedMessages).toContain("[EMAIL_1]")
    expect(json.data.botReply.text).toBe("Your email is alice@example.com.")
    expect(mocks.createMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromRole: "bot",
        text: "Your email is alice@example.com.",
      }),
    })
  })

  it("A2: aiDraftMode widget parks the reply as a conversation draft — visitor gets no bot message", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Draft-worthy answer." }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    mocks.getAnthropicClient.mockReturnValue({ messages: { create } })
    mocks.findWidget.mockResolvedValueOnce({
      organizationId: "org_1",
      enabled: true,
      allowedOrigins: ["https://site.example"],
      escalateToTicket: false,
      aiEnabled: true,
      aiDraftMode: true,
    })

    const res = await POST(request("How long do returns take?"))
    const json = await res.json()
    await new Promise((r) => setTimeout(r, 50))

    expect(res.status).toBe(200)
    expect(json.data.botReply).toBeNull()
    // no bot WebChatMessage row — only the visitor's own message was written
    const botWrites = mocks.createMessage.mock.calls.filter(
      (call) => (call[0] as { data: { fromRole: string } }).data.fromRole === "bot",
    )
    expect(botWrites).toHaveLength(0)
    // the draft landed on the ensured SocialConversation
    const draftWrite = mocks.convUpdateMany.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>
      data: { metadata: { aiDraft: Record<string, unknown> } }
    }
    expect(draftWrite.where).toMatchObject({ id: "sc_1", organizationId: "org_1" })
    expect(draftWrite.data.metadata.aiDraft).toMatchObject({
      text: "Draft-worthy answer.",
      reason: "draft_mode",
      channel: "web-chat",
      to: "sess_1",
    })
  })

  it("SAFETY: blocks a callback-time promise and forces an operator draft", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const unsafe = "Our manager will call you today at 3 PM."
    const create = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "text", text: unsafe }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{
          type: "text",
          text: '{"grounded":0.9,"complete":0.9,"accurate":0.9,"is_clarifying_question":false}',
        }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    mocks.getAnthropicClient.mockReturnValue({ messages: { create } })
    mocks.findWidget.mockResolvedValueOnce({
      organizationId: "org_1",
      enabled: true,
      allowedOrigins: ["https://site.example"],
      escalateToTicket: false,
      aiEnabled: true,
      aiDraftMode: false,
      aiThreshold: null,
    })

    const res = await POST(request("When will someone call me?"))
    const json = await res.json()
    await new Promise((r) => setTimeout(r, 50))

    const safe = "The contact time has not been confirmed. A manager needs to confirm the details."
    expect(res.status).toBe(200)
    expect(json.data.botReply).toBeNull()
    expect(create.mock.calls[0][0].system).toContain("CONFIRMED_CALLBACK_SLOT")

    const botWrites = mocks.createMessage.mock.calls.filter(
      (call) => (call[0] as { data: { fromRole: string } }).data.fromRole === "bot",
    )
    expect(botWrites).toHaveLength(0)

    const draftWrite = mocks.convUpdateMany.mock.calls.at(-1)?.[0] as {
      data: { metadata: { aiDraft: Record<string, unknown> } }
    }
    expect(draftWrite.data.metadata.aiDraft).toMatchObject({
      text: safe,
      reason: "commitment_guard",
      channel: "web-chat",
      to: "sess_1",
    })
    expect(draftWrite.data.metadata.aiDraft.text).not.toBe(unsafe)
    expect(draftWrite.data.metadata.aiDraft.text).not.toContain("3 PM")
  })
})
