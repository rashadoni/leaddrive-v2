import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

/**
 * Web-chat in the omni-channel inbox (Slice 2 reply path). An agent reply to a web-chat thread writes
 * a WebChatMessage(agent) into the session (single-source — the visitor's widget polls WebChatMessage),
 * NOT a ChannelMessage. The prisma mock deliberately omits channelMessage so any fall-through throws.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    webChatSession: { findFirst: vi.fn(), update: vi.fn() },
    webChatMessage: { create: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn().mockResolvedValue({ orgId: "org1", userId: "user1" }),
  getOrgId: vi.fn().mockResolvedValue("org1"),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), sendWhatsAppMedia: vi.fn() }))
vi.mock("@/lib/inbox-attachment", () => ({ readInboxAttachment: vi.fn(), isImageMime: vi.fn() }))
vi.mock("@/lib/telegram-media", () => ({ sendTelegramMedia: vi.fn() }))
vi.mock("@/lib/inbox-ensure-conversation", () => ({
  ensureConversation: vi.fn().mockResolvedValue({ id: "sc-web-1", assignedTo: null, wasCreated: false }),
}))
vi.mock("@/lib/inbox/customer-stage", () => ({
  markMarketingContacted: vi.fn().mockResolvedValue(true),
}))

import { POST } from "@/app/api/v1/inbox/route"
import { prisma } from "@/lib/prisma"
import { requireSessionAuth } from "@/lib/api-auth"

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSessionAuth).mockResolvedValue({
    orgId: "org1", userId: "user1", role: "support",
    email: "support@example.test", name: "Support",
  } as never)
})

describe("POST /api/v1/inbox — web-chat reply", () => {
  it("writes a WebChatMessage(agent) into the session + bumps lastMessageAt", async () => {
    vi.mocked(prisma.webChatSession.findFirst).mockResolvedValue({ id: "sess1", assignedUserId: null } as never)
    vi.mocked(prisma.webChatMessage.create).mockResolvedValue({ id: "msg1" } as never)
    const json = await (await POST(req({ to: "sess1", body: "hi visitor", channel: "web-chat" }))).json()
    expect(json.success).toBe(true)
    const arg = vi.mocked(prisma.webChatMessage.create).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data.sessionId).toBe("sess1")
    expect(arg.data.fromRole).toBe("agent")
    expect(arg.data.authorUserId).toBe("user1")
    expect(arg.data.text).toBe("hi visitor")
    expect(prisma.webChatSession.update).toHaveBeenCalled()
  })

  it("404 when the session isn't in the caller's org", async () => {
    vi.mocked(prisma.webChatSession.findFirst).mockResolvedValue(null as never)
    expect((await POST(req({ to: "nope", body: "x", channel: "web-chat" }))).status).toBe(404)
  })

  it("400 on empty body for web-chat", async () => {
    expect((await POST(req({ to: "sess1", body: "   ", channel: "web-chat" }))).status).toBe(400)
  })

  it("never touches ChannelMessage for web-chat (single-source — would throw if it did)", async () => {
    vi.mocked(prisma.webChatSession.findFirst).mockResolvedValue({ id: "sess1", assignedUserId: null } as never)
    vi.mocked(prisma.webChatMessage.create).mockResolvedValue({ id: "msg1" } as never)
    await POST(req({ to: "sess1", body: "hi", channel: "web-chat" }))
    expect(prisma.webChatMessage.create).toHaveBeenCalledTimes(1)
  })
})
