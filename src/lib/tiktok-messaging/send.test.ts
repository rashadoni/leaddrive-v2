import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  conversation: vi.fn(), connection: vi.fn(), findMessage: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), updateConversation: vi.fn(),
  access: vi.fn(), send: vi.fn(), execute: vi.fn(), tenant: vi.fn(),
}))
vi.mock("@/lib/prisma", () => {
  const tx = { $executeRaw: mocks.execute, socialConversation: { findFirst: mocks.conversation, updateMany: mocks.updateConversation },
    channelConnection: { findFirst: mocks.connection }, channelMessage: { findFirst: mocks.findMessage, create: mocks.create, updateMany: mocks.update, count: mocks.count } }
  return { prisma: { ...tx, $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } }
})
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (org: string, fn: () => unknown) => { mocks.tenant(org); return fn() } }))
vi.mock("./store", () => ({ dispatchMessagingText: async (...args: unknown[]) => { await mocks.access(); const id = await mocks.send(); await mocks.update({ where: { id: args[6], status: "pending" }, data: { status: "sent" } }); return id } }))
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), sendMessagingText: mocks.send }))
import { sendNativeMessagingReply } from "./send"
import { TikTokMessagingError } from "./api"
import type { SendConversationReplyOptions } from "@/lib/inbox/send-conversation-reply"

const opts: SendConversationReplyOptions = { organizationId: "org1", channel: "tiktok", to: "tiktok-messaging:business1:thread1",
  body: "Hello", conversationId: "conv1", channelConfigId: "config1", deliveryIdempotency: { source: "manual", key: "b59e9e54-abab-4a65-8272-111111111111" } }
let rows: Array<{ id: string; status: string; metadata: Record<string, unknown>; [key: string]: unknown }>
beforeEach(() => {
  vi.clearAllMocks(); rows = []
  mocks.conversation.mockResolvedValue({ id: "conv1", externalId: opts.to, channelConfigId: "config1", contactId: null,
    metadata: { provider: "tiktok_messaging", connectionId: "conn1", businessId: "business1", providerConversationId: "thread1" } })
  mocks.connection.mockResolvedValue({ id: "conn1", channelConfigId: "config1", settings: { openId: "business1" }, capabilities: { reply: true } })
  mocks.findMessage.mockImplementation(({ where }) => {
    if (where.direction === "inbound") return { createdAt: new Date() }
    if (where.metadata) return rows.find(row => row.metadata.deliveryIdempotencyKey === where.metadata.equals) ?? null
    return rows.find(row => row.status === "pending" || row.metadata.deliveryUnknown) ?? null
  })
  mocks.create.mockImplementation(({ data }) => { const row = { id: `attempt${rows.length}`, ...data }; rows.push(row); return row })
  mocks.update.mockImplementation(({ where, data }) => { const row = rows.find(row => row.id === where.id && row.status === where.status); if (row) Object.assign(row, data); return { count: row ? 1 : 0 } })
  mocks.count.mockResolvedValue(0)
  mocks.access.mockResolvedValue({ accessToken: "fixture-access", openId: "business1", channelConfigId: "config1" })
  mocks.send.mockResolvedValue("provider-message1")
})

describe("native TikTok durable delivery", () => {
  it("records pending before network, replays the same operation without another provider call", async () => {
    mocks.send.mockImplementation(async () => { expect(rows[0].status).toBe("pending"); return "m1" })
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: true, data: { status: "sent" } })
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: true, data: { replayed: true } })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(mocks.tenant).toHaveBeenCalledWith("org1")
    expect(rows[0].metadata).not.toHaveProperty("accessToken")
  })
  it("rejects replaying a key with another payload", async () => {
    await sendNativeMessagingReply(opts)
    expect(await sendNativeMessagingReply({ ...opts, body: "Changed" })).toMatchObject({ success: false, statusCode: 409 })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it("blocks both retry and a new operation after an uncertain network outcome", async () => {
    mocks.send.mockRejectedValueOnce(new TikTokMessagingError("tiktok_request_failed", true))
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: false, deliveryUnknown: true })
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: false, deliveryUnknown: true })
    expect(await sendNativeMessagingReply({ ...opts, deliveryIdempotency: { source: "manual", key: "b59e9e54-abab-4a65-8272-222222222222" } })).toMatchObject({ success: false, deliveryUnknown: true })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it("fails closed for another tenant's conversation or account, without network calls", async () => {
    mocks.conversation.mockResolvedValueOnce(null)
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: false, statusCode: 400 })
    mocks.connection.mockResolvedValueOnce({ id: "conn1", channelConfigId: "config1", settings: { openId: "another-business" }, capabilities: { reply: true } })
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: false, statusCode: 400 })
    expect(mocks.conversation).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org1", id: "conv1", deletedAt: null }) }))
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("enforces the reply window and conservative per-inbound budget", async () => {
    mocks.findMessage.mockImplementation(({ where }) => where.direction === "inbound" ? { createdAt: new Date(Date.now() - 49 * 3_600_000) } : null)
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: false, statusCode: 400 })
    mocks.findMessage.mockImplementation(({ where }) => where.direction === "inbound" ? { createdAt: new Date() } : null)
    mocks.count.mockResolvedValueOnce(10)
    expect(await sendNativeMessagingReply(opts)).toMatchObject({ success: false, statusCode: 400 })
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it("does not send attachments or reuse legacy automation claims", async () => {
    expect(await sendNativeMessagingReply({ ...opts, attachment: { buffer: Buffer.from("x"), mime: "image/png", filename: "x.png", url: "https://example.test/x.png" } })).toMatchObject({ success: false, statusCode: 400 })
    expect(await sendNativeMessagingReply({ ...opts, chatwootAutoReplyClaim: { inboundMessageId: "x", cooldownMs: 1000 } })).toMatchObject({ success: false, statusCode: 400 })
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
