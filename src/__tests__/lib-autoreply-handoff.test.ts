import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * «Автоответы» (2026-11-27): the rule's «Потом: передать сотруднику», the «первое сообщение»
 * trigger and the reply texts the bot can fill. Prisma is mocked here; the whole path through a
 * real webhook on a real Postgres is in whatsapp-ticket-path-postgres.test.ts.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    socialConversation: { groupBy: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))

import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { handOffAfterAutoReply, pickHandoffUser } from "@/lib/inbox/autoreply-handoff"
import { autoReplyTextProblem } from "@/lib/inbox/autoreply-rule-input"
import { matchChatbotRule, triggerNeedsValue, type ChatbotRuleLike } from "@/lib/chatbot-engine"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>

describe("who gets the conversation", () => {
  it("is the one person chosen", () => {
    expect(pickHandoffUser(["leyla"], [{ id: "leyla", openConversations: 40 }])).toBe("leyla")
  })

  it("among several, whoever holds the fewest open conversations; a tie goes to the one chosen first", () => {
    const loads = [{ id: "a", openConversations: 5 }, { id: "b", openConversations: 2 }, { id: "c", openConversations: 2 }]
    expect(pickHandoffUser(["a", "b", "c"], loads)).toBe("b")
    expect(pickHandoffUser(["c", "b", "a"], loads)).toBe("c")
  })

  it("is nobody when nobody chosen can work", () => {
    expect(pickHandoffUser(["gone"], [])).toBeNull()
  })
})

describe("handing the conversation over after the bot's reply", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fn(prisma.socialConversation.updateMany).mockResolvedValue({ count: 1 })
    fn(prisma.socialConversation.groupBy).mockResolvedValue([])
  })

  const handOff = (ids: string[]) => handOffAfterAutoReply({ orgId: "org-1", conversationId: "conv-1", ruleName: "Доставка", channelType: "whatsapp", handoffUserIds: ids })

  it("asks only for working people of this organization, takes an unheld conversation and tells the person", async () => {
    fn(prisma.user.findMany).mockResolvedValue([{ id: "leyla" }])

    expect(await handOff(["leyla"])).toEqual({ handedTo: "leyla" })
    expect(fn(prisma.user.findMany).mock.calls[0][0].where).toEqual({
      id: { in: ["leyla"] }, organizationId: "org-1", isActive: true, anonymizedAt: null, role: { not: "reviewer" },
    })
    expect(prisma.socialConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", organizationId: "org-1", assignedTo: null },
      data: { assignedTo: "leyla" },
    })
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1", userId: "leyla", entityType: "inbox_message", entityId: "conv-1", push: true,
      message: expect.stringContaining("«Доставка»"),
    }))
  })

  it("leaves a conversation somebody already holds, and tells nobody", async () => {
    fn(prisma.user.findMany).mockResolvedValue([{ id: "leyla" }])
    fn(prisma.socialConversation.updateMany).mockResolvedValue({ count: 0 })

    expect(await handOff(["leyla"])).toEqual({ handedTo: null, reason: "already-held" })
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("among several, counts their open conversations and gives it to the least loaded", async () => {
    fn(prisma.user.findMany).mockResolvedValue([{ id: "a" }, { id: "b" }])
    fn(prisma.socialConversation.groupBy).mockResolvedValue([{ assignedTo: "a", _count: { _all: 7 } }, { assignedTo: "b", _count: { _all: 1 } }])

    expect(await handOff(["a", "b"])).toEqual({ handedTo: "b" })
    expect(fn(prisma.socialConversation.groupBy).mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", status: "open", deletedAt: null })
  })

  it("hands to nobody when every chosen person has left, and writes nothing", async () => {
    fn(prisma.user.findMany).mockResolvedValue([])

    expect(await handOff(["gone"])).toEqual({ handedTo: null, reason: "nobody-available" })
    expect(prisma.socialConversation.updateMany).not.toHaveBeenCalled()
  })

  it("does nothing for a rule without people", async () => {
    expect(await handOff([])).toEqual({ handedTo: null, reason: "no-people" })
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})

describe("the «first message» trigger", () => {
  const rule = (over: Partial<ChatbotRuleLike>): ChatbotRuleLike => ({
    id: "r", status: "active", channelTypes: [], triggerType: "contains", triggerValue: null,
    responseText: "x", priority: 0, createdAt: "2026-01-01", ...over,
  })
  const greeting = rule({ id: "greet", triggerType: "first_message", priority: 5 })
  const price = rule({ id: "price", triggerType: "contains", triggerValue: "qiymət" })

  it("answers the customer's first message, whatever it says, and needs no words", () => {
    expect(triggerNeedsValue("first_message")).toBe(false)
    expect(matchChatbotRule([greeting, price], { channelType: "whatsapp", text: "qiymet nedir", isFirstMessage: true })?.id).toBe("greet")
  })

  it("stays out of every later message, so the word rules answer those", () => {
    expect(matchChatbotRule([greeting, price], { channelType: "whatsapp", text: "qiymet nedir", isFirstMessage: false })?.id).toBe("price")
    expect(matchChatbotRule([greeting], { channelType: "whatsapp", text: "salam" })).toBeNull()
  })

  it("greets a first message with no words in it, which no other rule answers", () => {
    expect(matchChatbotRule([greeting], { channelType: "whatsapp", text: "", isFirstMessage: true })?.id).toBe("greet")
    expect(matchChatbotRule([rule({ triggerType: "always" })], { channelType: "whatsapp", text: "", isFirstMessage: true })).toBeNull()
  })
})

describe("a reply text the bot can send", () => {
  it("takes the customer's data, which the bot fills", () => {
    expect(autoReplyTextProblem("Salam, {{contact.first_name}}! {{contact.name}} {{contact.email}}")).toBeNull()
  })

  it("refuses «My name»: the bot has none, and «Меня зовут .» would reach the customer", () => {
    expect(autoReplyTextProblem("Меня зовут {{agent.name}}")).toMatch(/agent\.name/)
  })

  it("refuses a word nothing fills", () => {
    expect(autoReplyTextProblem("Hi {{contact.fullname}}")).toMatch(/contact\.fullname/)
  })
})
