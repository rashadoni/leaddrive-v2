import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findOrganization: vi.fn(),
  findSubjects: vi.fn(),
  findMentions: vi.fn(),
  countMentions: vi.fn(),
  rankCommentIds: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: mocks.findOrganization },
    monitoringSubject: { findMany: mocks.findSubjects },
    socialMention: { findMany: mocks.findMentions, count: mocks.countMentions },
    $queryRaw: mocks.rankCommentIds,
  },
}))

import {
  VISUAL_REPORT_SECTIONS,
  VISUAL_REPORT_SENTIMENTS,
  visualReportRequestSchema,
} from "@/lib/social/visual-report-schema"
import {
  buildVisualMonitoringReportSnapshot,
  getVisualMonitoringReport,
  VisualReportSubjectsNotFoundError,
  type VisualMonitoringReportMention,
} from "@/lib/social/visual-monitoring-report"
import {
  socialReportEffectiveSubjectWhere,
  socialReportVisibleMentionWhere,
} from "@/lib/social/report-visibility"

const baseRequest = {
  format: "json" as const,
  locale: "en" as const,
  subjectIds: ["subject-a", "subject-b"],
  range: { from: "2026-07-01", to: "2026-07-02" },
  sections: [...VISUAL_REPORT_SECTIONS],
  topFindingsLimit: 20,
  commentsLimit: 20,
  topFindingsSentiments: [...VISUAL_REPORT_SENTIMENTS],
}

function mention(
  overrides: Partial<VisualMonitoringReportMention> & Pick<VisualMonitoringReportMention, "id">,
): VisualMonitoringReportMention {
  return {
    platform: "Instagram",
    contentKind: "POST",
    sourceType: "post",
    sentiment: "neutral",
    publishedAt: new Date("2026-07-01T12:00:00.000Z"),
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    authorName: "Author",
    authorHandle: "@author",
    text: "Finding",
    url: "https://instagram.com/p/one",
    parentPostUrl: null,
    engagement: 3,
    reach: 10,
    subjectIds: ["subject-a"],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOrganization.mockResolvedValue({ name: "LeadDrive", branding: {} })
  mocks.findSubjects.mockResolvedValue([
    { id: "subject-a", name: "Araz" },
    { id: "subject-b", name: "Oba" },
  ])
  mocks.findMentions.mockResolvedValue([])
  mocks.countMentions.mockResolvedValue(0)
  mocks.rankCommentIds.mockResolvedValue([])
})

describe("visual monitoring report contract", () => {
  it("accepts at most 366 inclusive days and rejects duplicate or oversized selections", () => {
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      range: { from: "2024-01-01", to: "2024-12-31" },
    }).success).toBe(true)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      range: { from: "2024-01-01", to: "2025-01-01" },
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      subjectIds: ["subject-a", "subject-a"],
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      subjectIds: Array.from({ length: 21 }, (_, index) => `subject-${index}`),
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      subjectIds: [],
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      sections: ["summary", "summary"],
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      topFindingsLimit: 51,
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      commentsLimit: 51,
    }).success).toBe(false)
    // Пустой набор тональностей дал бы пустой раздел находок без объяснения.
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      topFindingsSentiments: [],
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      topFindingsSentiments: ["negative", "negative"],
    }).success).toBe(false)
    expect(visualReportRequestSchema.safeParse({
      ...baseRequest,
      topFindingsSentiments: ["angry"],
    }).success).toBe(false)
    // Умолчание обязано быть «все тональности»: старый закэшированный клиент
    // не должен молча получить урезанный раздел.
    const withDefaults = visualReportRequestSchema.parse({
      locale: "en",
      subjectIds: ["subject-a"],
      range: baseRequest.range,
    })
    expect(withDefaults.topFindingsSentiments).toEqual([...VISUAL_REPORT_SENTIMENTS])
    expect(withDefaults.commentsLimit).toBe(20)
    expect(withDefaults.sections).toContain("comments")
  })
})

describe("buildVisualMonitoringReportSnapshot", () => {
  it("deduplicates global findings while retaining one count for every matched subject", () => {
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "az",
      range: baseRequest.range,
      sections: baseRequest.sections,
      topFindingsLimit: 10,
      commentsLimit: 10,
      topFindingsSentiments: [...VISUAL_REPORT_SENTIMENTS],
      organization: { name: "Tenant", primaryColor: "#123abc" },
      subjects: [
        { id: "subject-a", name: "Araz" },
        { id: "subject-b", name: "Oba" },
      ],
      generatedAt: new Date("2026-07-03T00:00:00.000Z"),
      mentions: [
        mention({ id: "shared", sentiment: "negative", subjectIds: ["subject-a"] }),
        mention({ id: "shared", sentiment: "negative", subjectIds: ["subject-b"] }),
        mention({
          id: "positive",
          platform: "TikTok",
          contentKind: "COMMENT",
          sentiment: "positive",
          publishedAt: new Date("2026-07-02T23:59:59.999Z"),
          subjectIds: ["subject-a"],
          engagement: 8,
          reach: 20,
          url: "javascript:alert(1)",
        }),
        mention({
          id: "outside",
          publishedAt: new Date("2026-07-03T00:00:00.000Z"),
          subjectIds: ["subject-a"],
        }),
        mention({
          id: "unknown-date-outside",
          publishedAt: null,
          createdAt: new Date("2026-07-03T00:00:00.000Z"),
          subjectIds: ["subject-a"],
        }),
      ],
    })

    expect(snapshot.totals).toEqual({
      findings: 2,
      positive: 1,
      neutral: 0,
      negative: 1,
      unknown: 0,
      engagement: 11,
      reach: 30,
    })
    expect(snapshot.subjects).toEqual([
      { id: "subject-a", name: "Araz", total: 2, positive: 1, neutral: 0, negative: 1, unknown: 0 },
      { id: "subject-b", name: "Oba", total: 1, positive: 0, neutral: 0, negative: 1, unknown: 0 },
    ])
    expect(snapshot.platforms).toEqual([
      { platform: "instagram", count: 1, percentage: 50 },
      { platform: "tiktok", count: 1, percentage: 50 },
    ])
    expect(snapshot.contentTypes).toEqual([
      { contentType: "comment", count: 1, percentage: 50 },
      { contentType: "post", count: 1, percentage: 50 },
    ])
    expect(snapshot.trend).toEqual([
      { date: "2026-07-01", total: 1, positive: 0, neutral: 0, negative: 1, unknown: 0 },
      { date: "2026-07-02", total: 1, positive: 1, neutral: 0, negative: 0, unknown: 0 },
    ])
    expect(snapshot.topFindings.map(item => item.id)).toEqual(["shared", "positive"])
    expect(snapshot.topFindings[1].url).toBeNull()
    expect(snapshot.methodology).toMatchObject({
      dateField: "publishedAt|firstSeenAt",
      globalDeduplication: "mentionId",
      subjectMatchStatus: "MATCHED",
      unclassifiedSentiment: "unknown",
    })
  })

  // Клиент просил отчёт только с негативом и нейтралом, но графики и KPI
  // обязаны остаться по всем находкам — иначе «100% негатива» на титуле.
  it("сужает раздел находок по тональности, не трогая портфельные счётчики", () => {
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "en",
      range: baseRequest.range,
      sections: baseRequest.sections,
      topFindingsLimit: 10,
      commentsLimit: 10,
      topFindingsSentiments: ["negative", "neutral"],
      organization: { name: "Tenant" },
      subjects: [{ id: "subject-a", name: "Araz" }],
      mentions: [
        mention({ id: "neg", sentiment: "negative" }),
        mention({ id: "neu", sentiment: "neutral" }),
        mention({ id: "pos", sentiment: "positive" }),
        mention({ id: "unk", sentiment: null }),
      ],
    })

    expect(snapshot.topFindings.map(item => item.id)).toEqual(["neg", "neu"])
    expect(snapshot.topFindingsFilter).toEqual({
      sentiments: ["negative", "neutral"],
      matched: 2,
      shown: 2,
    })
    expect(snapshot.totals).toMatchObject({ findings: 4, positive: 1, neutral: 1, negative: 1, unknown: 1 })
    expect(snapshot.subjects[0]).toMatchObject({ total: 4, positive: 1, negative: 1, unknown: 1 })
    expect(snapshot.platforms[0].count).toBe(4)
  })

  // Фильтр обязан стоять ДО среза по лимиту: иначе выбравший 2 негативных
  // получил бы столько, сколько их случайно попало в общий топ.
  it("применяет фильтр тональности до ограничения количества находок", () => {
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "en",
      range: baseRequest.range,
      sections: baseRequest.sections,
      topFindingsLimit: 2,
      commentsLimit: 10,
      topFindingsSentiments: ["negative"],
      organization: { name: "Tenant" },
      subjects: [{ id: "subject-a", name: "Araz" }],
      mentions: [
        mention({ id: "pos-1", sentiment: "positive", engagement: 100 }),
        mention({ id: "pos-2", sentiment: "positive", engagement: 99 }),
        mention({ id: "neg-1", sentiment: "negative", engagement: 5 }),
        mention({ id: "neg-2", sentiment: "negative", engagement: 4 }),
        mention({ id: "neg-3", sentiment: "negative", engagement: 3 }),
      ],
    })

    expect(snapshot.topFindings.map(item => item.id)).toEqual(["neg-1", "neg-2"])
    expect(snapshot.topFindingsFilter).toEqual({ sentiments: ["negative"], matched: 3, shown: 2 })
  })

  it("keeps comments independent from top findings and distinguishes direct links from parent fallbacks", () => {
    const directCommentUrl = "https://www.facebook.com/ObaMarket/posts/123?comment_id=9"
    const parentPostUrl = "https://www.facebook.com/ObaMarket/posts/123"
    const fallbackPostUrl = "https://www.facebook.com/ArazSupermarket/posts/456?utm_source=monitoring"
    const fallbackCanonicalUrl = "https://facebook.com/ArazSupermarket/posts/456"
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "en",
      range: baseRequest.range,
      sections: baseRequest.sections,
      topFindingsLimit: 1,
      commentsLimit: 2,
      topFindingsSentiments: ["positive"],
      organization: { name: "Tenant" },
      subjects: [{ id: "subject-a", name: "Araz" }],
      mentions: [
        mention({ id: "positive-post", sentiment: "positive", engagement: 100 }),
        mention({
          id: "direct-comment",
          platform: "facebook",
          contentKind: "COMMENT",
          sourceType: "comment",
          sentiment: "negative",
          authorName: "Leyla Aliyeva",
          authorHandle: "leyla.commenter",
          canonicalUrl: directCommentUrl,
          url: directCommentUrl,
          parentPostUrl,
          parentSource: {
            platform: "facebook",
            authorName: "Oba Market",
            authorHandle: "ObaMarket",
            url: parentPostUrl,
          },
          engagement: 4,
        }),
        mention({
          id: "parent-fallback",
          platform: "facebook",
          contentKind: "REPLY",
          sourceType: "reply",
          sentiment: "neutral",
          authorName: "Nihat",
          authorHandle: "nihat.reader",
          canonicalUrl: fallbackCanonicalUrl,
          url: fallbackPostUrl,
          parentPostUrl: fallbackPostUrl,
          parentSource: {
            platform: "facebook",
            authorName: "Araz Supermarket",
            authorHandle: "ArazSupermarket",
            url: fallbackPostUrl,
          },
          engagement: 2,
        }),
        mention({
          id: "limited-comment",
          contentKind: "COMMENT",
          sourceType: "comment",
          sentiment: null,
          engagement: 1,
        }),
      ],
    })

    // The findings sentiment filter and quota must not hide relevant comments.
    expect(snapshot.topFindings.map(item => item.id)).toEqual(["positive-post"])
    expect(snapshot.comments.map(item => item.id)).toEqual(["direct-comment", "parent-fallback"])
    expect(snapshot.commentsFilter).toEqual({ matched: 3, shown: 2 })

    expect(snapshot.comments[0]).toMatchObject({
      url: directCommentUrl,
      directCommentUrl,
      parentPostUrl,
      linkKind: "direct_comment",
      source: {
        label: "ObaMarket",
        handle: "ObaMarket",
        url: "https://www.facebook.com/ObaMarket",
        kind: "page",
      },
      authorProfile: {
        name: "Leyla Aliyeva",
        handle: "leyla.commenter",
        label: "Leyla Aliyeva · @leyla.commenter",
        profileUrl: "https://www.facebook.com/leyla.commenter",
      },
    })
    expect(snapshot.comments[1]).toMatchObject({
      url: fallbackPostUrl,
      directCommentUrl: null,
      parentPostUrl: fallbackPostUrl,
      linkKind: "parent_post",
    })
  })

  it("preserves profile-only authors, legacy comment semantics, and truthful reply fallbacks", () => {
    const tiktokParent = "https://www.tiktok.com/@brand/video/123"
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "en",
      range: baseRequest.range,
      sections: baseRequest.sections,
      topFindingsLimit: 10,
      commentsLimit: 10,
      topFindingsSentiments: [...VISUAL_REPORT_SENTIMENTS],
      organization: { name: "Tenant" },
      subjects: [{ id: "subject-a", name: "Araz" }],
      mentions: [
        mention({
          id: "profile-only",
          platform: "instagram",
          contentKind: "COMMENT",
          sourceType: "comment",
          authorName: null,
          authorHandle: null,
          authorProfileUrl: "https://www.instagram.com/profile_only/",
          url: "https://www.instagram.com/p/example/",
          parentPostUrl: "https://www.instagram.com/p/example/",
        }),
        mention({
          id: "legacy-comment",
          platform: "instagram",
          contentKind: "MENTION",
          sourceType: "comment",
          authorName: "legacy_user",
          authorHandle: "legacy_user",
          url: "https://www.instagram.com/p/legacy/",
          parentPostUrl: "https://www.instagram.com/p/legacy/",
        }),
        mention({
          id: "nested-reply",
          externalId: "reply-2",
          platform: "tiktok",
          contentKind: "REPLY",
          sourceType: "reply",
          canonicalUrl: `${tiktokParent}?comment_id=top-comment-1`,
          url: tiktokParent,
          parentPostUrl: tiktokParent,
        }),
        mention({
          id: "provider-reply",
          externalId: "facebook-reply-test-1",
          platform: "facebook",
          contentKind: "REPLY",
          sourceType: "reply",
          canonicalUrl: "https://www.facebook.com/BrandPage/posts/7?comment_id=REPLY1",
          url: "https://www.facebook.com/BrandPage/posts/7?comment_id=REPLY1",
          parentPostUrl: "https://www.facebook.com/BrandPage/posts/7",
        }),
      ],
    })
    const comments = new Map(snapshot.comments.map(item => [item.id, item]))

    expect(comments.get("profile-only")?.authorProfile).toMatchObject({
      name: null,
      handle: "profile_only",
      label: "@profile_only",
      profileUrl: "https://www.instagram.com/profile_only/",
    })
    expect(comments.get("legacy-comment")).toMatchObject({
      contentType: "comment",
      source: null,
    })
    expect(comments.get("legacy-comment")?.authorProfile?.label).toBe("@legacy_user")
    expect(comments.get("nested-reply")).toMatchObject({
      directCommentUrl: null,
      parentPostUrl: tiktokParent,
      linkKind: "parent_post",
    })
    expect(comments.get("provider-reply")).toMatchObject({
      directCommentUrl: "https://www.facebook.com/BrandPage/posts/7?comment_id=REPLY1",
      linkKind: "direct_comment",
    })
  })

  // «Страница/группа/издание» — то, чего клиенту не хватало в отчёте.
  it("выводит источник находки по платформе и честно молчит, когда его нет", () => {
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "en",
      range: baseRequest.range,
      sections: baseRequest.sections,
      topFindingsLimit: 10,
      commentsLimit: 10,
      topFindingsSentiments: [...VISUAL_REPORT_SENTIMENTS],
      organization: { name: "Tenant" },
      subjects: [{ id: "subject-a", name: "Araz" }],
      mentions: [
        mention({
          id: "fb-comment",
          platform: "facebook",
          contentKind: "COMMENT",
          sourceType: "comment",
          authorName: "Commenter",
          authorHandle: null,
          url: "https://www.facebook.com/ObaMarket/posts/123?comment_id=9",
          parentPostUrl: "https://www.facebook.com/ObaMarket/posts/123",
        }),
        mention({
          id: "fb-group",
          platform: "facebook",
          authorHandle: null,
          url: "https://www.facebook.com/groups/885544/permalink/77/",
          parentPostUrl: null,
        }),
        mention({
          id: "web",
          platform: "web",
          authorName: "Report.az",
          authorHandle: "report.az",
          url: "https://report.az/iqtisadiyyat/xeber/",
        }),
        mention({
          id: "tiktok",
          platform: "tiktok",
          authorHandle: null,
          url: "https://www.tiktok.com/@obamarket/video/7",
        }),
        mention({
          id: "ig-comment",
          platform: "instagram",
          contentKind: "COMMENT",
          sourceType: "comment",
          authorName: "Commenter",
          authorHandle: "some_person",
          url: "https://www.instagram.com/p/abc/#comment",
          parentPostUrl: "https://www.instagram.com/p/abc/",
        }),
      ],
    })

    const byId = new Map(snapshot.topFindings.map(item => [item.id, item]))
    expect(byId.get("fb-comment")?.source).toMatchObject({
      label: "ObaMarket",
      url: "https://www.facebook.com/ObaMarket",
      kind: "page",
    })
    expect(byId.get("fb-comment")?.authorProfile).toMatchObject({
      name: "Commenter",
      label: "Commenter",
      profileUrl: null,
    })
    expect(byId.get("fb-group")?.source).toMatchObject({ handle: "885544", kind: "group" })
    expect(byId.get("web")?.source).toMatchObject({ label: "Report.az", handle: "report.az", kind: "publisher" })
    expect(byId.get("tiktok")?.source).toMatchObject({ label: "@obamarket", kind: "account" })
    // У комментария Instagram владельца поста в ссылке нет, а автор — это
    // комментатор, а не площадка. Подставлять его было бы дезинформацией.
    expect(byId.get("ig-comment")?.source).toBeNull()
    expect(byId.get("ig-comment")?.authorProfile).toMatchObject({
      handle: "some_person",
      profileUrl: "https://www.instagram.com/some_person/",
    })
  })

  it("keeps unclassified sentiment separate from neutral", () => {
    const snapshot = buildVisualMonitoringReportSnapshot({
      locale: "en",
      range: baseRequest.range,
      sections: ["sentiment"],
      topFindingsLimit: 1,
      commentsLimit: 1,
      topFindingsSentiments: [...VISUAL_REPORT_SENTIMENTS],
      organization: { name: "Tenant" },
      subjects: [{ id: "subject-a", name: "Araz" }],
      mentions: [mention({ id: "unclassified", sentiment: null })],
    })

    expect(snapshot.totals.neutral).toBe(0)
    expect(snapshot.totals.unknown).toBe(1)
    expect(snapshot.subjects[0]).toMatchObject({ neutral: 0, unknown: 1 })
    expect(snapshot.sentiment).toContainEqual({ sentiment: "unknown", count: 1, percentage: 100 })
  })
})

describe("getVisualMonitoringReport", () => {
  it("rejects the whole selection before querying mentions when any tenant subject is unavailable", async () => {
    mocks.findSubjects.mockResolvedValue([{ id: "subject-a", name: "Araz" }])

    await expect(getVisualMonitoringReport({
      organizationId: "org-1",
      request: baseRequest,
    })).rejects.toBeInstanceOf(VisualReportSubjectsNotFoundError)
    expect(mocks.findMentions).not.toHaveBeenCalled()
    expect(mocks.countMentions).not.toHaveBeenCalled()
    expect(mocks.rankCommentIds).not.toHaveBeenCalled()
  })

  // Регрессия: createdAt выбирался из БД, но не прокидывался в snapshot —
  // находка без даты публикации роняла весь отчёт (prisma типизирован как any,
  // поэтому пропущенное поле не ловили ни tsc, ни сборка).
  it("carries the discovery date from the database into the snapshot", async () => {
    mocks.findMentions.mockResolvedValue([{
      id: "m-no-date",
      platform: "Facebook",
      contentKind: "POST",
      sourceType: "post",
      sentiment: "negative",
      publishedAt: null,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      authorName: "Author",
      authorHandle: "@author",
      text: "Browser-collected finding",
      canonicalUrl: null,
      url: "https://facebook.com/post/1",
      engagement: 1,
      reach: 2,
      subjectMatches: [{ subjectId: "subject-a" }],
    }])

    const snapshot = await getVisualMonitoringReport({ organizationId: "org-1", request: baseRequest })

    expect(snapshot.totals.findings).toBe(1)
    expect(snapshot.topFindings[0]?.publishedAt).toBe("2026-07-01T12:00:00.000Z")
  })

  it("keeps comments visible even when they are outside the aggregation query", async () => {
    const common = {
      sentiment: "neutral",
      publishedAt: new Date("2026-07-01T12:00:00.000Z"),
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      authorName: "Author",
      authorHandle: "author",
      postExternalId: null,
      canonicalUrl: null,
      parentPostUrl: null,
      engagement: 1,
      reach: 2,
      subjectMatches: [{ subjectId: "subject-a" }],
    }
    mocks.countMentions.mockResolvedValue(1)
    mocks.rankCommentIds.mockResolvedValue([{ id: "comment-outside-window" }])
    mocks.findMentions
      .mockResolvedValueOnce([{
        ...common,
        id: "post-in-window",
        externalId: "post-in-window",
        platform: "instagram",
        contentKind: "POST",
        sourceType: "post",
        text: "Aggregation post",
        url: "https://www.instagram.com/p/post-in-window/",
      }])
      .mockResolvedValueOnce([{
        ...common,
        id: "comment-outside-window",
        externalId: "comment-outside-window",
        platform: "instagram",
        contentKind: "COMMENT",
        sourceType: "comment",
        text: "Dedicated comment",
        url: "https://www.instagram.com/p/post-in-window/?comment_id=comment-outside-window",
      }])
      .mockResolvedValueOnce([])

    const snapshot = await getVisualMonitoringReport({ organizationId: "org-1", request: baseRequest })

    expect(snapshot.totals.findings).toBe(1)
    expect(snapshot.topFindings.map(item => item.id)).toEqual(["post-in-window"])
    expect(snapshot.comments.map(item => item.id)).toEqual(["comment-outside-window"])
    expect(snapshot.commentsFilter).toEqual({ matched: 1, shown: 1 })
    expect(mocks.findMentions.mock.calls[1]?.[0]).toMatchObject({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: { in: ["comment-outside-window"] },
        AND: expect.arrayContaining([
          socialReportVisibleMentionWhere(),
          socialReportEffectiveSubjectWhere({
            organizationId: "org-1",
            subjectIds: ["subject-a", "subject-b"],
          }),
          expect.objectContaining({
            OR: expect.arrayContaining([
              { contentKind: { in: ["COMMENT", "REPLY", "comment", "reply"] } },
            ]),
          }),
        ]),
      }),
    })
    const rankedSql = mocks.rankCommentIds.mock.calls[0]?.[0] as { sql: string }
    expect(rankedSql.sql).toContain('COALESCE(sm."publishedAt", sm."createdAt") DESC')
    expect(rankedSql.sql).toContain('GREATEST(sm."engagement", 0) DESC')
    expect(rankedSql.sql).toContain('LOWER(BTRIM(COALESCE(sm."sentiment", \'\'))) IN (\'negative\', \'neutral\')')
    expect(rankedSql.sql).toContain('sm."status" <> \'ignored\'')
    expect(rankedSql.sql).toContain('msm."status" = \'MATCHED\'')
    expect(rankedSql.sql).toContain('msm."reason" <> \'parent_post_match\'')
    expect(rankedSql.sql).toContain('FROM "social_relevance_feedback" AS feedback')
    expect(rankedSql.sql).toContain('feedback."subjectId" = msm."subjectId"')
    expect(mocks.countMentions).toHaveBeenCalledTimes(1)
  })

  it("enriches rendered comments with provenance, author profile, and parent-page identity", async () => {
    const directCommentUrl = "https://www.instagram.com/p/post-42/?comment_id=comment-9"
    const parentPostUrl = "https://www.instagram.com/p/post-42/"
    const commentRow = {
      id: "comment-9",
      externalId: "comment-9",
      platform: "INSTAGRAM",
      contentKind: "COMMENT",
      sourceType: "comment",
      sentiment: "negative",
      publishedAt: new Date("2026-07-01T11:00:00.000Z"),
      createdAt: new Date("2026-07-01T11:05:00.000Z"),
      authorName: "Leyla",
      authorHandle: "leyla.reader",
      text: "Delivery was late",
      postExternalId: "post-42",
      canonicalUrl: directCommentUrl,
      url: directCommentUrl,
      parentPostUrl,
      engagement: 7,
      reach: 20,
      subjectMatches: [{ subjectId: "subject-a" }],
    }
    mocks.countMentions.mockResolvedValue(1)
    mocks.rankCommentIds.mockResolvedValue([{ id: "comment-9" }])
    mocks.findMentions
      .mockResolvedValueOnce([commentRow])
      .mockResolvedValueOnce([commentRow])
      .mockResolvedValueOnce([{
        id: "comment-9",
        sourceMetadata: { authorProfileUrl: "https://www.instagram.com/leyla.reader/" },
        account: null,
        evidences: [
          {
            permalink: parentPostUrl,
            source: {
              platform: "web",
              sourceType: "keyword",
              handle: null,
              url: null,
            },
          },
          {
            permalink: directCommentUrl,
            source: {
              platform: "web",
              sourceType: "keyword",
              handle: null,
              url: null,
            },
          },
        ],
        ingestEnvelopes: [],
      }])
      .mockResolvedValueOnce([{
        platform: "INSTAGRAM",
        // Apify prefixes the stored parent ID while the child keeps postId raw.
        // The parent page therefore has to be recovered by parentPostUrl.
        externalId: "apify:post-42",
        authorName: null,
        authorHandle: "brand.page",
        canonicalUrl: parentPostUrl,
        url: parentPostUrl,
      }])

    const snapshot = await getVisualMonitoringReport({ organizationId: "org-1", request: baseRequest })

    expect(mocks.findMentions).toHaveBeenCalledTimes(4)
    expect(mocks.findMentions.mock.calls[2]?.[0]).toMatchObject({
      where: { organizationId: "org-1", id: { in: ["comment-9"] } },
      select: expect.objectContaining({
        sourceMetadata: true,
        evidences: expect.objectContaining({ take: 5 }),
        ingestEnvelopes: expect.objectContaining({ take: 5 }),
      }),
    })
    expect(mocks.findMentions.mock.calls[3]?.[0]).toMatchObject({
      where: expect.objectContaining({
        organizationId: "org-1",
        OR: expect.arrayContaining([
          { platform: "INSTAGRAM", externalId: "post-42" },
          { platform: "INSTAGRAM", canonicalUrl: parentPostUrl },
          { platform: "INSTAGRAM", url: parentPostUrl },
        ]),
      }),
    })
    expect(snapshot.comments[0]).toMatchObject({
      id: "comment-9",
      directCommentUrl,
      parentPostUrl,
      linkKind: "direct_comment",
      source: {
        label: "@brand.page",
        handle: "brand.page",
        url: "https://www.instagram.com/brand.page/",
      },
      authorProfile: {
        label: "Leyla · @leyla.reader",
        profileUrl: "https://www.instagram.com/leyla.reader/",
      },
    })
  })

  it("keeps a multi-brand finding for a valid subject after another subject is rejected", async () => {
    mocks.findMentions
      .mockResolvedValueOnce([{
        id: "shared-finding",
        externalId: "shared-finding",
        platform: "instagram",
        contentKind: "POST",
        sourceType: "post",
        sentiment: "neutral",
        publishedAt: new Date("2026-07-01T12:00:00.000Z"),
        createdAt: new Date("2026-07-01T12:01:00.000Z"),
        authorName: "Author",
        authorHandle: "author",
        text: "Shared finding",
        postExternalId: null,
        canonicalUrl: "https://www.instagram.com/p/shared/",
        url: "https://www.instagram.com/p/shared/",
        parentPostUrl: null,
        engagement: 1,
        reach: 2,
        subjectMatches: [{ subjectId: "subject-a" }, { subjectId: "subject-b" }],
        relevanceFeedback: [{ subjectId: "subject-a", feedbackType: "WRONG_SUBJECT" }],
      }])
      .mockResolvedValueOnce([])

    const snapshot = await getVisualMonitoringReport({ organizationId: "org-1", request: baseRequest })

    expect(snapshot.totals.findings).toBe(1)
    expect(snapshot.subjects).toEqual([
      { id: "subject-a", name: "Araz", total: 0, positive: 0, neutral: 0, negative: 0, unknown: 0 },
      { id: "subject-b", name: "Oba", total: 1, positive: 0, neutral: 1, negative: 0, unknown: 0 },
    ])
    expect(snapshot.topFindings[0]?.subjectIds).toEqual(["subject-b"])
  })

  it("queries only report-visible MATCHED subjects and the inclusive period inside the tenant", async () => {
    await getVisualMonitoringReport({ organizationId: "org-1", request: baseRequest })

    expect(mocks.findSubjects).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        id: { in: ["subject-a", "subject-b"] },
        status: { notIn: ["archived", "deleted"] },
      },
    }))
    expect(mocks.findMentions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        purgedAt: null,
        deletedAtSource: null,
        AND: expect.arrayContaining([
          socialReportVisibleMentionWhere(),
          socialReportEffectiveSubjectWhere({
            organizationId: "org-1",
            subjectIds: ["subject-a", "subject-b"],
          }),
        ]),
        OR: [
          {
            publishedAt: {
              gte: new Date("2026-07-01T00:00:00.000Z"),
              lt: new Date("2026-07-03T00:00:00.000Z"),
            },
          },
          {
            AND: [
              { publishedAt: null },
              {
                createdAt: {
                  gte: new Date("2026-07-01T00:00:00.000Z"),
                  lt: new Date("2026-07-03T00:00:00.000Z"),
                },
              },
            ],
          },
        ],
      }),
      take: 20_001,
      select: expect.objectContaining({
        subjectMatches: {
          where: {
            organizationId: "org-1",
            subjectId: { in: ["subject-a", "subject-b"] },
            status: "MATCHED",
            reason: { not: "parent_post_match" },
          },
          select: { subjectId: true },
        },
        relevanceFeedback: {
          where: {
            organizationId: "org-1",
            subjectId: { in: ["subject-a", "subject-b"] },
            feedbackType: { in: ["NOT_RELEVANT", "WRONG_SUBJECT", "DUPLICATE"] },
          },
          select: { subjectId: true, feedbackType: true },
        },
      }),
    }))
  })
})
