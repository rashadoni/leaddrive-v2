import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: vi.fn(async () => ({ orgId: "org_1" })),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_orgId: string, fn: () => unknown) => fn()),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(),
    },
  },
}))

import { GET } from "@/app/api/v1/channels/route"
import { prisma } from "@/lib/prisma"

function req() {
  return new NextRequest("http://localhost:3000/api/v1/channels")
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/v1/channels readiness metadata", () => {
  it("returns safe credential flags without returning secret values", async () => {
    const rows = [
      {
        id: "cfg_1",
        channelType: "whatsapp",
        configName: "LeadDrive WhatsApp",
        phoneNumber: "12345",
        pageId: null,
        appId: "app_1",
        webhookUrl: null,
        botToken: "bot-secret",
        apiKey: "legacy-token",
        appSecret: "",
        accessToken: "access-secret",
        phoneNumberId: "phone-id",
        businessAccountId: null,
        verifyToken: "verify-token",
        isActive: true,
        settings: null,
        createdAt: new Date("2026-06-26T10:00:00Z"),
        updatedAt: new Date("2026-06-26T10:00:00Z"),
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.channelConfig.findMany>>
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue(rows)

    const res = await GET(req())
    const body = await res.json() as { data: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(body.data[0]).toMatchObject({
      id: "cfg_1",
      channelType: "whatsapp",
      hasBotToken: true,
      hasApiKey: true,
      hasAppSecret: false,
      hasAccessToken: true,
      hasPhoneNumberId: true,
      hasBusinessAccountId: false,
      hasVerifyToken: true,
    })
    expect(body.data[0]).not.toHaveProperty("botToken")
    expect(body.data[0]).not.toHaveProperty("apiKey")
    expect(body.data[0]).not.toHaveProperty("appSecret")
    expect(body.data[0]).not.toHaveProperty("accessToken")
    expect(body.data[0]).not.toHaveProperty("phoneNumberId")
    expect(body.data[0]).not.toHaveProperty("businessAccountId")
  })
})
