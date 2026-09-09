import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext, context: { params: Promise<{ id: string }> }) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, context),
}))

const deps = vi.hoisted(() => ({
  findMany: vi.fn(),
  findManySubjects: vi.fn(),
  findManySubjectSources: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  replayIngestEnvelope: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (
    _module: string,
    _action: string,
    handler: RouteHandler,
  ) => (
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => handler(
    req,
    { orgId: "org-1", userId: "user-1", role: "manager" },
    context,
  ),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ingestEnvelope: {
      findMany: deps.findMany,
      count: deps.count,
      groupBy: deps.groupBy,
      findFirst: deps.findFirst,
      updateMany: deps.updateMany,
    },
    monitoringSubject: {
      findMany: deps.findManySubjects,
    },
    monitoringSubjectSource: {
      findMany: deps.findManySubjectSources,
    },
  },
  logAudit: deps.logAudit,
}))

vi.mock("@/lib/social/ingest-envelope-replay", () => ({
  replayIngestEnvelope: deps.replayIngestEnvelope,
}))

import { GET } from "@/app/api/v1/social/ingest-envelopes/route"
import { POST } from "@/app/api/v1/social/ingest-envelopes/[id]/resolve/route"
import { operatorActionableReviewReasonWhere } from "@/lib/social/review-queue-policy"

function listRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/social/ingest-envelopes${query}`)
}

function resolveRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v1/social/ingest-envelopes/envelope-1/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: "envelope-1" }) }

function reviewRow(
  id: string,
  text: string,
  contentKind = "POST",
  createdAt = new Date("2026-07-23T10:00:00.000Z"),
) {
  return {
    id,
    platform: "WEB",
    contentKind,
    text,
    url: `https://example.com/${id}`,
    canonicalUrl: null,
    parentPostUrl: null,
    publishedAt: null,
    relevanceReason: "manual_review_required",
    matchedTerms: ["Baku Electronics"],
    providerKey: "apify",
    subjectDecision: {},
    policySnapshot: {},
    source: null,
    routePlan: null,
    providerRun: null,
    tiktokPublicationRevisit: null,
    createdAt,
    purgeAt: new Date("2026-07-30T10:00:00.000Z"),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.findMany.mockResolvedValue([])
  deps.findManySubjects.mockResolvedValue([])
  deps.findManySubjectSources.mockResolvedValue([])
  deps.count.mockResolvedValue(0)
  deps.groupBy.mockResolvedValue([])
  deps.findFirst.mockResolvedValue({
    id: "envelope-1",
    acceptedMentionId: null,
    relevanceStatus: "REVIEW",
    relevanceReason: "manual_review_required",
    relevanceConfidence: 0.72,
    purgedAt: null,
    purgeAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date("2026-07-23T11:00:00.000Z"),
    discoveryAutoReviewDecisions: [],
  })
  deps.updateMany.mockResolvedValue({ count: 1 })
  deps.replayIngestEnvelope.mockResolvedValue({
    status: "REPLAYED",
    envelopeId: "envelope-1",
    mentionId: "mention-1",
    created: true,
    reviewSubjectId: "subject-1",
  })
})

describe("GET /api/v1/social/ingest-envelopes", () => {
  it("lists only the tenant's unexpired REVIEW envelopes", async () => {
    const res = await GET(listRequest("?limit=20"))
    expect(res.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        relevanceStatus: "REVIEW",
        acceptedMentionId: null,
        purgedAt: null,
        deletedAtSource: null,
        purgeAt: { gt: expect.any(Date) },
        discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
        AND: expect.arrayContaining([
          operatorActionableReviewReasonWhere(),
        ]),
      }),
      take: 21,
    }))
    expect(deps.count).toHaveBeenCalledWith({
      where: deps.findMany.mock.calls[0][0].where,
    })
    expect(deps.findManySubjectSources).not.toHaveBeenCalled()
  })

  it("excludes automatic review and internal context from rows and every queue count", async () => {
    const res = await GET(listRequest("?limit=20"))

    expect(res.status).toBe(200)
    const calls = [
      deps.findMany.mock.calls[0][0],
      ...deps.count.mock.calls.map(([args]) => args),
    ]
    expect(calls).toHaveLength(6)
    for (const args of calls) {
      expect(args.where.AND).toEqual(expect.arrayContaining([
        operatorActionableReviewReasonWhere(),
      ]))
    }
  })

  it("applies the selected mention query to the review queue", async () => {
    const res = await GET(listRequest("?limit=20&q=B%C9%99hruz%20%C5%9Eiraliyev"))

    expect(res.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { text: { contains: "Bəhruz Şiraliyev", mode: "insensitive" } },
          { url: { contains: "Bəhruz Şiraliyev", mode: "insensitive" } },
          { canonicalUrl: { contains: "Bəhruz Şiraliyev", mode: "insensitive" } },
          { source: { is: { query: { contains: "Bəhruz Şiraliyev", mode: "insensitive" } } } },
          {
            source: {
              is: {
                subjectSources: {
                  some: { subject: { name: { contains: "Bəhruz Şiraliyev", mode: "insensitive" } } },
                },
              },
            },
          },
        ]),
      }),
    }))
  })

  it("excludes the selected brand's owned web and social publications from review", async () => {
    deps.findManySubjects.mockResolvedValueOnce([{
      id: "subject-baku",
      legacyScenarioId: "scenario-baku",
      name: "Baku Electronics",
      aliases: [
        { kind: "DOMAIN", value: "bakuelectronics.az" },
        { kind: "HANDLE", value: "bakuelectronics" },
      ],
      sources: [
        {
          source: {
            id: "owned-web",
            platform: "web",
            sourceType: "page",
            handle: null,
            url: "https://bakuelectronics.az",
          },
        },
        {
          source: {
            id: "owned-instagram",
            platform: "instagram",
            sourceType: "profile",
            handle: "bakuelectronics",
            url: "https://www.instagram.com/bakuelectronics/",
          },
        },
      ],
    }])
    deps.findManySubjectSources.mockResolvedValueOnce([
      {
        sourceId: "source-baku-search",
        scenarioId: "scenario-baku",
        source: { subjectSources: [{ subjectId: "subject-baku" }] },
      },
    ])

    const res = await GET(listRequest("?limit=20&subjectId=subject-baku"))

    expect(res.status).toBe(200)
    expect(deps.findManySubjects).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: "subject-baku",
        status: { not: "deleted" },
      }),
    }))
    expect(deps.findManySubjectSources).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        subjectId: "subject-baku",
      },
      select: {
        sourceId: true,
        scenarioId: true,
        source: {
          select: {
            subjectSources: {
              where: {
                subject: { status: { not: "deleted" } },
              },
              select: { subjectId: true },
            },
          },
        },
      },
    })
    const serializedWhere = JSON.stringify(deps.findMany.mock.calls[0][0].where)
    expect(serializedWhere).toContain('"routePlan":{"is":{"scenarioId":{"in":["scenario-baku"]}}}')
    expect(serializedWhere).toContain('"providerRun":{"is":{"routePlan":{"is":{"scenarioId":{"in":["scenario-baku"]}}}}}')
    expect(serializedWhere).toContain('"sourceId":{"in":["source-baku-search"]}')
    expect(serializedWhere).not.toContain('"contains":"Baku Electronics"')
    expect(serializedWhere).toContain('"NOT"')
    expect(serializedWhere).toContain('"sourceId":{"in":["owned-web","owned-instagram"]}')
    expect(serializedWhere).toContain('"startsWith":"https://bakuelectronics.az/"')
    expect(serializedWhere).toContain('"startsWith":"https://instagram.com/bakuelectronics/"')
    expect(serializedWhere).toContain('"contentKind":{"notIn":["COMMENT","REPLY"]}')
    expect(serializedWhere).not.toContain('"parentPostUrl"')
  })

  it("rejects an unknown, deleted, or cross-tenant subject before reading review rows", async () => {
    const res = await GET(listRequest("?limit=20&subjectId=subject-unavailable"))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toBe("Monitoring subject not found")
    expect(deps.findManySubjects).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: { not: "deleted" },
        id: "subject-unavailable",
      },
    }))
    expect(deps.findManySubjectSources).not.toHaveBeenCalled()
    expect(deps.findMany).not.toHaveBeenCalled()
    expect(deps.count).not.toHaveBeenCalled()
  })

  it("fails closed when a valid subject has no persisted scenario or source provenance", async () => {
    deps.findManySubjects.mockResolvedValueOnce([{
      id: "subject-unlinked",
      legacyScenarioId: null,
      name: "Unlinked brand",
      aliases: [],
      sources: [],
    }])

    const res = await GET(listRequest("?limit=20&subjectId=subject-unlinked"))

    expect(res.status).toBe(200)
    expect(deps.findMany.mock.calls[0][0].where).toMatchObject({
      AND: expect.arrayContaining([
        { id: { in: [] } },
      ]),
    })
  })

  it("keeps a manual q filter in addition to exact subject provenance", async () => {
    deps.findManySubjects.mockResolvedValueOnce([{
      id: "subject-baku",
      legacyScenarioId: null,
      name: "Baku Electronics",
      aliases: [],
      sources: [],
    }])
    deps.findManySubjectSources.mockResolvedValueOnce([
      {
        sourceId: "source-baku-search",
        scenarioId: null,
        source: { subjectSources: [{ subjectId: "subject-baku" }] },
      },
    ])

    const res = await GET(listRequest("?limit=20&subjectId=subject-baku&q=campaign"))

    expect(res.status).toBe(200)
    const where = deps.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      OR: expect.arrayContaining([
        { text: { contains: "campaign", mode: "insensitive" } },
      ]),
      AND: expect.arrayContaining([
        {
          OR: expect.arrayContaining([
            {
              AND: expect.arrayContaining([
                { sourceId: { in: ["source-baku-search"] } },
              ]),
            },
          ]),
        },
      ]),
    })
  })

  it("requires the selected scenario and never falls back through a shared source", async () => {
    deps.findManySubjects.mockResolvedValueOnce([{
      id: "subject-baku",
      legacyScenarioId: "scenario-baku",
      name: "Baku Electronics",
      aliases: [],
      sources: [],
    }])
    deps.findManySubjectSources.mockResolvedValueOnce([
      {
        sourceId: "source-shared",
        scenarioId: "scenario-baku",
        source: {
          subjectSources: [
            { subjectId: "subject-baku" },
            { subjectId: "subject-other" },
          ],
        },
      },
      {
        sourceId: "source-exclusive",
        scenarioId: null,
        source: { subjectSources: [{ subjectId: "subject-baku" }] },
      },
    ])

    const res = await GET(listRequest("?limit=20&subjectId=subject-baku"))

    expect(res.status).toBe(200)
    const subjectScope = deps.findMany.mock.calls[0][0].where.AND.find(
      (clause: unknown) => JSON.stringify(clause).includes("scenario-baku"),
    )
    expect(subjectScope).toEqual({
      OR: [
        {
          routePlan: {
            is: { scenarioId: { in: ["scenario-baku"] } },
          },
        },
        {
          AND: [
            {
              OR: [
                { routePlanId: null },
                { routePlan: { is: { scenarioId: null } } },
              ],
            },
            {
              providerRun: {
                is: {
                  routePlan: {
                    is: { scenarioId: { in: ["scenario-baku"] } },
                  },
                },
              },
            },
          ],
        },
        {
          AND: [
            {
              OR: [
                { routePlanId: null },
                { routePlan: { is: { scenarioId: null } } },
              ],
            },
            {
              OR: [
                { providerRunId: null },
                {
                  providerRun: {
                    is: {
                      routePlan: { is: { scenarioId: null } },
                    },
                  },
                },
              ],
            },
            { sourceId: { in: ["source-exclusive"] } },
          ],
        },
      ],
    })
    expect(JSON.stringify(subjectScope)).not.toContain("source-shared")
    expect(JSON.stringify(subjectScope)).not.toContain("scenario-other")
  })

  it("returns the full filtered total instead of presenting the page size as the queue size", async () => {
    deps.count.mockResolvedValueOnce(280)

    const res = await GET(listRequest("?limit=20&platform=facebook"))
    const json = await res.json()

    expect(json.data.envelopes).toHaveLength(0)
    expect(json.data.total).toBe(280)
    expect(deps.count.mock.calls[0][0].where).toEqual(deps.findMany.mock.calls[0][0].where)
  })

  it("returns a stable cursor for the next review page without changing the full total", async () => {
    deps.findMany.mockResolvedValueOnce(Array.from({ length: 3 }, (_, index) => ({
      id: `envelope-${3 - index}`,
      platform: "WEB",
      contentKind: "POST",
      text: `Candidate ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      canonicalUrl: null,
      parentPostUrl: null,
      publishedAt: null,
      relevanceReason: "discovery_missing_published_at",
      matchedTerms: ["Baku Electronics"],
      providerKey: "apify",
      subjectDecision: {},
      policySnapshot: {},
      source: null,
      routePlan: null,
      providerRun: null,
      tiktokPublicationRevisit: null,
      createdAt: new Date(`2026-07-23T10:00:0${3 - index}.000Z`),
      purgeAt: new Date("2026-07-30T10:00:00.000Z"),
    })))
    deps.count.mockResolvedValueOnce(651)

    const firstPage = await GET(listRequest("?limit=2"))
    const firstJson = await firstPage.json()

    expect(firstJson.data.envelopes.map((item: { id: string }) => item.id)).toEqual([
      "envelope-3",
      "envelope-2",
    ])
    expect(firstJson.data.total).toBe(651)
    expect(firstJson.data.pageInfo).toEqual({
      page: 1,
      pageSize: 2,
      totalPages: 326,
      hasMore: true,
      nextCursor: "envelope-2",
    })
    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    }))

    deps.findMany.mockResolvedValueOnce([])
    await GET(listRequest("?limit=2&cursor=envelope-2"))

    expect(deps.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: { id: "envelope-2" },
      skip: 1,
      take: 3,
    }))
  })

  it("paginates after filtering the complete review queue by sentiment", async () => {
    const row = (id: string, text: string, contentKind = "POST") => ({
      id,
      platform: "WEB",
      contentKind,
      text,
      url: `https://example.com/${id}`,
      canonicalUrl: null,
      parentPostUrl: null,
      publishedAt: null,
      relevanceReason: "discovery_missing_published_at",
      matchedTerms: ["Baku Electronics"],
      providerKey: "apify",
      subjectDecision: {},
      policySnapshot: {},
      source: null,
      routePlan: null,
      providerRun: null,
      tiktokPublicationRevisit: null,
      createdAt: new Date("2026-07-23T10:00:00.000Z"),
      purgeAt: new Date("2026-07-30T10:00:00.000Z"),
    })
    deps.findMany.mockResolvedValueOnce([
      row("negative-1", "Bad service and broken phone"),
      row("positive-1", "Excellent service, thank you"),
      row("negative-2", "Worst support problem"),
      row("neutral-1", "Baku Electronics catalogue"),
    ])

    const res = await GET(listRequest("?sentiment=negative&limit=1&page=2"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledTimes(1)
    const sentimentFindManyArgs = deps.findMany.mock.calls[0]?.[0]
    expect(sentimentFindManyArgs).not.toHaveProperty("take")
    expect(sentimentFindManyArgs).not.toHaveProperty("skip")
    expect(json.data.envelopes.map((item: { id: string }) => item.id)).toEqual(["negative-2"])
    expect(json.data.total).toBe(2)
    expect(json.data.surfaceCounts).toEqual({
      all: 2,
      posts: 2,
      comments: 0,
      media: 0,
      unknown: 0,
    })
    expect(json.data.pageInfo).toEqual({
      page: 2,
      pageSize: 1,
      totalPages: 2,
      hasMore: false,
      nextCursor: null,
    })
  })

  it("does not label undecidable Azerbaijani text neutral during review filtering", async () => {
    deps.findMany.mockResolvedValueOnce([
      reviewRow("negative-az", "Pis xidmət, telefon xarabdır"),
      reviewRow("neutral-az", "Məhsul kataloqu yeniləndi"),
      reviewRow("positive-az", "Əla xidmət, təşəkkür edirəm"),
      reviewRow("negative-en", "Bad service and broken phone"),
    ])

    const res = await GET(listRequest(
      "?sentiment=negative&sentiment=neutral&language=az&limit=all",
    ))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledTimes(1)
    expect(deps.findMany.mock.calls[0][0]).not.toHaveProperty("take")
    expect(json.data.envelopes.map((item: { id: string }) => item.id)).toEqual([
      "negative-az",
    ])
    expect(json.data.total).toBe(1)
  })

  it("sorts the complete review queue by sentiment with unknown last", async () => {
    const rows = [
      reviewRow("undecidable", "Product catalogue", "POST", new Date("2026-07-23T11:00:00.000Z")),
      reviewRow("unknown-empty", "", "POST", new Date("2026-07-23T10:00:00.000Z")),
      reviewRow("negative", "Worst support problem"),
      reviewRow("positive", "Excellent service, thank you"),
    ]
    deps.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows)

    const positiveFirst = await GET(listRequest("?sort=sentiment_positive_first&limit=all"))
    const positiveJson = await positiveFirst.json()

    expect(positiveFirst.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledTimes(1)
    expect(positiveJson.data.envelopes.map((item: { id: string }) => item.id)).toEqual([
      "positive",
      "negative",
      "undecidable",
      "unknown-empty",
    ])

    const negativeFirst = await GET(listRequest("?sort=sentiment_negative_first&limit=all"))
    const negativeJson = await negativeFirst.json()

    expect(negativeFirst.status).toBe(200)
    expect(negativeJson.data.envelopes.map((item: { id: string }) => item.id)).toEqual([
      "negative",
      "positive",
      "undecidable",
      "unknown-empty",
    ])
  })

  it("returns every matching review row only when limit=all is explicit", async () => {
    const res = await GET(listRequest("?limit=all"))
    const json = await res.json()

    expect(res.status).toBe(200)
    const allFindManyArgs = deps.findMany.mock.calls[0]?.[0]
    expect(allFindManyArgs).not.toHaveProperty("take")
    expect(allFindManyArgs).not.toHaveProperty("skip")
    expect(json.data.pageInfo).toMatchObject({
      page: 1,
      pageSize: "all",
      totalPages: 1,
    })
  })

  it("returns full review counts by real content type and filters the selected surface", async () => {
    deps.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(329)

    const res = await GET(listRequest("?limit=20&surface=comments"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(deps.findMany.mock.calls[0][0].where).toMatchObject({
      AND: expect.arrayContaining([
        { contentKind: { in: ["COMMENT", "REPLY"] } },
      ]),
    })
    expect(json.data.total).toBe(9)
    expect(json.data.surfaceCounts).toEqual({
      all: 461,
      posts: 120,
      comments: 9,
      media: 3,
      unknown: 329,
    })
  })

  it("combines repeated and CSV review surfaces with OR", async () => {
    await GET(listRequest("?surface=posts,comments&surface=media"))

    const where = deps.findMany.mock.calls[0][0].where as { AND: unknown[] }
    const surfaceClause = where.AND.find(clause => (
      Array.isArray((clause as { OR?: unknown[] }).OR)
      && (clause as { OR: unknown[] }).OR.length === 3
    )) as { OR?: unknown[] } | undefined
    expect(surfaceClause?.OR).toHaveLength(3)
    const serializedSurface = JSON.stringify(surfaceClause)
    expect(serializedSurface).toContain("POST")
    expect(serializedSurface).toContain("COMMENT")
    expect(serializedSurface).toContain("VIDEO")
  })

  it("keeps unclassified findings visible without assigning them a fake type", async () => {
    await GET(listRequest("?surface=unknown"))

    expect(deps.findMany.mock.calls[0][0].where).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ NOT: expect.any(Object) }),
          ]),
        }),
      ]),
    })
  })

  it("moves legacy TikTok and YouTube POST envelopes to Media", async () => {
    await GET(listRequest("?surface=media"))

    expect(deps.findMany.mock.calls[0][0].where).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  AND: expect.arrayContaining([
                    expect.objectContaining({
                      platform: { in: ["youtube", "tiktok", "YOUTUBE", "TIKTOK"] },
                    }),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
      ]),
    })
  })

  it("scopes the review queue to a comma-separated platform allow-list", async () => {
    const res = await GET(listRequest("?limit=20&platform=youtube,tiktok&platform=instagram"))

    expect(res.status).toBe(200)
    const where = deps.findMany.mock.calls[0][0].where
    const destinationClause = where.AND.find((clause: unknown) =>
      JSON.stringify(clause).includes("youtube.com")
      && JSON.stringify(clause).includes("tiktok.com")
      && JSON.stringify(clause).includes("instagram.com"),
    )
    expect(destinationClause).toMatchObject({ OR: expect.any(Array) })
    expect(where).not.toHaveProperty("platform")
  })

  it("does not constrain platform when none is requested", async () => {
    await GET(listRequest("?limit=20"))
    const where = deps.findMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty("platform")
  })

  it("returns the normalized discovery audit trail without raw provider payloads", async () => {
    deps.findMany.mockResolvedValueOnce([{
      id: "envelope-1", platform: "TIKTOK", contentKind: "POST", text: "Candidate",
      url: "https://www.tiktok.com/@tenant/video/1", publishedAt: null,
      canonicalUrl: "https://www.tiktok.com/@tenant/video/1",
      parentPostUrl: null,
      relevanceReason: "discovery_missing_published_at", matchedTerms: ["Araz"],
      providerKey: "bright-data",
      subjectDecision: { query: "Araz supermarket", scenarioIds: ["scenario-1"] },
      policySnapshot: { lastCompleteCommentPage: 3 },
      source: null,
      routePlan: null,
      providerRun: { status: "PARTIAL", inputSnapshot: { secret: "must-not-leak" }, routePlan: null },
      tiktokPublicationRevisit: { coverageClass: "PARTIAL" },
      createdAt: new Date("2026-07-18T10:00:00.000Z"),
      purgeAt: new Date("2026-07-25T10:00:00.000Z"),
    }])

    const res = await GET(listRequest())
    const json = await res.json()

    expect(json.data.envelopes[0]).toMatchObject({
      query: "Araz supermarket", scenarioIds: ["scenario-1"], provider: "bright-data",
      coverageClass: "PARTIAL", lastCompletePage: 3,
      relevanceReason: "discovery_missing_published_at", matchedTerms: ["Araz"],
    })
    expect(json.data.envelopes[0]).not.toHaveProperty("policySnapshot")
    expect(json.data.envelopes[0]).not.toHaveProperty("providerRun")
  })

  it("links a row to the targeted scenario and subject through its source metadata", async () => {
    deps.findMany.mockResolvedValueOnce([{
      id: "envelope-baku", platform: "FACEBOOK", contentKind: "POST", text: "Candidate",
      url: "https://www.facebook.com/bakuelectronics.mmc/",
      canonicalUrl: "https://www.facebook.com/bakuelectronics.mmc/posts/123456",
      parentPostUrl: null,
      publishedAt: null,
      relevanceReason: "discovery_missing_published_at", matchedTerms: ["Baku Electronics"],
      providerKey: "bright-data", subjectDecision: {},
      policySnapshot: { lastCompleteCommentPage: 2 },
      source: {
        query: "Baku Electronics",
        handle: "bakuelectronics.mmc",
        url: "https://www.facebook.com/bakuelectronics.mmc/",
        keywords: ["Baku Electronics"],
        settings: {
          scenarioLinks: [
            {
              scenarioId: "scenario-other",
              scenarioName: "Other scenario",
              subjectId: "subject-other",
              subjectName: "Other subject",
              targetValue: "Other",
            },
            {
              scenarioId: "scenario-baku",
              scenarioName: "Baku Electronics monitoring",
              subjectId: "subject-baku",
              subjectName: "Baku Electronics",
              targetValue: "Baku Electronics",
            },
          ],
        },
        subjectSources: [
          { scenarioId: "scenario-other", subject: { id: "subject-other", name: "Other subject" } },
          { scenarioId: "scenario-baku", subject: { id: "subject-baku", name: "Baku Electronics" } },
        ],
      },
      routePlan: { scenarioId: "scenario-other" },
      providerRun: {
        status: "PARTIAL",
        inputSnapshot: {
          leadDriveTargetScenarioId: "scenario-baku",
          leadDriveTargetSubjectId: "subject-baku",
        },
        routePlan: { scenarioId: "scenario-other" },
      },
      tiktokPublicationRevisit: null,
      createdAt: new Date("2026-07-23T10:00:00.000Z"),
      purgeAt: new Date("2026-07-30T10:00:00.000Z"),
    }])

    const res = await GET(listRequest())
    const json = await res.json()

    expect(json.data.envelopes[0]).toMatchObject({
      query: "Baku Electronics",
      scenarioIds: ["scenario-baku"],
      scenarios: [{ id: "scenario-baku", name: "Baku Electronics monitoring" }],
      subjects: [{ id: "subject-baku", name: "Baku Electronics" }],
      suggestedSubjectId: "subject-baku",
      originalUrl: "https://www.facebook.com/bakuelectronics.mmc/",
      canonicalUrl: "https://www.facebook.com/bakuelectronics.mmc/posts/123456",
      openUrl: "https://www.facebook.com/bakuelectronics.mmc/posts/123456",
      linkState: "supported",
    })
    expect(json.data.envelopes[0].scenarios).not.toContainEqual(expect.objectContaining({ id: "scenario-other" }))
  })

  it("keeps a Facebook profile URL for audit but does not expose it as a post link", async () => {
    deps.findMany.mockResolvedValueOnce([{
      // Google discovery persists these rows as WEB even when the result URL
      // belongs to Facebook.
      id: "envelope-facebook-profile", platform: "WEB", contentKind: "POST", text: "Candidate",
      url: "https://www.facebook.com/bakuelectronics.mmc/",
      canonicalUrl: null,
      parentPostUrl: null,
      publishedAt: null,
      relevanceReason: "discovery_missing_published_at", matchedTerms: ["Baku Electronics"],
      providerKey: "bright-data", subjectDecision: {}, policySnapshot: {},
      source: null, routePlan: null, providerRun: null, tiktokPublicationRevisit: null,
      createdAt: new Date("2026-07-23T10:00:00.000Z"),
      purgeAt: new Date("2026-07-30T10:00:00.000Z"),
    }])

    const res = await GET(listRequest())
    const json = await res.json()

    expect(json.data.envelopes[0]).toMatchObject({
      platform: "facebook",
      acquisitionPlatform: "WEB",
      originalUrl: "https://www.facebook.com/bakuelectronics.mmc/",
      canonicalUrl: null,
      openUrl: null,
      linkState: "questionable",
    })
    expect(JSON.stringify(json.data.envelopes[0])).not.toContain("/dcb/tcnle")
  })

  it("shows only the authoritative subject tier for manual review selection", async () => {
    deps.findMany.mockResolvedValueOnce([{
      ...reviewRow("envelope-authoritative-subject", "Candidate", "COMMENT"),
      platform: "facebook",
      source: {
        query: "Araz Supermarket",
        handle: null,
        url: null,
        keywords: ["Araz Supermarket"],
        settings: {},
        subjectSources: [
          { scenarioId: null, subject: { id: "subject-a", name: "Araz Supermarket" } },
          { scenarioId: null, subject: { id: "subject-b", name: "Other brand" } },
        ],
      },
      providerRun: {
        status: "PARTIAL",
        inputSnapshot: { leadDriveTargetSubjectId: "subject-a" },
        routePlan: null,
      },
    }])

    const res = await GET(listRequest())
    const json = await res.json()

    expect(json.data.envelopes[0]).toMatchObject({
      suggestedSubjectId: "subject-a",
      subjects: [{ id: "subject-a", name: "Araz Supermarket" }],
    })
  })
})

describe("POST /api/v1/social/ingest-envelopes/[id]/resolve", () => {
  it("refuses direct operator resolution for automatic review rows", async () => {
    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_snippet_only_match",
      contentKind: "POST",
      relevanceConfidence: 0,
      purgedAt: null,
      purgeAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    })

    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-1" }), params)

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: "ingest_envelope_owned_by_automatic_review",
    })
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
    expect(deps.updateMany).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })

  it("keeps every normalized comment under automatic review ownership", async () => {
    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      relevanceReason: "manual_review_required",
      contentKind: "COMMENT",
      relevanceConfidence: 0,
      purgedAt: null,
      purgeAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    })

    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-1" }), params)

    expect(res.status).toBe(409)
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
  })

  it("keeps an unsupported automatic-reason shape operator-actionable", async () => {
    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_snippet_only_match",
      contentKind: "ARTICLE",
      relevanceConfidence: 0,
      purgedAt: null,
      purgeAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    })

    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-1" }), params)

    expect(res.status).toBe(200)
    expect(deps.replayIngestEnvelope).toHaveBeenCalledOnce()
  })

  it("accepts through the review-override replay boundary", async () => {
    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-1" }), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe("REPLAYED")
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-1",
      reviewActorId: "user-1",
    })
    expect(deps.logAudit).toHaveBeenCalledWith(
      "org-1",
      "review_accept",
      "ingest_envelope",
      "envelope-1",
      "REPLAYED",
      {
        oldValue: {
          relevanceStatus: "REVIEW",
          relevanceReason: "manual_review_required",
          relevanceConfidence: 0.72,
        },
        newValue: {
          relevanceStatus: "ACCEPTED",
          relevanceReason: "operator_review_accept",
          acceptedMentionId: "mention-1",
          replayStatus: "REPLAYED",
          subjectId: "subject-1",
        },
        userId: "user-1",
      },
    )
  })

  it("audits a policy-rejected positive comment as terminally rejected", async () => {
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "REJECTED_BY_COMMENT_POLICY",
      envelopeId: "envelope-1",
      mentionId: null,
      created: false,
      relevanceReason: "automatic_review_positive_comment",
    })

    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-1" }), params)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { status: "REJECTED_BY_COMMENT_POLICY" },
    })
    expect(deps.logAudit).toHaveBeenCalledWith(
      "org-1",
      "review_accept",
      "ingest_envelope",
      "envelope-1",
      "REJECTED_BY_COMMENT_POLICY",
      expect.objectContaining({
        newValue: {
          relevanceStatus: "REJECTED",
          relevanceReason: "automatic_review_positive_comment",
          acceptedMentionId: null,
          replayStatus: "REJECTED_BY_COMMENT_POLICY",
          subjectId: "subject-1",
        },
      }),
    )
  })

  it("audits an undecidable accepted comment as queued for automatic sentiment", async () => {
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "QUEUED_FOR_AUTOMATIC_TRIAGE",
      envelopeId: "envelope-1",
      mentionId: null,
      created: false,
      relevanceReason: "comment_sentiment_requires_review",
    })

    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-1" }), params)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { status: "QUEUED_FOR_AUTOMATIC_TRIAGE" },
    })
    expect(deps.logAudit).toHaveBeenCalledWith(
      "org-1",
      "review_accept",
      "ingest_envelope",
      "envelope-1",
      "QUEUED_FOR_AUTOMATIC_TRIAGE",
      expect.objectContaining({
        newValue: {
          relevanceStatus: "REVIEW",
          relevanceReason: "comment_sentiment_requires_review",
          acceptedMentionId: null,
          replayStatus: "QUEUED_FOR_AUTOMATIC_TRIAGE",
          subjectId: "subject-1",
        },
      }),
    )
  })

  it("requires rollback before manually resolving a suppressed envelope", async () => {
    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      acceptedMentionId: null,
      relevanceStatus: "REVIEW",
      relevanceReason: "discovery_missing_published_at",
      relevanceConfidence: 0.72,
      purgedAt: null,
      purgeAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [{ id: "decision-1" }],
    })

    const res = await POST(resolveRequest({ action: "accept" }), params)

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "review_apply_rollback_required" })
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
    expect(deps.updateMany).not.toHaveBeenCalled()
  })

  it("treats a repeated accept of the same linked mention as idempotent", async () => {
    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      acceptedMentionId: "mention-1",
      relevanceStatus: "ACCEPTED",
      relevanceReason: "operator_review_accept",
      relevanceConfidence: 0.72,
      purgedAt: null,
      purgeAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    })
    deps.replayIngestEnvelope.mockResolvedValueOnce({
      status: "ALREADY_ACCEPTED",
      envelopeId: "envelope-1",
      mentionId: "mention-1",
      created: false,
    })

    const res = await POST(resolveRequest({ action: "accept", subjectId: "subject-foreign" }), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe("ALREADY_ACCEPTED")
    expect(deps.replayIngestEnvelope).toHaveBeenCalledWith("org-1", "envelope-1", {
      reviewOverride: true,
      reviewSubjectId: "subject-foreign",
      reviewActorId: "user-1",
    })
    expect(deps.logAudit).toHaveBeenCalledWith(
      "org-1",
      "review_accept",
      "ingest_envelope",
      "envelope-1",
      "ALREADY_ACCEPTED",
      expect.objectContaining({
        newValue: expect.objectContaining({ subjectId: null }),
      }),
    )
  })

  it("scrubs the envelope on reject and keeps only status evidence", async () => {
    const res = await POST(resolveRequest({ action: "reject" }), params)

    expect(res.status).toBe(200)
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "envelope-1",
        organizationId: "org-1",
        relevanceStatus: "REVIEW",
        discoveryAutoReviewDecisions: { none: { state: "SUPPRESSED" } },
      }),
      data: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "operator_review_reject",
        text: null,
        authorName: null,
        authorHandle: null,
        authorAvatar: null,
        url: null,
        canonicalUrl: null,
        parentPostUrl: null,
        rawPayload: {},
      }),
    }))
    expect(deps.replayIngestEnvelope).not.toHaveBeenCalled()
    expect(deps.logAudit).toHaveBeenCalledWith(
      "org-1",
      "review_reject",
      "ingest_envelope",
      "envelope-1",
      "operator_review_reject",
      expect.objectContaining({ userId: "user-1" }),
    )
  })

  it("does not finish a reject before its audit write settles", async () => {
    let releaseAudit!: () => void
    const auditPending = new Promise<void>((resolve) => {
      releaseAudit = resolve
    })
    deps.logAudit.mockReturnValueOnce(auditPending)

    let settled = false
    const responsePromise = POST(
      resolveRequest({ action: "reject" }),
      params,
    ).finally(() => {
      settled = true
    })

    await vi.waitFor(() => expect(deps.logAudit).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)

    releaseAudit()
    await expect(responsePromise).resolves.toMatchObject({ status: 200 })
  })

  it("does not resolve a cross-tenant, expired or non-review envelope", async () => {
    deps.findFirst.mockResolvedValueOnce(null)
    expect((await POST(resolveRequest({ action: "accept" }), params)).status).toBe(404)

    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      relevanceStatus: "REVIEW",
      purgedAt: null,
      purgeAt: new Date(Date.now() - 1_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    })
    expect((await POST(resolveRequest({ action: "accept" }), params)).status).toBe(409)

    deps.findFirst.mockResolvedValueOnce({
      id: "envelope-1",
      relevanceStatus: "ACCEPTED",
      purgedAt: null,
      purgeAt: new Date(Date.now() + 3_600_000),
      updatedAt: new Date("2026-07-23T11:00:00.000Z"),
      discoveryAutoReviewDecisions: [],
    })
    expect((await POST(resolveRequest({ action: "reject" }), params)).status).toBe(409)
    expect(deps.updateMany).not.toHaveBeenCalled()
  })

  it("rejects an unknown action", async () => {
    expect((await POST(resolveRequest({ action: "purge" }), params)).status).toBe(400)
  })
})
