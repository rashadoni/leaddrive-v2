import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { findFirst: vi.fn() },
  monitoringSubject: { findMany: vi.fn() },
  socialMention: { findMany: vi.fn(), count: vi.fn() },
  mentionEvidence: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  refreshYouTubeToken: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: deps.classifySentiment }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: deps.findMatchedKeyword,
  ingestMentionWithResult: deps.ingestMentionWithResult,
}))
vi.mock("@/lib/social/youtube-poller", () => ({ refreshYouTubeToken: deps.refreshYouTubeToken }))
vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: deps.parentMatchContextsForComments,
}))

import { runVkCommentsCollector, vkWallTarget } from "@/lib/social/vk-comments-adapter"
import { runYouTubeCommentsCollector } from "@/lib/social/youtube-comments-adapter"
import { archiveProviderCursorKey } from "@/lib/social/archive-provider-window"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

function baseSource(overrides: Partial<MonitoringSourceForRun>): MonitoringSourceForRun {
  return {
    id: "source-1",
    organizationId: "org-1",
    platform: "youtube",
    sourceType: "page",
    ownership: "owned",
    collectionMode: "official_api",
    status: "active",
    cadenceMinutes: 60,
    keywords: ["brand"],
    lastCheckedAt: null,
    lastSuccessfulAt: null,
    lastError: null,
    settings: {},
    routeExecution: {
      collectorRunId: "collector-1",
      routePlanId: "route-1",
      capability: "READ_OWNED_COMMENTS",
      adapterKey: "OFFICIAL",
      acquisitionMode: "OFFICIAL_API",
      maxItems: 1000,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  mockPrisma.socialAccount.findFirst.mockResolvedValue({ id: "account-1", handle: "channel-1", accessToken: "encrypted", keywords: [] })
  mockPrisma.monitoringSubject.findMany.mockResolvedValue([])
  mockPrisma.socialMention.findMany.mockResolvedValue([])
  mockPrisma.socialMention.count.mockResolvedValue(0)
  mockPrisma.mentionEvidence.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.create.mockResolvedValue({ id: "evidence-1" })
  deps.refreshYouTubeToken.mockResolvedValue("youtube-token")
  deps.classifySentiment.mockResolvedValue("neutral")
  deps.findMatchedKeyword.mockReturnValue(null)
  deps.ingestMentionWithResult.mockImplementation(async (input: { externalId: string }) => ({ id: `mention-${input.externalId}`, created: true }))
  deps.parentMatchContextsForComments.mockResolvedValue(new Map())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("YouTube official comments", () => {
  it("uses commentThreads pagination and separately paginates all replies", async () => {
    let threadPage = 0
    let replyPage = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        replyPage += 1
        if (replyPage === 1) return new Response(JSON.stringify({
          items: [{ id: "reply-1", snippet: { textOriginal: "Reply one", parentId: "top-1", publishedAt: "2026-07-11T10:01:00Z" } }],
          nextPageToken: "reply-next",
        }), { status: 200 })
        expect(url.searchParams.get("pageToken")).toBe("reply-next")
        return new Response(JSON.stringify({ items: [{ id: "reply-2", snippet: { textOriginal: "Reply two", parentId: "top-1", publishedAt: "2026-07-11T10:02:00Z" } }] }), { status: 200 })
      }
      threadPage += 1
      expect(url.searchParams.get("searchTerms")).toBeNull()
      if (threadPage === 1) return new Response(JSON.stringify({
        items: [{ id: "thread-1", snippet: { videoId: "video-1", totalReplyCount: 2, topLevelComment: { id: "top-1", snippet: { textOriginal: "Top", publishedAt: "2026-07-11T10:00:00Z" } } } }],
        nextPageToken: "thread-next",
      }), { status: 200 })
      expect(url.searchParams.get("pageToken")).toBe("thread-next")
      return new Response(JSON.stringify({ items: [{ id: "thread-2", snippet: { videoId: "video-1", totalReplyCount: 0, topLevelComment: { id: "top-2", snippet: { textOriginal: "Second top", publishedAt: "2026-07-11T10:03:00Z" } } } }] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({ url: "https://www.youtube.com/watch?v=video-1", settings: { socialAccountId: "account-1" } }))

    expect(result).toMatchObject({ status: "success", foundCount: 4, newCount: 4, rawStats: expect.objectContaining({ threadPages: 2, replyPages: 2, coverageClass: "COMPLETE_FOR_INPUT" }) })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "reply-2",
      contentKind: "REPLY",
      postExternalId: "video-1",
      parentExternalId: "top-1",
      threadExternalId: "top-1",
    }))
  })

  it("fetches the full thread and passes parent context for a matched negative video", async () => {
    const watchUrl = "https://www.youtube.com/watch?v=video-negative"
    const parentContext = {
      parentMentionId: "mention-video-negative",
      matchedTerm: "brand",
      subjectIds: ["subject-brand"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-brand"],
    }
    deps.parentMatchContextsForComments.mockResolvedValue(new Map([[watchUrl, parentContext]]))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        return new Response(JSON.stringify({
          items: [{ id: "negative-reply", snippet: { textOriginal: "Neutral reply", publishedAt: "2026-07-11T10:01:00Z" } }],
        }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      expect(url.searchParams.get("searchTerms")).toBeNull()
      return new Response(JSON.stringify({
        items: [{
          id: "negative-thread",
          snippet: {
            videoId: "video-negative",
            totalReplyCount: 1,
            topLevelComment: {
              id: "negative-top",
              snippet: { textOriginal: "No brand keyword here", publishedAt: "2026-07-11T10:00:00Z" },
            },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: watchUrl,
      ownership: "external",
      keywords: ["brand"],
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
      },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      rawStats: expect.objectContaining({
        commentSearchTerms: [],
        negativeParentFullThreadTargets: 1,
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "negative-top",
      parentMatchContext: parentContext,
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "negative-reply",
      contentKind: "REPLY",
      parentMatchContext: parentContext,
    }))
  })

  it("rescans a stored negative video after it leaves keyword search discovery", async () => {
    const videoId = "stored-negative"
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
    const parentContext = {
      parentMentionId: "mention-stored-negative",
      matchedTerm: "brand",
      subjectIds: ["subject-brand"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-brand"],
    }
    mockPrisma.monitoringSubject.findMany.mockResolvedValue([{ id: "subject-brand" }])
    mockPrisma.socialMention.count.mockResolvedValue(1)
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      externalId: "provider:stored-negative",
      postExternalId: null,
      canonicalUrl: watchUrl,
      url: null,
    }])
    deps.parentMatchContextsForComments.mockResolvedValue(new Map([
      [videoId, parentContext],
      [watchUrl, parentContext],
    ]))
    const requestedThreadVideoIds: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        // The old publication is deliberately absent from the rolling search
        // window; only the durable negative-parent rescan can reach it.
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      requestedThreadVideoIds.push(url.searchParams.get("videoId") ?? "")
      expect(url.searchParams.get("searchTerms")).toBeNull()
      return new Response(JSON.stringify({
        items: [{
          id: "stored-thread",
          snippet: {
            videoId,
            totalReplyCount: 0,
            topLevelComment: {
              id: "stored-comment",
              snippet: { textOriginal: "Late neutral comment", publishedAt: "2026-08-01T10:00:00Z" },
            },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      settings: {
        subjectId: "subject-settings",
        scenarioLinks: [{ subjectId: "subject-scenario" }],
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
        targetSubjectId: "subject-route",
      },
    }))

    expect(mockPrisma.monitoringSubject.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        status: "active",
        OR: [
          { sources: { some: { sourceId: "source-1" } } },
          { id: { in: ["subject-route", "subject-settings", "subject-scenario"] } },
        ],
      },
      select: { id: true },
    })
    expect(mockPrisma.socialMention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        platform: "youtube",
        contentKind: { in: ["VIDEO", "POST"] },
        sentiment: "negative",
        deletedAtSource: null,
        purgedAt: null,
        subjectMatches: {
          some: {
            organizationId: "org-1",
            subjectId: { in: ["subject-brand"] },
            status: "MATCHED",
          },
        },
      }),
      skip: 0,
      take: 1,
    }))
    expect(requestedThreadVideoIds).toEqual([videoId])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      rawStats: expect.objectContaining({
        targetVideos: 1,
        durableNegativeRescanTargets: 1,
        durableNegativeRescanTargetsAdded: 1,
        durableNegativeRescanSubjectCount: 1,
        durableNegativeRescanTotalCount: 1,
        durableNegativeRescanRotationOffset: 0,
        commentSearchTerms: [],
        negativeParentFullThreadTargets: 1,
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "stored-comment",
      postExternalId: videoId,
      parentMatchContext: parentContext,
    }))
  })

  it("rotates the bounded stored-negative rescan window across source cadences", async () => {
    vi.useFakeTimers()
    // At 03:00 UTC this fixture's hourly bucket selects offset 4 for
    // total=5/take=2, forcing a one-row tail plus one-row wrapped query.
    const firstRunAt = new Date("2026-08-01T03:00:00.000Z")
    vi.setSystemTime(firstRunAt)
    mockPrisma.monitoringSubject.findMany.mockResolvedValue([{ id: "subject-brand" }])
    mockPrisma.socialMention.count.mockResolvedValue(5)
    mockPrisma.socialMention.findMany.mockImplementation(async (input: { skip?: number; take?: number }) => (
      Array.from({ length: input.take ?? 0 }, (_, index) => {
        const videoId = `rot-${((input.skip ?? 0) + index) % 5}`
        return {
          externalId: videoId,
          postExternalId: videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          url: null,
        }
      })
    ))
    deps.parentMatchContextsForComments.mockImplementation(async (
      _organizationId: string,
      _platform: string,
      _urls: string[],
      videoIds: string[],
    ) => new Map(videoIds.map(videoId => [videoId, {
      parentMentionId: `mention-${videoId}`,
      matchedTerm: "brand",
      subjectIds: ["subject-brand"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-brand"],
    }])))
    const requestedThreadVideoIds: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/commentThreads")) {
        requestedThreadVideoIds.push(url.searchParams.get("videoId") ?? "")
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))
    const source = baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      cadenceMinutes: 60,
      settings: { subjectId: "subject-brand", negativeRescanMaxVideos: 2 },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
      },
    })

    await runYouTubeCommentsCollector(source)
    expect(mockPrisma.socialMention.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ skip: 4, take: 1 }))
    expect(mockPrisma.socialMention.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 0, take: 1 }))
    expect(requestedThreadVideoIds).toEqual(["rot-4", "rot-0"])
    mockPrisma.socialMention.findMany.mockClear()
    requestedThreadVideoIds.length = 0
    vi.setSystemTime(new Date(firstRunAt.getTime() + 60 * 60_000))

    await runYouTubeCommentsCollector(source)
    const secondOffset = (mockPrisma.socialMention.findMany.mock.calls[0]?.[0] as { skip?: number }).skip

    expect(secondOffset).toBe(1)
    expect(mockPrisma.socialMention.findMany).toHaveBeenCalledTimes(1)
    expect(requestedThreadVideoIds).toEqual(["rot-1", "rot-2"])
  })

  it("reserves reply capacity and rotates reply priority across stored negative targets", async () => {
    vi.useFakeTimers()
    const firstRunAt = new Date("2026-08-01T03:00:00.000Z")
    vi.setSystemTime(firstRunAt)
    mockPrisma.monitoringSubject.findMany.mockResolvedValue([{ id: "subject-brand" }])
    mockPrisma.socialMention.count.mockResolvedValue(2)
    mockPrisma.socialMention.findMany.mockImplementation(async (input: { skip?: number; take?: number }) => (
      Array.from({ length: input.take ?? 0 }, (_, index) => {
        const videoId = `reply-rotation-${((input.skip ?? 0) + index) % 2}`
        return {
          externalId: videoId,
          postExternalId: videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          url: null,
        }
      })
    ))
    deps.parentMatchContextsForComments.mockImplementation(async (
      _organizationId: string,
      _platform: string,
      _urls: string[],
      videoIds: string[],
    ) => new Map(videoIds.map(videoId => [videoId, {
      parentMentionId: `mention-${videoId}`,
      matchedTerm: "brand",
      subjectIds: ["subject-brand"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-brand"],
    }])))
    const requestedThreadVideoIds: string[] = []
    const requestedReplyParentIds: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      if (url.pathname.endsWith("/comments")) {
        const parentId = url.searchParams.get("parentId") ?? ""
        requestedReplyParentIds.push(parentId)
        return new Response(JSON.stringify({
          items: [{
            id: `${parentId}-reply`,
            snippet: { textOriginal: "Late reply", parentId },
          }],
        }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      const videoId = url.searchParams.get("videoId") ?? ""
      requestedThreadVideoIds.push(videoId)
      const topIds = Array.from(
        { length: videoId === "reply-rotation-0" ? 10 : 9 },
        (_, index) => `${videoId}-top-${index}`,
      )
      return new Response(JSON.stringify({
        items: topIds.map(topId => ({
          id: `${topId}-thread`,
          snippet: {
            videoId,
            totalReplyCount: 1,
            topLevelComment: {
              id: topId,
              snippet: { textOriginal: "Late top-level comment" },
            },
          },
        })),
      }), { status: 200 })
    }))
    const source = baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      cadenceMinutes: 60,
      settings: {
        subjectId: "subject-brand",
        negativeRescanMaxVideos: 2,
        // The ordinary cap cannot cover the negative-thread completeness
        // floor. Verified negative targets receive bounded page budgets.
        maxCommentRequests: 1,
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
      },
    })

    const firstResult = await runYouTubeCommentsCollector(source)
    const firstThreadOrder = requestedThreadVideoIds.slice()
    expect(firstThreadOrder).toHaveLength(2)
    expect(new Set(firstThreadOrder)).toEqual(new Set(["reply-rotation-0", "reply-rotation-1"]))
    const firstReplyParents = requestedReplyParentIds.slice()
    expect(firstReplyParents).toHaveLength(18)
    expect(firstResult).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        baseMaxCommentRequests: 1,
        maxCommentRequests: 20,
        negativeThreadPageRequestBudget: 10,
        negativeTopLevelRequestBudget: 10,
        negativeReplyRequestReserve: 10,
        topLevelCommentRequestLimit: 10,
        commentRequests: 20,
        replyPages: 18,
        commentRequestCapped: true,
        coverageClass: "SAMPLED",
      }),
    })

    vi.setSystemTime(new Date(firstRunAt.getTime() + 60 * 60_000))
    const secondResult = await runYouTubeCommentsCollector(source)
    const secondThreadOrder = requestedThreadVideoIds.slice(2)
    expect(secondThreadOrder).toHaveLength(2)
    expect(secondThreadOrder[0]).not.toBe(firstThreadOrder[0])
    const secondRunReplyParents = requestedReplyParentIds.slice(firstReplyParents.length)
    expect(secondRunReplyParents).toHaveLength(18)
    expect(new Set(secondRunReplyParents)).not.toEqual(new Set(firstReplyParents))
    const allReplyParents = new Set([
      ...Array.from({ length: 10 }, (_, index) => `reply-rotation-0-top-${index}`),
      ...Array.from({ length: 9 }, (_, index) => `reply-rotation-1-top-${index}`),
    ])
    expect(new Set([...firstReplyParents, ...secondRunReplyParents])).toEqual(allReplyParents)
    expect(secondResult.rawStats).toEqual(expect.objectContaining({
      durableNegativeRescanRotationOffset: expect.any(Number),
      negativeReplyCandidateRotationOffset: expect.any(Number),
      replyPages: 18,
    }))
  })

  it("applies the negative-thread completeness floor beyond the route item cap", async () => {
    const videoId = "9uXuWzLdKwc"
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
    const parentContext = {
      parentMentionId: `mention-${videoId}`,
      matchedTerm: "brand",
      subjectIds: ["subject-brand"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-brand"],
    }
    deps.parentMatchContextsForComments.mockResolvedValue(new Map([[watchUrl, parentContext]]))
    const topLevelComments = Array.from({ length: 100 }, (_, index) => ({
      id: `thread-${index}`,
      snippet: {
        videoId,
        totalReplyCount: index === 0 ? 27 : 0,
        topLevelComment: {
          id: `top-${index}`,
          snippet: {
            textOriginal: `Customer comment ${index}`,
            publishedAt: "2026-07-11T10:00:00Z",
          },
        },
      },
    }))
    const replies = Array.from({ length: 27 }, (_, index) => ({
      id: `reply-${index}`,
      snippet: {
        textOriginal: `Customer reply ${index}`,
        parentId: "top-0",
        publishedAt: "2026-07-11T10:01:00Z",
      },
    }))
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        expect(url.searchParams.get("parentId")).toBe("top-0")
        return new Response(JSON.stringify({ items: replies }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      expect(url.searchParams.get("videoId")).toBe(videoId)
      expect(url.searchParams.get("searchTerms")).toBeNull()
      return new Response(JSON.stringify({ items: topLevelComments }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: watchUrl,
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 100,
      },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 127,
      newCount: 127,
      rawStats: expect.objectContaining({
        commentItems: 127,
        normalThreadCommentItems: 0,
        negativeThreadCommentItems: 127,
        negativeThreadItemCap: 1000,
        negativeThreadItemFloorApplied: true,
        threadPages: 1,
        replyPages: 1,
        commentRequests: 2,
        capped: false,
        coverageClass: "COMPLETE_FOR_INPUT",
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(127)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "reply-26",
      contentKind: "REPLY",
      parentMatchContext: parentContext,
    }))
  })

  it("hydrates an explicit external video before applying negative-parent full-thread policy", async () => {
    const watchUrl = "https://www.youtube.com/watch?v=video-hydrated-negative"
    const parentContext = {
      parentMentionId: "mention-video-hydrated-negative",
      matchedTerm: "brand",
      subjectIds: ["subject-brand"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-brand"],
    }
    deps.findMatchedKeyword.mockReturnValue("brand")
    deps.parentMatchContextsForComments
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([[watchUrl, parentContext]]))
    const requestedPaths: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith("/videos")) {
        expect(url.searchParams.get("id")).toBe("video-hydrated-negative")
        expect(url.searchParams.get("part")).toBe("snippet")
        return new Response(JSON.stringify({
          items: [{
            id: "video-hydrated-negative",
            snippet: {
              title: "Brand customer complaint",
              description: "A negative review of Brand service",
              channelId: "UCexternal",
              channelTitle: "Customer channel",
              publishedAt: new Date().toISOString(),
            },
          }],
        }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      expect(url.searchParams.get("searchTerms")).toBeNull()
      return new Response(JSON.stringify({
        items: [{
          id: "thread-hydrated-negative",
          snippet: {
            videoId: "video-hydrated-negative",
            totalReplyCount: 0,
            topLevelComment: {
              id: "comment-without-brand-term",
              snippet: { textOriginal: "I had the same problem", publishedAt: new Date().toISOString() },
            },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: watchUrl,
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
      },
    }))

    expect(requestedPaths).toEqual([
      "/youtube/v3/videos",
      "/youtube/v3/commentThreads",
    ])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      newCount: 2,
      rawStats: expect.objectContaining({
        explicitVideoHydrationStatus: "matched",
        explicitVideoHydrationError: null,
        negativeParentFullThreadTargets: 1,
        commentSearchTerms: [],
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "video-hydrated-negative",
      contentKind: "VIDEO",
      sourceMetadata: expect.objectContaining({ officialDiscovery: true, ownership: "external" }),
    }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "comment-without-brand-term",
      parentMatchContext: parentContext,
    }))
  })

  it("reports partial coverage when explicit parent hydration fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/videos")) {
        return new Response(JSON.stringify({ error: { message: "bad video request" } }), { status: 400 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      expect(url.searchParams.get("searchTerms")).toBe("brand")
      return new Response(JSON.stringify({
        items: [{
          id: "thread-after-hydration-failure",
          snippet: {
            videoId: "video-hydration-failed",
            totalReplyCount: 0,
            topLevelComment: {
              id: "comment-after-hydration-failure",
              snippet: { textOriginal: "brand complaint" },
            },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://www.youtube.com/watch?v=video-hydration-failed",
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
      },
    }))

    expect(result).toMatchObject({
      status: "partial",
      error: "youtube_fetch_failed",
      foundCount: 1,
      newCount: 1,
      rawStats: expect.objectContaining({
        explicitVideoHydrationStatus: "failed",
        explicitVideoHydrationError: "youtube_fetch_failed",
        coverageClass: "PARTIAL",
      }),
    })
  })

  it("stops commentThreads pagination when the provider repeats a page token", async () => {
    let threadCalls = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      threadCalls += 1
      return new Response(JSON.stringify({ items: [], nextPageToken: "same-thread-token" }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))

    expect(threadCalls).toBe(2)
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        threadPages: 2,
        threadPageTokenRepeated: true,
        commentRequests: 2,
        coverageClass: "PARTIAL",
      }),
    })
  })

  it("stops reply pagination when the provider repeats a page token", async () => {
    let replyCalls = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        replyCalls += 1
        return new Response(JSON.stringify({ items: [], nextPageToken: "same-reply-token" }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: [{
          id: "thread-1",
          snippet: {
            videoId: "video-1",
            totalReplyCount: 1,
            topLevelComment: { id: "top-1", snippet: { textOriginal: "Top" } },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))

    expect(replyCalls).toBe(2)
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        replyPages: 2,
        replyPageTokenRepeated: true,
        commentRequests: 3,
        coverageClass: "PARTIAL",
      }),
    })
  })

  it("caps comment endpoint requests even when every page is empty", async () => {
    let threadCalls = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      threadCalls += 1
      return new Response(JSON.stringify({ items: [], nextPageToken: `page-${threadCalls + 1}` }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://youtu.be/video-1",
      settings: { maxCommentRequests: 2 },
    }))

    expect(threadCalls).toBe(2)
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        threadPages: 2,
        commentRequests: 2,
        maxCommentRequests: 2,
        commentRequestCapped: true,
        capped: true,
        coverageClass: "SAMPLED",
      }),
    })
  })

  it("keeps already-fetched top-level comments when reply pagination exhausts the request budget", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        return new Response(JSON.stringify({
          items: [{ id: "reply-first", snippet: { textOriginal: "First reply" } }],
          nextPageToken: "reply-page-2",
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: [
          {
            id: "thread-first",
            snippet: {
              videoId: "video-1",
              totalReplyCount: 2,
              topLevelComment: { id: "top-first", snippet: { textOriginal: "First top" } },
            },
          },
          {
            id: "thread-second",
            snippet: {
              videoId: "video-1",
              totalReplyCount: 1,
              topLevelComment: { id: "top-second", snippet: { textOriginal: "Second top" } },
            },
          },
        ],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://youtu.be/video-1",
      settings: { maxCommentRequests: 2 },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 3,
      newCount: 3,
      rawStats: expect.objectContaining({
        commentRequests: 2,
        commentRequestCapped: true,
        coverageClass: "SAMPLED",
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({ externalId: "top-first" }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({ externalId: "top-second" }))
  })

  it("drains later top-level comments before an early thread can consume the item budget with replies", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        return new Response(JSON.stringify({
          items: ["reply-1", "reply-2", "reply-3"].map(id => ({
            id,
            snippet: { textOriginal: id },
          })),
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: [
          {
            id: "thread-first",
            snippet: {
              videoId: "video-1",
              totalReplyCount: 3,
              topLevelComment: { id: "top-first", snippet: { textOriginal: "First top" } },
            },
          },
          {
            id: "thread-later",
            snippet: {
              videoId: "video-1",
              totalReplyCount: 0,
              topLevelComment: { id: "top-later", snippet: { textOriginal: "Later top" } },
            },
          },
        ],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://youtu.be/video-1",
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_OWNED_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 3,
      },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 3,
      newCount: 3,
      rawStats: expect.objectContaining({ commentItems: 3, capped: true }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ externalId: "top-first" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({ externalId: "top-later" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(3, expect.objectContaining({ externalId: "reply-1" }))
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalledWith(expect.objectContaining({ externalId: "reply-2" }))
  })

  it("drains later commentThreads pages before fetching replies from the first page", async () => {
    const requestOrder: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/comments")) {
        requestOrder.push("replies")
        return new Response(JSON.stringify({
          items: ["reply-1", "reply-2"].map(id => ({ id, snippet: { textOriginal: id } })),
        }), { status: 200 })
      }
      const pageToken = url.searchParams.get("pageToken")
      requestOrder.push(pageToken ? "threads-page-2" : "threads-page-1")
      if (!pageToken) return new Response(JSON.stringify({
        items: [{
          id: "thread-first-page",
          snippet: {
            videoId: "video-1",
            totalReplyCount: 2,
            topLevelComment: { id: "top-first-page", snippet: { textOriginal: "First page top" } },
          },
        }],
        nextPageToken: "thread-page-2",
      }), { status: 200 })
      expect(pageToken).toBe("thread-page-2")
      return new Response(JSON.stringify({
        items: [{
          id: "thread-second-page",
          snippet: {
            videoId: "video-1",
            totalReplyCount: 0,
            topLevelComment: { id: "top-second-page", snippet: { textOriginal: "Second page top" } },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://youtu.be/video-1",
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_OWNED_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 3,
      },
    }))

    expect(requestOrder).toEqual(["threads-page-1", "threads-page-2", "replies"])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 3,
      newCount: 3,
      rawStats: expect.objectContaining({ threadPages: 2, replyPages: 1, capped: true }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ externalId: "top-first-page" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({ externalId: "top-second-page" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(3, expect.objectContaining({ externalId: "reply-1" }))
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalledWith(expect.objectContaining({ externalId: "reply-2" }))
  })

  it("reports comments-disabled as blocked input instead of a successful empty scan", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: "commentsDisabled" }] } }), { status: 403 })))
    await expect(runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))).resolves.toMatchObject({
      status: "skipped",
      error: "youtube_comments_disabled",
      rawStats: expect.objectContaining({ coverageClass: "BLOCKED" }),
    })
  })

  it("discovers videos by keyword and then scans comments for every video", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        expect(url.searchParams.get("q")).toBe("Acme Robotics")
        expect(url.searchParams.get("type")).toBe("video")
        const publishedAfter = new Date(url.searchParams.get("publishedAfter") ?? "")
        const lookbackHours = (Date.now() - publishedAfter.getTime()) / 3_600_000
        expect(lookbackHours).toBeGreaterThanOrEqual(167.9)
        expect(lookbackHours).toBeLessThan(169)
        return new Response(JSON.stringify({
          items: [
            { id: { videoId: "video-a" }, snippet: { title: "ACME ROBOTICS review", description: "Review", channelId: "UCa", channelTitle: "Reviewer", publishedAt: new Date(Date.now() - 6 * 24 * 3_600_000).toISOString() } },
            { id: { videoId: "video-b" }, snippet: { title: "Industry news", description: "Acme Robotics mentioned", channelId: "UCb", channelTitle: "News", publishedAt: new Date().toISOString() } },
          ],
        }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      expect(url.searchParams.get("searchTerms")).toBe("Acme Robotics")
      const videoId = url.searchParams.get("videoId")
      return new Response(JSON.stringify({
        items: [{ id: `thread-${videoId}`, snippet: {
          videoId,
          canReply: true,
          totalReplyCount: 0,
          topLevelComment: { id: `comment-${videoId}`, snippet: { textOriginal: `Brand comment ${videoId}` } },
        } }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme Robotics",
      keywords: ["Acme Robotics"],
      settings: {
        maxVideos: 2,
        selectiveDiscovery: { contractVersion: "youtube-selective-query-pack-v1" },
      },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 20 },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 4,
      newCount: 4,
      rawStats: expect.objectContaining({
        searchPages: 1,
        discoveryLookbackHours: 168,
        discoveredVideos: 2,
        targetVideos: 2,
        commentSearchTerms: ["Acme Robotics"],
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({ externalId: "video-a", contentKind: "VIDEO" }))
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "comment-video-a",
      accountId: null,
      sourceMetadata: expect.objectContaining({ youtubeCanReply: true, ownership: "external" }),
    }))
  })

  it("drains top-level comments for every discovered video before any replies", async () => {
    const requestOrder: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        requestOrder.push("search")
        return new Response(JSON.stringify({
          items: ["video-first", "video-later"].map(videoId => ({
            id: { videoId },
            snippet: {
              title: `Brand complaint ${videoId}`,
              description: "Brand problem",
              channelId: `channel-${videoId}`,
              channelTitle: "Customer",
              publishedAt: new Date().toISOString(),
            },
          })),
        }), { status: 200 })
      }
      if (url.pathname.endsWith("/comments")) {
        requestOrder.push("replies-first")
        return new Response(JSON.stringify({
          items: ["reply-first", "reply-over-cap"].map(id => ({ id, snippet: { textOriginal: id } })),
        }), { status: 200 })
      }
      const videoId = url.searchParams.get("videoId")
      requestOrder.push(`threads-${videoId}`)
      return new Response(JSON.stringify({
        items: [{
          id: `thread-${videoId}`,
          snippet: {
            videoId,
            totalReplyCount: videoId === "video-first" ? 2 : 0,
            topLevelComment: { id: `top-${videoId}`, snippet: { textOriginal: `brand ${videoId}` } },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "brand",
      keywords: ["brand"],
      settings: { maxVideos: 2 },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 3,
      },
    }))

    expect(requestOrder).toEqual([
      "search",
      "threads-video-first",
      "threads-video-later",
      "replies-first",
    ])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 5,
      newCount: 5,
      rawStats: expect.objectContaining({ targetVideos: 2, commentItems: 3, capped: true }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(3, expect.objectContaining({ externalId: "top-video-first" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(4, expect.objectContaining({ externalId: "top-video-later" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(5, expect.objectContaining({ externalId: "reply-first" }))
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalledWith(expect.objectContaining({ externalId: "reply-over-cap" }))
  })

  it("uses the targeted scenario archive date for the first YouTube archive run", async () => {
    const archiveStartAt = new Date(Date.now() - 90 * 24 * 3_600_000)
    const stalePublishedAt = new Date(archiveStartAt.getTime() - 60_000)
    let publishedAfter: string | null = null
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (!url.pathname.endsWith("/search")) {
        throw new Error("comments must not be requested for a pre-archive candidate")
      }
      publishedAfter = url.searchParams.get("publishedAfter")
      return new Response(JSON.stringify({
        items: [{
          id: { videoId: "pre-archive-video" },
          snippet: {
            title: "Acme archive mention",
            description: "Acme",
            channelId: "UCa",
            channelTitle: "Publisher",
            publishedAt: stalePublishedAt.toISOString(),
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme",
      keywords: ["Acme"],
      settings: {
        maxVideos: 1,
        scenarioLinks: [],
        // A legacy source-wide cursor must not replace this scenario's first
        // route-scoped archive boundary.
        searchIndex: {
          fetchAfter: new Date(archiveStartAt.getTime() + 30 * 24 * 3_600_000).toISOString(),
        },
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
        archiveStartAt: archiveStartAt.toISOString(),
      },
    }))

    expect(publishedAfter).toBe(archiveStartAt.toISOString())
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        archiveStartAt: archiveStartAt.toISOString(),
        since: archiveStartAt.toISOString(),
        until: expect.any(String),
        resumed: false,
        resumedFromWatermark: false,
        providerWindowOverlapMinutes: 0,
        rejectedVideos: 1,
        emptyEligibleResult: true,
        coverageClass: "COMPLETE_FOR_INPUT",
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "pre-archive-video",
      observation: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "STALE_PUBLICATION",
      }),
    }))
  })

  it("resumes a targeted YouTube archive run from its route cursor with safe overlap", async () => {
    const archiveStartAt = new Date(Date.now() - 90 * 24 * 3_600_000)
    const routeCursor = new Date(Date.now() - 2 * 24 * 3_600_000)
    const expectedSince = new Date(routeCursor.getTime() - 5 * 60_000)
    const stalePublishedAt = new Date(expectedSince.getTime() - 1)
    const archiveCursorKey = archiveProviderCursorKey({
      routePlanId: "route-1",
      adapterKey: "YOUTUBE_DATA_API",
      fullArchiveRun: true,
      targetScenarioId: "scenario-target",
      archiveStartAt,
    })
    let publishedAfter: string | null = null
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (!url.pathname.endsWith("/search")) {
        throw new Error("comments must not be requested for a pre-window candidate")
      }
      publishedAfter = url.searchParams.get("publishedAfter")
      return new Response(JSON.stringify({
        items: [{
          id: { videoId: "pre-cursor-video" },
          snippet: {
            title: "Acme cursor mention",
            description: "Acme",
            channelId: "UCa",
            channelTitle: "Publisher",
            publishedAt: stalePublishedAt.toISOString(),
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme",
      keywords: ["Acme"],
      settings: {
        maxVideos: 1,
        scenarioLinks: [],
        searchIndex: {
          routeProviderCursors: {
            [archiveCursorKey]: {
              fetchAfter: routeCursor.toISOString(),
            },
          },
        },
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_EXTERNAL_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
        archiveStartAt: archiveStartAt.toISOString(),
      },
    }))

    expect(publishedAfter).toBe(expectedSince.toISOString())
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        archiveStartAt: archiveStartAt.toISOString(),
        since: expectedSince.toISOString(),
        until: expect.any(String),
        resumed: true,
        resumedFromWatermark: true,
        providerWindowOverlapMinutes: 5,
        rejectedVideos: 1,
        coverageClass: "COMPLETE_FOR_INPUT",
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "pre-cursor-video",
      observation: expect.objectContaining({
        relevanceStatus: "REJECTED",
        relevanceReason: "STALE_PUBLICATION",
      }),
    }))
  })

  it("applies the targeted archive window to comments on a direct video source", async () => {
    const archiveStartAt = new Date(Date.now() - 10 * 24 * 3_600_000)
    const oldCommentAt = new Date(archiveStartAt.getTime() - 1)
    const newCommentAt = new Date(archiveStartAt.getTime() + 60_000)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      expect(url.searchParams.get("videoId")).toBe("video-direct")
      return new Response(JSON.stringify({
        items: [
          {
            id: "thread-new",
            snippet: {
              videoId: "video-direct",
              totalReplyCount: 0,
              topLevelComment: {
                id: "comment-new",
                snippet: { textOriginal: "New comment", publishedAt: newCommentAt.toISOString() },
              },
            },
          },
          {
            id: "thread-old",
            snippet: {
              videoId: "video-direct",
              totalReplyCount: 0,
              topLevelComment: {
                id: "comment-old",
                snippet: { textOriginal: "Old comment", publishedAt: oldCommentAt.toISOString() },
              },
            },
          },
        ],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://www.youtube.com/watch?v=video-direct",
      settings: {
        scenarioLinks: [],
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_OWNED_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
        archiveStartAt: archiveStartAt.toISOString(),
      },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      newCount: 1,
      ignoredCount: 1,
      rawStats: expect.objectContaining({
        archiveStartAt: archiveStartAt.toISOString(),
        since: archiveStartAt.toISOString(),
        until: expect.any(String),
        beforeWindowCommentCount: 1,
        afterWindowCommentCount: 0,
        coverageClass: "COMPLETE_FOR_INPUT",
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "comment-new",
    }))
  })

  it("does not persist an undated direct-video comment or advance targeted archive coverage", async () => {
    const archiveStartAt = new Date(Date.now() - 10 * 24 * 3_600_000)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: "thread-undated",
        snippet: {
          videoId: "video-direct",
          totalReplyCount: 0,
          topLevelComment: {
            id: "comment-undated",
            snippet: { textOriginal: "Timestamp missing" },
          },
        },
      }],
    }), { status: 200 })))

    const result = await runYouTubeCommentsCollector(baseSource({
      url: "https://www.youtube.com/watch?v=video-direct",
      settings: {
        scenarioLinks: [{
          scenarioId: "scenario-target",
          archiveStartAt: archiveStartAt.toISOString(),
        }],
      },
      routeExecution: {
        collectorRunId: "collector-1",
        routePlanId: "route-1",
        capability: "READ_OWNED_COMMENTS",
        adapterKey: "YOUTUBE_DATA_API",
        acquisitionMode: "OFFICIAL_API",
        maxItems: 20,
        fullArchiveRun: true,
        targetScenarioId: "scenario-target",
      },
    }))

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 0,
      ignoredCount: 1,
      rawStats: expect.objectContaining({
        missingCommentTimestampCount: 1,
        coverageClass: "PARTIAL",
      }),
    })
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("does not let a full discovery page starve the keyword comment stage", async () => {
    const commentVideoIds: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        expect(url.searchParams.get("maxResults")).toBe("10")
        return new Response(JSON.stringify({
          items: Array.from({ length: 10 }, (_, index) => ({
            id: { videoId: `video-${index}` },
            snippet: {
              title: index === 0 ? "Acme Robotics field review" : `Unrelated industry video ${index}`,
              description: index === 0 ? "Acme Robotics test" : "Another company",
              channelId: `UC${index}`,
              channelTitle: "Reviewer",
              publishedAt: new Date().toISOString(),
            },
          })),
        }), { status: 200 })
      }
      expect(url.pathname.endsWith("/commentThreads")).toBe(true)
      commentVideoIds.push(url.searchParams.get("videoId") ?? "")
      return new Response(JSON.stringify({
        items: [{
          id: "thread-0",
          snippet: {
            videoId: "video-0",
            totalReplyCount: 0,
            topLevelComment: { id: "comment-0", snippet: { textOriginal: "Acme Robotics is mentioned here" } },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme Robotics",
      keywords: ["Acme Robotics"],
      settings: { maxVideos: 10 },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 10 },
    }))

    expect(commentVideoIds).toEqual(["video-0"])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 11,
      rawStats: expect.objectContaining({
        discoveredVideos: 10,
        approvedVideos: 1,
        // Search provenance without a literal term is operator review work, so
        // only the deterministic match may reach the paid comment stage.
        reviewVideos: 9,
        rejectedVideos: 0,
        targetVideos: 1,
        threadPages: 1,
        commentItems: 1,
        discoveryCandidateCap: 10,
        commentItemCap: 10,
        capped: false,
        coverageClass: "COMPLETE_FOR_INPUT",
      }),
    })
  })

  it("searches each keyword inside discovered videos and deduplicates overlapping results", async () => {
    const commentTerms: Array<string | null> = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        return new Response(JSON.stringify({
          items: [{
            id: { videoId: "video-a" },
            snippet: {
              title: "Acme Robotics review",
              description: "Acme field test",
              channelId: "UCa",
              channelTitle: "Reviewer",
              publishedAt: new Date().toISOString(),
            },
          }],
        }), { status: 200 })
      }
      commentTerms.push(url.searchParams.get("searchTerms"))
      return new Response(JSON.stringify({
        items: [{
          id: "thread-a",
          snippet: {
            videoId: "video-a",
            totalReplyCount: 0,
            topLevelComment: { id: "comment-a", snippet: { textOriginal: "Acme Robotics comment" } },
          },
        }],
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme|Acme Robotics",
      keywords: ["Acme", "Acme Robotics", "acme"],
      settings: { maxVideos: 1 },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 20 },
    }))

    expect(commentTerms).toEqual(["Acme", "Acme Robotics"])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      newCount: 2,
      rawStats: expect.objectContaining({
        threadPages: 2,
        commentSearchTerms: ["Acme", "Acme Robotics"],
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(2)
  })

  it("stops discovery search when the provider repeats a page token", async () => {
    let searchCalls = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        searchCalls += 1
        // Same videoId + same nextPageToken on every page: without a repeated-token
        // guard the loop never advances (all-duplicate items) yet keeps paging.
        return new Response(JSON.stringify({
          items: [{ id: { videoId: "video-loop" }, snippet: { title: "Acme", description: "Acme", channelId: "UCa", channelTitle: "Chan", publishedAt: new Date().toISOString() } }],
          nextPageToken: "same-token",
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme",
      settings: { maxVideos: 50, maxSearchPages: 2 },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 500 },
    }))

    expect(searchCalls).toBe(2)
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({ searchPageTokenRepeated: true, discoveredVideos: 1 }),
    })
  })

  it("defaults discovery to one search page and marks a remaining cursor as sampled", async () => {
    let searchCalls = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        searchCalls += 1
        return new Response(JSON.stringify({
          items: [{
            id: { videoId: "video-a" },
            snippet: {
              title: "Acme review",
              description: "Acme",
              channelId: "UCa",
              channelTitle: "Reviewer",
              publishedAt: new Date().toISOString(),
            },
          }],
          nextPageToken: "page-2",
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme",
      keywords: ["Acme"],
      settings: { maxVideos: 25 },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 100 },
    }))

    expect(searchCalls).toBe(1)
    expect(result).toMatchObject({
      status: "success",
      rawStats: expect.objectContaining({
        searchPages: 1,
        maxSearchPages: 1,
        searchPageCapped: true,
        coverageClass: "SAMPLED",
      }),
    })
  })

  it("deduplicates non-eligible discovery candidates independently from eligible targets", async () => {
    let searchCalls = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (!url.pathname.endsWith("/search")) {
        throw new Error("comments must not be requested for rejected candidates")
      }
      searchCalls += 1
      return new Response(JSON.stringify({
        items: [{
          id: { videoId: "rejected-video" },
          snippet: {
            title: "Unrelated industry news",
            description: "Another company",
            channelId: "UCa",
            channelTitle: "Publisher",
            publishedAt: new Date().toISOString(),
          },
        }],
        ...(searchCalls === 1 ? { nextPageToken: "page-2" } : {}),
      }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme",
      keywords: ["Acme"],
      settings: { maxVideos: 25, maxSearchPages: 2 },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 100 },
    }))

    expect(searchCalls).toBe(2)
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      rawStats: expect.objectContaining({
        discoveredVideos: 1,
        reviewVideos: 1,
        rejectedVideos: 0,
        emptyEligibleResult: true,
        coverageClass: "COMPLETE_FOR_INPUT",
      }),
    })
  })

  it("never calls the comments provider for REVIEW or REJECTED discovery candidates", async () => {
    const commentCalls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/search")) {
        return new Response(JSON.stringify({
          items: [
            { id: { videoId: "review-video" }, snippet: { title: "Acme launch", description: "Acme", channelId: "UCa", channelTitle: "Channel" } },
            { id: { videoId: "rejected-video" }, snippet: { title: "Unrelated launch", description: "Other brand", channelId: "UCb", channelTitle: "Channel", publishedAt: new Date().toISOString() } },
          ],
        }), { status: 200 })
      }
      commentCalls.push(url.searchParams.get("videoId") ?? "channel")
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      sourceType: "keyword",
      ownership: "external",
      query: "Acme",
      keywords: ["Acme"],
      settings: { maxVideos: 2 },
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 20 },
    }))

    expect(commentCalls).toEqual([])
    // An executed search with zero ELIGIBLE videos is a normal empty result,
    // not an error: the old skip+error poisoned the route circuit breaker and
    // silently killed YouTube collection in production.
    expect(result).toMatchObject({
      status: "success",
      rawStats: { emptyEligibleResult: true },
    })
    expect(result.error).toBeUndefined()
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(2)
  })

  it("resolves an external channel handle and watches all channel comments", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
    vi.stubEnv("YOUTUBE_API_KEY", "youtube-key")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get("key")).toBe("youtube-key")
      if (url.pathname.endsWith("/channels")) {
        expect(url.searchParams.get("forHandle")).toBe("acme")
        return new Response(JSON.stringify({ items: [{ id: "UCexternalchannel1234567890" }] }), { status: 200 })
      }
      expect(url.searchParams.get("allThreadsRelatedToChannelId")).toBe("UCexternalchannel1234567890")
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({
      ownership: "external",
      handle: "@acme",
      url: "https://www.youtube.com/@acme",
      settings: {},
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 20 },
    }))

    expect(result).toMatchObject({ status: "success", foundCount: 0, rawStats: expect.objectContaining({ channelId: "UCexternalchannel1234567890" }) })
  })

  it("resolves channel-mode parent contexts once for every video on a provider page", async () => {
    mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
    vi.stubEnv("YOUTUBE_API_KEY", "youtube-key")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/channels")) {
        return new Response(JSON.stringify({ items: [{ id: "UCexternalchannel1234567890" }] }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: ["video-a", "video-b"].map(videoId => ({
          id: `thread-${videoId}`,
          snippet: {
            videoId,
            totalReplyCount: 0,
            topLevelComment: {
              id: `comment-${videoId}`,
              snippet: { textOriginal: `Comment on ${videoId}`, publishedAt: "2026-07-11T10:00:00Z" },
            },
          },
        })),
      }), { status: 200 })
    }))

    await runYouTubeCommentsCollector(baseSource({
      ownership: "external",
      handle: "@acme",
      url: "https://www.youtube.com/@acme",
      settings: {},
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_EXTERNAL_COMMENTS", adapterKey: "YOUTUBE_DATA_API", acquisitionMode: "OFFICIAL_API", maxItems: 20 },
    }))

    expect(deps.parentMatchContextsForComments).toHaveBeenCalledTimes(1)
    expect(deps.parentMatchContextsForComments).toHaveBeenCalledWith(
      "org-1",
      "youtube",
      [
        "https://www.youtube.com/watch?v=video-a",
        "https://www.youtube.com/watch?v=video-b",
      ],
      ["video-a", "video-b"],
    )
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(2)
  })

  it("retries a 429 once honouring Retry-After and succeeds without failing the run", async () => {
    let commentCalls = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      commentCalls += 1
      if (commentCalls === 1) {
        return new Response(JSON.stringify({ error: { message: "temporary throttle" } }), {
          status: 429,
          headers: { "retry-after": "0" },
        })
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))

    expect(commentCalls).toBe(2)
    expect(result.status).toBe("success")
    expect(result.error ?? null).toBeNull()
  })

  it("does not retry RESOURCE_EXHAUSTED even when the legacy reason looks transient", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { errors: [{ reason: "backendError" }], status: "RESOURCE_EXHAUSTED" } }),
      { status: 429, headers: { "retry-after": "0" } },
    )))

    const result = await runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: "failed",
      error: "youtube_rate_limited:backendError",
      rawStats: expect.objectContaining({
        status: 429,
        reason: "backendError",
        credential: "oauth_account",
        coverageClass: "BLOCKED",
      }),
    })
  })

  it("retries a transient user rate limit when Google does not mark quota exhausted", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response(JSON.stringify({
          error: { errors: [{ reason: "userRateLimitExceeded" }] },
        }), { status: 429, headers: { "retry-after": "0" } })
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }))

    const result = await runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))

    expect(calls).toBe(2)
    expect(result.status).toBe("success")
  })

  it.each(["quotaExceeded", "dailyLimitExceeded", "limitExceeded"])(
    "classifies hard 403 quota reason %s without retrying",
    async (reason) => {
      mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
      vi.stubEnv("YOUTUBE_API_KEY", "youtube-key")
      vi.stubGlobal("fetch", vi.fn(async () => new Response(
        JSON.stringify({ error: { errors: [{ reason }] } }),
        { status: 403 },
      )))

      const result = await runYouTubeCommentsCollector(baseSource({ url: "https://youtu.be/video-1" }))

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        status: "failed",
        error: `youtube_rate_limited:${reason}`,
        rawStats: expect.objectContaining({
          status: 403,
          reason,
          credential: "api_key",
        }),
      })
    },
  )
})

describe("VK official comments", () => {
  it("parses wall URLs and paginates replies beyond the inline thread sample", async () => {
    vi.stubEnv("VK_SERVICE_TOKEN", "vk-token")
    const source = baseSource({
      platform: "vkontakte",
      url: "https://vk.com/wall-42_99",
      routeExecution: { collectorRunId: "collector-1", routePlanId: "route-1", capability: "READ_OWNED_COMMENTS", adapterKey: "VK_API", acquisitionMode: "OFFICIAL_API", maxItems: 100 },
    })
    expect(vkWallTarget(source)).toEqual({ ownerId: -42, postId: 99 })
    let topCall = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get("access_token")).toBe("vk-token")
      if (url.searchParams.get("comment_id") === "10") {
        return new Response(JSON.stringify({ response: {
          count: 2,
          items: [
            { id: 11, from_id: 2, text: "Inline reply", date: 1782209401 },
            { id: 12, from_id: 3, text: "Paged reply", date: 1782209402 },
          ],
        } }), { status: 200 })
      }
      topCall += 1
      return new Response(JSON.stringify({ response: {
        count: 1,
        items: [{ id: 10, from_id: 1, text: "Top VK comment", date: 1782209400, thread: { count: 2, items: [{ id: 11, from_id: 2, text: "Inline reply", date: 1782209401 }] } }],
      } }), { status: 200 })
    }))

    const result = await runVkCommentsCollector(source)

    expect(topCall).toBe(1)
    expect(result).toMatchObject({ status: "success", foundCount: 3, newCount: 3, rawStats: expect.objectContaining({ pages: 1, replyPages: 1, coverageClass: "COMPLETE_FOR_INPUT" }) })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "-42_99_12",
      contentKind: "REPLY",
      replyToExternalId: "-42_99_10",
    }))
  })
})
