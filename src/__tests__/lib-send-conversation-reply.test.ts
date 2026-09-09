import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  findAttempt: vi.fn(),
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  finalizeMessage: vi.fn(),
  updateConversation: vi.fn(),
  findConversation: vi.fn(),
  sendChatwoot: vi.fn(),
}))

const tx = {
  $executeRaw: mocks.executeRaw,
  channelMessage: {
    findFirst: mocks.findAttempt,
    create: mocks.createMessage,
    updateMany: mocks.finalizeMessage,
  },
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    channelMessage: {
      findFirst: mocks.findAttempt,
      create: mocks.createMessage,
      update: mocks.updateMessage,
    },
    socialConversation: {
      findFirst: mocks.findConversation,
      updateMany: mocks.updateConversation,
    },
    contact: { updateMany: vi.fn() },
    channelConfig: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/chatwoot", () => ({ sendChatwootMessage: mocks.sendChatwoot }))
vi.mock("@/lib/channels/platform-connections", () => ({
  resolveChannelConnection: vi.fn(async () => ({ available: true })),
}))
vi.mock("@/lib/channels/reply-routing", () => ({
  resolveReplyRoute: vi.fn(() => ({ available: true })),
}))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), sendWhatsAppMedia: vi.fn() }))
vi.mock("@/lib/telegram", () => ({ resolveTelegramSendTarget: vi.fn(), sendTelegramText: vi.fn() }))
vi.mock("@/lib/telegram-media", () => ({ sendTelegramMedia: vi.fn() }))
vi.mock("@/lib/facebook", () => ({ sendFacebookMessage: vi.fn(), sendInstagramMessage: vi.fn() }))
vi.mock("@/lib/vkontakte", () => ({ sendVkMessage: vi.fn() }))
vi.mock("@/lib/inbox-ensure-conversation", () => ({ ensureConversation: vi.fn() }))
vi.mock("@/lib/inbox-attachment", () => ({ isImageMime: vi.fn(() => false) }))

import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"

const MANUAL_KEY = "11111111-1111-4111-8111-111111111111"
const CHATBOT_KEY_1 = "a".repeat(64)
const CHATBOT_KEY_2 = "b".repeat(64)
const NOW = 1_000_000_000
const send = (overrides: Partial<Parameters<typeof sendConversationReply>[0]> = {}) => sendConversationReply({
  organizationId: "org-1",
  channel: "tiktok",
  to: "cw-42",
  body: "hello",
  conversationId: "conv-1",
  channelConfigId: "cfg-1",
  deliveryIdempotency: { source: "manual", key: MANUAL_KEY },
  ...overrides,
})
const sendKeyword = (
  inboundMessageId: string,
  key: string,
  overrides: Partial<Parameters<typeof sendConversationReply>[0]> = {},
) => send({
  deliveryIdempotency: { source: "chatbot", key },
  extraMetadata: {
    autoReply: true,
    keywordAutoReply: true,
    chatbotRuleId: "rule-1",
    chatbotInboundMessageId: inboundMessageId,
  },
  chatwootAutoReplyClaim: {
    inboundMessageId,
    cooldownMs: 300_000,
    nowMs: NOW,
  },
  ...overrides,
})

type LedgerRow = {
  id: string
  status: string
  metadata: Record<string, unknown>
  createdAt: Date
  [key: string]: unknown
}

function installInMemoryLedger(): LedgerRow[] {
  const rows: LedgerRow[] = []
  let transactionTail = Promise.resolve()

  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const previous = transactionTail
    let unlock = () => {}
    transactionTail = new Promise<void>((resolve) => { unlock = resolve })
    await previous
    try {
      return await callback(tx)
    } finally {
      unlock()
    }
  })
  mocks.findAttempt.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (typeof where.id === "string" && where.direction === "inbound") {
      return { id: where.id }
    }
    const metadata = where.metadata as { path?: string[]; equals?: unknown } | undefined
    if (metadata?.path?.[0] === "deliveryIdempotencyKey") {
      return rows.find((row) => row.metadata.deliveryIdempotencyKey === metadata.equals) ?? null
    }
    if (Array.isArray(where.OR)) {
      return rows.find((row) => row.status === "pending" || row.metadata.deliveryUnknown === true) ?? null
    }
    if (metadata?.path?.[0] === "autoReply") {
      const createdAt = where.createdAt as { gte?: Date } | undefined
      const statuses = (where.status as { in?: string[] } | undefined)?.in ?? []
      return rows.find((row) => (
        row.metadata.autoReply === true
        && statuses.includes(row.status)
        && (!createdAt?.gte || row.createdAt >= createdAt.gte)
      )) ?? null
    }
    return null
  })
  mocks.createMessage.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row: LedgerRow = {
      id: `attempt-${rows.length + 1}`,
      ...data,
      status: String(data.status),
      metadata: data.metadata as Record<string, unknown>,
      createdAt: new Date(NOW),
    }
    rows.push(row)
    return { id: row.id, status: row.status }
  })
  mocks.finalizeMessage.mockImplementation(async ({ where, data }: {
    where: { id: string }
    data: { status: string; metadata: Record<string, unknown> }
  }) => {
    const row = rows.find((candidate) => candidate.id === where.id)
    if (!row) throw new Error("missing attempt")
    row.status = data.status
    row.metadata = data.metadata
    return { count: 1 }
  })
  return rows
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeRaw.mockResolvedValue(1)
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  mocks.findAttempt.mockResolvedValue(null)
  mocks.createMessage.mockResolvedValue({ id: "attempt-1", status: "pending" })
  mocks.updateMessage.mockImplementation(async ({ data }: { data: { status: string } }) => ({
    id: "attempt-1",
    status: data.status,
  }))
  mocks.finalizeMessage.mockResolvedValue({ count: 1 })
  mocks.updateConversation.mockResolvedValue({ count: 1 })
  mocks.findConversation.mockResolvedValue({ externalId: "cw-42" })
  mocks.sendChatwoot.mockResolvedValue({ success: true })
})

describe("sendConversationReply Chatwoot delivery ledger", () => {
  it("rejects a recipient that is not bound to the tenant-local conversation before claiming a ledger row", async () => {
    const result = await send({ to: "cw-from-another-conversation" })

    expect(result).toEqual({
      success: false,
      statusCode: 400,
      error: "Chatwoot conversation binding mismatch.",
    })
    expect(mocks.findConversation).toHaveBeenCalledWith({
      where: {
        id: "conv-1",
        organizationId: "org-1",
        platform: "tiktok",
        deletedAt: null,
      },
      select: { externalId: true },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.sendChatwoot).not.toHaveBeenCalled()
  })

  it("commits the advisory-lock transaction before the external POST", async () => {
    let transactionActive = false
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      transactionActive = true
      try {
        return await callback(tx)
      } finally {
        transactionActive = false
      }
    })
    mocks.sendChatwoot.mockImplementation(async () => {
      expect(transactionActive).toBe(false)
      return { success: true }
    })

    const result = await send()

    expect(result).toMatchObject({ success: true, statusCode: 201 })
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2)
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "pending",
        conversationId: "conv-1",
        metadata: expect.objectContaining({
          deliveryAttempted: true,
          deliveryIdempotencyKey: `manual:${MANUAL_KEY}`,
          deliveryPayloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
      select: { id: true, status: true },
    }))
    expect(mocks.createMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendChatwoot.mock.invocationCallOrder[0],
    )
  })

  it("posts on the conversation's own Chatwoot config", async () => {
    // Without the id, sendChatwootMessage resolves "any active chatwoot config
    // for this org". This pipeline is the shared outbound path — a manual reply,
    // a keyword auto-reply and a flow action all land here — so an org with two
    // active Chatwoot accounts answered from whichever one the sender's
    // unordered `findFirst` returned. See lib-chatwoot-send CWL-9.
    const result = await send({ channelConfigId: "cfg_b" })

    expect(result).toMatchObject({ success: true })
    expect(mocks.sendChatwoot).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "cw-42",
      organizationId: "org-1",
      channelConfigId: "cfg_b",
    }))
  })

  it("allows two concurrent same-key calls to create one claim and POST exactly once", async () => {
    installInMemoryLedger()

    const [first, second] = await Promise.all([send(), send()])

    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
    expect(mocks.createMessage).toHaveBeenCalledTimes(1)
    expect(first.success || second.success).toBe(true)
    const blocked = [first, second].find((result) => !result.success)
    if (blocked) {
      expect(blocked).toMatchObject({ success: false, statusCode: 409, deliveryUnknown: true })
    } else {
      expect([first, second]).toContainEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ replayed: true }),
      }))
    }
  })

  it("allows only one parallel keyword send for distinct inbound Chatwoot message IDs", async () => {
    installInMemoryLedger()
    let releaseSend: ((value: { success: true }) => void) | undefined
    mocks.sendChatwoot.mockImplementationOnce(() => new Promise((resolve) => {
      releaseSend = resolve
    }))

    const firstPromise = sendKeyword("inbound-chatwoot-1", CHATBOT_KEY_1)
    await vi.waitFor(() => expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1))

    const second = await sendKeyword("inbound-chatwoot-2", CHATBOT_KEY_2)

    expect(second).toMatchObject({
      success: false,
      statusCode: 409,
      deliveryUnknown: true,
      attemptId: "attempt-1",
    })
    expect(mocks.createMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)

    if (!releaseSend) throw new Error("Chatwoot send did not start")
    releaseSend({ success: true })
    await expect(firstPromise).resolves.toMatchObject({ success: true })
  })

  it("checks the confirmed auto-reply cooldown under the claim lock", async () => {
    const rows = installInMemoryLedger()

    const first = await sendKeyword("inbound-chatwoot-1", CHATBOT_KEY_1)
    const second = await sendKeyword("inbound-chatwoot-2", CHATBOT_KEY_2)

    expect(first).toMatchObject({ success: true })
    expect(second).toMatchObject({
      success: false,
      statusCode: 409,
      autoReplyCooldown: true,
    })
    expect(rows).toHaveLength(1)
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
  })

  it("keeps an unknown keyword attempt durable and blocks a distinct retry", async () => {
    const rows = installInMemoryLedger()
    mocks.sendChatwoot.mockResolvedValueOnce({ success: false, error: "timeout", deliveryUnknown: true })

    const unknown = await sendKeyword("inbound-chatwoot-1", CHATBOT_KEY_1)
    const retry = await sendKeyword("inbound-chatwoot-2", CHATBOT_KEY_2)

    expect(unknown).toMatchObject({
      success: false,
      statusCode: 409,
      deliveryUnknown: true,
      attemptId: "attempt-1",
    })
    expect(retry).toMatchObject({
      success: false,
      statusCode: 409,
      deliveryUnknown: true,
      attemptId: "attempt-1",
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: "failed",
      metadata: expect.objectContaining({ autoReply: true, deliveryUnknown: true }),
    })
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
  })

  it("rejects a keyword claim whose inbound row is outside the tenant conversation", async () => {
    mocks.findAttempt.mockResolvedValueOnce(null)

    const result = await sendKeyword("cross-tenant-inbound", CHATBOT_KEY_1)

    expect(result).toMatchObject({ success: false, statusCode: 409 })
    expect(mocks.findAttempt).toHaveBeenCalledWith({
      where: {
        id: "cross-tenant-inbound",
        organizationId: "org-1",
        conversationId: "conv-1",
        direction: "inbound",
        channelType: "tiktok",
      },
      select: { id: true },
    })
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.sendChatwoot).not.toHaveBeenCalled()
  })

  it("replays the original delivered message id/status without another POST", async () => {
    installInMemoryLedger()

    const first = await send()
    const replay = await send()

    expect(first).toMatchObject({ success: true, data: { id: "attempt-1", status: "delivered" } })
    expect(replay).toMatchObject({
      success: true,
      data: { id: "attempt-1", status: "delivered", replayed: true },
    })
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
    expect(mocks.createMessage).toHaveBeenCalledTimes(1)
  })

  it("rejects same-key payload drift with 409 and no second POST", async () => {
    installInMemoryLedger()
    await send()

    const conflict = await send({ body: "different text" })

    expect(conflict).toMatchObject({ success: false, statusCode: 409 })
    expect(conflict).not.toMatchObject({ deliveryUnknown: true })
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
    expect(mocks.createMessage).toHaveBeenCalledTimes(1)
  })

  it("records an ambiguous response and returns a no-retry conflict", async () => {
    mocks.sendChatwoot.mockResolvedValue({ success: false, error: "timeout", deliveryUnknown: true })

    const result = await send()

    expect(result).toMatchObject({ success: false, statusCode: 409, deliveryUnknown: true, attemptId: "attempt-1" })
    expect(mocks.finalizeMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "failed",
        metadata: expect.objectContaining({ deliveryUnknown: true }),
      },
    }))
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
  })

  it("keeps the pre-send pending marker when final persistence fails", async () => {
    mocks.finalizeMessage.mockRejectedValue(new Error("database unavailable"))

    const result = await send()

    expect(result).toMatchObject({ success: false, statusCode: 409, deliveryUnknown: true })
    expect(mocks.createMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(1)
  })

  it("does not POST while any earlier attempt is unresolved", async () => {
    mocks.findAttempt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "unresolved-1" })

    const result = await send()

    expect(result).toMatchObject({ success: false, statusCode: 409, deliveryUnknown: true })
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.sendChatwoot).not.toHaveBeenCalled()
  })

  it("treats a same-key pending row as unknown even when its payload hash differs", async () => {
    mocks.findAttempt.mockResolvedValueOnce({
      id: "pending-1",
      status: "pending",
      metadata: { deliveryPayloadHash: "different" },
    })

    const result = await send({ body: "new text" })

    expect(result).toMatchObject({ success: false, statusCode: 409, deliveryUnknown: true })
    expect(mocks.createMessage).not.toHaveBeenCalled()
    expect(mocks.sendChatwoot).not.toHaveBeenCalled()
  })

  it("allows a new key only after the prior unknown attempt was explicitly reconciled as not delivered", async () => {
    const rows = installInMemoryLedger()
    mocks.sendChatwoot
      .mockResolvedValueOnce({ success: false, error: "timeout", deliveryUnknown: true })
      .mockResolvedValueOnce({ success: true })

    const unknown = await send()
    expect(unknown).toMatchObject({
      success: false,
      statusCode: 409,
      deliveryUnknown: true,
      attemptId: "attempt-1",
    })
    rows[0].metadata = {
      ...rows[0].metadata,
      deliveryUnknown: false,
      deliveryReconciliation: { outcome: "not_delivered" },
    }

    const retry = await send({
      deliveryIdempotency: { source: "manual", key: "22222222-2222-4222-8222-222222222222" },
    })

    expect(retry).toMatchObject({ success: true, data: { id: "attempt-2", status: "delivered" } })
    expect(mocks.createMessage).toHaveBeenCalledTimes(2)
    expect(mocks.sendChatwoot).toHaveBeenCalledTimes(2)
  })

  it("rejects an unbounded or missing manual key before any DB/network side effect", async () => {
    const result = await send({ deliveryIdempotency: { source: "manual", key: "attacker-controlled" } })

    expect(result).toMatchObject({ success: false, statusCode: 400 })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.sendChatwoot).not.toHaveBeenCalled()
  })

  it("rejects an unknown runtime source even when its key looks server-generated", async () => {
    const result = await send({
      deliveryIdempotency: { source: "forged", key: "a".repeat(64) } as never,
    })

    expect(result).toMatchObject({ success: false, statusCode: 400 })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.sendChatwoot).not.toHaveBeenCalled()
  })
})
