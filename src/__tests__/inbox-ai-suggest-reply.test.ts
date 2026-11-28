import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * «AI cavab təklifi» in the inbox (owner 2026-11-28: «походу он не изучает мои знания и предлагает
 * писать на английском»). On an Instagram comment «+» under a post the button answered the operator, in
 * English, «I don't see the customer's message…»: the model got the one line «+», none of the page's
 * knowledge and no post.
 *
 * The proof is what reaches the model through the real route and the real reply generator: the page's
 * own agent and knowledge, what the page learned, the conversation, and the comment framed as a comment
 * under its post. And that a suggestion writes nothing a customer conversation would read. Only the
 * model and the database rows are stand-ins.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ messages: [] as Row[], conversation: null as Row | null, hidden: [] as string[] }))
const writes = vi.hoisted(() => ({ session: 0, chat: 0, logs: [] as Row[] }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => ({ features: ["aiAutoReply"] })) },
    aiChatSession: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => { writes.session++; return { id: "s1" } }),
      update: vi.fn(async () => ({})),
    },
    aiChatMessage: { create: vi.fn(async () => { writes.chat++; return {} }), findMany: vi.fn(async () => []) },
    channelMessage: {
      findMany: vi.fn(async ({ where, orderBy }: Row) => {
        const rows = db.messages.filter((m) => m.conversationId === where.conversationId && (!where.direction || m.direction === where.direction))
        return orderBy?.createdAt === "desc" ? [...rows].reverse() : rows
      }),
    },
    contact: { findFirst: vi.fn(async () => null) },
    socialConversation: {
      findFirst: vi.fn(async ({ where }: Row) =>
        db.conversation && db.conversation.id === where.id && db.conversation.organizationId === where.organizationId ? db.conversation : null),
    },
    aiInteractionLog: { create: vi.fn(async ({ data }: Row) => { writes.logs.push(data); return { id: "log1" } }) },
    aiAgentConfig: {
      findFirst: vi.fn(async ({ where }: Row) =>
        where.agentType === "inbox_page" && where.channelConfigId === "cfg_page"
          ? {
              id: "agent_page", organizationId: "org_1", agentType: "inbox_page", isActive: true, channelConfigId: "cfg_page",
              systemPrompt: "Sən LeadDrive kurslarının məsləhətçisisən.", knowledgeBase: "Kurs mağazada 95 AZN-dir.",
              greeting: null, replyLanguage: "az", model: "claude-sonnet-4-6", temperature: 0.4, maxTokens: 600,
              escalationEnabled: true, autoLeadEnabled: false,
            }
          : null),
    },
    channelConfig: { findFirst: vi.fn(async () => ({ id: "cfg_page", organizationId: "org_1", settings: {} })) },
    inboxLearnedItem: {
      findMany: vi.fn(async ({ where }: Row) =>
        where.OR
          ? [{ kind: "knowledge", type: "price", title: "Instagram endirimi", body: "Instagram-da 89 AZN", status: "active", source: "manual", approvedAt: new Date(), removedAt: null }]
          : []),
    },
  },
}))
vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: vi.fn(async () => ({ allowed: true })),
  calculateAiCost: () => 0,
  getAiLimits: vi.fn(async () => ({ maxOutputTokens: 1024 })),
}))
vi.mock("@/lib/inbox/kb-context", () => ({
  buildInboxKbContext: vi.fn(async () => ""),
  buildInboxKbContextDetailed: vi.fn(async () => ({ context: "", sources: [] })),
}))
const anthropicCreate = vi.fn()
vi.mock("@/lib/ai/anthropic-client", () => ({ getAnthropicClient: () => ({ messages: { create: anthropicCreate } }) }))
vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth:
    (hnd: (req: NextRequest, auth: Row, ctx: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx: unknown) =>
      hnd(req, { orgId: "org_1", userId: "u1", role: "admin", hiddenChannelConfigIds: db.hidden, email: "m@example.test", name: "M" }, ctx),
}))

import { POST } from "@/app/api/v1/inbox/ai-assist/route"
import { historyForSuggestion } from "@/lib/inbox/ai-suggest-reply"

process.env.ANTHROPIC_API_KEY ??= "test-key"

const post = (body: Row) =>
  POST(new NextRequest("http://localhost/api/v1/inbox/ai-assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), {} as never)

const call = () => anthropicCreate.mock.calls[0]?.[0] as { system: string; messages: Array<{ role: string; content: string }> }

const comment = (body: string) => ({
  conversationId: "conv_1", direction: "inbound", body, status: "delivered",
  metadata: { igComment: { commentId: "c1", mediaId: "m1", caption: "Instagram-da 89, mağazada 95. Müştəri yazsın +", username: "bahruz" } },
})

beforeEach(() => {
  vi.clearAllMocks()
  writes.session = 0
  writes.chat = 0
  writes.logs = []
  db.hidden = []
  db.conversation = {
    id: "conv_1", organizationId: "org_1", platform: "instagram", externalId: "igsid_1",
    contactName: "bahruz.najafov", contactId: null, channelConfigId: "cfg_page",
  }
  db.messages = [comment("+")]
  anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "Salam! Kurs Instagram-da 89 AZN-dir." }], usage: { input_tokens: 10, output_tokens: 5 } })
})

describe("«Предложить ответ» on a conversation answers as the page's AI would", () => {
  it("gives the model the page's agent, its knowledge and what the page learned", async () => {
    const res = await post({ action: "suggest", lastInbound: "+", lang: "az", conversationId: "conv_1" })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.suggestion).toBe("Salam! Kurs Instagram-da 89 AZN-dir.")
    expect(call().system).toContain("LeadDrive kurslarının məsləhətçisisən")
    expect(call().system).toContain("Kurs mağazada 95 AZN-dir")
    expect(call().system).toContain("Instagram-da 89 AZN")
    // The operator reads it before sending: no «передаю менеджеру», a blank for a missing fact.
    expect(call().system).toContain("ПРОВЕРКА СОТРУДНИКОМ")
  })

  it("tells the model a «+» is a comment under a post, and which post", async () => {
    await post({ action: "suggest", lastInbound: "+", conversationId: "conv_1" })

    const last = call().messages.at(-1)!
    expect(last.role).toBe("user")
    expect(last.content).toContain("Комментарий клиента под постом Instagram")
    expect(last.content).toContain("Instagram-da 89, mağazada 95")
    expect(last.content.endsWith("\n+")).toBe(true)
  })

  it("reads the whole conversation, not only the last line", async () => {
    db.messages = [
      { conversationId: "conv_1", direction: "inbound", body: "Salam, kurs var?", status: "delivered", metadata: {} },
      { conversationId: "conv_1", direction: "outbound", body: "Bəli, var.", status: "sent", metadata: {} },
      { conversationId: "conv_1", direction: "outbound", body: "göndərilmədi", status: "failed", metadata: {} },
      { conversationId: "conv_1", direction: "inbound", body: "Qiyməti?", status: "delivered", metadata: {} },
      { conversationId: "conv_1", direction: "inbound", body: "Onlayn da var?", status: "delivered", metadata: {} },
    ]
    await post({ action: "suggest", conversationId: "conv_1" })

    expect(call().messages).toEqual([
      { role: "user", content: "Salam, kurs var?" },
      { role: "assistant", content: "Bəli, var." },
      { role: "user", content: "Qiyməti?\nOnlayn da var?" },
    ])
  })

  it("writes nothing a customer conversation reads, and counts as an operator suggestion", async () => {
    await post({ action: "suggest", conversationId: "conv_1" })

    expect(writes.session).toBe(0)
    expect(writes.chat).toBe(0)
    expect(writes.logs).toHaveLength(1)
    expect(writes.logs[0].agentType).toBe("inbox_assist")
  })

  it("a conversation with no customer message says so instead of asking the model", async () => {
    db.messages = [{ conversationId: "conv_1", direction: "outbound", body: "Salam!", status: "sent", metadata: {} }]
    const res = await post({ action: "suggest", conversationId: "conv_1" })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("no_customer_message")
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("an email conversation keeps the plain compose helper", async () => {
    db.conversation = { ...db.conversation!, platform: "email" }
    const res = await post({ action: "suggest", lastInbound: "Hello, price?", lang: "en", conversationId: "conv_1" })

    expect(res.status).toBe(200)
    expect(call().messages[0].content).toContain("Hello, price?")
    expect(call().messages[0].content).toContain("never to the support agent")
  })
})

describe("historyForSuggestion", () => {
  it("ends at the customer's latest message: an operator reply after it is not what is answered", () => {
    expect(historyForSuggestion([
      { direction: "inbound", body: "Salam", status: "delivered", metadata: {} },
      { direction: "outbound", body: "Salam!", status: "sent", metadata: {} },
    ])).toEqual([{ role: "user", content: "Salam" }])
  })

  it("starts with the customer", () => {
    expect(historyForSuggestion([
      { direction: "outbound", body: "Kampaniya!", status: "sent", metadata: {} },
      { direction: "inbound", body: "Nə qədər?", status: "delivered", metadata: {} },
    ])).toEqual([{ role: "user", content: "Nə qədər?" }])
  })
})
