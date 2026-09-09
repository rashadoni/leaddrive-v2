import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    monitoringSubject: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    channelMessage: {
      findMany: vi.fn(),
    },
  },
}))

import { GET, PATCH } from "@/app/api/v1/social/mentions/route"
import { prisma } from "@/lib/prisma"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const findMany = vi.mocked(prisma.socialMention.findMany)
const findChannelMessages = vi.mocked(prisma.channelMessage.findMany)
const countMentions = vi.mocked(prisma.socialMention.count)
const groupMentions = vi.mocked(prisma.socialMention.groupBy)
const findSubject = vi.mocked(prisma.monitoringSubject.findFirst)
const findSubjects = vi.mocked(prisma.monitoringSubject.findMany)

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/social/mentions${query}`)
}

const visibleArchiveClause = {
  OR: [
    { sourceMetadata: { path: ["archiveOnly"], not: true } },
    { sourceMetadata: { path: ["archiveOnly"], equals: Prisma.DbNull } },
  ],
}

const visibleNoiseClause = {
  OR: [
    { sourceMetadata: { path: ["socialTriage", "hiddenNoise"], not: true } },
    { sourceMetadata: { path: ["socialTriage", "hiddenNoise"], equals: Prisma.DbNull } },
  ],
}

const contextAcceptedSearchClause = {
  subjectMatches: {
    some: {
      organizationId: "org-1",
      status: "MATCHED",
      reason: {
        in: [
          "operator_review_accept",
          "negative_parent_post_inheritance",
          "comment_negative_in_brand_context",
        ],
      },
    },
  },
}

const externalSearchStreamClause = {
  OR: [
    {
      sourceProvider: {
        in: ["search_index", "provider_api", "browser_capture", "notification_inbox", "official_discovery"],
      },
    },
    {
      AND: [
        { platform: "youtube" },
        { sourceProvider: "native" },
        {
          OR: [
            { sourceMetadata: { path: ["officialDiscovery"], equals: true } },
            {
              AND: [
                { sourceMetadata: { path: ["officialCollector"], equals: true } },
                { sourceMetadata: { path: ["ownership"], equals: "external" } },
              ],
            },
          ],
        },
      ],
    },
  ],
}

const directExternalCommentClause = {
  OR: [
    {
      AND: [
        { contentKind: { notIn: ["COMMENT", "REPLY"] } },
        { sourceType: { notIn: ["comment", "reply"] } },
      ],
    },
    {
      AND: [
        {
          OR: [
            { contentKind: { in: ["COMMENT", "REPLY"] } },
            { sourceType: { in: ["comment", "reply"] } },
          ],
        },
        { matchedTerm: { not: null } },
        {
          OR: [
            { text: { contains: "Araz Supermarket", mode: "insensitive" } },
            { text: { contains: "Araz", mode: "insensitive" } },
            { text: { contains: "arazsupermarket", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { sourceMetadata: { path: ["inheritedParentMatch"], not: true } },
            { sourceMetadata: { path: ["inheritedParentMatch"], equals: Prisma.DbNull } },
          ],
        },
      ],
    },
    {
      AND: [
        {
          OR: [
            { contentKind: { in: ["COMMENT", "REPLY"] } },
            { sourceType: { in: ["comment", "reply"] } },
          ],
        },
        {
          subjectMatches: {
            some: {
              organizationId: "org-1",
              subjectId: "subject-araz",
              status: "MATCHED",
              reason: {
                in: [
                  "operator_review_accept",
                  "negative_parent_post_inheritance",
                  "comment_negative_in_brand_context",
                ],
              },
            },
          },
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([
    {
      id: "mention-1",
      organizationId: "org-1",
      platform: "tiktok",
      externalId: "cw-1",
      sourceType: "comment",
      sourceProvider: "tiktok_organic",
      sourceMetadata: { chatwootMessageId: "555" },
      text: "Nomrem +994501112233",
      aiDrafts: [{ id: "draft-1", status: "needs_approval" }],
    },
  ])
  findChannelMessages.mockResolvedValue([])
  findSubject.mockResolvedValue({
    name: "Araz Supermarket",
    aliases: [
      { kind: "NAME", value: "Araz", isNegative: false },
      { kind: "HANDLE", value: "@arazsupermarket", isNegative: false },
      { kind: "CONTEXT", value: "market", isNegative: false },
    ],
    sources: [],
  } as never)
  findSubjects.mockResolvedValue([
    {
      name: "Araz Supermarket",
      aliases: [
        { kind: "NAME", value: "Araz", isNegative: false },
        { kind: "HANDLE", value: "@arazsupermarket", isNegative: false },
      ],
      sources: [
        {
          source: {
            id: "source-araz-instagram",
            sourceType: "page",
            handle: "arazsupermarket",
            url: "https://instagram.com/arazsupermarket",
          },
        },
      ],
    },
    {
      name: "Bravo Supermarket",
      aliases: [
        { kind: "HANDLE", value: "@bravosupermarketaz", isNegative: false },
      ],
      sources: [
        {
          source: {
            id: "source-bravo-youtube",
            sourceType: "profile",
            handle: "Bravo Supermarket Azerbaijan",
            url: "https://www.youtube.com/@BravoSupermarketAzerbaijan",
          },
        },
      ],
    },
  ] as never)
  countMentions.mockResolvedValue(1)
  groupMentions.mockImplementation(async ({ by }: { by: string[] }) =>
    by.includes("status")
      ? [{ status: "new", _count: 1 }]
      : by.includes("sourceType")
        ? [{ sourceType: "comment", _count: 2 }, { sourceType: "post", _count: 3 }]
        : by.includes("parentPostUrl")
          ? []
          : [{ sentiment: "negative", _count: 1 }],
  )
})

describe("GET /api/v1/social/mentions", () => {
  it("returns only the full AI/manual reply queue and reports its database count", async () => {
    countMentions.mockResolvedValueOnce(2)
    countMentions.mockResolvedValueOnce(2)
    countMentions.mockResolvedValueOnce(1)
    countMentions.mockResolvedValueOnce(1)
    countMentions.mockResolvedValueOnce(0)
    countMentions.mockResolvedValueOnce(0)
    countMentions.mockResolvedValueOnce(9)

    const res = await GET(request("?queue=ai_replies&limit=25&page=1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { aiDrafts: { some: { organizationId: "org-1", status: "needs_approval" } } },
          { manualEngagementTasks: { some: { organizationId: "org-1", status: { in: ["OPEN", "IN_PROGRESS"] } } } },
        ],
      }),
    }))
    expect(countMentions.mock.calls.at(-1)?.[0]).toEqual({
      where: expect.objectContaining({
        AND: [riskRelevantMentionWhere()],
      }),
    })
    expect(json.data.stats.replyQueueTotal).toBe(9)
    expect(json.data.pagination.total).toBe(2)
  })

  it("filters the complete dataset before applying page offset and limit", async () => {
    countMentions.mockResolvedValueOnce(151)

    const res = await GET(request("?sentiment=negative&limit=50&page=3"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          riskRelevantMentionWhere(),
          { OR: [{ sentiment: { in: ["negative"] } }] },
        ]),
      }),
      take: 50,
      skip: 100,
      // nulls: "last" — иначе PostgreSQL при DESC поднимает находки без даты
      // публикации на первые страницы ленты «сначала новые».
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    }))
    expect(json.data.pagination).toEqual({
      page: 3,
      pageSize: 50,
      total: 151,
      totalPages: 4,
    })
  })

  it("combines repeated and CSV multi-filters with OR inside each category", async () => {
    const res = await GET(request(
      "?platform=instagram,tiktok&platform=facebook"
      + "&sentiment=negative,neutral"
      + "&status=new&status=reviewed,ignored"
      + "&language=az,ru",
    ))

    expect(res.status).toBe(200)
    const where = findMany.mock.calls[0]?.[0].where as {
      status?: unknown
      AND?: unknown[]
    }
    expect(where.status).toEqual({ in: ["new", "reviewed", "ignored"] })
    expect(where.AND).toEqual(expect.arrayContaining([
      { OR: [{ sentiment: { in: ["negative", "neutral"] } }] },
      {
        OR: [
          { sourceMetadata: { path: ["socialTriage", "language"], equals: "az" } },
          { sourceMetadata: { path: ["socialTriage", "language"], equals: "ru" } },
          // Комментарии языковой фильтр не отсекает: их релевантность держится
          // на родительском посте, а метки у них чаще всего нет.
          {
            OR: [
              { contentKind: { in: ["COMMENT", "REPLY"] } },
              { sourceType: { in: ["comment", "reply"] } },
            ],
          },
        ],
      },
    ]))
    const serializedWhere = JSON.stringify(where)
    expect(serializedWhere).toContain("instagram.com")
    expect(serializedWhere).toContain("tiktok.com")
    expect(serializedWhere).toContain("facebook.com")
    expect(serializedWhere).toContain('\"platform\":{\"in\":[\"instagram\",\"INSTAGRAM\"]}')
    expect(serializedWhere).toContain('\"platform\":{\"in\":[\"tiktok\",\"TIKTOK\"]}')
    expect(serializedWhere).toContain('\"platform\":{\"in\":[\"facebook\",\"FACEBOOK\"]}')
  })

  it("treats missing triage language as the explicit unknown language", async () => {
    await GET(request("?language=unknown"))

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          {
            OR: [
              { sourceMetadata: { path: ["socialTriage", "language"], equals: Prisma.DbNull } },
              // Комментарии проходят независимо от выбранного языка — см. выше.
              {
                OR: [
                  { contentKind: { in: ["COMMENT", "REPLY"] } },
                  { sourceType: { in: ["comment", "reply"] } },
                ],
              },
            ],
          },
        ]),
      }),
    }))
  })

  it("supports an explicit unpaginated result after all filters are applied", async () => {
    const res = await GET(request("?platform=facebook&limit=all"))
    const json = await res.json()

    expect(res.status).toBe(200)
    const findManyArgs = findMany.mock.calls[0]?.[0]
    expect(findManyArgs).not.toHaveProperty("take")
    expect(findManyArgs).not.toHaveProperty("skip")
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { platform: { in: ["facebook", "FACEBOOK"] } },
                ]),
              }),
            ]),
          }),
        ]),
      }),
    }))
    expect(json.data.pagination).toEqual({
      page: 1,
      pageSize: "all",
      total: 1,
      totalPages: 1,
    })
  })

  it("applies Social Monitoring source, AI and WhatsApp filters within the tenant", async () => {
    const res = await GET(request("?platform=tiktok&sourceType=comment&sourceProvider=tiktok_organic&aiStatus=needs_approval&whatsappStatus=dry_run_sent&limit=25"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.mentions).toHaveLength(1)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        externalId: { not: "__tg_offset__" },
        purgedAt: null,
        deletedAtSource: null,
        AND: expect.arrayContaining([
          visibleArchiveClause,
          visibleNoiseClause,
          expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { platform: { in: ["tiktok", "TIKTOK"] } },
                ]),
              }),
            ]),
          }),
        ]),
        sourceType: "comment",
        sourceProvider: "tiktok_organic",
        aiDrafts: { some: { organizationId: "org-1", status: "needs_approval" } },
        whatsappGroupStatus: "dry_run_sent",
      }),
      take: 25,
      include: expect.objectContaining({
        account: {
          select: { handle: true, displayName: true },
        },
        cluster: { select: { id: true, mentionCount: true, topic: true, riskLevel: true } },
        evidences: expect.objectContaining({
          orderBy: { capturedAt: "desc" },
          take: 5,
        }),
        aiDrafts: expect.objectContaining({
          orderBy: { createdAt: "desc" },
          take: 1,
          select: expect.objectContaining({
            id: true,
            status: true,
            sendMode: true,
            sentAt: true,
            forbiddenReason: true,
            createdAt: true,
          }),
        }),
        subjectMatches: expect.objectContaining({
          orderBy: { decidedAt: "desc" },
          take: 1,
          select: expect.objectContaining({
            subjectId: true,
            status: true,
            reason: true,
            confidence: true,
            matchedAliasIds: true,
            contextSignals: true,
            subject: {
              select: {
                name: true,
                aliases: { select: { id: true, value: true } },
              },
            },
          }),
        }),
        relevanceFeedback: expect.objectContaining({
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: expect.objectContaining({
            subjectId: true,
            feedbackType: true,
          }),
        }),
        mediaObservations: {
          where: { purgedAt: null },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            id: true,
            mediaType: true,
            sourceUrl: true,
            thumbnailUrl: true,
            status: true,
          },
        },
      }),
    }))
    expect(countMentions).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        externalId: { not: "__tg_offset__" },
        purgedAt: null,
        deletedAtSource: null,
        AND: expect.arrayContaining([
          visibleArchiveClause,
          visibleNoiseClause,
          expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { platform: { in: ["tiktok", "TIKTOK"] } },
                ]),
              }),
            ]),
          }),
        ]),
        sourceType: "comment",
        sourceProvider: "tiktok_organic",
        aiDrafts: { some: { organizationId: "org-1", status: "needs_approval" } },
        whatsappGroupStatus: "dry_run_sent",
      }),
    })
  })

  it("filters by surface=comments and keeps bySourceType counts surface-agnostic", async () => {
    const res = await GET(request("?surface=comments"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { contentKind: { in: ["COMMENT", "REPLY"] } },
              { sourceType: { in: ["comment", "reply"] } },
            ]),
          }),
        ]),
      }),
    }))
    // The sourceType aggregate must NOT carry the surface filter — the segmented
    // control needs counts for all segments while one is active.
    const sourceTypeGroupCall = groupMentions.mock.calls.find(
      (c: [{ by: string[]; where: Record<string, unknown> }]) => c[0].by.includes("sourceType"),
    )
    expect(sourceTypeGroupCall).toBeDefined()
    expect(sourceTypeGroupCall![0].where).not.toHaveProperty("sourceType")
    expect(json.data.stats.bySourceType).toEqual({ comment: 2, post: 3 })
  })

  it("supports repeated and CSV surface selections as one OR category", async () => {
    await GET(request("?surface=posts,comments&surface=media"))

    const where = findMany.mock.calls[0]?.[0].where as { AND?: unknown[] }
    const surfaceClause = where.AND?.find(clause => {
      const serialized = JSON.stringify(clause)
      return serialized.includes('"contentKind":"POST"')
        && serialized.includes('"COMMENT"')
        && serialized.includes('"VIDEO"')
    }) as { OR?: unknown[] } | undefined
    expect(surfaceClause?.OR).toHaveLength(3)
  })

  it("uses the complete filtered dataset for All instead of rebuilding it from surface counts", async () => {
    countMentions
      .mockResolvedValueOnce(30) // current page/pagination total
      .mockResolvedValueOnce(30) // surface-agnostic All
      .mockResolvedValueOnce(17) // posts
      .mockResolvedValueOnce(0) // comments
      .mockResolvedValueOnce(13) // media
      .mockResolvedValueOnce(0) // unknown

    const res = await GET(request("?stream=search&subjectId=subject-araz"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.stats.total).toBe(30)
    expect(json.data.stats.bySurface).toEqual({
      all: 30,
      posts: 17,
      comments: 0,
      media: 13,
      unknown: 0,
    })
  })

  it("filters surface=media by actual media evidence and legacy video platforms", async () => {
    await GET(request("?surface=media"))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { contentKind: { in: ["VIDEO", "IMAGE", "AUDIO"] } },
                  expect.objectContaining({
                    AND: expect.arrayContaining([
                      { platform: { in: ["youtube", "tiktok"] } },
                    ]),
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      }),
    }))
  })

  it("keeps TikTok video records out of surface=posts", async () => {
    await GET(request("?platform=tiktok&surface=posts"))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { platform: { in: ["tiktok", "TIKTOK"] } },
                ]),
              }),
            ]),
          }),
          expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    AND: expect.arrayContaining([
                      { contentKind: "POST" },
                      { platform: { notIn: ["youtube", "tiktok"] } },
                    ]),
                  }),
                  expect.objectContaining({
                    AND: expect.arrayContaining([
                      expect.objectContaining({
                        NOT: expect.objectContaining({
                          OR: expect.arrayContaining([
                            expect.objectContaining({
                              AND: expect.arrayContaining([
                                { platform: { in: ["youtube", "tiktok"] } },
                              ]),
                            }),
                          ]),
                        }),
                      }),
                    ]),
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      }),
    }))
  })

  it("filters findings by publication period and supports oldest-first sorting", async () => {
    const startedAt = Date.now()
    await GET(request("?dateRange=7d&sort=oldest"))
    const finishedAt = Date.now()

    const call = findMany.mock.calls.at(-1)?.[0] as {
      where?: { AND?: Array<{ OR?: Array<Record<string, unknown>> }> }
      orderBy?: Array<{ publishedAt?: string; id?: string }>
    }
    expect(call.orderBy).toEqual([{ publishedAt: "asc" }, { id: "asc" }])
    // Окно живёт в AND (а не спредом): его клауза — OR, а верхний уровень уже
    // занят другими OR. Находки без даты публикации отбираются по дате
    // обнаружения, иначе браузерный Facebook-сбор выпадал бы из ленты.
    const dateClause = (call.where?.AND ?? []).find(clause => Array.isArray(clause.OR)
      && clause.OR.some(branch => "publishedAt" in branch))
    expect(dateClause).toBeDefined()
    const [byPublished, byFirstSeen] = dateClause!.OR as [
      { publishedAt: { gte: Date } },
      { AND: [{ publishedAt: null }, { createdAt: { gte: Date } }] },
    ]
    expect(byPublished.publishedAt.gte).toBeInstanceOf(Date)
    expect(byFirstSeen.AND[0]).toEqual({ publishedAt: null })
    expect(byFirstSeen.AND[1].createdAt.gte).toBeInstanceOf(Date)
    const threshold = byPublished.publishedAt.gte.getTime()
    const sevenDays = 7 * 24 * 60 * 60_000
    expect(threshold).toBeGreaterThanOrEqual(startedAt - sevenDays)
    expect(threshold).toBeLessThanOrEqual(finishedAt - sevenDays)
  })

  it("sorts persisted sentiments in both directions with null values last", async () => {
    await GET(request("?sort=sentiment_negative_first"))
    expect(findMany.mock.calls.at(-1)?.[0].orderBy).toEqual([
      { sentiment: { sort: "asc", nulls: "last" } },
      { publishedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ])

    await GET(request("?sort=sentiment_positive_first"))
    expect(findMany.mock.calls.at(-1)?.[0].orderBy).toEqual([
      { sentiment: { sort: "desc", nulls: "last" } },
      { publishedAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ])
  })

  it("does not hide TikTok posts from the external search stream", async () => {
    await GET(request("?platform=tiktok&stream=search"))

    const call = findMany.mock.calls.at(-1)?.[0] as { where?: { AND?: unknown[]; sourceType?: unknown } }
    expect(call.where?.sourceType).toBeUndefined()
    expect(call.where?.AND).toEqual(expect.arrayContaining([visibleArchiveClause]))
  })

  it("keeps direct complaints visible in a focused monitor card without requiring a repeated brand term", async () => {
    await GET(request("?stream=search&subjectId=subject-araz"))

    expect(findSubject).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "subject-araz", organizationId: "org-1" },
      select: expect.objectContaining({
        sources: expect.objectContaining({
          where: {
            OR: [
              { relationType: { in: ["OWNED", "OFFICIAL"] } },
              { source: { ownership: "owned" } },
            ],
          },
        }),
      }),
    }))

    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        subjectMatches: {
          some: {
            organizationId: "org-1",
            subjectId: "subject-araz",
            status: "MATCHED",
            reason: { not: "parent_post_match" },
          },
        },
        AND: expect.arrayContaining([directExternalCommentClause]),
      }),
    }))
  })

  it("does not return another tenant\x27s subject matches", async () => {
    findSubject.mockResolvedValueOnce(null)
    findMany.mockResolvedValueOnce([])
    countMentions.mockResolvedValueOnce(0)

    const res = await GET(request("?subjectId=foreign-subject&stream=search"))

    expect(res.status).toBe(200)
    expect(findSubject).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-subject", organizationId: "org-1" },
    }))
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        subjectMatches: {
          some: expect.objectContaining({
            organizationId: "org-1",
            subjectId: "foreign-subject",
          }),
        },
      }),
    }))
  })

  it("separates live and backfilled official posts from matched external subject mentions", async () => {
    await GET(request("?subjectId=subject-araz&authorScope=official"))

    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        subjectMatches: {
          some: {
            organizationId: "org-1",
            subjectId: "subject-araz",
            status: "REJECTED",
            reason: { startsWith: "official_author" },
          },
        },
      }),
    }))

    await GET(request("?subjectId=subject-araz&authorScope=others"))
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        subjectMatches: {
          some: {
            organizationId: "org-1",
            subjectId: "subject-araz",
            status: "MATCHED",
            reason: { not: "parent_post_match" },
          },
        },
      }),
    }))
  })

  it("filters official authors across the whole organization when no monitor is selected", async () => {
    await GET(request("?authorScope=official&surface=posts"))

    expect(findSubjects).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        status: { not: "deleted" },
      },
    }))
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { authorHandle: { equals: "arazsupermarket", mode: "insensitive" } },
              { authorHandle: { equals: "bravosupermarketaz", mode: "insensitive" } },
              { authorHandle: { equals: "BravoSupermarketAzerbaijan", mode: "insensitive" } },
              { authorName: { equals: "Bravo Supermarket Azerbaijan", mode: "insensitive" } },
            ]),
          }),
        ]),
      }),
    }))
  })

  it("filters other authors across the whole organization when reviewing posts", async () => {
    await GET(request("?authorScope=others&surface=posts"))

    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        AND: expect.arrayContaining([
          expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { authorHandle: null },
                  expect.objectContaining({
                    AND: expect.arrayContaining([
                      { authorHandle: { not: "arazsupermarket", mode: "insensitive" } },
                      { authorHandle: { not: "bravosupermarketaz", mode: "insensitive" } },
                      { authorHandle: { not: "BravoSupermarketAzerbaijan", mode: "insensitive" } },
                    ]),
                  }),
                ]),
              }),
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { authorName: null },
                  expect.objectContaining({
                    AND: expect.arrayContaining([
                      { authorName: { not: "Bravo Supermarket Azerbaijan", mode: "insensitive" } },
                    ]),
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      }),
    }))
  })

  it("separates connected page comments from external search streams", async () => {
    const ownedRes = await GET(request("?stream=owned"))

    expect(ownedRes.status).toBe(200)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        sourceProvider: "native",
      }),
    }))

    const searchRes = await GET(request("?stream=search"))

    expect(searchRes.status).toBe(200)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        ...externalSearchStreamClause,
      }),
    }))

    const providerOverrideRes = await GET(request("?stream=search&sourceProvider=native"))

    expect(providerOverrideRes.status).toBe(200)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        sourceProvider: "native",
      }),
    }))
  })

  it("shows explicit keyword matches, inherited matches, and direct complaint matches in the external search stream", async () => {
    const res = await GET(request("?stream=search"))

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        ...externalSearchStreamClause,
        AND: expect.arrayContaining([
          visibleArchiveClause,
          {
            OR: [
              contextAcceptedSearchClause,
              {
                AND: [
                  visibleNoiseClause,
                  { matchedTerm: { not: null } },
                ],
              },
            ],
          },
        ]),
      }),
    }))
  })

  it("filters mentions by keyword, hashtag, cluster topic, and evidence text", async () => {
    const res = await GET(request("?stream=search&q=%23q%C9%99za"))

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        ...externalSearchStreamClause,
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { matchedTerm: { contains: "#qəza", mode: "insensitive" } },
              { text: { contains: "#qəza", mode: "insensitive" } },
              { cluster: { is: { topic: { contains: "#qəza", mode: "insensitive" } } } },
              { evidences: { some: { rawSnippet: { contains: "#qəza", mode: "insensitive" } } } },
              { matchedTerm: { contains: "qəza", mode: "insensitive" } },
              { text: { contains: "qəza", mode: "insensitive" } },
            ]),
          }),
        ]),
      }),
    }))
  })

  it("filters duplicate phone leads through source metadata", async () => {
    const res = await GET(request("?phoneLead=duplicate"))

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        sourceMetadata: { path: ["phoneLead", "status"], equals: "duplicate_linked" },
      }),
    }))
  })

  it("applies triage filters while keeping hidden noise collapsed by default", async () => {
    const highRiskRes = await GET(request("?triage=high_risk"))

    expect(highRiskRes.status).toBe(200)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          visibleArchiveClause,
          visibleNoiseClause,
          {
            OR: [
              { sourceMetadata: { path: ["socialTriage", "prRisk"], equals: "high" } },
              { sourceMetadata: { path: ["socialTriage", "urgency"], equals: "critical" } },
            ],
          },
        ]),
      }),
    }))

    const noiseRes = await GET(request("?triage=noise"))

    expect(noiseRes.status).toBe(200)
    const noiseCall = findMany.mock.calls.at(-1)?.[0] as { where?: { AND?: unknown[] } }
    expect(noiseCall.where?.AND).toEqual(expect.arrayContaining([
      visibleArchiveClause,
      { sourceMetadata: { path: ["socialTriage", "hiddenNoise"], equals: true } },
    ]))
  })

  it("hydrates Chatwoot attachment metadata from ChannelMessage for older mentions", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "mention-attachment",
        organizationId: "org-1",
        platform: "tiktok",
        externalId: "chatwoot:555",
        sourceType: "dm",
        sourceProvider: "chatwoot",
        sourceMetadata: { chatwootMessageId: "555" },
        text: "[Вложение]",
        aiDrafts: [],
      },
    ])
    findChannelMessages.mockResolvedValueOnce([
      {
        id: "msg-1",
        externalId: "555",
        mediaUrl: "https://cdn.chatwoot.test/photo.jpg",
        messageType: "image",
      },
    ])

    const res = await GET(request("?platform=tiktok"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(findChannelMessages).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        channelType: "tiktok",
        direction: "inbound",
        mediaUrl: { not: null },
        OR: [
          { externalId: { in: ["555"] } },
          { id: { in: ["555"] } },
        ],
      }),
    }))
    expect(json.data.mentions[0].sourceMetadata).toMatchObject({
      chatwootMessageId: "555",
      mediaUrl: "https://cdn.chatwoot.test/photo.jpg",
      messageType: "image",
    })
  })

  // Прод, август 2026: под одним TikTok-видео 275 комментариев. Размер ветки
  // едет вместе со строкой, иначе лента объясняет объём только повтором того же
  // видео на каждой карточке.
  it("reports how many findings the current filter holds in each comment thread", async () => {
    const parent = "https://tiktok.com/@xeber.group1/video/7668437904028355860"
    findMany.mockResolvedValue([
      { id: "comment-1", organizationId: "org-1", platform: "tiktok", sourceType: "comment", sourceMetadata: {}, text: "Allah rəhmət eləsin", parentPostUrl: parent },
      { id: "comment-2", organizationId: "org-1", platform: "tiktok", sourceType: "comment", sourceMetadata: {}, text: "Can ANA", parentPostUrl: parent },
      { id: "post-1", organizationId: "org-1", platform: "instagram", sourceType: "post", sourceMetadata: {}, text: "Yeni mağaza", parentPostUrl: null },
    ] as never)
    groupMentions.mockImplementation(async ({ by }: { by: string[] }) =>
      by.includes("parentPostUrl")
        ? [{ parentPostUrl: parent, _count: 275 }]
        : by.includes("status")
          ? [{ status: "new", _count: 3 }]
          : by.includes("sourceType")
            ? [{ sourceType: "comment", _count: 2 }]
            : [{ sentiment: "negative", _count: 1 }],
    )

    const res = await GET(request("?platform=tiktok"))
    const json = await res.json()

    expect(res.status).toBe(200)
    // Счёт идёт по тому же фильтру, что и лента: число должно совпадать с тем,
    // что в ней реально лежит, а не со всей веткой в базе.
    expect(groupMentions).toHaveBeenCalledWith(expect.objectContaining({
      by: ["parentPostUrl"],
      where: expect.objectContaining({ parentPostUrl: { in: [parent] } }),
    }))
    expect(json.data.mentions.map((mention: { id: string; threadCommentTotal: number | null }) => [
      mention.id,
      mention.threadCommentTotal,
    ])).toEqual([
      ["comment-1", 275],
      ["comment-2", 275],
      ["post-1", null],
    ])
  })
})

/**
 * Прод 2026-08-04, вопрос владельца: «когда я меняю негатив на нейтрал, обучение
 * происходит или нет?». Обучения модели нет, но правка обязана хотя бы держаться
 * и оставлять след: без провенанса очередной сбор той же записи её затирал.
 */
describe("PATCH /api/v1/social/mentions — правка тональности", () => {
  const findMention = vi.mocked(prisma.socialMention.findFirst)
  const updateMention = vi.mocked(prisma.socialMention.update)

  function patch(body: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/v1/social/mentions", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    findMention.mockResolvedValue({
      id: "m-1",
      organizationId: "org-1",
      sentiment: "negative",
      sourceMetadata: { socialTriage: { language: "az" }, phoneLead: { status: "duplicate_linked" } },
    } as never)
    updateMention.mockResolvedValue({ id: "m-1", sentiment: "neutral" } as never)
  })

  it("метит правку провенансом: кто, когда и из какого значения", async () => {
    const response = await PATCH(patch({ id: "m-1", sentiment: "neutral" }))

    expect(response.status).toBe(200)
    const data = updateMention.mock.calls[0]?.[0].data as Record<string, unknown>
    expect(data.sentiment).toBe("neutral")
    expect(data.sourceMetadata).toMatchObject({
      // Чужие ключи метаданных сохраняются.
      phoneLead: { status: "duplicate_linked" },
      socialTriage: {
        language: "az",
        sentimentSource: "operator",
        sentimentBefore: "negative",
        sentimentAfter: "neutral",
        sentimentCorrectedBy: "user-1",
      },
    })
  })

  it("смена только статуса метаданные не трогает", async () => {
    await PATCH(patch({ id: "m-1", status: "reviewed" }))

    const data = updateMention.mock.calls[0]?.[0].data as Record<string, unknown>
    expect(data).toMatchObject({ status: "reviewed", handledBy: "user-1" })
    expect(data).not.toHaveProperty("sourceMetadata")
    expect(data).not.toHaveProperty("sentiment")
  })
})
