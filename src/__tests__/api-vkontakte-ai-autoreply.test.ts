import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Y2 — VKontakte webhook AI auto-reply gate. Same contract as telegram: fire maybeAiAutoReply
 * only when the channel is "ai" and the rules bot didn't own; outbound via sendChannelReply.
 */
const { aiSpy, sendSpy, state } = vi.hoisted(() => ({
  aiSpy: vi.fn(async (..._a: unknown[]) => ({ replied: true, escalated: false })),
  sendSpy: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  state: { config: null as any, ruleOwned: false },
}))
const emitEventsSpy = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findFirst: vi.fn(async () => state.config) },
    channelMessage: { create: vi.fn(async ({ data }: any) => ({ id: "msg_1", ...data })) },
  },
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn(async () => ({ id: "conv_vk", assignedTo: null })) }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: emitEventsSpy }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(() => ({ catch: () => {} })) }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_o: string, fn: () => any) => fn(),
  runWithRlsBypass: (fn: () => any) => fn(),
}))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ matched: state.ruleOwned })),
  chatbotTookOwnership: () => state.ruleOwned,
  sendChannelReply: sendSpy,
}))
vi.mock("@/lib/social/ai-autoreply", () => ({ maybeAiAutoReply: aiSpy }))

// F-26: the route verifies the VK Callback API secret before touching anything,
// because `group_id` is public and authenticates nobody. The fixture carries a
// matching secret on both sides so these tests exercise auto-reply rather than
// rejection — the rejection paths are covered in api-webhooks-mgmt.test.ts.
const VK_SECRET = "vk-callback-secret"

function vkReq(replyMode?: string, text = "Salam") {
  state.config = {
    id: "cfg_vk",
    organizationId: "org_1",
    pageId: "123",
    settings: { ...(replyMode ? { replyMode } : {}), secret: VK_SECRET },
  }
  return new NextRequest("http://localhost/api/v1/webhooks/vkontakte", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      group_id: 123,
      type: "message_new",
      secret: VK_SECRET,
      object: { message: { from_id: 555, text, id: 7 } },
    }),
  })
}

beforeEach(() => {
  aiSpy.mockClear()
  sendSpy.mockClear()
  emitEventsSpy.mockClear()
  state.ruleOwned = false
})

describe("vkontakte webhook — Y2 AI auto-reply gate", () => {
  it("replyMode 'ai' → maybeAiAutoReply fires with vkontakte context", async () => {
    const { POST } = await import("../app/api/v1/webhooks/vkontakte/route")
    await POST(vkReq("ai"))
    expect(aiSpy).toHaveBeenCalledOnce()
    expect(aiSpy).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_1", platform: "vkontakte", conversationId: "conv_vk", externalId: "555", userMessage: "Salam", send: expect.any(Function) }),
    )
    expect(emitEventsSpy).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "conv_vk", wasCreated: undefined })
  })

  it("default replyMode (agent) → maybeAiAutoReply NOT called", async () => {
    const { POST } = await import("../app/api/v1/webhooks/vkontakte/route")
    await POST(vkReq())
    expect(aiSpy).not.toHaveBeenCalled()
  })
})
