import { beforeEach, describe, expect, it, vi } from "vitest"
const m = vi.hoisted(() => ({ lookup: vi.fn(), connection: vi.fn(), config: vi.fn(), find: vi.fn(), create: vi.fn(), upsert: vi.fn(), updateConversation: vi.fn(), updateConnection: vi.fn(), tenant: vi.fn() }))
vi.mock("@/lib/prisma", () => {
  const tx = { $executeRaw: vi.fn(), channelConnection: { findMany: m.lookup, findFirst: m.connection, updateMany: m.updateConnection },
    channelConfig: { findFirst: m.config }, channelMessage: { findFirst: m.find, create: m.create }, socialConversation: { upsert: m.upsert, updateMany: m.updateConversation } }
  return { prisma: { ...tx, $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) } }
})
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => fn(), runWithTenant: (org: string, fn: () => unknown) => { m.tenant(org); return fn() } }))
import { ingestMessagingInbound } from "./ingest"
const event = { businessId: "b1", conversationId: "c1", messageId: "m1", senderId: "p1", senderName: "Customer", body: "Hello", messageType: "text", timestamp: Date.now() }
beforeEach(() => {
  vi.clearAllMocks()
  m.lookup.mockResolvedValue([{ id: "conn1", organizationId: "org1" }])
  m.connection.mockResolvedValue({ channelConfigId: "config1", settings: { appId: "app1", openId: "b1" }, capabilities: { read: true } })
  m.config.mockResolvedValue({ id: "config1" }); m.find.mockResolvedValue(null); m.upsert.mockResolvedValue({ id: "conv1" })
})
describe("native inbound tenant isolation", () => {
  it("uses the verified account binding, tenant context, and account-qualified external IDs", async () => {
    expect(await ingestMessagingInbound(event, "app1")).toBe("stored")
    expect(m.tenant).toHaveBeenCalledWith("org1")
    expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: "org1", externalId: "tiktok-messaging:b1:m1", conversationId: "conv1", metadata: expect.objectContaining({ provider: "tiktok_messaging" }) }) })
  })
  it("acknowledges duplicates without incrementing unread counts", async () => {
    m.find.mockResolvedValue({ id: "existing" })
    expect(await ingestMessagingInbound(event, "app1")).toBe("duplicate")
    expect(m.create).not.toHaveBeenCalled(); expect(m.updateConversation).not.toHaveBeenCalled()
  })
  it("ignores ambiguous ownership, disconnected accounts, and inactive configs", async () => {
    m.lookup.mockResolvedValueOnce([{ id: "c1", organizationId: "org1" }, { id: "c2", organizationId: "org2" }])
    expect(await ingestMessagingInbound(event, "app1")).toBe("ignored")
    m.connection.mockResolvedValueOnce(null)
    expect(await ingestMessagingInbound(event, "app1")).toBe("ignored")
    m.config.mockResolvedValueOnce(null)
    expect(await ingestMessagingInbound(event, "app1")).toBe("ignored")
    expect(m.create).not.toHaveBeenCalled()
  })
})
