import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Y2 — telegram webhook AI auto-reply gate. Fires maybeAiAutoReply ONLY when the channel is
 * set to "ai" (matrix replyMode) AND the rules bot didn't already own the message; outbound
 * goes via the shared sendChannelReply dispatcher. Mirrors fb/ig/chatwoot.
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
    channelMessage: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "msg_1", ...data })),
      update: vi.fn(async () => ({})),
    },
    contact: { updateMany: vi.fn(async () => ({})) },
  },
}))
vi.mock("@/lib/sanitize", () => ({ sanitizeLog: (s: string) => s }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => {}) }))
vi.mock("@/lib/telegram-media", () => ({ fetchAndStoreTelegramMedia: vi.fn(async () => null) }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn(async () => undefined) }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_o: string, fn: () => any) => fn(),
  runWithRlsBypass: (fn: () => any) => fn(),
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn(async () => ({ id: "conv_tg", assignedTo: null })) }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: emitEventsSpy }))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ matched: state.ruleOwned })),
  chatbotTookOwnership: () => state.ruleOwned,
  sendChannelReply: sendSpy,
}))
vi.mock("@/lib/social/ai-autoreply", () => ({ maybeAiAutoReply: aiSpy }))

function tgReq(token: string | null, replyMode?: string, text = "Salam") {
  state.config = { id: "cfg_tg", organizationId: "org_1", botToken: "BOT", settings: replyMode ? { replyMode } : {} }
  const url = token ? `http://localhost/api/v1/webhooks/telegram?token=${token}` : "http://localhost/api/v1/webhooks/telegram"
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { message_id: 5, chat: { id: 999 }, from: { id: 1, first_name: "Ali" }, text } }),
  })
}

beforeEach(() => {
  aiSpy.mockClear()
  sendSpy.mockClear()
  emitEventsSpy.mockClear()
  state.ruleOwned = false
})

describe("telegram webhook — Y2 AI auto-reply gate", () => {
  it("replyMode 'ai' + rules didn't own → maybeAiAutoReply fires with telegram context", async () => {
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(tgReq("BOT", "ai"))
    expect(aiSpy).toHaveBeenCalledOnce()
    expect(aiSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_1", platform: "telegram", conversationId: "conv_tg", externalId: "999", userMessage: "Salam", send: expect.any(Function),
      }),
    )
    expect(emitEventsSpy).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "conv_tg", wasCreated: undefined })
  })

  it("default replyMode (agent) → maybeAiAutoReply NOT called (pure rules/mirror)", async () => {
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(tgReq("BOT"))
    expect(aiSpy).not.toHaveBeenCalled()
  })

  it("replyMode 'ai' but the rules bot OWNED the message → no AI (no double reply)", async () => {
    state.ruleOwned = true
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(tgReq("BOT", "ai"))
    expect(aiSpy).not.toHaveBeenCalled()
  })
})
