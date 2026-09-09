import { describe, expect, it, vi } from "vitest"

const { sendChannelReply, sourceStillUnanswered } = vi.hoisted(() => ({
  sendChannelReply: vi.fn().mockResolvedValue({ ok: true }),
  sourceStillUnanswered: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/chatbot-autoreply", () => ({ sendChannelReply }))
vi.mock("@/lib/inbox/chatwoot-source-guard", () => ({
  chatwootSourceStillUnanswered: sourceStillUnanswered,
}))

import { runAutonomousInboxAgent } from "@/lib/inbox/autonomous-agent-cron"

function dbFixture() {
  return {
    aiAgentConfig: {
      findMany: vi.fn().mockResolvedValue([{
        organizationId: "org-1",
        autonomousLookbackDays: 7,
        autonomousBatchSize: 20,
        autonomousBacklogEnabled: true,
      }]),
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([{
        id: "org-1",
        features: ["aiAutoReply"],
      }]),
    },
    channelConfig: {
      findMany: vi.fn().mockResolvedValue([{
        id: "channel-1",
        channelType: "chatwoot",
        pageId: null,
        settings: { replyMode: "ai", accountId: "account-1", inboxId: "inbox-1" },
      }]),
      findFirst: vi.fn().mockResolvedValue({ apiKey: "secret" }),
    },
    socialConversation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "conv-unanswered",
          channelConfigId: "channel-1",
          platform: "tiktok",
          externalId: "cw-42",
          contactId: "contact-1",
          contactName: "Aysel",
          tags: [],
          aiReplyPendingMessageId: null,
          lastMessageAt: new Date("2026-07-28T08:00:00.000Z"),
          messages: [{
            id: "msg-unanswered",
            direction: "inbound",
            body: "Qiymət və ölçü haqqında məlumat verin",
            status: "delivered",
            createdAt: new Date("2026-07-28T08:00:00.000Z"),
            metadata: {},
          }],
        },
        {
          id: "conv-answered",
          channelConfigId: "channel-1",
          platform: "tiktok",
          externalId: "cw-43",
          contactId: null,
          contactName: "Answered",
          tags: [],
          aiReplyPendingMessageId: null,
          lastMessageAt: new Date("2026-07-28T08:30:00.000Z"),
          messages: [{
            id: "msg-answer",
            direction: "outbound",
            body: "Cavab",
            status: "sent",
            createdAt: new Date("2026-07-28T08:30:00.000Z"),
            metadata: {},
          }],
        },
      ]),
    },
    channelMessage: {
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

describe("autonomous Inbox backlog sweep", () => {
  it("processes only unanswered inbound conversations and marks the backlog origin", async () => {
    const db = dbFixture()
    const reply = vi.fn().mockResolvedValue({
      replied: true,
      escalated: false,
    })

    const result = await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"),
      businessOpen: vi.fn().mockResolvedValue(true),
      reply,
    })

    expect(reply).toHaveBeenCalledTimes(1)
    expect(db.socialConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        assignedTo: null,
        AND: expect.arrayContaining([
          { OR: expect.arrayContaining([{ aiReplyPendingMessageId: { not: null } }]) },
          { OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date("2026-07-28T10:00:00.000Z") } }] },
        ]),
      }),
    }))
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      platform: "tiktok",
      conversationId: "conv-unanswered",
      externalId: "cw-42",
      userMessage: "Qiymət və ölçü haqqında məlumat verin",
      inboundMessageId: "msg-unanswered",
      origin: "backlog",
    }))
    expect(result).toEqual({
      organizations: 1,
      candidates: 2,
      replied: 1,
      escalated: 0,
      skipped: { "not-unanswered": 1 },
    })
  })

  it("recovers a newer inbound that was not covered by the preceding AI reply", async () => {
    const db = dbFixture()
    db.socialConversation.findMany.mockResolvedValue([{
      id: "conv-rapid",
      channelConfigId: "channel-1",
      platform: "tiktok",
      externalId: "cw-rapid",
      contactId: null,
      contactName: "Rapid",
      tags: [],
      aiReplyPendingMessageId: "msg-2",
      lastMessageAt: new Date("2026-07-28T08:00:03.000Z"),
      messages: [
        {
          id: "reply-1", direction: "outbound", body: "Birinci cavab", status: "delivered",
          createdAt: new Date("2026-07-28T08:00:03.000Z"),
          metadata: { aiAutoReply: true, inReplyToInboundId: "msg-1" },
        },
        {
          id: "msg-2", direction: "inbound", body: "İkinci sual", status: "delivered",
          createdAt: new Date("2026-07-28T08:00:02.000Z"), metadata: {},
        },
        {
          id: "msg-1", direction: "inbound", body: "Birinci sual", status: "delivered",
          createdAt: new Date("2026-07-28T08:00:00.000Z"), metadata: {},
        },
      ],
    }])
    const reply = vi.fn().mockResolvedValue({ replied: true, escalated: false })

    await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"),
      businessOpen: vi.fn().mockResolvedValue(true),
      reply,
    })

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: "İkinci sual",
      inboundMessageId: "msg-2",
      inboundMessageIds: ["msg-2"],
    }))
  })

  it("recovers a pending webhook turn even when optional backlog processing is disabled", async () => {
    const db = dbFixture()
    db.aiAgentConfig.findMany.mockResolvedValue([{
      organizationId: "org-1",
      autonomousLookbackDays: 7,
      autonomousBatchSize: 20,
      autonomousBacklogEnabled: false,
    }])
    db.socialConversation.findMany.mockResolvedValue([{
      id: "conv-pending",
      channelConfigId: "channel-1",
      platform: "tiktok",
      externalId: "cw-pending",
      contactId: null,
      contactName: "Pending",
      tags: [],
      aiReplyPendingMessageId: "msg-3",
      lastMessageAt: new Date("2026-07-28T08:00:03.000Z"),
      messages: [{
        id: "msg-3", direction: "inbound", body: "Üçüncü sual", status: "delivered",
        createdAt: new Date("2026-07-28T08:00:03.000Z"),
        metadata: { chatwootInboxId: "inbox-1", chatwootProviderMessageId: "103" },
      }],
    }])
    const businessOpen = vi.fn().mockResolvedValue(false)
    const reply = vi.fn().mockResolvedValue({ replied: true, escalated: false })

    await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"), businessOpen, reply,
    })

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: "Üçüncü sual",
      inboundMessageIds: ["msg-3"],
      preSend: expect.any(Function),
    }))
    const preSend = reply.mock.calls[0][0].preSend
    await expect(preSend()).resolves.toBe(true)
    expect(sourceStillUnanswered).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      channelConfigId: "channel-1",
      chatwootConversationId: "cw-pending",
      chatwootInboxId: "inbox-1",
      inboundProviderMessageIds: ["103"],
    }))
    expect(businessOpen).not.toHaveBeenCalled()
  })

  it("blocks a pending Chatwoot recovery when a later source reply exists and uses the exact config when sending", async () => {
    const db = dbFixture()
    db.socialConversation.findMany.mockResolvedValue([{
      id: "conv-pending",
      channelConfigId: "channel-1",
      platform: "tiktok",
      externalId: "cw-pending",
      contactId: "contact-1",
      contactName: "Pending",
      tags: [],
      aiReplyPendingMessageId: "msg-pending",
      lastMessageAt: new Date("2026-07-28T08:00:03.000Z"),
      messages: [{
        id: "msg-pending", direction: "inbound", body: "Sual", status: "delivered",
        createdAt: new Date("2026-07-28T08:00:03.000Z"),
        metadata: { chatwootInboxId: "inbox-1", chatwootProviderMessageId: "103" },
      }],
    }])
    sourceStillUnanswered.mockResolvedValueOnce(false)
    const reply = vi.fn(async (input) => {
      if (input.preSend && !await input.preSend()) {
        return { replied: false, escalated: false, skipped: "source_reply_detected" }
      }
      await input.send("Cavab")
      return { replied: true, escalated: false }
    })

    const result = await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"),
      businessOpen: vi.fn().mockResolvedValue(true),
      reply,
    })

    expect(sendChannelReply).not.toHaveBeenCalled()
    expect(result.skipped).toEqual({ source_reply_detected: 1 })

    sourceStillUnanswered.mockResolvedValueOnce(true)
    await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"),
      businessOpen: vi.fn().mockResolvedValue(true),
      reply,
    })
    expect(sendChannelReply).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      channelType: "tiktok",
      to: "cw-pending",
      channelConfigId: "channel-1",
    }))
  })

  it("fails closed and clears a stale pre-send attempt instead of rescanning it forever", async () => {
    const db = dbFixture()
    db.socialConversation.findMany.mockResolvedValue([{
      id: "conv-stale-send",
      channelConfigId: "channel-1",
      platform: "tiktok",
      externalId: "cw-stale",
      contactId: null,
      contactName: "Stale",
      tags: [],
      aiReplyPendingMessageId: "msg-4",
      lastMessageAt: new Date("2026-07-28T09:50:00.000Z"),
      messages: [
        {
          id: "attempt-4", direction: "outbound", body: "Cavab", status: "pending",
          createdAt: new Date("2026-07-28T09:55:00.000Z"),
          metadata: {
            aiAutoReply: true,
            deliveryAttempted: true,
            inReplyToInboundIds: ["msg-4"],
          },
        },
        {
          id: "msg-4", direction: "inbound", body: "Sual", status: "delivered",
          createdAt: new Date("2026-07-28T09:50:00.000Z"), metadata: {},
        },
      ],
    }])
    const reply = vi.fn()

    const result = await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"),
      businessOpen: vi.fn().mockResolvedValue(true),
      reply,
    })

    expect(reply).not.toHaveBeenCalled()
    expect(db.channelMessage.update).toHaveBeenCalledWith({
      where: { id: "attempt-4" },
      data: expect.objectContaining({
        status: "failed",
        metadata: expect.objectContaining({
          deliveryUnknown: true,
          recoveryReason: "stale_send_attempt",
        }),
      }),
    })
    expect(db.socialConversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "conv-stale-send",
        organizationId: "org-1",
        aiReplyPendingMessageId: { not: null },
      },
      data: { aiReplyPendingMessageId: null },
    })
    expect(result.skipped).toEqual({ "delivery-unknown": 1 })
  })

  it("does nothing when the tenant master AI feature is off", async () => {
    const db = dbFixture()
    db.organization.findMany.mockResolvedValue([{ id: "org-1", features: [] }])
    const reply = vi.fn()

    const result = await runAutonomousInboxAgent(db as never, {
      now: new Date("2026-07-28T10:00:00.000Z"),
      businessOpen: vi.fn().mockResolvedValue(true),
      reply,
    })

    expect(reply).not.toHaveBeenCalled()
    expect(result.organizations).toBe(0)
    expect(result.skipped).toEqual({ "feature-off": 1 })
  })
})
