import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string; scopes?: string[] }
type RouteHandler<C = unknown> = (req: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>

const mockState = vi.hoisted(() => ({
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
  fenceBlocked: false,
  role: "manager",
  apiKey: false,
}))

const outboundMocks = vi.hoisted(() => ({
  validateMonitoringSourceOutboundEndpoints: vi.fn(),
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

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mockState.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => {
      if (mockState.fenceBlocked) {
        return NextResponse.json(
          {
            error: "Social Monitoring is paused for a clean-slate reset",
            code: "social_monitoring_collection_blocked",
          },
          { status: 409 },
        )
      }
      return handler(req, {
        orgId: "org-1",
        userId: "user-1",
        role: mockState.role,
        ...(mockState.apiKey ? { scopes: ["write:social"] } : {}),
      }, ctx)
    }
  },
}))

vi.mock("@/lib/ai/budget", () => ({
  isAiFeatureEnabled: vi.fn(),
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  compileSourceRoutePlans: vi.fn(async () => []),
}))

vi.mock("@/lib/social/social-outbound-http", () => ({
  validateMonitoringSourceOutboundEndpoints: outboundMocks.validateMonitoringSourceOutboundEndpoints,
}))

vi.mock("@/lib/social/monitoring-scenarios", () => ({
  getMonitoringScenarios: vi.fn(async () => []),
  updateMonitoringScenario: vi.fn(),
}))

vi.mock("@/lib/prisma", () => {
  const prisma = {
    organization: {
      findUnique: vi.fn(async () => ({ features: [] })),
    },
    monitoringSource: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    monitoringSubject: {
      findFirst: vi.fn(),
    },
    monitoringSubjectSource: {
      upsert: vi.fn(),
    },
    collectorRun: {
      findMany: vi.fn(),
    },
    mentionEvidence: {
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
    discoveryLead: {
      updateMany: vi.fn(),
    },
    rejectedObservationFingerprint: {
      updateMany: vi.fn(),
    },
    ingestEnvelope: {
      updateMany: vi.fn(),
    },
    socialMetricSnapshot: {
      updateMany: vi.fn(),
    },
    aiAlert: {
      findMany: vi.fn(),
    },
    socialAccount: {
      findMany: vi.fn(),
    },
    channelConfig: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  return { prisma, logAudit: vi.fn() }
})

import { DELETE, GET as GET_ONE, PATCH } from "@/app/api/v1/social/monitoring-sources/[id]/route"
import { GET, POST } from "@/app/api/v1/social/monitoring-sources/route"
import { isAiFeatureEnabled } from "@/lib/ai/budget"
import { getMonitoringScenarios, updateMonitoringScenario } from "@/lib/social/monitoring-scenarios"
import { prisma, logAudit } from "@/lib/prisma"

const findMany = vi.mocked(prisma.monitoringSource.findMany)
const groupBy = vi.mocked(prisma.monitoringSource.groupBy)
const findFirst = vi.mocked(prisma.monitoringSource.findFirst)
const create = vi.mocked(prisma.monitoringSource.create)
const update = vi.mocked(prisma.monitoringSource.update)
const deleteSource = vi.mocked(prisma.monitoringSource.delete)
const detachEvidence = vi.mocked(prisma.mentionEvidence.updateMany)
const detachLeads = vi.mocked(prisma.discoveryLead.updateMany)
const detachFingerprints = vi.mocked(prisma.rejectedObservationFingerprint.updateMany)
const detachEnvelopes = vi.mocked(prisma.ingestEnvelope.updateMany)
const detachSnapshots = vi.mocked(prisma.socialMetricSnapshot.updateMany)
const transaction = vi.mocked(prisma.$transaction)
const findRuns = vi.mocked(prisma.collectorRun.findMany)
const groupEvidence = vi.mocked(prisma.mentionEvidence.groupBy)
const findAlerts = vi.mocked(prisma.aiAlert.findMany)
const findSocialAccounts = vi.mocked(prisma.socialAccount.findMany)
const findChannelConfig = vi.mocked(prisma.channelConfig.findFirst)
const featureEnabled = vi.mocked(isAiFeatureEnabled)
const audit = vi.mocked(logAudit)
const getScenarios = vi.mocked(getMonitoringScenarios)
const updateScenario = vi.mocked(updateMonitoringScenario)

const now = new Date("2026-07-05T10:00:00.000Z")

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "src-1",
    organizationId: "org-1",
    platform: "instagram",
    sourceType: "hashtag",
    url: null,
    handle: null,
    query: "leaddrive",
    ownership: "external",
    collectionMode: "search_index",
    cadenceMinutes: 60,
    keywords: ["LeadDrive"],
    riskLevel: "high",
    status: "needs_setup",
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    lastError: null,
    settings: {},
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    collectorRuns: [],
    _count: { collectorRuns: 0, evidences: 0 },
    ...overrides,
  }
}

function request(path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function params(id = "src-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  mockState.fenceBlocked = false
  mockState.role = "manager"
  mockState.apiKey = false
  outboundMocks.validateMonitoringSourceOutboundEndpoints.mockResolvedValue(undefined)
  featureEnabled.mockResolvedValue(false)
  findSocialAccounts.mockResolvedValue([
    { id: "social-account-1", platform: "instagram", isActive: true, accessToken: "encrypted-instagram-token" },
    { id: "social-account-2", platform: "facebook", isActive: true, accessToken: "encrypted-facebook-token" },
  ] as never)
  findChannelConfig.mockResolvedValue(null as never)
  findMany.mockResolvedValue([source()] as never)
  groupBy
    .mockResolvedValueOnce([{ status: "needs_setup", _count: 1 }] as never)
    .mockResolvedValueOnce([{ collectionMode: "search_index", _count: 1 }] as never)
    .mockResolvedValueOnce([{ riskLevel: "high", _count: 1 }] as never)
  findRuns.mockResolvedValue([
    {
      id: "run-1",
      sourceId: "src-1",
      status: "partial",
      startedAt: now,
      finishedAt: now,
      foundCount: 4,
      newCount: 2,
      duplicateCount: 1,
      ignoredCount: 1,
      error: "search_index_rate_limited",
      source: { platform: "instagram", sourceType: "hashtag", collectionMode: "search_index" },
    },
  ] as never)
  groupEvidence.mockResolvedValue([{ sourceTrustTier: "T3", _count: 2 }] as never)
  findAlerts.mockResolvedValue([{ id: "alert-1", type: "social_signal_risk", severity: "warning", message: "Risk", metadata: {}, createdAt: now, isRead: false }] as never)
  findFirst.mockResolvedValue(null as never)
  create.mockResolvedValue(source() as never)
  update.mockResolvedValue(source({ handle: "brand", query: null, sourceType: "page", collectionMode: "official_api", riskLevel: "low", status: "active" }) as never)
  deleteSource.mockResolvedValue(source() as never)
  detachEvidence.mockResolvedValue({ count: 0 } as never)
  detachLeads.mockResolvedValue({ count: 0 } as never)
  detachFingerprints.mockResolvedValue({ count: 0 } as never)
  detachEnvelopes.mockResolvedValue({ count: 0 } as never)
  detachSnapshots.mockResolvedValue({ count: 0 } as never)
  transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)) as never)
  getScenarios.mockResolvedValue([])
  updateScenario.mockResolvedValue({} as never)
})

describe("GET /api/v1/social/monitoring-sources", () => {
  it("lists tenant-scoped sources with filters and health summary", async () => {
    const res = await GET(request("/api/v1/social/monitoring-sources?platform=instagram&sourceType=hashtag&status=needs_setup&q=lead"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "hashtag",
        status: "needs_setup",
        OR: expect.arrayContaining([
          { url: { contains: "lead", mode: "insensitive" } },
          { handle: { contains: "lead", mode: "insensitive" } },
          { query: { contains: "lead", mode: "insensitive" } },
          { keywords: { has: "lead" } },
        ]),
      }),
      include: expect.objectContaining({
        routePlans: expect.objectContaining({
          include: {
            capabilityProof: {
              select: { status: true, verifiedAt: true, expiresAt: true },
            },
          },
        }),
        providerRuns: expect.objectContaining({ where: { purgedAt: null }, take: 8 }),
        collectorRuns: expect.objectContaining({ take: 1 }),
        _count: {
          select: expect.objectContaining({
            collectorRuns: true,
            evidences: true,
            providerRuns: { where: { purgedAt: null } },
          }),
        },
      }),
    }))
    expect(json.data.sources[0].health).toMatchObject({
      state: "needs_setup",
      due: false,
      lastError: null,
    })
    expect(json.data.sources[0].readiness).toMatchObject({
      overall: "needs_setup",
      canCollect: false,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "needs_setup", action: "slow_search_index_cadence" }),
        expect.objectContaining({ key: "reply", state: "manual_only", action: "use_ai_draft_or_original" }),
        expect.objectContaining({ key: "liveSend", state: "dry_run", action: "finish_reply_setup_first" }),
      ]),
    })
    expect(json.data.stats).toMatchObject({
      total: 1,
      byStatus: { needs_setup: 1 },
      byMode: { search_index: 1 },
      byRisk: { high: 1 },
    })
    expect(json.data.coverage).toMatchObject({
      last24h: { found: 4, new: 2, duplicate: 1, ignored: 1, failed: 0, partial: 1 },
      trustTiers: { T3: 2 },
      partialCoverage: true,
    })
    expect(json.data.coverage.recentAlerts).toHaveLength(1)
  })

  it("can request concrete page, profile and URL targets without keyword-route rows taking their place", async () => {
    const res = await GET(request("/api/v1/social/monitoring-sources?targetKind=direct&limit=200"))

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        AND: [{ OR: [{ url: { not: null } }, { handle: { not: null } }] }],
      }),
      take: 200,
    }))
  })

  it("returns provider setup summary without exposing encrypted tokens or legacy env selectors", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "session-secret-must-never-be-exposed")
    findMany.mockResolvedValueOnce([
      source({
        collectionMode: "provider_api",
        status: "active",
        settings: {
          provider: {
            approved: true,
            name: "generic-listener",
            endpoint: "https://listener.example.com/social/search",
            tokenEnv: "NEXTAUTH_SECRET",
            encryptedToken: "ciphertext",
            reply: {
              approved: true,
              endpoint: "https://reply.example.com/social/reply",
              tokenEnv: "NEXTAUTH_SECRET",
              encryptedToken: "reply-ciphertext",
            },
          },
        },
      }),
    ] as never)

    const res = await GET(request("/api/v1/social/monitoring-sources"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.sources[0].providerSetup).toMatchObject({
      collectionConfigured: true,
      collectionApproved: true,
      collectionEndpointHost: "listener.example.com",
      collectionHasEncryptedToken: true,
      replyConfigured: true,
      replyApproved: true,
      replyEndpointHost: "reply.example.com",
    })
    expect(json.data.sources[0].settings.provider).toMatchObject({
      approved: true,
      endpoint: "https://listener.example.com/social/search",
      hasEncryptedToken: true,
      reply: expect.objectContaining({
        approved: true,
        endpoint: "https://reply.example.com/social/reply",
        hasEncryptedToken: true,
      }),
    })
    expect(json.data.sources[0].providerSetup).not.toHaveProperty("collectionTokenEnv")
    expect(json.data.sources[0].providerSetup).not.toHaveProperty("replyTokenEnv")
    expect(json.data.sources[0].settings.provider).not.toHaveProperty("tokenEnv")
    expect(json.data.sources[0].settings.provider.encryptedToken).toBeUndefined()
    expect(json.data.sources[0].settings.provider.reply).not.toHaveProperty("tokenEnv")
    expect(json.data.sources[0].settings.provider.reply.encryptedToken).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain("NEXTAUTH_SECRET")
    expect(JSON.stringify(json)).not.toContain("session-secret-must-never-be-exposed")
    expect(json.data.sources[0].readiness).toMatchObject({
      overall: "needs_setup",
      canCollect: false,
      canReplyLive: false,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "needs_setup", action: "configure_provider_allowlist" }),
        expect.objectContaining({ key: "reply", state: "needs_setup", action: "configure_provider_reply_allowlist" }),
        expect.objectContaining({ key: "liveSend", state: "dry_run", action: "finish_reply_setup_first" }),
      ]),
    })
  })
})

describe("POST /api/v1/social/monitoring-sources", () => {
  it("does not create a source while clean-slate collection is blocked", async () => {
    mockState.fenceBlocked = true

    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "hashtag",
      query: "#LeadDrive",
    }))

    expect(res.status).toBe(409)
    expect(findFirst).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("accepts deprecated assignment fields but creates an independent source", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "profile",
      ownership: "external",
      url: "https://instagram.com/baku.es__",
      subjectId: "subject-1",
      scenarioId: "scenario-1",
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "profile",
        url: "https://instagram.com/baku.es__",
      }),
    }))
    expect(create.mock.calls[0]?.[0]?.data.settings).not.toHaveProperty("scenarioLinks")
    expect(prisma.monitoringSubject.findFirst).not.toHaveBeenCalled()
    expect(prisma.monitoringSubjectSource.upsert).not.toHaveBeenCalled()
    expect(json.data.subjectSources).toEqual([])
    expect(json.data.reused).toBe(false)
  })

  it("creates a safe hashtag watchlist source with automatic mode and risk classification", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "hashtag",
      query: "#LeadDrive",
      keywords: ["LeadDrive", "LeadDrive", "crm"],
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "hashtag",
        collectionMode: "search_index",
        query: "leaddrive",
      },
      select: { id: true },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "hashtag",
        query: "leaddrive",
        collectionMode: "search_index",
        cadenceMinutes: 360,
        riskLevel: "high",
        status: "needs_setup",
        keywords: ["LeadDrive", "crm"],
        settings: expect.objectContaining({
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
          blockedReasons: ["public_search_requires_approved_provider_or_search_index"],
          expandedQueries: expect.arrayContaining([
            expect.objectContaining({ displayTerm: "leaddrive", reason: "base_query", priority: 100, cadenceMinutes: 30 }),
            expect.objectContaining({ displayTerm: "#leaddrive", reason: "hashtag_variant", priority: 95, cadenceMinutes: 30 }),
            expect.objectContaining({ displayTerm: "crm", reason: "keyword", priority: 82, cadenceMinutes: 60 }),
          ]),
          queryExpansion: expect.objectContaining({ strategy: "heuristic_v1" }),
        }),
        createdBy: "user-1",
      }),
    }))
    expect(audit).toHaveBeenCalledWith("org-1", "create", "monitoring_source", "src-1", "instagram:hashtag")
    expect(json.data.health).toBeTruthy()
  })

  it("routes external Instagram pages to approved search-index setup instead of inert manual mode", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      url: "https://www.instagram.com/patrulaz.az/",
      cadenceMinutes: 60,
      keywords: ["patrulaz"],
    }))

    expect(res.status).toBe(201)
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "page",
        collectionMode: "search_index",
        url: "https://www.instagram.com/patrulaz.az",
      },
      select: { id: true },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: "instagram",
        sourceType: "page",
        ownership: "external",
        url: "https://www.instagram.com/patrulaz.az",
        collectionMode: "search_index",
        cadenceMinutes: 360,
        riskLevel: "high",
        status: "needs_setup",
        settings: expect.objectContaining({
          blockedReasons: ["external_page_monitoring_requires_approved_provider_or_search_index"],
          searchIndex: expect.objectContaining({ domain: "instagram.com" }),
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
  })

  it("rejects a URL variant that resolves to an official identity", async () => {
    findMany.mockResolvedValueOnce([source({
      id: "official-source",
      platform: "instagram",
      sourceType: "profile",
      url: "https://www.instagram.com/ObaMarketler/?utm_source=old",
      query: null,
      ownership: "external",
      subjectSources: [{ relationType: "OFFICIAL" }],
    })] as never)

    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "profile",
      ownership: "external",
      handle: "@obamarketler",
    }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "official_identity_not_collectable" })
    expect(findFirst).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("ignores inert manual mode for external public page targets", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "profile",
      ownership: "external",
      collectionMode: "manual",
      url: "https://www.instagram.com/patrulaz.az/",
    }))

    expect(res.status).toBe(201)
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "profile",
        collectionMode: "search_index",
        url: "https://www.instagram.com/patrulaz.az",
      },
      select: { id: true },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: "instagram",
        sourceType: "profile",
        ownership: "external",
        collectionMode: "search_index",
        cadenceMinutes: 360,
        riskLevel: "high",
        status: "needs_setup",
        settings: expect.objectContaining({
          blockedReasons: ["external_page_monitoring_requires_approved_provider_or_search_index"],
          searchIndex: expect.objectContaining({ domain: "instagram.com" }),
        }),
      }),
    }))
  })

  it("persists a connected account identity for owned official page sources", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "owned",
      handle: "patrulaz.az",
      settings: { socialAccountId: "social-account-1" },
    }))

    expect(res.status).toBe(201)
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "page",
        collectionMode: "official_api",
        handle: "patrulaz.az",
      },
      select: { id: true },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: "instagram",
        sourceType: "page",
        ownership: "owned",
        collectionMode: "official_api",
        riskLevel: "low",
        status: "active",
        settings: expect.objectContaining({
          socialAccountId: "social-account-1",
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
  })

  it("creates an approved provider-backed page source without hardcoded adapters", async () => {
    mockState.role = "admin"
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      collectionMode: "provider_api",
      url: "https://www.instagram.com/patrulaz.az/",
      cadenceMinutes: 60,
      keywords: ["patrulaz"],
      settings: {
        provider: {
          approved: true,
          name: "generic-listener",
          endpoint: "https://listener.example.com/social/search",
          encryptedToken: "provider-ciphertext",
          reply: {
            approved: true,
            endpoint: "https://reply.example.com/social/reply",
            encryptedToken: "reply-ciphertext",
          },
        },
      },
    }))

    expect(res.status).toBe(201)
    expect(outboundMocks.validateMonitoringSourceOutboundEndpoints).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          endpoint: "https://listener.example.com/social/search",
          reply: expect.objectContaining({ endpoint: "https://reply.example.com/social/reply" }),
        }),
      }),
    )
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        platform: "instagram",
        sourceType: "page",
        collectionMode: "provider_api",
        url: "https://www.instagram.com/patrulaz.az",
      },
      select: { id: true },
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: "instagram",
        sourceType: "page",
        ownership: "external",
        url: "https://www.instagram.com/patrulaz.az",
        collectionMode: "provider_api",
        cadenceMinutes: 60,
        riskLevel: "high",
        status: "active",
        settings: expect.objectContaining({
          provider: {
            approved: true,
            name: "generic-listener",
            endpoint: "https://listener.example.com/social/search",
            encryptedToken: "provider-ciphertext",
            reply: {
              approved: true,
              endpoint: "https://reply.example.com/social/reply",
              encryptedToken: "reply-ciphertext",
            },
          },
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
  })

  it("does not let an API key redirect provider credentials through source settings", async () => {
    mockState.role = "admin"
    mockState.apiKey = true

    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      collectionMode: "provider_api",
      handle: "patrulaz.az",
      settings: {
        provider: {
          approved: true,
          endpoint: "https://attacker.example.com/collect",
          allowedHosts: ["attacker.example.com"],
        },
      },
    }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: "browser_admin_required" })
    expect(outboundMocks.validateMonitoringSourceOutboundEndpoints).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("does not let a manager change source outbound endpoints or tokens", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      collectionMode: "provider_api",
      handle: "patrulaz.az",
      settings: {
        provider: {
          approved: true,
          endpoint: "https://listener.example.com/collect",
          token: "new-secret",
        },
      },
    }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: "browser_admin_required" })
    expect(outboundMocks.validateMonitoringSourceOutboundEndpoints).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects live-send and auto-reply flags", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "hashtag",
      query: "#LeadDrive",
      settings: { liveExternalSendEnabled: true },
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain("Unsafe live-send flags")
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects unsafe nested provider live-reply flags", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      collectionMode: "provider_api",
      handle: "patrulaz.az",
      settings: {
        provider: {
          approved: true,
          endpoint: "https://listener.example.com/social/search",
          reply: {
            approved: true,
            endpoint: "https://reply.example.com/social/reply",
            autoReplyEnabled: true,
          },
        },
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain("settings.provider.reply.autoReplyEnabled")
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects provider endpoints that are not HTTPS", async () => {
    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      collectionMode: "provider_api",
      handle: "patrulaz.az",
      settings: {
        provider: {
          approved: true,
          endpoint: "http://listener.example.com/social/search",
        },
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Provider endpoint must use HTTPS")
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects a provider endpoint when DNS validation blocks it", async () => {
    mockState.role = "admin"
    outboundMocks.validateMonitoringSourceOutboundEndpoints.mockRejectedValueOnce(
      new Error("Provider endpoint must resolve only to public internet addresses"),
    )

    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "page",
      ownership: "external",
      collectionMode: "provider_api",
      handle: "patrulaz.az",
      settings: {
        provider: {
          approved: true,
          endpoint: "https://rebind.example.com/social/search",
        },
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Provider endpoint must resolve only to public internet addresses")
    expect(create).not.toHaveBeenCalled()
  })

  it("prevents duplicate targets even when an old client sends assignment fields", async () => {
    findFirst.mockResolvedValueOnce({ id: "existing" } as never)

    const res = await POST(request("/api/v1/social/monitoring-sources", {
      platform: "instagram",
      sourceType: "hashtag",
      query: "LeadDrive",
      subjectId: "legacy-subject",
      scenarioId: "legacy-scenario",
    }))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe("Monitoring source already exists")
    expect(create).not.toHaveBeenCalled()
  })
})

describe("GET/PATCH/DELETE /api/v1/social/monitoring-sources/[id]", () => {
  it("does not update or reactivate a source while clean-slate collection is blocked", async () => {
    mockState.fenceBlocked = true

    const res = await PATCH(new NextRequest("http://localhost/api/v1/social/monitoring-sources/src-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    }), params())

    expect(res.status).toBe(409)
    expect(findFirst).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("loads one source only through the active tenant", async () => {
    findFirst.mockResolvedValueOnce(source({ collectorRuns: [{ id: "run-1", status: "success", startedAt: now, finishedAt: now, foundCount: 2, newCount: 1, duplicateCount: 1, ignoredCount: 0, error: null }] }) as never)

    const res = await GET_ONE(request("/api/v1/social/monitoring-sources/src-1"), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "src-1", organizationId: "org-1" },
      include: expect.objectContaining({
        _count: {
          select: expect.objectContaining({
            providerRuns: { where: { purgedAt: null } },
          }),
        },
      }),
    }))
    expect(json.data.health.lastRun).toMatchObject({ id: "run-1", status: "success" })
    expect(json.data.readiness).toMatchObject({
      overall: "needs_setup",
      externalSendsDisabled: true,
    })
  })

  it("returns not found instead of crossing the tenant boundary for a foreign source", async () => {
    findFirst.mockResolvedValueOnce(null as never)

    const res = await GET_ONE(request("/api/v1/social/monitoring-sources/foreign-src"), params("foreign-src"))

    expect(res.status).toBe(404)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-src", organizationId: "org-1" },
    }))
  })

  it("updates a source after merged validation and duplicate guard", async () => {
    findFirst
      .mockResolvedValueOnce(source({ sourceType: "page", query: null, handle: "oldbrand", ownership: "owned", collectionMode: "official_api", riskLevel: "low", status: "active" }) as never)
      .mockResolvedValueOnce(null as never)

    const res = await PATCH(new NextRequest("http://localhost/api/v1/social/monitoring-sources/src-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "@Brand", cadenceMinutes: 30 }),
    }), params())

    expect(res.status).toBe(200)
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId: "org-1",
        id: { not: "src-1" },
        platform: "instagram",
        sourceType: "page",
        collectionMode: "official_api",
        handle: "brand",
      },
      select: { id: true },
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "src-1" },
      data: expect.objectContaining({
        handle: "brand",
        cadenceMinutes: 30,
        settings: expect.objectContaining({
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
    const json = await res.json()
    expect(json.data.readiness).toBeTruthy()
  })

  it("updates provider setup for an existing source", async () => {
    mockState.role = "admin"
    findFirst
      .mockResolvedValueOnce(source({ sourceType: "page", query: null, handle: "patrulaz.az", ownership: "external", collectionMode: "search_index" }) as never)
      .mockResolvedValueOnce(null as never)

    const res = await PATCH(new NextRequest("http://localhost/api/v1/social/monitoring-sources/src-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collectionMode: "provider_api",
        settings: {
          provider: {
            approved: true,
            endpoint: "https://listener.example.com/social/search",
            encryptedToken: "provider-ciphertext",
          },
        },
      }),
    }), params())

    expect(res.status).toBe(200)
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId: "org-1",
        id: { not: "src-1" },
        platform: "instagram",
        sourceType: "page",
        collectionMode: "provider_api",
        handle: "patrulaz.az",
      },
      select: { id: true },
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "src-1" },
      data: expect.objectContaining({
        collectionMode: "provider_api",
        status: "active",
        settings: expect.objectContaining({
          provider: {
            approved: true,
            endpoint: "https://listener.example.com/social/search",
            encryptedToken: "provider-ciphertext",
          },
          liveExternalSendEnabled: false,
          autoReplyEnabled: false,
        }),
      }),
    }))
  })

  it("deletes an existing source through delete permission", async () => {
    findFirst.mockResolvedValueOnce(source() as never)

    const res = await DELETE(request("/api/v1/social/monitoring-sources/src-1"), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(deleteSource).toHaveBeenCalledWith({ where: { id: "src-1" } })
    expect(audit).toHaveBeenCalledWith("org-1", "delete", "monitoring_source", "src-1", "instagram:hashtag", {
      newValue: { removedScenarioIds: [] },
    })
  })

  it("deletes a direct Source independently without mutating scenarios", async () => {
    findFirst.mockResolvedValueOnce(source({
      sourceType: "profile",
      url: "https://www.instagram.com/client-page",
      query: null,
    }) as never)

    const res = await DELETE(request("/api/v1/social/monitoring-sources/src-1"), params())

    expect(res.status).toBe(200)
    expect(getScenarios).not.toHaveBeenCalled()
    expect(updateScenario).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it("detaches collected artifacts inside one transaction so NoAction FKs cannot block the delete", async () => {
    findFirst.mockResolvedValueOnce(source() as never)

    const res = await DELETE(request("/api/v1/social/monitoring-sources/src-1"), params())

    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(detachEvidence).toHaveBeenCalledWith({
      where: { organizationId: "org-1", sourceId: "src-1" },
      data: { sourceId: null },
    })
    expect(detachLeads).toHaveBeenCalledWith({
      where: { organizationId: "org-1", sourceId: "src-1" },
      data: { sourceId: null },
    })
    expect(detachFingerprints).toHaveBeenCalledWith({
      where: { organizationId: "org-1", sourceId: "src-1" },
      data: { sourceId: null },
    })
    expect(detachEnvelopes).toHaveBeenCalledWith({
      where: { organizationId: "org-1", sourceId: "src-1" },
      data: { sourceId: null },
    })
    expect(detachEnvelopes).toHaveBeenCalledWith({
      where: { organizationId: "org-1", collectorRun: { sourceId: "src-1" } },
      data: { collectorRunId: null },
    })
    expect(detachEnvelopes).toHaveBeenCalledWith({
      where: { organizationId: "org-1", routePlan: { sourceId: "src-1" } },
      data: { routePlanId: null },
    })
    expect(detachEnvelopes).toHaveBeenCalledWith({
      where: { organizationId: "org-1", providerRun: { sourceId: "src-1" } },
      data: { providerRunId: null },
    })
    expect(detachSnapshots).toHaveBeenCalledWith({
      where: { organizationId: "org-1", providerRun: { sourceId: "src-1" } },
      data: { providerRunId: null },
    })
    const detachOrder = Math.min(
      detachEvidence.mock.invocationCallOrder[0],
      detachLeads.mock.invocationCallOrder[0],
      detachFingerprints.mock.invocationCallOrder[0],
      detachEnvelopes.mock.invocationCallOrder[0],
      detachSnapshots.mock.invocationCallOrder[0],
    )
    expect(detachOrder).toBeLessThan(deleteSource.mock.invocationCallOrder[0])
  })

  it("does not touch collected artifacts when the source is not in the tenant", async () => {
    findFirst.mockResolvedValueOnce(null as never)

    const res = await DELETE(request("/api/v1/social/monitoring-sources/foreign-src"), params("foreign-src"))

    expect(res.status).toBe(404)
    expect(transaction).not.toHaveBeenCalled()
    expect(deleteSource).not.toHaveBeenCalled()
  })
})

describe("monitoring source RBAC registration", () => {
  it("registers read/write/delete actions on the social module", () => {
    expect(mockState.registrations).toEqual(expect.arrayContaining([
      { module: "social", action: "read" },
      { module: "social", action: "write" },
      { module: "social", action: "delete" },
    ]))
  })
})
