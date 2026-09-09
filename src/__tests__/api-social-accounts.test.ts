import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteContext = { params: Promise<{ id: string }> }
type RouteHandler = (req: NextRequest, auth: AuthContext, ctx: RouteContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, ctx: RouteContext) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    channelConfig: { findMany: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  compileOrganizationSourceRoutePlans: vi.fn(async () => []),
}))

import { GET } from "@/app/api/v1/social/accounts/route"
import { PUT } from "@/app/api/v1/social/accounts/[id]/route"
import { prisma } from "@/lib/prisma"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/social/accounts/account-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function ctx(id = "account-1"): RouteContext {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([] as never)
})

describe("GET /api/v1/social/accounts", () => {
  it("shows channel-only pages without exposing tokens or duplicating SocialAccount rows", async () => {
    vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([{
      id: "account-fb",
      organizationId: "org-1",
      platform: "facebook",
      handle: "page-1",
      displayName: "Brand Facebook",
      accessToken: "encrypted-facebook-token",
      tokenExpiresAt: null,
      isActive: true,
      keywords: [],
      lastPolledAt: null,
      createdAt: new Date("2026-07-15T00:00:00.000Z"),
      updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    }] as never)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      {
        id: "channel-fb",
        channelType: "facebook",
        configName: "Brand Facebook",
        pageId: "page-1",
        isActive: true,
        apiKey: "raw-facebook-page-token",
        createdAt: new Date("2026-07-15T00:00:00.000Z"),
        updatedAt: new Date("2026-07-15T00:00:00.000Z"),
      },
      {
        id: "channel-ig",
        channelType: "instagram",
        configName: "@brand",
        pageId: "ig-user-1",
        isActive: true,
        apiKey: "raw-instagram-login-token",
        createdAt: new Date("2026-07-15T00:00:00.000Z"),
        updatedAt: new Date("2026-07-15T00:00:00.000Z"),
      },
      {
        id: "channel-meta-app",
        channelType: "facebook",
        configName: "Meta app credentials",
        pageId: null,
        isActive: true,
        apiKey: null,
        createdAt: new Date("2026-07-15T00:00:00.000Z"),
        updatedAt: new Date("2026-07-15T00:00:00.000Z"),
      },
    ] as never)

    const res = await GET(new NextRequest("http://localhost/api/v1/social/accounts"))
    const json = await res.json()

    expect(json.data.accounts).toHaveLength(1)
    expect(json.data.accounts[0]).toMatchObject({ id: "account-fb", accessToken: "***", connected: true })
    expect(json.data.connectedPages).toEqual([
      expect.objectContaining({ id: "channel-ig", platform: "instagram", handle: "ig-user-1", connected: true }),
    ])
    expect(prisma.channelConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ pageId: { not: null } }),
    }))
    expect(JSON.stringify(json)).not.toContain("Meta app credentials")
    expect(JSON.stringify(json)).not.toContain("raw-facebook-page-token")
    expect(JSON.stringify(json)).not.toContain("raw-instagram-login-token")
    expect(JSON.stringify(json)).not.toContain("encrypted-facebook-token")
  })
})

describe("PUT /api/v1/social/accounts/[id]", () => {
  it("redacts stored OAuth token material in the response", async () => {
    vi.mocked(prisma.socialAccount.findFirst).mockResolvedValue({
      id: "account-1",
      organizationId: "org-1",
      platform: "tiktok",
      handle: "brand",
      accessToken: "encrypted-oauth-token",
    } as never)
    vi.mocked(prisma.socialAccount.update).mockResolvedValue({
      id: "account-1",
      organizationId: "org-1",
      platform: "tiktok",
      handle: "brand",
      displayName: "Brand TikTok",
      accessToken: "encrypted-oauth-token",
      tokenExpiresAt: new Date("2026-07-05T00:00:00.000Z"),
      isActive: true,
      keywords: [],
      lastPolledAt: null,
      createdAt: new Date("2026-07-05T00:00:00.000Z"),
      updatedAt: new Date("2026-07-05T00:00:00.000Z"),
    } as never)

    const res = await PUT(request({ displayName: "Brand TikTok" }), ctx())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.connected).toBe(true)
    expect(json.data.accessToken).toBe("***")
    expect(JSON.stringify(json)).not.toContain("encrypted-oauth-token")
    expect(prisma.socialAccount.update).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: { displayName: "Brand TikTok" },
    })
  })
})
