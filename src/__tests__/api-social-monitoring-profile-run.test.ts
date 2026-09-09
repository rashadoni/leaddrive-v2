import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler<C = unknown> = (req: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>

const mocks = vi.hoisted(() => ({
  role: "admin",
  findLink: vi.fn(),
  countProofs: vi.fn(),
  compilePlans: vi.fn(),
  getScenarios: vi.fn(),
  runSource: vi.fn(),
  fenceBlocked: false,
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mocks.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => {
      if (mocks.fenceBlocked) {
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
        role: mocks.role,
      }, ctx)
    }
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubjectSource: { findFirst: mocks.findLink },
    socialProviderCapabilityProof: { count: mocks.countProofs },
  },
}))

vi.mock("@/lib/social/monitoring-scenarios", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/social/monitoring-scenarios")>(),
  getMonitoringScenariosUncached: mocks.getScenarios,
}))

vi.mock("@/lib/social/monitoring-collector", () => ({
  runMonitoringSourceNow: mocks.runSource,
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  compileSourceRoutePlans: mocks.compilePlans,
  ROUTE_ADAPTERS: {
    BRIGHT_DATA_SNAPSHOT: "BRIGHT_DATA_SNAPSHOT",
    APIFY_ASYNC: "APIFY_ASYNC",
    META_GRAPH: "META_GRAPH",
  },
  SOURCE_ROUTE_POLICY_VERSION: "test-policy-v1",
}))

vi.mock("@/lib/social/bright-data-live-routing", () => ({
  isBrightDataLiveRoutingAllowed: () => true,
}))

import { POST } from "@/app/api/v1/social/monitoring-profiles/[id]/run/route"

const archiveStartAt = "2026-07-01T00:00:00.000Z"

const activeScenario = {
  id: "scenario-a",
  subjectId: "subject-a",
  status: "active",
  platforms: ["instagram"],
  search: {
    topics: [],
    keywords: ["Baku Electronics"],
    hashtags: [],
    urls: ["https://www.instagram.com/bakuelectronics"],
    handles: [],
    useHashtagFallback: true,
    includeOwnedComments: true,
    includeExternalComments: false,
  },
  archive: {
    startAt: archiveStartAt,
    lastBackfilledAt: null,
    scannedCount: 0,
    matchedCount: 0,
    status: "pending",
  },
}

const freeLink = {
  scenarioId: "scenario-a",
  relationType: "MONITORS",
  subject: { status: "active" },
  source: {
    id: "source-a",
    organizationId: "org-1",
    platform: "instagram",
    sourceType: "keyword",
    url: null,
    handle: null,
    query: "Baku Electronics",
    ownership: "external",
    collectionMode: "search_index",
    cadenceMinutes: 360,
    status: "active",
    settings: { scenarioLinks: [{ scenarioId: "scenario-a" }] },
    routePlans: [{
      routeKey: "source:source-a:current",
      scenarioId: "scenario-a",
      policyVersion: "test-policy-v1",
      capability: "DISCOVER_POSTS",
      status: "ACTIVE",
      primaryAdapter: "META_GRAPH",
      fallbackAdapters: [],
      capabilityProofId: "proof-meta",
      dependsOnCapability: null,
      budget: {},
    }],
    _count: { subjectSources: 1 },
  },
}

function paidExternalCommentLink(
  commentPlanOverrides: Record<string, unknown> = {},
) {
  const discoveryPlan = {
    ...freeLink.source.routePlans[0],
    primaryAdapter: "APIFY_ASYNC",
    fallbackAdapters: [],
    capabilityProofId: null,
    budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 1.5 },
  }
  return {
    ...freeLink,
    source: {
      ...freeLink.source,
      routePlans: [
        discoveryPlan,
        {
          ...discoveryPlan,
          routeKey: "source:source-a:scenario-a:READ_EXTERNAL_COMMENTS",
          capability: "READ_EXTERNAL_COMMENTS",
          status: "ACTIVE",
          dependsOnCapability: "DISCOVER_POSTS",
          ...commentPlanOverrides,
        },
      ],
    },
  }
}

function request(body: unknown) {
  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? { fullArchiveConfirmed: true, ...body }
    : body
  return new NextRequest("http://localhost/api/v1/social/monitoring-profiles/subject-a/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function params(id = "subject-a") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = "admin"
  mocks.fenceBlocked = false
  mocks.findLink.mockResolvedValue(freeLink)
  mocks.countProofs.mockResolvedValue(0)
  mocks.compilePlans.mockResolvedValue(freeLink.source.routePlans)
  mocks.getScenarios.mockResolvedValue([activeScenario])
  mocks.runSource.mockResolvedValue({
    runId: "collector-a",
    sourceId: "source-a",
    status: "success",
    foundCount: 2,
    newCount: 1,
    duplicateCount: 1,
    ignoredCount: 0,
  })
})

describe("POST /api/v1/social/monitoring-profiles/[id]/run", () => {
  it("does not read or recompile a source while clean-slate collection is blocked", async () => {
    mocks.fenceBlocked = true

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    expect(mocks.findLink).not.toHaveBeenCalled()
    expect(mocks.getScenarios).not.toHaveBeenCalled()
    expect(mocks.compilePlans).not.toHaveBeenCalled()
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("requires an explicit confirmation for a manual full-archive run", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/v1/social/monitoring-profiles/subject-a/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: "scenario-a",
          sourceId: "source-a",
        }),
      },
    ), params())

    expect(response.status).toBe(400)
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("revalidates profile membership and scopes the collector to the requested scenario", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        // Legacy profile sources may be correctly linked in the relation table
        // while their denormalized settings do not contain scenarioLinks.
        settings: { scenarioLinks: [] },
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.findLink).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        subjectId: "subject-a",
        sourceId: "source-a",
      },
    }))
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", {
      fullArchiveRun: true,
      maxTotalChargeUsd: undefined,
      requestedByUserId: "user-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
      paidRunConfirmed: false,
      clientFundedManual: false,
      providerAccountFunded: false,
    })
  })

  it("accepts includeComments=false without forwarding an enabled override", async () => {
    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      includeComments: false,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledOnce()
    expect(mocks.runSource.mock.calls[0]?.[2]).not.toHaveProperty("includeComments")
  })

  it("requires a confirmed client-funded run before enabling external comments", async () => {
    mocks.getScenarios.mockResolvedValue([{
      ...activeScenario,
      search: {
        ...activeScenario.search,
        includeExternalComments: true,
      },
    }])
    mocks.findLink.mockResolvedValue(paidExternalCommentLink())

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      includeComments: true,
    }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "external_comments_run_not_authorized",
      reason: "paid_client_funded_route_required",
    })
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("fails closed when the scenario has not enabled external comments", async () => {
    mocks.findLink.mockResolvedValue(paidExternalCommentLink())

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      includeComments: true,
    }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "external_comments_run_not_authorized",
      reason: "scenario_external_comments_disabled",
    })
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("applies the same scenario opt-in and paid confirmation guards to comments-only", async () => {
    mocks.findLink.mockResolvedValue(paidExternalCommentLink())

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      commentsOnly: true,
    }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "external_comments_run_not_authorized",
      reason: "scenario_external_comments_disabled",
    })
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it.each([
    ["neutral", { scenarioId: null }],
    ["blocked", { status: "BLOCKED" }],
    ["fallback-only", {
      primaryAdapter: "META_GRAPH",
      fallbackAdapters: ["APIFY_ASYNC"],
    }],
    ["wrong dependency", { dependsOnCapability: "ENRICH_CONTENT" }],
  ])("fails closed for a %s external-comment route", async (_label, overrides) => {
    mocks.getScenarios.mockResolvedValue([{
      ...activeScenario,
      search: {
        ...activeScenario.search,
        includeExternalComments: true,
      },
    }])
    mocks.findLink.mockResolvedValue(paidExternalCommentLink(overrides))

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      includeComments: true,
    }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "external_comments_run_not_authorized",
      reason: "scenario_apify_comment_route_required",
    })
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("forwards includeComments only for an authorized scenario Apify comment route", async () => {
    mocks.getScenarios.mockResolvedValue([{
      ...activeScenario,
      search: {
        ...activeScenario.search,
        includeExternalComments: true,
      },
    }])
    mocks.findLink.mockResolvedValue(paidExternalCommentLink({
      status: "DEGRADED",
    }))

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      includeComments: true,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith(
      "org-1",
      "source-a",
      expect.objectContaining({
        paidRunConfirmed: true,
        clientFundedManual: true,
        includeComments: true,
      }),
    )
  })

  it("dispatches an authorized profile-scoped comments-only pass without rerunning discovery", async () => {
    mocks.getScenarios.mockResolvedValue([{
      ...activeScenario,
      search: {
        ...activeScenario.search,
        includeExternalComments: true,
      },
    }])
    mocks.findLink.mockResolvedValue(paidExternalCommentLink())

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      commentsOnly: true,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", {
      fullArchiveRun: false,
      maxTotalChargeUsd: undefined,
      requestedByUserId: "user-1",
      onlyCapability: "READ_EXTERNAL_COMMENTS",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
      paidRunConfirmed: true,
      clientFundedManual: true,
      providerAccountFunded: false,
      includeComments: true,
    })
  })

  it("allows an ENRICH_CONTENT dependency only for the explicit comments-only pass", async () => {
    mocks.getScenarios.mockResolvedValue([{
      ...activeScenario,
      search: {
        ...activeScenario.search,
        includeExternalComments: true,
      },
    }])
    mocks.findLink.mockResolvedValue(paidExternalCommentLink({
      dependsOnCapability: "ENRICH_CONTENT",
    }))

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      commentsOnly: true,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith(
      "org-1",
      "source-a",
      expect.objectContaining({
        onlyCapability: "READ_EXTERNAL_COMMENTS",
        includeComments: true,
      }),
    )
  })

  it("never dispatches a detached or cross-profile source", async () => {
    mocks.findLink.mockResolvedValue(null)

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-other",
    }), params())

    expect(response.status).toBe(404)
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("never dispatches the brand's official page as an external source", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      relationType: "OFFICIAL",
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "official_identity_not_collectable",
    })
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("rechecks the profile, scenario, and source lifecycle before every dispatch", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      subject: { status: "paused" },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("rejects a source explicitly linked only to a different scenario", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      scenarioId: "scenario-b",
      source: {
        ...freeLink.source,
        settings: { scenarioLinks: [{ scenarioId: "scenario-b" }] },
        routePlans: [{
          ...freeLink.source.routePlans[0],
          scenarioId: "scenario-b",
        }],
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("dispatches the managed Google Alerts RSS source for an additive WEB scenario", async () => {
    const rssScenario = {
      ...activeScenario,
      platforms: ["web"],
      web: {
        sourceMode: "google_alerts_rss",
        googleAlertsRssConfigured: true,
      },
      search: {
        ...activeScenario.search,
        keywords: ["Araz Supermarket"],
        urls: [],
      },
    }
    const rssLink = {
      ...freeLink,
      source: {
        ...freeLink.source,
        id: "rss-source",
        platform: "web",
        sourceType: "notification_inbox",
        collectionMode: "notification_inbox",
        url: null,
        handle: null,
        query: "google-alerts-rss:scenario-a",
        settings: {
          managedBy: "google_alerts_rss",
          scenarioId: "scenario-a",
          scenarioName: "Araz Supermarket",
          scenarioLinks: [{ scenarioId: "scenario-a" }],
        },
        routePlans: [{
          ...freeLink.source.routePlans[0],
          routeKey: "source:rss-source:current",
          primaryAdapter: "GOOGLE_ALERTS_RSS",
          capabilityProofId: null,
        }],
      },
    }
    mocks.getScenarios.mockResolvedValue([rssScenario])
    mocks.findLink.mockResolvedValue(rssLink)

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "rss-source",
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.compilePlans).not.toHaveBeenCalled()
    expect(mocks.runSource).toHaveBeenCalledWith(
      "org-1",
      "rss-source",
      expect.objectContaining({
        targetScenarioId: "scenario-a",
        targetSubjectId: "subject-a",
        archiveStartAt,
        paidRunConfirmed: false,
        clientFundedManual: false,
        providerAccountFunded: false,
      }),
    )
  })

  // WEB собирается только лентой Google Alerts: прежний keyword-источник
  // больше не входит в план сценария, и ручной запуск по нему обязан
  // отказать, а не крутить обход изданий (решение владельца 2026-08-01).
  it("отказывает в ручном запуске устаревшего прямого WEB-источника", async () => {
    mocks.getScenarios.mockResolvedValue([{
      ...activeScenario,
      platforms: ["web"],
      web: {
        sourceMode: "google_alerts_rss",
        googleAlertsRssConfigured: true,
      },
      search: {
        ...activeScenario.search,
        keywords: ["Araz Supermarket"],
        urls: [],
      },
    }])
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        platform: "web",
        sourceType: "keyword",
        collectionMode: "search_index",
        url: null,
        handle: null,
        query: "Araz Supermarket",
        settings: {
          scenarioId: "scenario-a",
          scenarioLinks: [{ scenarioId: "scenario-a" }],
        },
        routePlans: [{
          ...freeLink.source.routePlans[0],
          scenarioId: "scenario-a",
        }],
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("requires confirmation and forwards an optional client-funded provider cap", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        routePlans: [{
          ...freeLink.source.routePlans[0],
          scenarioId: "scenario-a",
          status: "ACTIVE",
          primaryAdapter: "APIFY_ASYNC",
          fallbackAdapters: [],
          budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 1.5 },
        }],
      },
    })

    const unconfirmed = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())
    expect(unconfirmed.status).toBe(409)
    expect(mocks.runSource).not.toHaveBeenCalled()

    const confirmed = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      maxTotalChargeUsd: 1.5,
    }), params())
    expect(confirmed.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", {
      fullArchiveRun: true,
      maxTotalChargeUsd: 1.5,
      requestedByUserId: "user-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
      paidRunConfirmed: true,
      clientFundedManual: true,
      providerAccountFunded: false,
    })
  })

  it("uses the server-side client-funded fuse when the paid request omits a cap", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        routePlans: [{
          ...freeLink.source.routePlans[0],
          scenarioId: "scenario-a",
          status: "ACTIVE",
          primaryAdapter: "APIFY_ASYNC",
          fallbackAdapters: [],
          budget: {},
        }],
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", {
      fullArchiveRun: true,
      maxTotalChargeUsd: undefined,
      requestedByUserId: "user-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
      paidRunConfirmed: true,
      clientFundedManual: true,
      providerAccountFunded: false,
    })
  })

  it("never dispatches a source explicitly assigned across scenarios as a neutral shared source", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        settings: {
          scenarioLinks: [{ scenarioId: "scenario-a" }, { scenarioId: "scenario-b" }],
        },
        _count: { subjectSources: 2 },
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "monitoring_shared_source_confirmation_required",
    })
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("runs a source assigned to this and another scenario after full-search confirmation", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        settings: {
          scenarioLinks: [{ scenarioId: "scenario-a" }, { scenarioId: "scenario-b" }],
        },
        _count: { subjectSources: 2 },
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      fullSearchConfirmed: true,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", expect.objectContaining({
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
    }))
  })

  it("runs a neutral shared query only after full-search confirmation and scopes it to one subject", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      scenarioId: null,
      source: {
        ...freeLink.source,
        settings: {},
        routePlans: [{
          ...freeLink.source.routePlans[0],
          scenarioId: null,
        }],
        _count: { subjectSources: 2 },
      },
    })

    const unconfirmed = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())
    expect(unconfirmed.status).toBe(409)
    expect(mocks.runSource).not.toHaveBeenCalled()

    const confirmed = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      fullSearchConfirmed: true,
    }), params())
    expect(confirmed.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", {
      fullArchiveRun: true,
      maxTotalChargeUsd: undefined,
      requestedByUserId: "user-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
      paidRunConfirmed: false,
      clientFundedManual: false,
      providerAccountFunded: false,
    })
  })

  it("does not pass a local USD cap for a confirmed Bright Data-only route", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        routePlans: [{
          ...freeLink.source.routePlans[0],
          scenarioId: "scenario-a",
          status: "ACTIVE",
          primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
          fallbackAdapters: [],
          budget: { usdLimitsConfigured: false },
        }],
      },
    })

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.runSource).toHaveBeenCalledWith("org-1", "source-a", {
      fullArchiveRun: true,
      maxTotalChargeUsd: undefined,
      requestedByUserId: "user-1",
      targetScenarioId: "scenario-a",
      targetSubjectId: "subject-a",
      archiveStartAt,
      paidRunConfirmed: true,
      clientFundedManual: true,
      providerAccountFunded: true,
    })
  })

  it("permits only tenant admins to initiate profile runs", async () => {
    mocks.role = "manager"

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(403)
    expect(mocks.findLink).not.toHaveBeenCalled()
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("refreshes a stale free plan and requires paid confirmation before dispatch", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        routePlans: [{
          ...freeLink.source.routePlans[0],
          primaryAdapter: "META_GRAPH",
          fallbackAdapters: [],
          capabilityProofId: "proof-meta",
        }],
      },
    })
    mocks.countProofs.mockResolvedValue(1)
    mocks.compilePlans.mockResolvedValue([{
      ...freeLink.source.routePlans[0],
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: [],
      capabilityProofId: "proof-bright-data",
      budget: { usdLimitsConfigured: false },
    }])

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
    }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "paid_run_confirmation_required",
      providerAccountFundedOnly: true,
    })
    expect(mocks.compilePlans).toHaveBeenCalledOnce()
    expect(mocks.runSource).not.toHaveBeenCalled()
  })

  it("does not treat a current Meta Apify route as stale when a Bright Data proof exists", async () => {
    mocks.findLink.mockResolvedValue({
      ...freeLink,
      source: {
        ...freeLink.source,
        routePlans: [{
          ...freeLink.source.routePlans[0],
          primaryAdapter: "APIFY_ASYNC",
          fallbackAdapters: [],
          capabilityProofId: null,
          budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 1.5 },
        }],
      },
    })
    mocks.countProofs.mockResolvedValue(1)

    const response = await POST(request({
      scenarioId: "scenario-a",
      sourceId: "source-a",
      paidConfirmed: true,
      maxTotalChargeUsd: 1.5,
    }), params())

    expect(response.status).toBe(200)
    expect(mocks.countProofs).not.toHaveBeenCalled()
    expect(mocks.compilePlans).not.toHaveBeenCalled()
    expect(mocks.runSource).toHaveBeenCalledOnce()
  })

  it("registers the route on the social write permission", () => {
    expect(mocks.registrations).toContainEqual({ module: "social", action: "write" })
  })
})
