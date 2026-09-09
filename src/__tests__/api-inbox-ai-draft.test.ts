import { createHash } from "node:crypto"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * A2 — operator review of a pending AI draft (send / discard). Contracts:
 * org-scoped, 404 without a pending draft, send goes through sendConversationReply
 * with approval metadata, an operator EDIT drops the aiAutoReply/aiQuality claim,
 * a failed send KEEPS the draft, and both terminal actions clear metadata.aiDraft.
 */

type TestRole = "admin" | "support" | "ticketing" | "viewer"
type RouteHandler = (req: NextRequest, auth: {
  orgId: string
  userId: string
  role: TestRole
  email: string
  name: string
}, ctx?: unknown) => Promise<Response>

let role: TestRole = "support"
let hasBrowserSession = true

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: RouteHandler) => (req: NextRequest, ctx?: unknown) => {
    if (!hasBrowserSession) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }
    return handler(req, {
      orgId: "o1",
      userId: "u1",
      role,
      email: "support@example.test",
      name: "Support Operator",
    }, ctx)
  },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findFirst: vi.fn(), updateMany: vi.fn() },
    channelMessage: { findFirst: vi.fn() },
    aiChatMessage: { create: vi.fn() },
    webChatSession: { findFirst: vi.fn(), update: vi.fn() },
    webChatMessage: { findFirst: vi.fn(), create: vi.fn() },
  },
}))
const sendConversationReply = vi.fn()
vi.mock("@/lib/inbox/send-conversation-reply", () => ({
  sendConversationReply: (...args: unknown[]) => sendConversationReply(...args),
}))
const claimConversationAiReply = vi.fn()
const releaseConversationAiReplyClaim = vi.fn()
vi.mock("@/lib/social/ai-autoreply", () => ({
  claimConversationAiReply: (...args: unknown[]) => claimConversationAiReply(...args),
  releaseConversationAiReplyClaim: (...args: unknown[]) => releaseConversationAiReplyClaim(...args),
}))
// ai-draft imports notifications (→ next-auth chain) — mock to keep the suite hermetic.
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))

import { POST } from "@/app/api/v1/inbox/conversations/[id]/ai-draft/route"
import { prisma } from "@/lib/prisma"

const DRAFT = {
  text: "Qaytarma 14 gün çəkir.",
  reason: "below_threshold",
  quality: { grounded: 0.5, complete: 0.5, accurate: 0.5, total: 0.5, isClarifyingQuestion: false, scorerModel: "m", scoredAt: "t" },
  channel: "telegram",
  to: "chat42",
  sessionId: "s1",
  createdAt: "2026-07-16T00:00:00.000Z",
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/inbox/conversations/cv1/ai-draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: "cv1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  role = "support"
  hasBrowserSession = true
  vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
    id: "cv1", externalId: "chat42", metadata: { aiDraft: DRAFT }, channelConfigId: "cfg1", contactId: "ct1",
  } as never)
  vi.mocked(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.aiChatMessage.create).mockResolvedValue({} as never)
  vi.mocked(prisma.webChatSession.findFirst).mockResolvedValue({ id: "ws1", assignedUserId: null } as never)
  vi.mocked(prisma.webChatSession.update).mockResolvedValue({} as never)
  vi.mocked(prisma.webChatMessage.create).mockResolvedValue({ id: "wm1" } as never)
  vi.mocked(prisma.webChatMessage.findFirst).mockResolvedValue(null as never)
  claimConversationAiReply.mockResolvedValue({ claimed: true, token: "draft-claim", claimedUntil: new Date() })
  releaseConversationAiReplyClaim.mockResolvedValue(undefined)
  sendConversationReply.mockResolvedValue({ success: true, statusCode: 201, data: { id: "m1", status: "delivered" } })
})

describe("POST /inbox/conversations/[id]/ai-draft", () => {
  it.each(["viewer", "ticketing"] as const)("denies %s before reading or mutating a draft", async (deniedRole) => {
    role = deniedRole

    const res = await POST(request({ action: "send" }), ctx as never)

    expect(res.status).toBe(403)
    expect(prisma.socialConversation.findFirst).not.toHaveBeenCalled()
    expect(sendConversationReply).not.toHaveBeenCalled()
  })

  it("requires a browser session instead of treating an API principal as an operator", async () => {
    hasBrowserSession = false

    const res = await POST(request({ action: "discard" }), ctx as never)

    expect(res.status).toBe(401)
    expect(prisma.socialConversation.findFirst).not.toHaveBeenCalled()
  })

  it("does not let a future/unknown generate action bypass the route-wide write gate", async () => {
    role = "viewer"

    const res = await POST(request({ action: "generate" }), ctx as never)

    expect(res.status).toBe(403)
    expect(prisma.socialConversation.findFirst).not.toHaveBeenCalled()
  })

  it.each(["support", "admin"] as const)("allows a %s operator to discard a pending draft", async (allowedRole) => {
    role = allowedRole

    const res = await POST(request({ action: "discard" }), ctx as never)

    expect(res.status).toBe(200)
  })

  it("send: delivers the draft with approval metadata and clears it", async () => {
    const res = await POST(request({ action: "send" }), ctx as never)
    expect(res.status).toBe(200)
    const arg = sendConversationReply.mock.calls[0][0] as Record<string, unknown>
    expect(arg).toMatchObject({ organizationId: "o1", channel: "telegram", to: "chat42", body: DRAFT.text, conversationId: "cv1" })
    expect(arg.deliveryIdempotency).toEqual({
      source: "ai-draft",
      key: createHash("sha256").update(`ai-draft:o1:cv1:${DRAFT.createdAt}`).digest("hex"),
    })
    expect(arg.extraMetadata).toMatchObject({
      autoReply: true, aiAutoReply: true, aiDraftApproved: true, aiDraftReason: "below_threshold", approvedBy: "u1",
    })
    expect((arg.extraMetadata as Record<string, unknown>).aiQuality).toMatchObject({ total: 0.5 })
    // assistant turn persisted only after the confirmed send
    expect(prisma.aiChatMessage.create).toHaveBeenCalledWith({ data: { sessionId: "s1", role: "assistant", content: DRAFT.text } })
    // draft cleared (last updateMany writes metadata WITHOUT aiDraft)
    const clear = vi.mocked(prisma.socialConversation.updateMany).mock.calls.at(-1)?.[0] as { data: { metadata: Record<string, unknown> } }
    expect("aiDraft" in clear.data.metadata).toBe(false)
  })

  it("send with an operator EDIT drops the AI-authorship claim (no aiAutoReply/aiQuality)", async () => {
    const res = await POST(request({ action: "send", text: "Исправленный ответ." }), ctx as never)
    expect(res.status).toBe(200)
    const arg = sendConversationReply.mock.calls[0][0] as { body: string; extraMetadata: Record<string, unknown> }
    expect(arg.body).toBe("Исправленный ответ.")
    expect(arg.extraMetadata.aiAutoReply).toBe(false)
    expect(arg.extraMetadata.aiQuality).toBeUndefined()
    expect(prisma.aiChatMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ content: "Исправленный ответ." }) })
  })

  it("failed send KEEPS the draft for retry", async () => {
    sendConversationReply.mockResolvedValue({ success: false, statusCode: 500, error: "channel down" })
    const res = await POST(request({ action: "send" }), ctx as never)
    expect(res.status).toBe(500)
    // no clear call — the only updateMany calls would be the clear; there must be none
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("unknown delivery clears the draft and tells the operator not to retry", async () => {
    sendConversationReply.mockResolvedValue({
      success: false,
      statusCode: 409,
      error: "verify in Chatwoot before retrying",
      deliveryUnknown: true,
    })

    const res = await POST(request({ action: "send" }), ctx as never)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ deliveryUnknown: true })
    const clear = vi.mocked(prisma.socialConversation.updateMany).mock.calls.at(-1)?.[0] as { data: { metadata: Record<string, unknown> } }
    expect("aiDraft" in clear.data.metadata).toBe(false)
    expect(prisma.aiChatMessage.create).not.toHaveBeenCalled()
  })

  it("allows only one concurrent sender to claim a draft", async () => {
    claimConversationAiReply
      .mockResolvedValueOnce({ claimed: true, token: "winner", claimedUntil: new Date() })
      .mockResolvedValueOnce({ claimed: false })

    const [first, second] = await Promise.all([
      POST(request({ action: "send" }), ctx as never),
      POST(request({ action: "send" }), ctx as never),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect(sendConversationReply).toHaveBeenCalledTimes(1)
  })

  it("refuses a second attempt when the draft already has an outbound ledger row", async () => {
    vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue({ id: "already-attempted" } as never)

    const res = await POST(request({ action: "send" }), ctx as never)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ deliveryUnknown: true })
    expect(sendConversationReply).not.toHaveBeenCalled()
    expect(claimConversationAiReply).toHaveBeenCalledTimes(1)
    expect(releaseConversationAiReplyClaim).toHaveBeenCalledTimes(1)
  })

  it("does not send a draft that changed before the operation lease was acquired", async () => {
    vi.mocked(prisma.socialConversation.findFirst)
      .mockResolvedValueOnce({
        id: "cv1", externalId: "chat42", metadata: { aiDraft: DRAFT }, channelConfigId: "cfg1", contactId: "ct1",
      } as never)
      .mockResolvedValueOnce({
        metadata: { aiDraft: { ...DRAFT, createdAt: "2026-07-16T00:00:01.000Z" } },
      } as never)

    const res = await POST(request({ action: "send" }), ctx as never)

    expect(res.status).toBe(409)
    expect(sendConversationReply).not.toHaveBeenCalled()
    expect(releaseConversationAiReplyClaim).toHaveBeenCalledTimes(1)
  })

  it("discard clears without sending", async () => {
    const res = await POST(request({ action: "discard" }), ctx as never)
    expect(res.status).toBe(200)
    expect(sendConversationReply).not.toHaveBeenCalled()
    const clear = vi.mocked(prisma.socialConversation.updateMany).mock.calls.at(-1)?.[0] as { data: { metadata: Record<string, unknown> } }
    expect("aiDraft" in clear.data.metadata).toBe(false)
  })

  it("does not discard while another request owns the draft lease", async () => {
    claimConversationAiReply.mockResolvedValue({ claimed: false })

    const res = await POST(request({ action: "discard" }), ctx as never)

    expect(res.status).toBe(409)
    expect(sendConversationReply).not.toHaveBeenCalled()
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("web-chat draft delivers as a widget message (bot when unedited) and clears", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
      id: "cv1", externalId: "w:ws1", metadata: { aiDraft: { ...DRAFT, channel: "web-chat", to: "ws1" } },
      channelConfigId: null, contactId: null,
    } as never)
    const res = await POST(request({ action: "send" }), ctx as never)
    expect(res.status).toBe(200)
    expect(sendConversationReply).not.toHaveBeenCalled()
    const msg = (vi.mocked(prisma.webChatMessage.create).mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(msg).toMatchObject({ sessionId: "ws1", fromRole: "bot", text: DRAFT.text })
    expect(msg.metadata).toMatchObject({ aiDraftApproved: true, aiGenerated: true })
    const clear = vi.mocked(prisma.socialConversation.updateMany).mock.calls.at(-1)?.[0] as { data: { metadata: Record<string, unknown> } }
    expect("aiDraft" in clear.data.metadata).toBe(false)
  })

  it("404 when there is no pending draft", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
      id: "cv1", externalId: "chat42", metadata: {}, channelConfigId: "cfg1", contactId: "ct1",
    } as never)
    const res = await POST(request({ action: "send" }), ctx as never)
    expect(res.status).toBe(404)
  })

  it("404 when the conversation belongs to another org (scope enforced by the where clause)", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue(null as never)
    const res = await POST(request({ action: "send" }), ctx as never)
    expect(res.status).toBe(404)
    expect(vi.mocked(prisma.socialConversation.findFirst).mock.calls[0][0]).toMatchObject({
      where: { id: "cv1", organizationId: "o1" },
    })
  })
})
