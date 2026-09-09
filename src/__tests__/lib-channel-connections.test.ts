import { beforeEach, describe, expect, it, vi } from "vitest"

const db = {
  connections: [] as Array<Record<string, unknown>>,
  channelConfigs: [] as Array<Record<string, unknown>>,
  lastMessage: null as { createdAt: Date } | null,
  upserts: [] as Array<Record<string, unknown>>,
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConnection: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.connections.filter((row) => row.organizationId === where.organizationId && row.platform === where.platform),
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.connections.find((row) =>
          row.organizationId === where.organizationId
          && row.platform === where.platform
          && row.surface === where.surface
          && row.provider === where.provider,
        ) || null,
      ),
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.upserts.push(args)
        return args
      }),
    },
    channelConfig: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.channelConfigs.find((row) => row.organizationId === where.organizationId && row.channelType === where.channelType) || null,
      ),
    },
    channelMessage: {
      findFirst: vi.fn(async () => db.lastMessage),
    },
  },
}))

describe("channel platform connections", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.connections = []
    db.channelConfigs = []
    db.lastMessage = null
    db.upserts = []
  })

  it("maps legacy TikTok Chatwoot config to tiktok/dm/chatwoot", async () => {
    db.channelConfigs = [{
      id: "cfg_cw",
      organizationId: "org_1",
      channelType: "chatwoot",
      configName: "TikTok via Chatwoot",
      isActive: true,
      apiKey: "token",
      settings: { provider: "tiktok", baseUrl: "https://app.chatwoot.com", accountId: 171064, webhookSecret: "secret" },
    }]
    db.lastMessage = { createdAt: new Date("2026-06-30T10:00:00Z") }

    const { listPlatformConnections, connectionCan } = await import("@/lib/channels/platform-connections")
    const rows = await listPlatformConnections({ organizationId: "org_1", platform: "tiktok" })
    const dm = rows.find((row) => row.surface === "dm" && row.provider === "chatwoot")

    expect(dm).toMatchObject({
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
      status: "connected",
      channelConfigId: "cfg_cw",
      settings: expect.objectContaining({ accountId: "171064", webhookSecretConfigured: true, apiKeyConfigured: true }),
    })
    expect(connectionCan(dm, "reply")).toBe(true)
  })

  it("adds needs-access TikTok Organic and Business surfaces when not connected", async () => {
    const { listPlatformConnections, connectionCan } = await import("@/lib/channels/platform-connections")
    const rows = await listPlatformConnections({ organizationId: "org_1", platform: "tiktok" })

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "comment", provider: "tiktok_organic", status: "needs_access" }),
      expect.objectContaining({ surface: "mention", provider: "tiktok_organic", status: "needs_access" }),
      expect.objectContaining({ surface: "lead_ad", provider: "tiktok_business", status: "needs_access" }),
    ]))
    expect(connectionCan(rows.find((row) => row.surface === "comment"), "reply")).toBe(false)
  })

  it("syncs TikTok Chatwoot ChannelConfig into ChannelConnection without changing the legacy provider flag", async () => {
    const { syncTikTokDmConnectionForChannelConfig } = await import("@/lib/channels/platform-connections")

    await syncTikTokDmConnectionForChannelConfig({
      id: "cfg_cw",
      organizationId: "org_1",
      channelType: "chatwoot",
      configName: "TikTok via Chatwoot",
      isActive: true,
      apiKey: "token",
      settings: { provider: "tiktok", platform: "tiktok", surface: "dm", routingProvider: "chatwoot", baseUrl: "https://cw.test", accountId: "171064" },
    })

    expect(db.upserts[0]).toMatchObject({
      where: {
        organizationId_platform_surface_provider: {
          organizationId: "org_1",
          platform: "tiktok",
          surface: "dm",
          provider: "chatwoot",
        },
      },
      create: expect.objectContaining({
        platform: "tiktok",
        surface: "dm",
        provider: "chatwoot",
        status: "connected",
      }),
    })
  })
})
