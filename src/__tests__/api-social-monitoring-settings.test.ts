import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string; scopes?: string[] }
type RouteHandler<C = unknown> = (req: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>

const mockState = vi.hoisted(() => ({
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
  role: "manager",
  apiKey: false,
}))

const mockDeps = vi.hoisted(() => ({
  encryptToken: vi.fn(),
  validateEndpointForWrite: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mockState.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-1",
      userId: "user-1",
      role: mockState.role,
      ...(mockState.apiKey ? { scopes: ["write:social"] } : {}),
    }, ctx)
  },
}))

vi.mock("@/lib/secure-token", () => ({
  encryptToken: mockDeps.encryptToken,
}))

vi.mock("@/lib/social/social-outbound-http", () => ({
  validateSocialOutboundEndpointForWrite: mockDeps.validateEndpointForWrite,
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  compileOrganizationSourceRoutePlans: vi.fn(async () => []),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/monitoring-schedule-status", () => ({
  socialMonitoringScheduleStatus: vi.fn(async () => null),
}))

import { GET, PUT } from "@/app/api/v1/social/monitoring-settings/route"
import { prisma, logAudit } from "@/lib/prisma"
import {
  mergeMonitoringSettingsIntoSourceSettings,
  type SocialMonitoringSettings,
} from "@/lib/social/monitoring-settings"

const findFirst = vi.mocked(prisma.channelConfig.findFirst)
const create = vi.mocked(prisma.channelConfig.create)
const update = vi.mocked(prisma.channelConfig.update)
const audit = vi.mocked(logAudit)

type ChannelConfigWriteArgs = { data: { apiKey?: string | null; settings?: unknown } }

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/monitoring-settings", {
    method: body === undefined ? "GET" : "PUT",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockState.role = "manager"
  mockState.apiKey = false
  mockDeps.encryptToken.mockReturnValue("encrypted-search-token")
  mockDeps.validateEndpointForWrite.mockImplementation(async (url: string) => url)
  findFirst.mockResolvedValue(null as never)
  create.mockImplementation(async (args: ChannelConfigWriteArgs) => ({ id: "cfg-1", apiKey: args.data.apiKey ?? null, settings: args.data.settings }) as never)
  update.mockImplementation(async (args: ChannelConfigWriteArgs) => ({ id: "cfg-1", apiKey: args.data.apiKey ?? null, settings: args.data.settings }) as never)
})

describe("social monitoring settings API", () => {
  it("returns empty tenant settings without exposing secrets", async () => {
    const res = await GET(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({
      schedule: {
        enabled: true,
        cadenceMinutes: 10_080,
        reportWindowDays: 7,
        timeZone: "UTC",
      },
      searchIndex: {
        enabled: false,
        provider: "generic",
        endpoint: null,
        allowedHosts: [],
        limit: null,
        hasToken: false,
        apifyActors: {
          webSearch: "apify/google-search-scraper",
          instagramProfile: "apify/instagram-scraper",
          instagramHashtag: "apify/instagram-hashtag-scraper",
          facebookSearch: "scrapeforge/facebook-search-posts",
          facebookPosts: "apify/facebook-posts-scraper",
          tiktokSearch: "clockworks/tiktok-scraper",
        },
      },
      provider: { allowedHosts: [], replyAllowedHosts: [] },
    })
    expect(mockState.registrations).toContainEqual({ module: "social", action: "read" })
  })

  it("enables comments for a legacy enabled Apify row unless it explicitly opted out", async () => {
    findFirst.mockResolvedValue({
      id: "cfg-legacy",
      apiKey: "encrypted-token",
      settings: { searchIndex: { enabled: true, provider: "apify" } },
    } as never)

    const res = await GET(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.searchIndex).toMatchObject({ provider: "apify", enabled: true, includeComments: true })
  })

  it("saves search-index/provider configuration from UI and redacts token", async () => {
    mockState.role = "admin"
    const res = await PUT(request({
      searchIndex: {
        enabled: true,
        endpoint: "https://search.example.com/social/search",
        allowedHosts: "extra.example.com",
        limit: 12,
        token: "secret-token",
      },
      provider: {
        allowedHosts: "listener.example.com",
        replyAllowedHosts: "reply.example.com",
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockDeps.encryptToken).toHaveBeenCalledWith("secret-token", "social-search-index:org-1")
    expect(mockDeps.validateEndpointForWrite).toHaveBeenCalledWith(
      "https://search.example.com/social/search",
      "Search-index endpoint",
    )
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        channelType: "social_monitoring",
        configName: "Monitoring providers",
        apiKey: "encrypted-search-token",
        settings: {
          schedule: {
            enabled: true,
            cadenceMinutes: 10_080,
            reportWindowDays: 7,
            timeZone: "UTC",
          },
          searchIndex: {
            enabled: true,
            provider: "generic",
            endpoint: "https://search.example.com/social/search",
            allowedHosts: ["extra.example.com", "search.example.com"],
            limit: 12,
            includeComments: false,
            apifyActors: {
              webSearch: "apify/google-search-scraper",
              instagramProfile: "apify/instagram-scraper",
              instagramHashtag: "apify/instagram-hashtag-scraper",
              facebookSearch: "scrapeforge/facebook-search-posts",
              facebookPosts: "apify/facebook-posts-scraper",
              tiktokSearch: "clockworks/tiktok-scraper",
              instagramComments: "apify/instagram-comment-scraper",
              facebookComments: "apify/facebook-comments-scraper",
              tiktokComments: "clockworks/tiktok-comments-scraper",
            },
          },
          provider: {
            allowedHosts: ["listener.example.com"],
            replyAllowedHosts: ["reply.example.com"],
          },
        },
      }),
    }))
    expect(json.data.searchIndex).toMatchObject({
      enabled: true,
      provider: "generic",
      endpoint: "https://search.example.com/social/search",
      hasToken: true,
    })
    expect(JSON.stringify(json)).not.toContain("secret-token")
    expect(JSON.stringify(json)).not.toContain("encrypted-search-token")
    expect(audit).toHaveBeenCalledWith(
      "org-1",
      "update",
      "social_monitoring_settings",
      "org-1",
      "monitoring providers",
      expect.objectContaining({ userId: "user-1" }),
    )
    expect(mockState.registrations).toContainEqual({ module: "social", action: "write" })
  })

  it("rejects a search endpoint when DNS validation blocks it", async () => {
    mockState.role = "admin"
    mockDeps.validateEndpointForWrite.mockRejectedValueOnce(
      new Error("Search-index endpoint must resolve only to public internet addresses"),
    )

    const res = await PUT(request({
      searchIndex: {
        endpoint: "https://rebind.example.com/search",
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Search-index endpoint must resolve only to public internet addresses")
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("saves Apify as UI-managed search provider without a generic endpoint", async () => {
    mockState.role = "admin"
    const res = await PUT(request({
      searchIndex: {
        enabled: true,
        provider: "apify",
        allowedHosts: "",
        limit: 9,
        token: "apify-token",
        apifyActors: {
          instagramProfile: "custom/instagram-profile",
          instagramHashtag: null,
          facebookSearch: "custom/facebook-search",
          facebookPosts: "custom/facebook-posts",
          tiktokSearch: "custom/tiktok-search",
        },
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        apiKey: "encrypted-search-token",
        settings: {
          schedule: {
            enabled: true,
            cadenceMinutes: 10_080,
            reportWindowDays: 7,
            timeZone: "UTC",
          },
          searchIndex: {
            enabled: true,
            provider: "apify",
            endpoint: null,
            allowedHosts: ["api.apify.com"],
            limit: 9,
            includeComments: true,
            apifyActors: {
              webSearch: "apify/google-search-scraper",
              instagramProfile: "custom/instagram-profile",
              instagramHashtag: "apify/instagram-hashtag-scraper",
              facebookSearch: "custom/facebook-search",
              facebookPosts: "custom/facebook-posts",
              tiktokSearch: "custom/tiktok-search",
              instagramComments: "apify/instagram-comment-scraper",
              facebookComments: "apify/facebook-comments-scraper",
              tiktokComments: "clockworks/tiktok-comments-scraper",
            },
          },
          provider: {
            allowedHosts: [],
            replyAllowedHosts: [],
          },
        },
      }),
    }))
    expect(json.data.searchIndex).toMatchObject({
      enabled: true,
      provider: "apify",
      endpoint: null,
      allowedHosts: ["api.apify.com"],
      hasToken: true,
      includeComments: true,
      apifyActors: {
        instagramProfile: "custom/instagram-profile",
        instagramHashtag: "apify/instagram-hashtag-scraper",
        facebookSearch: "custom/facebook-search",
        facebookPosts: "custom/facebook-posts",
        tiktokSearch: "custom/tiktok-search",
      },
    })
    expect(JSON.stringify(json)).not.toContain("apify-token")
    expect(JSON.stringify(json)).not.toContain("encrypted-search-token")
  })

  it("does not let an API key redirect a preserved monitoring token", async () => {
    mockState.role = "admin"
    mockState.apiKey = true
    findFirst.mockResolvedValue({
      id: "cfg-1",
      apiKey: "encrypted-existing-token",
      settings: { searchIndex: { endpoint: "https://old.example.com/search" } },
    } as never)

    const res = await PUT(request({
      searchIndex: {
        endpoint: "https://attacker.example.com/collect",
        allowedHosts: ["attacker.example.com"],
      },
    }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: "browser_admin_required" })
    expect(mockDeps.validateEndpointForWrite).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("does not let a manager change outbound monitoring credentials or hosts", async () => {
    const res = await PUT(request({ searchIndex: { clearToken: true } }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: "browser_admin_required" })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("merges Apify settings into search-index sources without per-source hardcoding", () => {
    const monitoringSettings: SocialMonitoringSettings = {
      schedule: {
        enabled: true,
        cadenceMinutes: 10_080,
        reportWindowDays: 7,
        timeZone: "UTC",
      },
      searchIndex: {
        enabled: true,
        provider: "apify",
        endpoint: null,
        allowedHosts: ["api.apify.com"],
        limit: 11,
        includeComments: false,
        encryptedToken: "ciphertext",
        hasToken: true,
        apifyActors: {
          webSearch: "apify/google-search-scraper",
          instagramProfile: "apify/instagram-scraper",
          instagramHashtag: "apify/instagram-hashtag-scraper",
          facebookSearch: "scrapeforge/facebook-search-posts",
          facebookPosts: "custom/facebook-posts",
          tiktokSearch: "clockworks/tiktok-scraper",
          instagramComments: "apify/instagram-comment-scraper",
          facebookComments: "apify/facebook-comments-scraper",
          tiktokComments: "clockworks/tiktok-comments-scraper",
        },
      },
      provider: {
        allowedHosts: [],
        replyAllowedHosts: [],
      },
    }

    const merged = mergeMonitoringSettingsIntoSourceSettings(
      {
        searchIndex: {
          apifyActors: {
            tiktokSearch: "tenant/tiktok-search",
          },
        },
      },
      monitoringSettings,
      { organizationId: "org-1", collectionMode: "search_index" },
    )

    expect(merged.searchIndex).toMatchObject({
      approved: true,
      provider: "apify",
      encryptedToken: "ciphertext",
      tokenPurpose: "social-search-index:org-1",
      allowedHosts: ["api.apify.com"],
      limit: 11,
      apifyActors: {
        instagramProfile: "apify/instagram-scraper",
        instagramHashtag: "apify/instagram-hashtag-scraper",
        facebookSearch: "scrapeforge/facebook-search-posts",
        facebookPosts: "custom/facebook-posts",
        tiktokSearch: "tenant/tiktok-search",
      },
    })
  })

  it("persists an explicit weekly schedule without changing provider configuration", async () => {
    mockState.role = "admin"
    const res = await PUT(request({
      schedule: {
        enabled: true,
        cadenceMinutes: 10_080,
        reportWindowDays: 7,
        timeZone: "Asia/Baku",
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          schedule: {
            enabled: true,
            cadenceMinutes: 10_080,
            reportWindowDays: 7,
            timeZone: "Asia/Baku",
          },
        }),
      }),
    }))
    expect(json.data.schedule).toEqual({
      enabled: true,
      cadenceMinutes: 10_080,
      reportWindowDays: 7,
      timeZone: "Asia/Baku",
    })
  })

  // Остановка сбора по всему тенанту — админское действие: переключатель в
  // интерфейсе виден только админу, и сервер обязан думать так же (#665).
  it("refuses to change the tenant schedule switch for a non-admin", async () => {
    const res = await PUT(request({ schedule: { enabled: false } }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: "admin_required" })
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("records what changed when the schedule switch is flipped", async () => {
    mockState.role = "admin"

    const res = await PUT(request({ schedule: { enabled: false } }))

    expect(res.status).toBe(200)
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "update",
      "social_monitoring_settings",
      "org-1",
      "schedule disabled",
      expect.objectContaining({ userId: "user-1" }),
    )
  })
})
