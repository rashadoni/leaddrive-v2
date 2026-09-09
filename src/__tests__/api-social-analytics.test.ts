import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { socialMention: { findMany: vi.fn() } },
}))
vi.mock("@/lib/social/monitoring-rollups", () => ({
  getSocialMonitoringRollups: vi.fn(async () => ({
    surfaces: { posts: 0, comments: 0, replies: 0, other: 0 },
    surfaceByPlatform: [],
    providerCosts: [],
    providerTotals: { chargeUsd: 0, acceptedCount: 0, receivedCount: 0 },
    coverage: [],
  })),
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn() }))
let mockRole = "superadmin"
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (req: NextRequest, auth: { orgId: string; role: string }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", role: mockRole }),
}))

import { prisma } from "@/lib/prisma"
import { getSocialMonitoringRollups } from "@/lib/social/monitoring-rollups"
import { GET } from "@/app/api/v1/social/analytics/route"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const findMany = vi.mocked(prisma.socialMention.findMany)
const getRollups = vi.mocked(getSocialMonitoringRollups)

function request(days = 30): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/v1/social/analytics?days=${days}`) } as unknown as NextRequest
}

function mention(overrides: Record<string, unknown> = {}) {
  return {
    platform: "instagram",
    sentiment: "neutral",
    status: "new",
    sourceType: "post",
    contentKind: "POST",
    authorHandle: "author",
    authorName: "Author",
    matchedTerm: "brand",
    engagement: 1,
    reach: 2,
    publishedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRole = "superadmin"
})

describe("GET /api/v1/social/analytics", () => {
  it("excludes the telegram offset sentinel from the query", async () => {
    findMany.mockResolvedValue([])
    await GET(request())
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        externalId: { not: "__tg_offset__" },
        purgedAt: null,
        deletedAtSource: null,
        AND: [riskRelevantMentionWhere()],
      }),
    }))
    expect(getRollups).toHaveBeenCalledWith("org-1", expect.any(Date))
  })

  it("aggregates posts-vs-comments surfaces and a comments breakdown", async () => {
    findMany.mockResolvedValue([
      mention({ sourceType: "post", contentKind: "POST" }),
      mention({ sourceType: "mention", contentKind: "MENTION", platform: "twitter" }),
      mention({ sourceType: "unknown", contentKind: "COMMENT", sentiment: "Negative", platform: "youtube" }),
      // Ответы считаются и в fallback-поверхностях: тенанты не получают
      // operationalRollups, и карточка поверхностей строится из data.surfaces.
      mention({ sourceType: "unknown", contentKind: "REPLY", platform: "facebook" }),
      mention({ sourceType: "dm", contentKind: "DM" }),
      mention({ sourceType: "unknown", contentKind: "UNKNOWN" }),
    ] as never)

    const res = await GET(request())
    const { data } = await res.json()

    expect(data.surfaces).toEqual({ posts: 2, comments: 1, replies: 1, other: 2 })
    expect(data.commentsBreakdown.total).toBe(1)
    expect(data.commentsBreakdown.sentiment).toEqual({ positive: 0, neutral: 0, negative: 1 })
    expect(data.commentsBreakdown.byPlatform).toEqual([
      { platform: "youtube", count: 1 },
    ])
    // existing aggregates unaffected
    expect(data.totals.mentions).toBe(6)
    expect(data.sentiment).toEqual({ positive: 0, neutral: 5, negative: 1 })
  })

  it("returns operational rollups to the superadmin", async () => {
    findMany.mockResolvedValue([])
    const res = await GET(request())
    const { data } = await res.json()
    expect(getRollups).toHaveBeenCalledWith("org-1", expect.any(Date))
    expect(data.operationalRollups).not.toBeNull()
  })

  it("hides operational rollups (provider costs) from tenant users", async () => {
    mockRole = "admin"
    findMany.mockResolvedValue([])
    const res = await GET(request())
    const { data } = await res.json()
    expect(getRollups).not.toHaveBeenCalled()
    expect(data.operationalRollups).toBeNull()
  })
})
