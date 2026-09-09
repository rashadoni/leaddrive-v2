import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: vi.fn(async () => ({ orgId: "org_1" })),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(),
    },
    channelMessage: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/channels/platform-connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/platform-connections")>()
  return {
    ...actual,
    listPlatformConnections: vi.fn(),
  }
})

import { GET } from "@/app/api/v1/channels/tiktok-hub/route"
import { prisma } from "@/lib/prisma"
import { listPlatformConnections } from "@/lib/channels/platform-connections"

const findConfigs = vi.mocked(prisma.channelConfig.findMany)
const findLastMessage = vi.mocked(prisma.channelMessage.findFirst)
const listConnections = vi.mocked(listPlatformConnections)

function request(path = "/api/v1/channels/tiktok-hub") {
  return new NextRequest(`https://app.leaddrivecrm.org${path}`, {
    headers: { "x-organization-id": "org_1" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  findConfigs.mockResolvedValue([
    {
      id: "cfg_cw",
      configName: "TikTok via Chatwoot",
      isActive: true,
      apiKey: "token",
      settings: {
        provider: "tiktok",
        platform: "tiktok",
        surface: "dm",
        routingProvider: "chatwoot",
        baseUrl: "https://app.chatwoot.com",
        accountId: "171064",
        webhookSecret: "secret123",
      },
      createdAt: new Date("2026-06-30T09:00:00Z"),
      updatedAt: new Date("2026-06-30T09:00:00Z"),
    },
  ] as never)
  findLastMessage.mockResolvedValue({ createdAt: new Date("2026-06-30T10:00:00Z") } as never)
  listConnections.mockResolvedValue([
    {
      id: "cc_dm",
      organizationId: "org_1",
      channelConfigId: "cfg_cw",
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
      displayName: "TikTok via Chatwoot",
      status: "connected",
      capabilities: { read: true, reply: true, webhook: true, importLead: false },
      settings: {
        accountId: "171064",
        webhookSecret: "connection-secret",
        apiKey: "connection-key",
        nested: {
          inboxId: "inbox_1",
          clientSecret: "nested-secret",
        },
      },
    },
    {
      id: "needs_access:tiktok:comment:tiktok_organic",
      organizationId: "org_1",
      platform: "tiktok",
      surface: "comment",
      provider: "tiktok_organic",
      displayName: "TikTok Comments & Mentions",
      status: "needs_access",
      capabilities: { read: false, reply: false, webhook: false, importLead: false },
      settings: {
        requiredAccess: ["TikTok API for Business", "Organic API"],
        webhookSecret: "comment-secret",
        accessToken: "comment-token",
      },
      synthetic: true,
    },
    {
      id: "needs_access:tiktok:mention:tiktok_organic",
      organizationId: "org_1",
      platform: "tiktok",
      surface: "mention",
      provider: "tiktok_organic",
      displayName: "TikTok Mentions",
      status: "needs_access",
      capabilities: { read: false, reply: false, webhook: false, importLead: false },
      settings: {
        requiredAccess: ["TikTok API for Business", "Organic API"],
        verifyToken: "mention-verify-token",
      },
      synthetic: true,
    },
    {
      id: "needs_access:tiktok:lead_ad:tiktok_business",
      organizationId: "org_1",
      platform: "tiktok",
      surface: "lead_ad",
      provider: "tiktok_business",
      displayName: "TikTok Lead Ads",
      status: "needs_access",
      capabilities: { read: false, reply: false, webhook: false, importLead: false },
      settings: {
        requiredAccess: ["TikTok Business API", "Lead Ads webhook"],
        webhookSecret: "lead-secret",
        refreshToken: "lead-refresh-token",
      },
      synthetic: true,
    },
  ])
})

describe("GET /api/v1/channels/tiktok-hub", () => {
  it("returns one TikTok hub with DM connected and Organic/Business needs-access cards", async () => {
    const res = await GET(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.cards).toHaveLength(3)
    expect(json.data.cards[0]).toMatchObject({
      key: "dm",
      provider: "chatwoot",
      status: "connected",
      capabilities: { read: true, reply: true, webhook: true, importLead: false },
      webhookUrl: null,
      webhookUrlAvailable: true,
    })
    expect(JSON.stringify(json)).not.toContain("secret123")
    expect(JSON.stringify(json)).not.toContain("token=")
    expect(JSON.stringify(json)).not.toContain("connection-secret")
    expect(JSON.stringify(json)).not.toContain("connection-key")
    expect(JSON.stringify(json)).not.toContain("nested-secret")
    expect(JSON.stringify(json)).not.toContain("comment-secret")
    expect(JSON.stringify(json)).not.toContain("comment-token")
    expect(JSON.stringify(json)).not.toContain("mention-verify-token")
    expect(JSON.stringify(json)).not.toContain("lead-secret")
    expect(JSON.stringify(json)).not.toContain("lead-refresh-token")
    expect(json.data.cards[0].connection.settings).toMatchObject({
      accountId: "171064",
      nested: { inboxId: "inbox_1" },
    })
    expect(json.data.cards[1]).toMatchObject({
      key: "comments_mentions",
      provider: "tiktok_organic",
      status: "needs_access",
      capabilities: { read: false, reply: false, webhook: false, importLead: false },
    })
    expect(json.data.cards[2]).toMatchObject({
      key: "lead_ads",
      provider: "tiktok_business",
      status: "needs_access",
      capabilities: { importLead: false, reply: false },
    })
  })

  it("does not reveal the secret-bearing DM webhook URL even when requested", async () => {
    const res = await GET(request("/api/v1/channels/tiktok-hub?includeWebhookUrl=1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.cards[0]).toMatchObject({
      key: "dm",
      webhookUrl: null,
      webhookUrlAvailable: true,
    })
    expect(JSON.stringify(json)).not.toContain("secret123")
    expect(JSON.stringify(json)).not.toContain("token=")
  })
})
