import { describe, it, expect, vi, beforeEach } from "vitest"

const orgFindUnique = vi.hoisted(() => vi.fn())
const convoFindFirst = vi.hoisted(() => vi.fn())
const unconfirmedDeliveryFindFirst = vi.hoisted(() => vi.fn())
const flowFindMany = vi.hoisted(() => vi.fn())
const runFlow = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: orgFindUnique },
    socialConversation: { findFirst: convoFindFirst },
    channelMessage: { findFirst: unconfirmedDeliveryFindFirst },
    conversationFlow: { findMany: flowFindMany },
  },
}))

vi.mock("@/lib/inbox/flow-runner", () => ({
  runConversationFlow: runFlow,
}))

import { emitConversationEvent, emitConversationIngestEvents } from "@/lib/inbox/conversation-events"

beforeEach(() => {
  vi.clearAllMocks()
  orgFindUnique.mockResolvedValue({ features: ["conversationFlowEvents"] })
  convoFindFirst.mockResolvedValue({ platform: "telegram" })
  unconfirmedDeliveryFindFirst.mockResolvedValue(null)
  flowFindMany.mockResolvedValue([{ id: "flow_1", organizationId: "org_1", graph: {} }])
  runFlow.mockResolvedValue({ ok: true, status: "completed", terminal: false, steps: [] })
})

describe("conversation flow event dispatcher", () => {
  it("is default-off unless the org has the conversationFlowEvents flag", async () => {
    orgFindUnique.mockResolvedValue({ features: [] })
    const result = await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_1",
      eventType: "message.inbound",
    })
    expect(result).toMatchObject({ ok: true, skipped: "flag_off", flowsRun: 0 })
    expect(convoFindFirst).not.toHaveBeenCalled()
    expect(runFlow).not.toHaveBeenCalled()
  })

  it("surfaces an unconfirmed delivery even when conversation flows are disabled", async () => {
    orgFindUnique.mockResolvedValue({ features: [] })
    unconfirmedDeliveryFindFirst.mockResolvedValue({ id: "outbound_unknown" })

    const result = await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_1",
      eventType: "message_inbound",
    })

    expect(result).toMatchObject({
      ok: false,
      terminal: true,
      skipped: "delivery_unconfirmed",
      flowsRun: 0,
    })
    expect(orgFindUnique).not.toHaveBeenCalled()
    expect(convoFindFirst).not.toHaveBeenCalled()
    expect(flowFindMany).not.toHaveBeenCalled()
    expect(runFlow).not.toHaveBeenCalled()
  })

  it("matches active flows by trigger + conversation platform and runs them org-scoped", async () => {
    const result = await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_1",
      eventType: "message_inbound",
      actorUserId: "u_1",
    })
    expect(result).toMatchObject({ ok: true, eventType: "message_inbound", flowsRun: 1 })
    expect(flowFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        status: "active",
        trigger: "message_inbound",
        OR: [{ channelTypes: { isEmpty: true } }, { channelTypes: { has: "telegram" } }],
      },
      orderBy: [{ updatedAt: "desc" }],
    })
    expect(runFlow).toHaveBeenCalledWith({
      flow: { id: "flow_1", organizationId: "org_1", graph: {} },
      conversationId: "conv_1",
      organizationId: "org_1",
      actorUserId: "u_1",
    })
  })

  it("stops later matching flows after an explicit terminal result", async () => {
    flowFindMany.mockResolvedValue([
      { id: "flow_terminal", organizationId: "org_1", graph: {} },
      { id: "flow_must_not_run", organizationId: "org_1", graph: {} },
    ])
    runFlow.mockResolvedValueOnce({
      ok: false,
      status: "failed",
      error: "terminal_failure",
      terminal: true,
      steps: [],
    })

    const result = await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_1",
      eventType: "message_inbound",
    })

    expect(result).toMatchObject({ ok: false, terminal: true, flowsRun: 1 })
    expect(result.results).toEqual([
      expect.objectContaining({ flowId: "flow_terminal", terminal: true }),
    ])
    expect(runFlow).toHaveBeenCalledOnce()
    expect(runFlow).not.toHaveBeenCalledWith(expect.objectContaining({
      flow: expect.objectContaining({ id: "flow_must_not_run" }),
    }))
  })

  it("does not start a flow while an earlier outbound delivery is unconfirmed", async () => {
    unconfirmedDeliveryFindFirst.mockResolvedValue({ id: "outbound_unknown" })

    const result = await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_1",
      eventType: "message_inbound",
    })

    expect(result).toMatchObject({
      ok: false,
      terminal: true,
      skipped: "delivery_unconfirmed",
      flowsRun: 0,
    })
    expect(unconfirmedDeliveryFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        conversationId: "conv_1",
        direction: "outbound",
        OR: [
          { status: "pending", metadata: { path: ["deliveryAttempted"], equals: true } },
          { status: "failed", metadata: { path: ["deliveryUnknown"], equals: true } },
        ],
      },
      select: { id: true },
    })
    expect(flowFindMany).not.toHaveBeenCalled()
    expect(runFlow).not.toHaveBeenCalled()
  })

  it("recovers terminal state from a durable marker when the flow throws after sending", async () => {
    flowFindMany.mockResolvedValue([
      { id: "flow_that_sent", organizationId: "org_1", graph: {} },
      { id: "flow_must_not_run", organizationId: "org_1", graph: {} },
    ])
    unconfirmedDeliveryFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "outbound_unknown" })
    runFlow.mockRejectedValueOnce(new Error("flow run audit update failed"))

    const result = await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_1",
      eventType: "message_inbound",
    })

    expect(result).toMatchObject({ ok: false, terminal: true, flowsRun: 1 })
    expect(result.results).toEqual([
      expect.objectContaining({ flowId: "flow_that_sent", terminal: true }),
    ])
    expect(unconfirmedDeliveryFindFirst).toHaveBeenCalledTimes(2)
    expect(runFlow).toHaveBeenCalledOnce()
  })

  it("normalizes idle and AI-escalated dotted aliases into flow triggers", async () => {
    await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_idle",
      eventType: "conversation.idle",
    })
    expect(flowFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ trigger: "conversation_idle" }),
    }))

    await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_escalated",
      eventType: "ai.escalated",
    })
    expect(flowFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ trigger: "ai_escalated" }),
    }))
  })

  it("matches non-social inbox conversations by metadata.channel with inbox fallback", async () => {
    convoFindFirst.mockResolvedValue({ platform: "inbox", metadata: { channel: "sms" } })

    await emitConversationEvent({
      organizationId: "org_1",
      conversationId: "conv_sms",
      eventType: "message_inbound",
    })

    expect(flowFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        status: "active",
        trigger: "message_inbound",
        OR: [
          { channelTypes: { isEmpty: true } },
          { channelTypes: { has: "sms" } },
          { channelTypes: { has: "inbox" } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }],
    })
  })

  it("emits conversation_opened first for a newly-created conversation, then message_inbound", async () => {
    flowFindMany.mockImplementation(async ({ where }: { where: { trigger: string } }) => [
      { id: `${where.trigger}_flow`, organizationId: "org_1", graph: {} },
    ])
    const result = await emitConversationIngestEvents({
      organizationId: "org_1",
      conversationId: "conv_new",
      wasCreated: true,
    })
    expect(result.opened?.eventType).toBe("conversation_opened")
    expect(result.inbound?.eventType).toBe("message_inbound")
    expect(result.terminal).toBe(false)
    expect(runFlow.mock.calls.map((call) => call[0].flow.id)).toEqual([
      "conversation_opened_flow",
      "message_inbound_flow",
    ])
  })

  it("does not emit message_inbound when conversation_opened is terminal", async () => {
    flowFindMany.mockImplementation(async ({ where }: { where: { trigger: string } }) => [
      { id: `${where.trigger}_flow`, organizationId: "org_1", graph: {} },
    ])
    runFlow.mockResolvedValueOnce({
      ok: false,
      status: "failed",
      error: "terminal_failure",
      terminal: true,
      steps: [],
    })

    const result = await emitConversationIngestEvents({
      organizationId: "org_1",
      conversationId: "conv_new",
      wasCreated: true,
    })

    expect(result).toMatchObject({ terminal: true })
    expect(result.opened).toMatchObject({ eventType: "conversation_opened", terminal: true })
    expect(result.inbound).toBeUndefined()
    expect(flowFindMany).toHaveBeenCalledOnce()
    expect(runFlow).toHaveBeenCalledOnce()
  })
})
