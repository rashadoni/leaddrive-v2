import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  transaction: vi.fn(), execute: vi.fn(), tenant: vi.fn(), bypass: vi.fn(),
  findConnection: vi.fn(), uniqueConnection: vi.fn(), updateConnection: vi.fn(), upsertConnection: vi.fn(),
  findConfig: vi.fn(), createConfig: vi.fn(), updateConfig: vi.fn(),
  findMessage: vi.fn(), updateMessage: vi.fn(), updateConversation: vi.fn(),
  refresh: vi.fn(), grant: vi.fn(), accountAccess: vi.fn(), send: vi.fn(), revoke: vi.fn(), subscribe: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: m.transaction,
    channelConnection: { updateMany: m.updateConnection },
  },
}))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: m.tenant, runWithRlsBypass: m.bypass }))
vi.mock("./api", async importOriginal => ({
  ...await importOriginal<typeof import("./api")>(),
  refreshMessagingToken: m.refresh,
  verifyMessagingGrant: m.grant,
  verifyMessagingAccountAccess: m.accountAccess,
  sendMessagingText: m.send,
  revokeMessagingToken: m.revoke,
  subscribeMessagingWebhook: m.subscribe,
}))

import { decryptToken, encryptToken } from "@/lib/secure-token"
import { TikTokMessagingError, type MessagingTokens } from "./api"
import { TIKTOK_MESSAGING_SCOPES } from "./config"
import { disconnectMessaging, dispatchMessagingText, messagingAccess, saveMessagingConnection } from "./store"

const NOW = Date.UTC(2026, 9, 19, 12)
const PURPOSE = "oauth:tiktok-messaging:org1"
const tx = {
  $executeRaw: m.execute,
  channelConnection: { findFirst: m.findConnection, findUnique: m.uniqueConnection, updateMany: m.updateConnection, upsert: m.upsertConnection },
  channelConfig: { findFirst: m.findConfig, create: m.createConfig, updateMany: m.updateConfig },
  channelMessage: { findFirst: m.findMessage, updateMany: m.updateMessage },
  socialConversation: { updateMany: m.updateConversation },
}

type Connection = {
  id: string; organizationId: string; channelConfigId: string | null; status: string
  accessToken: string | null; refreshToken: string | null; secretRef: string | null
  tokenExpiresAt: Date | null; settings: Record<string, unknown>; capabilities: Record<string, boolean>
  lastError?: string | null
}
type Fixture = {
  connection: Connection
  config: { id: string; organizationId: string; channelType: string; isActive: boolean }
  message: { id: string; organizationId: string; channelConfigId: string; conversationId: string; status: string; body: string; metadata: Record<string, unknown>; externalId?: string }
}
let committed: Fixture
let working: Fixture | null
let events: string[]
let claimedByOtherOrganization: boolean

const rows = () => working ?? committed
const freshTokens = (): MessagingTokens => ({
  accessToken: "fixture-rotated-access", refreshToken: "fixture-rotated-refresh", openId: "business1",
  expiresIn: 3600, refreshExpiresIn: 90_000, scopes: [...TIKTOK_MESSAGING_SCOPES],
})
const dispatch = () => dispatchMessagingText("org1", "conn1", "business1", "config1", "thread1", "Hello", "attempt1")

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(Date, "now").mockReturnValue(NOW)
  vi.stubEnv("NEXTAUTH_SECRET", "native-tiktok-store-test-master-secret-only")
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_ID", "app1")
  vi.stubEnv("TIKTOK_MESSAGING_CLIENT_SECRET", "fixture-app-secret")
  vi.stubEnv("TIKTOK_MESSAGING_AUTHORIZATION_URL", "https://www.tiktok.com/auth/authorize/")
  vi.stubEnv("TIKTOK_MESSAGING_REDIRECT_URI", "https://crm.example/api/v1/channels/tiktok-messaging/oauth/callback/")
  committed = {
    connection: {
      id: "conn1", organizationId: "org1", channelConfigId: "config1", status: "connected",
      accessToken: encryptToken("fixture-old-access", PURPOSE), refreshToken: encryptToken("fixture-old-refresh", PURPOSE),
      secretRef: null, tokenExpiresAt: new Date(NOW + 3_600_000),
      settings: { appId: "app1", openId: "business1", grantVerified: true, webhookSubscribed: true, refreshExpiresAt: new Date(NOW + 172_800_000).toISOString() },
      capabilities: { read: true, reply: true, webhook: true, importLead: false },
    },
    config: { id: "config1", organizationId: "org1", channelType: "tiktok_messaging", isActive: true },
    message: {
      id: "attempt1", organizationId: "org1", channelConfigId: "config1", conversationId: "conv1", status: "pending", body: "Hello",
      metadata: { provider: "tiktok_messaging", connectionId: "conn1", businessId: "business1", providerConversationId: "thread1" },
    },
  }
  working = null
  events = []
  claimedByOtherOrganization = false
  m.tenant.mockImplementation((_org: string, work: () => unknown) => work())
  m.bypass.mockImplementation((work: () => unknown) => work())
  // A deliberate commit/rollback model: an update observed inside the callback
  // is not durable until the callback resolves. This catches refresh-token loss
  // when validation errors accidentally escape from the transaction.
  m.transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => {
    expect(working).toBeNull()
    working = structuredClone(committed)
    events.push("begin")
    try {
      const result = await work(tx)
      committed = working!
      events.push("commit")
      return result
    } catch (error) {
      events.push("rollback")
      throw error
    } finally {
      working = null
    }
  })
  m.execute.mockImplementation(async (_sql: TemplateStringsArray, key: string) => {
    expect(working).not.toBeNull()
    events.push(`lock:${key}`)
    return 1
  })
  m.findConnection.mockImplementation(async ({ where }) => {
    if (typeof where.organizationId === "object") return claimedByOtherOrganization ? { id: "other-tenant-connection" } : null
    const connection = rows().connection
    return connection.organizationId === where.organizationId && connection.id === where.id && connection.status === where.status
      ? structuredClone(connection) : null
  })
  m.uniqueConnection.mockImplementation(async ({ where }) => rows().connection.organizationId === where.organizationId_platform_surface_provider.organizationId
    ? structuredClone(rows().connection) : null)
  m.updateConnection.mockImplementation(async ({ where, data }) => {
    const connection = rows().connection
    if (connection.id !== where.id || connection.organizationId !== where.organizationId) return { count: 0 }
    Object.assign(connection, structuredClone(data))
    events.push("connection-written")
    return { count: 1 }
  })
  m.upsertConnection.mockImplementation(async ({ update }) => {
    Object.assign(rows().connection, structuredClone(update))
    return structuredClone(rows().connection)
  })
  m.findConfig.mockImplementation(async ({ where }) => {
    const config = rows().config
    return config.id === where.id && config.organizationId === where.organizationId && config.channelType === where.channelType && config.isActive === where.isActive
      ? { id: config.id } : null
  })
  m.createConfig.mockResolvedValue({ id: "new-config" })
  m.updateConfig.mockImplementation(async ({ where, data }) => {
    const config = rows().config
    if (config.id !== where.id || config.organizationId !== where.organizationId) return { count: 0 }
    Object.assign(config, data)
    return { count: 1 }
  })
  m.findMessage.mockImplementation(async ({ where }) => {
    const message = rows().message
    return message.id === where.id && message.organizationId === where.organizationId && message.channelConfigId === where.channelConfigId && message.status === where.status
      ? structuredClone(message) : null
  })
  m.updateMessage.mockImplementation(async ({ where, data }) => {
    const message = rows().message
    if (message.id !== where.id || message.organizationId !== where.organizationId || message.status !== where.status) return { count: 0 }
    Object.assign(message, structuredClone(data))
    events.push("message-written")
    return { count: 1 }
  })
  m.updateConversation.mockResolvedValue({ count: 1 })
  m.refresh.mockResolvedValue(freshTokens())
  m.grant.mockResolvedValue([...TIKTOK_MESSAGING_SCOPES])
  m.accountAccess.mockResolvedValue(undefined)
  m.send.mockResolvedValue("provider-message1")
  m.revoke.mockImplementation(async () => { events.push("revoke"); return undefined })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("native TikTok connection storage", () => {
  it("persists both rotated tokens encrypted for the owning tenant and uses provider expiries", async () => {
    committed.connection.tokenExpiresAt = new Date(NOW - 1)
    expect(await messagingAccess("org1", "conn1")).toEqual({ accessToken: "fixture-rotated-access", openId: "business1", channelConfigId: "config1" })
    expect(m.refresh).toHaveBeenCalledWith("fixture-old-refresh")
    expect(m.grant).toHaveBeenCalledWith("fixture-rotated-access", "business1")
    expect(m.accountAccess).toHaveBeenCalledWith("fixture-rotated-access", "business1")
    expect(committed.connection.accessToken).toMatch(/^v1:/)
    expect(committed.connection.refreshToken).toMatch(/^v1:/)
    expect(decryptToken(committed.connection.accessToken!, PURPOSE)).toBe("fixture-rotated-access")
    expect(decryptToken(committed.connection.refreshToken!, PURPOSE)).toBe("fixture-rotated-refresh")
    expect(() => decryptToken(committed.connection.accessToken!, "oauth:tiktok-messaging:org2")).toThrow()
    expect(JSON.stringify(committed)).not.toContain("fixture-rotated-access")
    expect(JSON.stringify(committed)).not.toContain("fixture-rotated-refresh")
    expect(committed.connection.tokenExpiresAt?.getTime()).toBe(NOW + 3_600_000)
    expect(committed.connection.settings).toMatchObject({ grantVerified: true, refreshExpiresAt: new Date(NOW + 90_000_000).toISOString() })
    expect(events.at(-1)).toBe("commit")
  })

  it("commits a rotation when grant verification fails, then retries verification with the saved tokens", async () => {
    committed.connection.tokenExpiresAt = new Date(NOW - 1)
    m.grant.mockRejectedValueOnce(new TikTokMessagingError("tiktok_rate_limited"))
    await expect(messagingAccess("org1", "conn1")).rejects.toMatchObject({ reason: "tiktok_rate_limited", deliveryUnknown: false })
    expect(events.at(-1)).toBe("commit")
    expect(events).not.toContain("rollback")
    expect(decryptToken(committed.connection.refreshToken!, PURPOSE)).toBe("fixture-rotated-refresh")
    expect(committed.connection.settings.grantVerified).toBe(false)
    expect(committed.connection.lastError).toBe("tiktok_rate_limited")
    expect(m.send).not.toHaveBeenCalled()

    await expect(messagingAccess("org1", "conn1")).resolves.toMatchObject({ accessToken: "fixture-rotated-access" })
    expect(m.refresh).toHaveBeenCalledTimes(1)
    expect(m.grant).toHaveBeenNthCalledWith(2, "fixture-rotated-access", "business1")
    expect(committed.connection.settings.grantVerified).toBe(true)
    expect(committed.connection.lastError).toBeNull()
  })

  it("keeps rotated credentials but blocks dispatch if advanced-account access verification fails", async () => {
    committed.connection.tokenExpiresAt = new Date(NOW - 1)
    m.accountAccess.mockRejectedValueOnce(new TikTokMessagingError("tiktok_advanced_access_required"))
    await expect(dispatch()).rejects.toMatchObject({ reason: "tiktok_advanced_access_required", deliveryUnknown: false })
    expect(events.at(-1)).toBe("commit")
    expect(decryptToken(committed.connection.refreshToken!, PURPOSE)).toBe("fixture-rotated-refresh")
    expect(committed.connection.settings.grantVerified).toBe(false)
    expect(committed.message.status).toBe("pending")
    expect(m.send).not.toHaveBeenCalled()
  })

  it("rejects a superseded OAuth fingerprint without replacing the existing connection", async () => {
    committed.connection.secretRef = "consumed:newer-attempt"
    const before = structuredClone(committed)
    await expect(saveMessagingConnection("org1", "user1", freshTokens(), [...TIKTOK_MESSAGING_SCOPES], true, "older-attempt"))
      .rejects.toMatchObject({ reason: "tiktok_authorization_superseded" })
    expect(committed).toEqual(before)
    expect(m.upsertConnection).not.toHaveBeenCalled()
    expect(m.createConfig).not.toHaveBeenCalled()
    expect(m.updateConfig).not.toHaveBeenCalled()
    expect(events.at(-1)).toBe("rollback")
  })

  it("rejects an account already owned by another organization before writing any local credentials", async () => {
    claimedByOtherOrganization = true
    committed.connection.secretRef = "consumed:attempt"
    const before = structuredClone(committed)
    await expect(saveMessagingConnection("org1", "user1", freshTokens(), [...TIKTOK_MESSAGING_SCOPES], true, "attempt"))
      .rejects.toMatchObject({ reason: "tiktok_account_already_connected" })
    expect(m.bypass).toHaveBeenCalledTimes(1)
    expect(m.findConnection).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      organizationId: { not: "org1" },
      AND: [{ settings: { path: ["appId"], equals: "app1" } }, { settings: { path: ["openId"], equals: "business1" } }],
    }) }))
    expect(committed).toEqual(before)
    expect(m.upsertConnection).not.toHaveBeenCalled()
    expect(m.updateConnection).not.toHaveBeenCalled()
    expect(m.createConfig).not.toHaveBeenCalled()
  })

  it.each([true, false])("clears both local tokens and disables delivery when provider revocation succeeds=%s", async revoked => {
    committed.connection.secretRef = "consumed:outstanding-attempt"
    if (!revoked) m.revoke.mockRejectedValueOnce(new TikTokMessagingError("tiktok_request_failed"))
    expect(await disconnectMessaging("org1")).toBe(revoked)
    expect(m.revoke).toHaveBeenCalledWith("fixture-old-access")
    expect(committed.connection).toMatchObject({ status: "disabled", accessToken: null, refreshToken: null, secretRef: null, tokenExpiresAt: null,
      capabilities: { read: false, reply: false, webhook: false, importLead: false }, settings: { webhookSubscribed: false } })
    expect(committed.config.isActive).toBe(false)
    await expect(dispatch()).rejects.toMatchObject({ reason: "tiktok_not_connected" })
    expect(m.send).not.toHaveBeenCalled()
  })
})

describe("native TikTok dispatch lease", () => {
  it("does not send an attempt that was reconciled while waiting for the dispatch lock", async () => {
    committed.message.status = "failed"
    committed.message.metadata.deliveryReconciliation = { outcome: "not_delivered" }
    await expect(dispatch()).rejects.toMatchObject({ reason: "tiktok_attempt_no_longer_pending", deliveryUnknown: false })
    expect(m.findMessage).toHaveBeenCalledWith({ where: {
      id: "attempt1", organizationId: "org1", channelConfigId: "config1", direction: "outbound", channelType: "tiktok", status: "pending",
    } })
    expect(m.send).not.toHaveBeenCalled()
    expect(m.updateMessage).not.toHaveBeenCalled()
    expect(committed.message.status).toBe("failed")
  })

  it("holds the shared organization lock through provider dispatch and durable success, before disconnect proceeds", async () => {
    const enteredSend = deferred<void>()
    const finishSend = deferred<string>()
    m.send.mockImplementation(async () => {
      expect(working).not.toBeNull()
      expect(events).toContain("lock:tiktok-messaging-connection:org1")
      expect(committed.message.status).toBe("pending")
      events.push("send-start")
      enteredSend.resolve(undefined)
      const providerId = await finishSend.promise
      expect(working).not.toBeNull()
      expect(m.revoke).not.toHaveBeenCalled()
      events.push("send-finished")
      return providerId
    })
    const sending = dispatch()
    await Promise.race([
      enteredSend.promise,
      sending.then(() => { throw new Error("Dispatch returned before entering the provider call") }),
    ])
    const disconnecting = disconnectMessaging("org1")
    try {
      await Promise.resolve()
      expect(m.transaction).toHaveBeenCalledTimes(1)
      expect(m.revoke).not.toHaveBeenCalled()
      expect(committed.message.status).toBe("pending")
    } finally {
      finishSend.resolve("provider-message1")
      await Promise.allSettled([sending, disconnecting])
    }
    expect(await sending).toBe("provider-message1")
    expect(await disconnecting).toBe(true)
    expect(committed.message).toMatchObject({ status: "sent", externalId: "tiktok-messaging:business1:provider-message1",
      metadata: { providerMessageId: "provider-message1", deliveryUnknown: false } })
    expect(committed.connection.status).toBe("disabled")
    expect(events.indexOf("send-finished")).toBeLessThan(events.indexOf("message-written"))
    expect(events.indexOf("message-written")).toBeLessThan(events.indexOf("commit"))
    expect(events.indexOf("commit")).toBeLessThan(events.indexOf("revoke"))
    expect(events.filter(event => event === "lock:tiktok-messaging-connection:org1")).toHaveLength(2)
    expect(m.send).toHaveBeenCalledTimes(1)
  })

  it("reports an uncertain outcome if provider accepted the send but the durable pending claim is lost", async () => {
    m.updateMessage.mockResolvedValueOnce({ count: 0 })
    await expect(dispatch()).rejects.toMatchObject({ reason: "tiktok_send_result_unknown", deliveryUnknown: true })
    expect(m.send).toHaveBeenCalledTimes(1)
    expect(m.updateConversation).not.toHaveBeenCalled()
    expect(committed.message.status).toBe("pending")
  })
})
