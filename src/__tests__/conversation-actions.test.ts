import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * E1.1a — Conversation Automation Engine action executor.
 * Each action: happy path + tenant-guard + the guard/not-found branches.
 */
const updateMany = vi.hoisted(() => vi.fn())
const socialConversationFindFirst = vi.hoisted(() => vi.fn())
// A2 — the ai_reply gate loads the channel's reply policy; null = gating off (send).
const channelConfigFindFirst = vi.hoisted(() => vi.fn(async () => null))
const upsert = vi.hoisted(() => vi.fn())
const channelMessageFindFirst = vi.hoisted(() => vi.fn())
const createNotification = vi.hoisted(() => vi.fn(async () => {}))
const createTicket = vi.hoisted(() =>
  vi.fn(async () => ({ id: "tk_1", ticketNumber: "TK-0007", assignedTo: null, subject: "s" })),
)
const sendReply = vi.hoisted(() => vi.fn())
const generateAiReply = vi.hoisted(() => vi.fn())
const claimAiReply = vi.hoisted(() => vi.fn())
const userFindFirst = vi.hoisted(() => vi.fn())
const userFindMany = vi.hoisted(() => vi.fn())
const contactFindFirst = vi.hoisted(() => vi.fn())
const contactUpdateMany = vi.hoisted(() => vi.fn())
const aiChatMessageCreate = vi.hoisted(() => vi.fn())
const releaseAiReply = vi.hoisted(() => vi.fn())
const routeConversation = vi.hoisted(() => vi.fn())
const getBusinessHoursDecision = vi.hoisted(() => vi.fn())
const emitConversationEvent = vi.hoisted(() => vi.fn())
const maybeCreateQualifiedLeadTask = vi.hoisted(() => vi.fn(async () => ({ created: false })))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { updateMany, findFirst: socialConversationFindFirst },
    channelMessage: { findFirst: channelMessageFindFirst },
    conversationParticipant: { upsert },
    user: { findFirst: userFindFirst, findMany: userFindMany },
    contact: { findFirst: contactFindFirst, updateMany: contactUpdateMany },
    aiChatMessage: { create: aiChatMessageCreate },
    channelConfig: { findFirst: channelConfigFindFirst },
  },
}))
vi.mock("@/lib/notifications", () => ({ createNotification }))
vi.mock("@/lib/ticket-factory", () => ({ createTicketWithAssignment: createTicket }))
vi.mock("@/lib/inbox/send-conversation-reply", () => ({ sendConversationReply: sendReply }))
vi.mock("@/lib/social/ai-autoreply", () => ({
  generateChannelAiReply: generateAiReply,
  claimConversationAiReply: claimAiReply,
  releaseConversationAiReplyClaim: releaseAiReply,
}))
vi.mock("@/lib/inbox/conversation-routing", () => ({ routeConversation }))
vi.mock("@/lib/inbox/business-hours", () => ({ getBusinessHoursDecision }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationEvent }))
// Keep this action-executor suite hermetic: the real qualification module imports
// generated Prisma runtime types that are intentionally absent in this worktree.
vi.mock("@/lib/inbox/lead-qualification", () => ({ maybeCreateQualifiedLeadTask }))

import { executeConversationAction, type ConversationActionContext, type ConversationActionType } from "@/lib/inbox/conversation-actions"

const baseCtx = (): ConversationActionContext => ({
  organizationId: "org_1",
  conversationId: "c_1",
  actorUserId: "u_actor",
  conversation: {
    id: "c_1",
    contactId: "ct_1",
    contactName: "Anna",
    platform: "whatsapp",
    externalId: "+994501234567",
    channelConfigId: "ch_1",
    lastMessage: "What does it cost?",
    status: "open",
    assignedTo: null,
    metadata: { foo: "bar" },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  updateMany.mockResolvedValue({ count: 1 })
  socialConversationFindFirst.mockResolvedValue({
    assignedTo: null,
    status: "open",
    updatedAt: new Date("2026-06-23T11:50:00Z"),
    metadata: { routing: { assignedAt: "2026-06-23T11:50:00.000Z" } },
  })
  channelMessageFindFirst.mockResolvedValue(null)
  upsert.mockResolvedValue({})
  sendReply.mockResolvedValue({ success: true, data: { id: "m_1", status: "delivered" } })
  generateAiReply.mockResolvedValue({ reply: "It costs 10 AZN.", escalate: false, sessionId: "sess_1" })
  claimAiReply.mockResolvedValue({ claimed: true, token: "claim_tok_1", claimedUntil: new Date("2026-06-23T12:00:00Z") })
  releaseAiReply.mockResolvedValue(undefined)
  aiChatMessageCreate.mockResolvedValue({})
  userFindFirst.mockResolvedValue({ id: "u_x" }) // assignment target exists in-org by default
  userFindMany.mockResolvedValue([{ id: "u_admin" }]) // escalation team
  contactFindFirst.mockResolvedValue(null)
  contactUpdateMany.mockResolvedValue({ count: 1 })
  routeConversation.mockResolvedValue({
    routed: true,
    queueId: "q_1",
    queueName: "Support",
    strategy: "least_loaded",
    assignedTo: "u_route",
    agentName: "Routed Agent",
    load: 2,
  })
  getBusinessHoursDecision.mockResolvedValue({
    open: true,
    reason: "inside_hours",
    channelType: "whatsapp",
    matchedChannelType: "whatsapp",
    configId: "bh_1",
    timezone: "Asia/Baku",
    localDate: "2026-06-23",
    localTime: "12:00",
    weekday: "tue",
    replyMessage: "Welcome",
    welcomeMessage: "Welcome",
    awayMessage: "Away",
  })
})

describe("multi-tenant target validation (#2)", () => {
  it("assign rejects a target from another org without writing", async () => {
    userFindFirst.mockResolvedValue(null)
    const r = await executeConversationAction({ type: "assign", config: { assignTo: "u_other" } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "assign", error: "target_not_in_org" })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("assign allows null (unassign) with no target check", async () => {
    const r = await executeConversationAction({ type: "assign", config: { assignTo: null } }, baseCtx())
    expect(r.ok).toBe(true)
    expect(userFindFirst).not.toHaveBeenCalled()
  })
  it("handoff_agent rejects a cross-org target without writing", async () => {
    userFindFirst.mockResolvedValue(null)
    const r = await executeConversationAction({ type: "handoff_agent", config: { toUserId: "u_other" } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "handoff_agent", error: "target_not_in_org" })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("validates the target against THIS org", async () => {
    await executeConversationAction({ type: "handoff_agent", config: { toUserId: "u_2" } }, baseCtx())
    expect(userFindFirst).toHaveBeenCalledWith({ where: { id: "u_2", organizationId: "org_1" }, select: { id: true } })
  })
})

describe("send_reply", () => {
  it("sends config.text to the conversation target and links the outbound row", async () => {
    const r = await executeConversationAction({ type: "send_reply", config: { text: "  Hello  " } }, baseCtx())
    expect(r).toEqual({ ok: true, action: "send_reply", detail: { messageId: "m_1", status: "delivered" } })
    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1", channel: "whatsapp", to: "+994501234567", body: "Hello",
      conversationId: "c_1", channelConfigId: "ch_1", contactId: "ct_1",
    }))
  })

  it("derives a stable, source-scoped delivery key from flow run + node", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "tiktok"
    ctx.conversation.externalId = "42"
    ctx.deliveryOperationId = "run_1:send_node"

    await executeConversationAction({ type: "send_reply", config: { text: "Hello" } }, ctx)
    await executeConversationAction({ type: "send_reply", config: { text: "Hello" } }, ctx)

    const first = sendReply.mock.calls[0][0].deliveryIdempotency
    const second = sendReply.mock.calls[1][0].deliveryIdempotency
    expect(first).toMatchObject({ source: "flow", key: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(second).toEqual(first)
  })

  it("sends inbox/email replies to the real address from metadata.channel + metadata.contactEmail", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "inbox"
    ctx.conversation.externalId = "c:ct_1"
    ctx.conversation.metadata = { channel: "email", contactEmail: "customer@example.com" }

    const r = await executeConversationAction({ type: "send_reply", config: { text: "Email reply" } }, ctx)

    expect(r).toEqual({ ok: true, action: "send_reply", detail: { messageId: "m_1", status: "delivered" } })
    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      channel: "email",
      to: "customer@example.com",
      body: "Email reply",
      conversationId: "c_1",
      contactId: "ct_1",
    }))
  })

  it("falls back to the org-scoped Contact when an inbox/email conversation is keyed by contactId", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "inbox"
    ctx.conversation.externalId = "c:ct_1"
    ctx.conversation.metadata = { channel: "email" }
    contactFindFirst.mockResolvedValue({ email: "from-contact@example.com" })

    const r = await executeConversationAction({ type: "send_reply", config: { text: "Email reply" } }, ctx)

    expect(r.ok).toBe(true)
    expect(contactFindFirst).toHaveBeenCalledWith({
      where: { id: "ct_1", organizationId: "org_1" },
      select: { email: true },
    })
    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({
      channel: "email",
      to: "from-contact@example.com",
    }))
  })

  it("rejects inbox/email replies when no real recipient can be resolved", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "inbox"
    ctx.conversation.externalId = "c:ct_1"
    ctx.conversation.metadata = { channel: "email" }
    contactFindFirst.mockResolvedValue(null)

    const r = await executeConversationAction({ type: "send_reply", config: { text: "Email reply" } }, ctx)

    expect(r).toEqual({ ok: false, action: "send_reply", error: "no_recipient" })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("rejects empty text without sending", async () => {
    const r = await executeConversationAction({ type: "send_reply", config: { text: "  " } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "send_reply", error: "no_text" })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("marks an unknown delivery terminal so a flow cannot retry it", async () => {
    sendReply.mockResolvedValue({
      success: false,
      statusCode: 409,
      error: "verify before retrying",
      deliveryUnknown: true,
    })

    const r = await executeConversationAction(
      { type: "send_reply", config: { text: "Hello" } },
      baseCtx(),
    )

    expect(r).toEqual({
      ok: false,
      action: "send_reply",
      error: "delivery_unknown",
      detail: { deliveryUnknown: true },
      terminal: true,
    })
  })
})

describe("menu", () => {
  const menuAction = {
    type: "menu" as const,
    config: {
      prompt: "How can we help?",
      options: [
        { id: "sales", label: "Sales", match: ["sales", "1"] },
        { id: "support", label: "Support", match: ["support", "2"] },
      ],
    },
  }

  it("sends a numbered menu and waits for the next customer reply when no option matches", async () => {
    const r = await executeConversationAction(menuAction, baseCtx())

    expect(r).toEqual({
      ok: false,
      action: "menu",
      error: "awaiting_menu_reply",
      detail: { messageId: "m_1", status: "delivered", optionCount: 2 },
    })
    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({
      channel: "whatsapp",
      to: "+994501234567",
      body: "How can we help?\n\n1. Sales\n2. Support",
      conversationId: "c_1",
    }))
  })

  it("returns an option branch when the latest customer message matches by number", async () => {
    const ctx = baseCtx()
    ctx.conversation.lastMessage = "2"

    const r = await executeConversationAction(menuAction, ctx)

    expect(r).toEqual({
      ok: true,
      action: "menu",
      branch: "option:support",
      detail: { selectedOptionId: "support", selectedLabel: "Support" },
    })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("uses the same tenant-safe recipient resolution as send_reply", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "inbox"
    ctx.conversation.externalId = "c:ct_1"
    ctx.conversation.metadata = { channel: "email", contactEmail: "customer@example.com" }

    await executeConversationAction(menuAction, ctx)

    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({
      channel: "email",
      to: "customer@example.com",
    }))
  })

  it("rejects invalid menu configuration without sending", async () => {
    const noPrompt = await executeConversationAction({ type: "menu", config: { options: [{ label: "Sales" }] } }, baseCtx())
    const noOptions = await executeConversationAction({ type: "menu", config: { prompt: "Choose" } }, baseCtx())

    expect(noPrompt).toEqual({ ok: false, action: "menu", error: "no_prompt" })
    expect(noOptions).toEqual({ ok: false, action: "menu", error: "no_options" })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("does not let an unknown menu delivery enter a retry branch", async () => {
    sendReply.mockResolvedValue({
      success: false,
      statusCode: 409,
      error: "verify before retrying",
      deliveryUnknown: true,
    })

    expect(await executeConversationAction(menuAction, baseCtx())).toEqual({
      ok: false,
      action: "menu",
      error: "delivery_unknown",
      detail: { deliveryUnknown: true },
      terminal: true,
    })
  })
})

describe("ai_reply", () => {
  it("does not generate or send when a human owns the conversation", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "facebook"
    socialConversationFindFirst.mockResolvedValue({ assignedTo: "u_human" })

    const r = await executeConversationAction({ type: "ai_reply" }, ctx)

    expect(r).toEqual({ ok: false, action: "ai_reply", error: "assigned_to_human" })
    expect(claimAiReply).not.toHaveBeenCalled()
    expect(generateAiReply).not.toHaveBeenCalled()
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("claims atomically, generates from the latest inbound, then sends", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "facebook"
    ctx.conversation.externalId = "psid_1"
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r).toEqual({ ok: true, action: "ai_reply", detail: { messageId: "m_1", status: "delivered", escalated: false } })
    expect(claimAiReply).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "c_1", holdMs: 120_000 })
    expect(generateAiReply).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org_1", channel: "facebook", externalId: "psid_1",
      userMessage: "What does it cost?", senderName: "Anna", contactId: "ct_1",
    }))
    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({ body: "It costs 10 AZN." }))
  })

  it("does not generate or send when aiReplyClaimedAt claim is lost", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"
    claimAiReply.mockResolvedValue({ claimed: false })
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r).toEqual({ ok: false, action: "ai_reply", error: "cooldown" })
    expect(generateAiReply).not.toHaveBeenCalled()
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("returns the generator skip reason and does not send", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "vkontakte"
    generateAiReply.mockResolvedValue({ reply: null, escalate: false, skipped: "budget" })
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r).toEqual({ ok: false, action: "ai_reply", error: "budget" })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("rejects unsupported AI channels before consuming aiReplyClaimedAt", async () => {
    const r = await executeConversationAction({ type: "ai_reply" }, baseCtx())
    expect(r).toEqual({ ok: false, action: "ai_reply", error: "unsupported_channel" })
    expect(claimAiReply).not.toHaveBeenCalled()
  })

  it("holds the claim for the full operation, not the 8s webhook window, and defers persist (#1, #4)", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"
    await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(claimAiReply).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "c_1", holdMs: 120_000 })
    expect(generateAiReply).toHaveBeenCalledWith(expect.objectContaining({ persistAssistant: false }))
  })

  it("persists the assistant turn ONLY after a confirmed send (#4)", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r.ok).toBe(true)
    expect(aiChatMessageCreate).toHaveBeenCalledWith({
      data: { sessionId: "sess_1", role: "assistant", content: "It costs 10 AZN." },
    })
    expect(releaseAiReply).not.toHaveBeenCalled()
  })

  it("releases the claim and skips history persist when send fails (#4)", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"
    sendReply.mockResolvedValue({ success: false, statusCode: 400, error: "send_failed" })
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r).toEqual({ ok: false, action: "ai_reply", error: "send_failed" })
    expect(releaseAiReply).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "c_1", token: "claim_tok_1" })
    expect(aiChatMessageCreate).not.toHaveBeenCalled()
  })

  it("keeps the claim and stops the flow when delivery is unknown", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "tiktok"
    sendReply.mockResolvedValue({
      success: false,
      statusCode: 409,
      error: "verify before retrying",
      deliveryUnknown: true,
    })

    const r = await executeConversationAction({ type: "ai_reply" }, ctx)

    expect(r).toEqual({
      ok: false,
      action: "ai_reply",
      error: "delivery_unknown",
      detail: { deliveryUnknown: true },
      terminal: true,
    })
    expect(releaseAiReply).not.toHaveBeenCalled()
    expect(aiChatMessageCreate).not.toHaveBeenCalled()
  })

  it("releases the claim when the generator yields no reply (#4)", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"
    generateAiReply.mockResolvedValue({ reply: null, escalate: false, skipped: "budget", sessionId: "sess_1" })
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r).toEqual({ ok: false, action: "ai_reply", error: "budget" })
    expect(releaseAiReply).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "c_1", token: "claim_tok_1" })
    expect(sendReply).not.toHaveBeenCalled()
  })

  it("notifies the inbox team when the AI escalates (#3)", async () => {
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"
    generateAiReply.mockResolvedValue({ reply: "Передаю оператору.", escalate: true, sessionId: "sess_1" })
    const r = await executeConversationAction({ type: "ai_reply" }, ctx)
    expect(r).toEqual({ ok: true, action: "ai_reply", detail: { messageId: "m_1", status: "delivered", escalated: true } })
    expect(userFindMany).toHaveBeenCalled()
    expect(createNotification).toHaveBeenCalled()
    expect(emitConversationEvent).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "c_1",
      eventType: "ai_escalated",
      actorUserId: "u_actor",
    })
  })
})

describe("assign", () => {
  it("sets assignedTo, tenant-guarded", async () => {
    const r = await executeConversationAction({ type: "assign", config: { assignTo: "u_2" } }, baseCtx())
    expect(r).toEqual({ ok: true, action: "assign", detail: { assignedTo: "u_2" } })
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "c_1", organizationId: "org_1" }, data: { assignedTo: "u_2" } })
  })
  it("returns not_found when no row matched (cross-tenant / missing)", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const r = await executeConversationAction({ type: "assign", config: { assignTo: "u_2" } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "assign", error: "not_found" })
  })
})

describe("categorize", () => {
  it("merges category into metadata without clobbering siblings", async () => {
    const r = await executeConversationAction({ type: "categorize", config: { category: "New Lead" } }, baseCtx())
    expect(r).toEqual({ ok: true, action: "categorize", detail: { category: "New Lead" } })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c_1", organizationId: "org_1" },
      data: { metadata: { foo: "bar", category: "New Lead" } },
    })
  })
  it("rejects an empty category without touching the DB", async () => {
    const r = await executeConversationAction({ type: "categorize", config: { category: "  " } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "categorize", error: "no_category" })
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe("update_field", () => {
  it("updates only allow-listed contact fields tenant-scoped", async () => {
    const r = await executeConversationAction(
      { type: "update_field", config: { field: "contact.lifecycleStage", value: "MQL" } },
      baseCtx(),
    )
    expect(r).toEqual({
      ok: true,
      action: "update_field",
      detail: { field: "contact.lifecycleStage", value: "mql" },
    })
    expect(contactUpdateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", organizationId: "org_1" },
      data: { lifecycleStage: "mql" },
    })
  })

  it("normalizes contact tags from comma text", async () => {
    const r = await executeConversationAction(
      { type: "update_field", config: { field: "contact.tags", value: " VIP, sales, vip " } },
      baseCtx(),
    )
    expect(r).toEqual({
      ok: true,
      action: "update_field",
      detail: { field: "contact.tags", value: ["vip", "sales"] },
    })
    expect(contactUpdateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", organizationId: "org_1" },
      data: { tags: ["vip", "sales"] },
    })
  })

  it("rejects arbitrary fields and conversations without a contact", async () => {
    const blocked = await executeConversationAction(
      { type: "update_field", config: { field: "organizationId", value: "evil" } },
      baseCtx(),
    )
    expect(blocked).toEqual({ ok: false, action: "update_field", error: "field_not_allowed" })

    const ctx = baseCtx()
    ctx.conversation.contactId = null
    const noContact = await executeConversationAction(
      { type: "update_field", config: { field: "contact.category", value: "vip" } },
      ctx,
    )
    expect(noContact).toEqual({ ok: false, action: "update_field", error: "no_contact" })
    expect(contactUpdateMany).not.toHaveBeenCalled()
  })
})

describe("handoff_agent", () => {
  it("assigns to the target human + writes a handoff marker, tenant-guarded", async () => {
    const r = await executeConversationAction(
      { type: "handoff_agent", config: { toUserId: "u_2", reason: "customer asked for a human" } },
      baseCtx(),
    )
    expect(r).toEqual({ ok: true, action: "handoff_agent", detail: { assignedTo: "u_2", reason: "customer asked for a human" } })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c_1", organizationId: "org_1" },
      data: { assignedTo: "u_2", metadata: { foo: "bar", handoff: { reason: "customer asked for a human" } } },
    })
  })
  it("accepts assignTo as an alias and a null reason", async () => {
    const r = await executeConversationAction({ type: "handoff_agent", config: { assignTo: "u_3" } }, baseCtx())
    expect(r).toEqual({ ok: true, action: "handoff_agent", detail: { assignedTo: "u_3", reason: null } })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c_1", organizationId: "org_1" },
      data: { assignedTo: "u_3", metadata: { foo: "bar", handoff: { reason: null } } },
    })
  })
  it("rejects a missing target without touching the DB", async () => {
    const r = await executeConversationAction({ type: "handoff_agent", config: {} }, baseCtx())
    expect(r).toEqual({ ok: false, action: "handoff_agent", error: "no_target" })
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("returns not_found when no row matched (cross-tenant / missing)", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const r = await executeConversationAction({ type: "handoff_agent", config: { toUserId: "u_2" } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "handoff_agent", error: "not_found" })
  })
})

describe("assign_to_queue", () => {
  it("routes through TeamQueue and returns the selected assignee details", async () => {
    const r = await executeConversationAction({ type: "assign_to_queue", config: { queueId: "q_1" } }, baseCtx())
    expect(r).toEqual({
      ok: true,
      action: "assign_to_queue",
      detail: {
        queueId: "q_1",
        queueName: "Support",
        strategy: "least_loaded",
        assignedTo: "u_route",
        agentName: "Routed Agent",
        load: 2,
      },
    })
    expect(routeConversation).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "c_1", queueId: "q_1" })
  })

  it("accepts teamQueueId as an alias", async () => {
    const r = await executeConversationAction({ type: "assign_to_queue", config: { teamQueueId: "q_alias" } }, baseCtx())
    expect(r.ok).toBe(true)
    expect(routeConversation).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "c_1", queueId: "q_alias" })
  })

  it("rejects a missing queue id without routing", async () => {
    const r = await executeConversationAction({ type: "assign_to_queue", config: {} }, baseCtx())
    expect(r).toEqual({ ok: false, action: "assign_to_queue", error: "no_queue" })
    expect(routeConversation).not.toHaveBeenCalled()
  })

  it("maps router failures onto action failures", async () => {
    routeConversation.mockResolvedValue({ routed: false, reason: "no_available_agent" })
    const r = await executeConversationAction({ type: "assign_to_queue", config: { queueId: "q_1" } }, baseCtx())
    expect(r).toEqual({ ok: false, action: "assign_to_queue", error: "no_available_agent" })
  })
})

describe("reroute_if_unanswered", () => {
  beforeEach(() => {
    socialConversationFindFirst.mockResolvedValue({
      assignedTo: "u_current",
      status: "open",
      updatedAt: new Date("2026-06-23T11:50:00Z"),
      metadata: { routing: { assignedAt: "2026-06-23T11:50:00.000Z" } },
    })
  })

  it("reroutes away from the current assignee after the timeout when no outbound answer exists", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-23T12:00:00Z"))
    try {
      const r = await executeConversationAction(
        { type: "reroute_if_unanswered", config: { queueId: "q_1", afterMinutes: 5 } },
        baseCtx(),
      )

      expect(r).toEqual({
        ok: true,
        action: "reroute_if_unanswered",
        detail: {
          queueId: "q_1",
          queueName: "Support",
          strategy: "least_loaded",
          assignedTo: "u_route",
          agentName: "Routed Agent",
          load: 2,
          previousAssignedTo: "u_current",
          reason: "unanswered",
        },
      })
      expect(channelMessageFindFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          conversationId: "c_1",
          direction: "outbound",
          createdAt: { gte: new Date("2026-06-23T11:50:00.000Z") },
        },
        select: { id: true },
      })
      expect(routeConversation).toHaveBeenCalledWith({
        organizationId: "org_1",
        conversationId: "c_1",
        queueId: "q_1",
        excludeUserIds: ["u_current"],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not reroute before the configured timeout", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-23T11:52:00Z"))
    try {
      const r = await executeConversationAction(
        { type: "reroute_if_unanswered", config: { queueId: "q_1", afterMinutes: 5 } },
        baseCtx(),
      )

      expect(r).toEqual({ ok: false, action: "reroute_if_unanswered", error: "not_due" })
      expect(channelMessageFindFirst).not.toHaveBeenCalled()
      expect(routeConversation).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not reroute when an outbound answer exists after assignment", async () => {
    channelMessageFindFirst.mockResolvedValue({ id: "m_out" })

    const r = await executeConversationAction(
      { type: "reroute_if_unanswered", config: { queueId: "q_1", afterMinutes: 5 } },
      baseCtx(),
    )

    expect(r).toEqual({ ok: false, action: "reroute_if_unanswered", error: "already_answered" })
    expect(routeConversation).not.toHaveBeenCalled()
  })

  it("routes immediately when the conversation is currently unassigned", async () => {
    socialConversationFindFirst.mockResolvedValue({
      assignedTo: null,
      status: "open",
      updatedAt: new Date("2026-06-23T11:50:00Z"),
      metadata: {},
    })

    const r = await executeConversationAction(
      { type: "reroute_if_unanswered", config: { teamQueueId: "q_1" } },
      baseCtx(),
    )

    expect(r).toMatchObject({
      ok: true,
      action: "reroute_if_unanswered",
      detail: { previousAssignedTo: null, reason: "unassigned" },
    })
    expect(channelMessageFindFirst).not.toHaveBeenCalled()
    expect(routeConversation).toHaveBeenCalledWith({
      organizationId: "org_1",
      conversationId: "c_1",
      queueId: "q_1",
      excludeUserIds: [],
    })
  })
})

describe("business_hours_gate", () => {
  it("returns success in-hours and does not send or write", async () => {
    const r = await executeConversationAction({ type: "business_hours_gate" }, baseCtx())

    expect(r).toMatchObject({
      ok: true,
      action: "business_hours_gate",
      detail: {
        reason: "inside_hours",
        channelType: "whatsapp",
        replyMessage: "Welcome",
      },
    })
    expect(getBusinessHoursDecision).toHaveBeenCalledWith({
      organizationId: "org_1",
      channelType: "whatsapp",
    })
    expect(sendReply).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("returns failure off-hours so the flow can take its away branch", async () => {
    getBusinessHoursDecision.mockResolvedValue({
      open: false,
      reason: "outside_hours",
      channelType: "telegram",
      matchedChannelType: "all",
      configId: "bh_all",
      timezone: "Asia/Baku",
      localDate: "2026-06-23",
      localTime: "20:30",
      weekday: "tue",
      replyMessage: "We are closed.",
      welcomeMessage: null,
      awayMessage: "We are closed.",
    })
    const ctx = baseCtx()
    ctx.conversation.platform = "telegram"

    const r = await executeConversationAction({ type: "business_hours_gate" }, ctx)

    expect(r).toMatchObject({
      ok: false,
      action: "business_hours_gate",
      error: "outside_business_hours",
      detail: {
        reason: "outside_hours",
        matchedChannelType: "all",
        replyMessage: "We are closed.",
      },
    })
    expect(sendReply).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe("close", () => {
  it("sets status=resolved, tenant-guarded", async () => {
    const r = await executeConversationAction({ type: "close" }, baseCtx())
    expect(r).toEqual({ ok: true, action: "close", detail: { closeOutcome: null } })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c_1", organizationId: "org_1" },
      data: expect.objectContaining({ status: "resolved", closedAt: expect.any(Date) }),
    })
  })

  it("persists a supplied outcome and note, and keeps the first closedAt on re-close", async () => {
    const r = await executeConversationAction(
      { type: "close", config: { closeOutcome: "won", closeOutcomeReason: "paid upfront" } },
      { ...baseCtx(), conversation: { ...baseCtx().conversation, status: "resolved" } },
    )
    expect(r).toEqual({ ok: true, action: "close", detail: { closeOutcome: "won" } })
    const data = updateMany.mock.calls.at(-1)![0].data
    expect(data).toMatchObject({ status: "resolved", closeOutcome: "won", closeOutcomeReason: "paid upfront" })
    expect(data.closedAt).toBeUndefined() // already resolved → don't overwrite closedAt
  })
})

describe("create_ticket", () => {
  it("opens a ticket via the factory with conversation context", async () => {
    const r = await executeConversationAction({ type: "create_ticket", config: { priority: "high" } }, baseCtx())
    expect(r).toEqual({ ok: true, action: "create_ticket", detail: { ticketId: "tk_1", ticketNumber: "TK-0007" } })
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", contactId: "ct_1", source: "whatsapp", priority: "high", createdBy: "u_actor" }),
    )
  })
})

describe("notify", () => {
  it("notifies the assignee, scoped to the conversation entity", async () => {
    const ctx = baseCtx()
    ctx.conversation.assignedTo = "u_owner"
    await executeConversationAction({ type: "notify", config: { title: "Hi", message: "m" } }, ctx)
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", userId: "u_owner", entityType: "conversation", entityId: "c_1", title: "Hi" }),
    )
  })
})

describe("add_participant", () => {
  it("upserts a participant (idempotent)", async () => {
    const r = await executeConversationAction({ type: "add_participant", config: { userId: "u_5" } }, baseCtx())
    expect(r).toEqual({ ok: true, action: "add_participant", detail: { userId: "u_5" } })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { socialConversationId_userId: { socialConversationId: "c_1", userId: "u_5" } } }),
    )
  })
  it("rejects when no userId given", async () => {
    const r = await executeConversationAction({ type: "add_participant", config: {} }, baseCtx())
    expect(r).toEqual({ ok: false, action: "add_participant", error: "no_user" })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe("safety", () => {
  it("returns unknown_action for an untyped action type", async () => {
    const r = await executeConversationAction({ type: "nuke" as unknown as ConversationActionType }, baseCtx())
    expect(r).toEqual({ ok: false, action: "nuke", error: "unknown_action" })
  })
  it("catches a thrown DB error as {ok:false, error:'exception'}", async () => {
    updateMany.mockRejectedValue(new Error("db down"))
    const r = await executeConversationAction({ type: "close" }, baseCtx())
    expect(r).toEqual({ ok: false, action: "close", error: "exception" })
  })
})
