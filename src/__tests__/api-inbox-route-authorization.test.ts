import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type TestRole = "admin" | "support" | "ticketing" | "viewer"

const state = vi.hoisted(() => ({
  role: "support" as TestRole,
  hasBrowserSession: true,
  sanitizeOwnedRefs: vi.fn(),
  findConversation: vi.fn(),
  sendConversationReply: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: Function) => handler,
  withRlsSessionAuth: (handler: Function) => (req: NextRequest, ctx?: unknown) => {
    if (!state.hasBrowserSession) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }
    return handler(req, {
      orgId: "org-1",
      userId: "operator-1",
      role: state.role,
      email: "operator@example.test",
      name: "Inbox Operator",
    }, ctx)
  },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findFirst: state.findConversation },
  },
}))
vi.mock("@/lib/verify-owned-refs", () => ({
  sanitizeOwnedRefs: (...args: unknown[]) => state.sanitizeOwnedRefs(...args),
}))
vi.mock("@/lib/inbox/send-conversation-reply", () => ({
  sendConversationReply: (...args: unknown[]) => state.sendConversationReply(...args),
}))
vi.mock("@/lib/inbox-attachment", () => ({ readInboxAttachment: vi.fn() }))
vi.mock("@/lib/inbox-ensure-conversation", () => ({ ensureConversation: vi.fn() }))
vi.mock("@/lib/inbox/customer-stage", () => ({
  markMarketingContacted: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/calls/access", () => ({ exposeCallForClient: vi.fn() }))

import { POST } from "@/app/api/v1/inbox/route"

const KEY = "11111111-1111-4111-8111-111111111111"

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/v1/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      channel: "tiktok",
      to: "cw-client-supplied",
      body: "hello",
      conversationId: "conv-1",
      deliveryIdempotencyKey: KEY,
      ...overrides,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "support"
  state.hasBrowserSession = true
  state.sanitizeOwnedRefs.mockResolvedValue({ conversationId: "conv-1" })
  state.findConversation.mockResolvedValue({ externalId: "cw-server-bound", channelConfigId: "cfg-1" })
  state.sendConversationReply.mockResolvedValue({
    success: true,
    statusCode: 201,
    data: { id: "attempt-1", status: "delivered" },
  })
})

describe("POST /api/v1/inbox operator authorization", () => {
  it.each(["viewer", "ticketing"] as const)("denies a %s session before parsing ownership or sending", async (role) => {
    state.role = role

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(state.sanitizeOwnedRefs).not.toHaveBeenCalled()
    expect(state.sendConversationReply).not.toHaveBeenCalled()
  })

  it("rejects an API/non-browser principal before treating it as an operator", async () => {
    state.hasBrowserSession = false

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(state.sanitizeOwnedRefs).not.toHaveBeenCalled()
    expect(state.sendConversationReply).not.toHaveBeenCalled()
  })

  it.each(["support", "admin"] as const)("allows a %s operator with inbox/write", async (role) => {
    state.role = role

    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(state.sendConversationReply).toHaveBeenCalledTimes(1)
  })

  it("derives Chatwoot recipient/config from the exact tenant conversation instead of trusting client to", async () => {
    const response = await POST(request({ to: "cw-from-another-conversation" }))

    expect(response.status).toBe(201)
    expect(state.findConversation).toHaveBeenCalledWith({
      where: {
        id: "conv-1",
        organizationId: "org-1",
        platform: "tiktok",
        deletedAt: null,
      },
      select: { externalId: true, channelConfigId: true },
    })
    expect(state.sendConversationReply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      conversationId: "conv-1",
      to: "cw-server-bound",
      channelConfigId: "cfg-1",
      deliveryIdempotency: { source: "manual", key: KEY },
    }))
  })

  it("fails closed when the selected local id is not a live tenant TikTok conversation", async () => {
    state.findConversation.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(state.sendConversationReply).not.toHaveBeenCalled()
  })
})
