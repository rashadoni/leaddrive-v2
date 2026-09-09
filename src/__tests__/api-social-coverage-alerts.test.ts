import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const withTenantFence = vi.hoisted(() => vi.fn())

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSource: {
      findMany: vi.fn(),
    },
    socialMention: {
      findMany: vi.fn(),
    },
    aiAlert: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))

import { POST } from "@/app/api/v1/social/coverage-alerts/route"
import { prisma } from "@/lib/prisma"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const findSources = vi.mocked(prisma.monitoringSource.findMany)
const findMentions = vi.mocked(prisma.socialMention.findMany)
const findAlerts = vi.mocked(prisma.aiAlert.findMany)
const createAlert = vi.mocked(prisma.aiAlert.create)

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/coverage-alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true as const, value: await collect() }))
  findSources.mockResolvedValue([
    { id: "src-1", platform: "instagram", sourceType: "hashtag", collectionMode: "search_index", status: "limited", lastError: "rate_limited" },
  ])
  findMentions.mockResolvedValue([
    {
      id: "m-1",
      platform: "facebook",
      sourceType: "mention",
      sourceProvider: "native",
      sourceMetadata: { socialTriage: { leadIntent: true, complaint: false, relevanceScore: 88 } },
      authorName: "Aysel",
      authorHandle: "aysel",
      text: "Please contact me",
      sentiment: "neutral",
      matchedTerm: "demo",
      reach: 100,
      engagement: 10,
      cluster: null,
    },
  ])
  findAlerts.mockResolvedValue([])
  createAlert.mockResolvedValue({ id: "alert-1" })
})

describe("POST /api/v1/social/coverage-alerts", () => {
  it("evaluates rules and writes deduped social coverage alerts", async () => {
    const res = await POST(request({ limit: 50 }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.evaluated).toBeGreaterThanOrEqual(2)
    expect(json.data.created).toBeGreaterThanOrEqual(2)
    expect(findSources).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
    }))
    expect(findMentions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        externalId: { not: "__tg_offset__" },
        purgedAt: null,
        deletedAtSource: null,
        AND: [riskRelevantMentionWhere()],
      }),
      take: 50,
    }))
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        type: "social_coverage_rule",
      }),
    }))
  })

  it("returns 409 without reading findings when the clean-slate fence is closed", async () => {
    withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    const res = await POST(request({ limit: 50 }))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe("social_monitoring_collection_blocked")
    expect(findSources).not.toHaveBeenCalled()
    expect(findMentions).not.toHaveBeenCalled()
    expect(findAlerts).not.toHaveBeenCalled()
    expect(createAlert).not.toHaveBeenCalled()
  })
})
