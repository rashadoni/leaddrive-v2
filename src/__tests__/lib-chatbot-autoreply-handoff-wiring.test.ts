import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * maybeAutoReply with the «Автоответы» additions (2026-11-27): the customer's name in the reply,
 * the «first message» trigger read from the conversation, and the hand-over that follows only a
 * reply that went out.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    chatbotRule: { findMany: vi.fn(), update: vi.fn() },
    channelMessage: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    socialConversation: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock("@/lib/inbox/send-conversation-reply", () => ({ sendConversationReply: vi.fn() }))
vi.mock("@/lib/inbox/lead-qualification", () => ({ maybeCreateQualifiedLeadTask: vi.fn(async () => undefined) }))
vi.mock("@/lib/inbox/customer-stage-classifier", () => ({ maybeClassifyCustomerStage: vi.fn(async () => undefined) }))
vi.mock("@/lib/inbox/autoreply-handoff", () => ({ handOffAfterAutoReply: vi.fn(async () => ({ handedTo: "leyla" })) }))

import { maybeAutoReply } from "@/lib/chatbot-autoreply"
import { prisma } from "@/lib/prisma"
import { sendWhatsAppMessage } from "@/lib/whatsapp"
import { handOffAfterAutoReply } from "@/lib/inbox/autoreply-handoff"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

const rule = (over = {}) => ({
  id: "r1", name: "Доставка", status: "active", channelTypes: [], triggerType: "contains", triggerValue: "доставка",
  responseText: "Здравствуйте, {{contact.first_name}}! Напишите адрес.", priority: 0, createdAt: "2026-01-01", handoffUserIds: [], ...over,
})
const call = (over = {}) => maybeAutoReply({
  orgId: "o1", channelType: "whatsapp", conversationId: "c1", contactId: "ct1", inboundText: "сколько доставка", to: "+994", nowMs: 1_000_000, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  fn(prisma.organization.findUnique).mockResolvedValue({ features: ["chatbotAutoReply"] })
  fn(prisma.channelMessage.findMany).mockResolvedValue([])
  fn(prisma.channelMessage.create).mockResolvedValue({})
  fn(prisma.channelMessage.count).mockResolvedValue(1)
  fn(prisma.chatbotRule.update).mockResolvedValue({})
  fn(prisma.socialConversation.findFirst).mockResolvedValue({ autoReplyOffAt: null, contactName: "Customer" })
  fn(prisma.contact.findFirst).mockResolvedValue({ fullName: "Aysel Məmmədova", email: null })
  fn(sendWhatsAppMessage).mockResolvedValue({ success: true })
})

describe("the bot's reply by a rule", () => {
  it("carries the customer's first name, sent and recorded the same", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])

    expect(await call()).toMatchObject({ matched: true, sent: true })
    expect(fn(sendWhatsAppMessage).mock.calls[0][0].message).toBe("Здравствуйте, Aysel! Напишите адрес.")
    expect(fn(prisma.channelMessage.create).mock.calls[0][0].data.body).toBe("Здравствуйте, Aysel! Напишите адрес.")
  })

  it("hands the conversation over after the reply went out, naming the rule", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([rule({ handoffUserIds: ["leyla"] })])

    await call()
    expect(handOffAfterAutoReply).toHaveBeenCalledWith({ orgId: "o1", conversationId: "c1", ruleName: "Доставка", channelType: "whatsapp", handoffUserIds: ["leyla"] })
  })

  it("hands nothing over when the reply did not go out: the customer is not passed on in silence", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([rule({ handoffUserIds: ["leyla"] })])
    fn(sendWhatsAppMessage).mockResolvedValue({ success: false, error: "meta down" })

    expect(await call()).toMatchObject({ sent: false, skipped: "send-failed" })
    expect(handOffAfterAutoReply).not.toHaveBeenCalled()
  })
})

describe("«first message» read from the conversation", () => {
  const greeting = rule({ id: "greet", triggerType: "first_message", triggerValue: null, responseText: "Salam!", priority: 9 })

  it("greets when the conversation holds only this inbound", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([greeting, rule()])
    fn(prisma.channelMessage.count).mockResolvedValue(1)

    expect(await call()).toMatchObject({ sent: true, ruleId: "greet" })
    expect(fn(prisma.channelMessage.count).mock.calls[0][0].where).toEqual({ organizationId: "o1", conversationId: "c1", direction: "inbound" })
  })

  it("lets the word rules answer a later message", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([greeting, rule()])
    fn(prisma.channelMessage.count).mockResolvedValue(4)

    expect(await call()).toMatchObject({ sent: true, ruleId: "r1" })
  })

  it("does not count messages when no rule greets", async () => {
    fn(prisma.chatbotRule.findMany).mockResolvedValue([rule()])
    await call()
    expect(prisma.channelMessage.count).not.toHaveBeenCalled()
  })
})
