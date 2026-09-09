import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  gateChannelsAccess: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  syncTikTok: vi.fn(),
  validateOutboundWebhookUrl: vi.fn(),
}))

vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: mocks.gateChannelsAccess,
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      updateMany: mocks.updateMany,
    },
  },
}))

vi.mock("@/lib/channels/platform-connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/platform-connections")>()
  return {
    ...actual,
    syncTikTokDmConnectionForChannelConfig: mocks.syncTikTok,
  }
})

vi.mock("@/lib/integrations/webhook-url-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/webhook-url-guard")>()
  return {
    ...actual,
    validateOutboundWebhookUrl: mocks.validateOutboundWebhookUrl,
  }
})

import { GET as GET_LIST, POST } from "@/app/api/v1/channels/route"
import { GET as GET_ONE, PUT } from "@/app/api/v1/channels/[id]/route"

const channelRow = {
  id: "ch_1",
  organizationId: "org_1",
  channelType: "whatsapp",
  configName: "WhatsApp Business",
  botToken: "telegram-bot-token",
  webhookUrl: "waba_123",
  apiKey: "legacy-access-token",
  phoneNumber: "phone_number_id",
  appId: "app_123",
  appSecret: "meta-app-secret",
  pageId: "page_123",
  settings: {},
  isActive: true,
  accessToken: "whatsapp-access-token",
  phoneNumberId: "phone_number_id",
  businessAccountId: "waba_123",
  verifyToken: "verify-token-required-by-edit-form",
  displayName: "Main WA",
  createdAt: new Date("2026-07-05T00:00:00.000Z"),
  updatedAt: new Date("2026-07-05T00:00:00.000Z"),
}

const chatwootChannelRow = {
  ...channelRow,
  id: "ch_tiktok",
  channelType: "chatwoot",
  configName: "TikTok via Chatwoot",
  botToken: null,
  webhookUrl: null,
  apiKey: "chatwoot-api-token",
  phoneNumber: null,
  appId: null,
  appSecret: null,
  pageId: null,
  accessToken: null,
  phoneNumberId: null,
  businessAccountId: null,
  verifyToken: null,
  displayName: null,
  settings: {
    provider: "tiktok",
    platform: "tiktok",
    surface: "dm",
    routingProvider: "chatwoot",
    baseUrl: "https://chatwoot.example",
    accountId: "42",
    webhookSecret: "stored-chatwoot-webhook-secret",
  },
}

function req(body?: unknown) {
  return new NextRequest("https://app.leaddrivecrm.org/api/v1/channels/ch_1", {
    method: body ? "PUT" : "GET",
    headers: { "content-type": "application/json", "x-organization-id": "org_1" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function assertNoRawSecrets(payload: unknown) {
  const serialized = JSON.stringify(payload)

  expect(serialized).not.toContain("telegram-bot-token")
  expect(serialized).not.toContain("legacy-access-token")
  expect(serialized).not.toContain("whatsapp-access-token")
  expect(serialized).not.toContain("meta-app-secret")
  expect(serialized).not.toContain("verify-token-required-by-edit-form")
  expect(serialized).not.toContain("stored-chatwoot-webhook-secret")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.gateChannelsAccess.mockResolvedValue({ orgId: "org_1", role: "admin" })
  mocks.syncTikTok.mockResolvedValue(undefined)
  mocks.validateOutboundWebhookUrl.mockImplementation(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: "93.184.216.34", family: 4 }],
  }))
})

describe("channel config secret response redaction", () => {
  it("redacts raw secret fields in the list response", async () => {
    mocks.findMany.mockResolvedValue([channelRow])

    const res = await GET_LIST(req())
    const json = await res.json()

    expect(res.status).toBe(200)
    assertNoRawSecrets(json)
    expect(json.data[0]).toMatchObject({
      hasBotToken: true,
      hasApiKey: true,
      hasAppSecret: true,
      hasAccessToken: true,
      hasVerifyToken: true,
    })
    expect(json.data[0]).not.toHaveProperty("verifyToken")
  })

  it("redacts raw secret fields in the detail response", async () => {
    mocks.findFirst.mockResolvedValue(channelRow)

    const res = await GET_ONE(req(), { params: Promise.resolve({ id: "ch_1" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    assertNoRawSecrets(json)
    expect(json.data).toMatchObject({
      hasAccessToken: true,
      hasAppSecret: true,
      hasVerifyToken: true,
    })
    expect(json.data).not.toHaveProperty("verifyToken")
  })

  it("redacts raw secret fields after create", async () => {
    mocks.create.mockResolvedValue(channelRow)

    const res = await POST(req({
      channelType: "whatsapp",
      configName: "WhatsApp Business",
      accessToken: "whatsapp-access-token",
      phoneNumberId: "phone_number_id",
      businessAccountId: "waba_123",
      verifyToken: "verify-token-required-by-edit-form",
      appSecret: "meta-app-secret",
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    assertNoRawSecrets(json)
    expect(json.data.hasAccessToken).toBe(true)
    expect(json.data).not.toHaveProperty("verifyToken")
  })

  it("redacts raw secret fields after update without changing stored channel values", async () => {
    mocks.findFirst.mockResolvedValueOnce(channelRow).mockResolvedValueOnce({ ...channelRow, configName: "WA Updated" })
    mocks.updateMany.mockResolvedValue({ count: 1 })

    const res = await PUT(req({ configName: "WA Updated" }), { params: Promise.resolve({ id: "ch_1" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    assertNoRawSecrets(json)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "ch_1",
        organizationId: "org_1",
        channelType: { not: "voip" },
      },
      data: expect.objectContaining({ configName: "WA Updated" }),
    })
    expect(json.data).toMatchObject({ configName: "WA Updated", hasAccessToken: true })
  })

  it("redacts chatwoot webhook secrets from settings while exposing a readiness flag", async () => {
    mocks.findMany.mockResolvedValue([chatwootChannelRow])

    const res = await GET_LIST(req())
    const json = await res.json()

    expect(res.status).toBe(200)
    assertNoRawSecrets(json)
    expect(json.data[0]).toMatchObject({
      hasApiKey: true,
      hasWebhookSecret: true,
      settings: {
        provider: "tiktok",
        platform: "tiktok",
        baseUrl: "https://chatwoot.example",
        accountId: "42",
      },
    })
    expect(json.data[0].settings).not.toHaveProperty("webhookSecret")
  })

  it("returns only non-sensitive VoIP feature state to an admin on the generic list route", async () => {
    mocks.findMany.mockResolvedValue([{
      ...channelRow,
      channelType: "voip",
      settings: {
        provider: "asterisk",
        ariHost: "private-host",
        ariPort: 8088,
        username: "private-user",
        password: "private-password",
        context: "private-context",
        callerExtension: "private-extension",
        voiceAgentPrompt: "private-prompt",
        voiceAgentEnabled: true,
        manualLeadAiCallsEnabled: false,
        voiceAgentMode: "outbound",
      },
    }])

    const res = await GET_LIST(req())
    const json = await res.json()
    const serialized = JSON.stringify(json)

    expect(res.status).toBe(200)
    expect(json.data[0].settings).toEqual({
      provider: "asterisk",
      voiceAgentEnabled: true,
      manualLeadAiCallsEnabled: false,
      voiceAgentMode: "outbound",
    })
    expect(serialized).not.toContain("private-")
  })

  it("returns only non-sensitive VoIP feature state to an admin on the generic detail route", async () => {
    mocks.findFirst.mockResolvedValue({
      ...channelRow,
      channelType: "voip",
      settings: {
        provider: "asterisk",
        ariHost: "private-host",
        username: "private-user",
        password: "private-password",
        voiceAgentPrompt: "private-prompt",
        voiceAgentEnabled: true,
        manualLeadAiCallsEnabled: true,
        voiceAgentMode: "both",
      },
    })

    const res = await GET_ONE(req(), { params: Promise.resolve({ id: "ch_1" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.settings).toEqual({
      provider: "asterisk",
      voiceAgentEnabled: true,
      manualLeadAiCallsEnabled: true,
      voiceAgentMode: "both",
    })
    expect(JSON.stringify(json)).not.toContain("private-")
  })

  it("preserves a stored chatwoot webhook secret when edit payload leaves it blank", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(chatwootChannelRow)
      .mockResolvedValueOnce({ ...chatwootChannelRow, configName: "TikTok Updated" })
    mocks.updateMany.mockResolvedValue({ count: 1 })

    const res = await PUT(req({
      channelType: "chatwoot",
      configName: "TikTok Updated",
      settings: {
        provider: "tiktok",
        platform: "tiktok",
        baseUrl: "https://chatwoot.example",
        accountId: "42",
        webhookSecret: "",
      },
    }), { params: Promise.resolve({ id: "ch_tiktok" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "ch_tiktok",
        organizationId: "org_1",
        channelType: { not: "voip" },
      },
      data: {
        channelType: "chatwoot",
        configName: "TikTok Updated",
        settings: {
          provider: "tiktok",
          platform: "tiktok",
          surface: "dm",
          routingProvider: "chatwoot",
          baseUrl: "https://chatwoot.example",
          accountId: "42",
          webhookSecret: "stored-chatwoot-webhook-secret",
        },
      },
    })
    assertNoRawSecrets(json)
    expect(json.data.hasWebhookSecret).toBe(true)
  })

  it("rejects an unsafe Chatwoot baseUrl before updating the channel", async () => {
    mocks.findFirst.mockResolvedValueOnce(chatwootChannelRow)
    mocks.validateOutboundWebhookUrl.mockRejectedValueOnce(
      new Error("Webhook URL resolves to a private address"),
    )

    const res = await PUT(req({
      channelType: "chatwoot",
      settings: {
        provider: "tiktok",
        baseUrl: "https://chatwoot-rebind.example",
      },
    }), { params: Promise.resolve({ id: "ch_tiktok" }) })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/public HTTPS URL/)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
