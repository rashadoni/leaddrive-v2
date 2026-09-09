import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { findFirst: vi.fn(), update: vi.fn() },
  mentionEvidence: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
  classifySentiment: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  findMatchedKeyword: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/secure-token", () => ({ decryptToken: deps.decryptToken, encryptToken: deps.encryptToken }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: deps.classifySentiment }))
vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult: deps.ingestMentionWithResult,
  findMatchedKeyword: deps.findMatchedKeyword,
}))
vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: deps.parentMatchContextsForComments,
}))

import { nextTikTokCursor, runTikTokBusinessCommentsCollector } from "@/lib/social/tiktok-business-comments-adapter"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "src-tiktok",
  organizationId: "org-1",
  platform: "tiktok",
  sourceType: "page",
  ownership: "owned",
  collectionMode: "official_api",
  status: "active",
  cadenceMinutes: 60,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  keywords: ["LeadDrive"],
  settings: { socialAccountId: "acc-1", tiktokBusinessId: "business-1", maxVideos: 20 },
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-1",
    capability: "READ_OWNED_COMMENTS",
    adapterKey: "TIKTOK_BUSINESS_API",
    acquisitionMode: "OFFICIAL_API",
    maxItems: 100,
  },
}

function response(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: "OK", request_id: `req-${Math.random()}`, data }), { status: 200 })
}

async function flushAsyncCalls() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  mockPrisma.socialAccount.findFirst.mockResolvedValue({
    id: "acc-1",
    handle: "display-open-id",
    accessToken: "encrypted-business-token",
    keywords: [],
  })
  mockPrisma.mentionEvidence.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.create.mockResolvedValue({ id: "evidence-1" })
  deps.decryptToken.mockReturnValue("business-access-token")
  deps.encryptToken.mockReturnValue("encrypted-refreshed-token")
  mockPrisma.socialAccount.update.mockResolvedValue({ id: "acc-1" })
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

describe("TikTok Business comments adapter", () => {
  it("rejects missing and repeated cursors", () => {
    const seen = new Set<string>()
    expect(nextTikTokCursor({ hasMore: true, cursor: 2, seen })).toEqual({ cursor: "2", error: null })
    expect(nextTikTokCursor({ hasMore: true, cursor: 2, seen })).toEqual({ cursor: undefined, error: "tiktok_pagination_cursor_repeated" })
    expect(nextTikTokCursor({ hasMore: true, cursor: undefined, seen })).toEqual({ cursor: undefined, error: "tiktok_pagination_cursor_missing" })
  })

  it("paginates videos, comments and replies and suppresses documented duplicate comment ids", async () => {
    const parentContext = {
      parentMentionId: "mention-video-1",
      matchedTerm: "LeadDrive",
      subjectIds: ["subject-1"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-1"],
    }
    deps.parentMatchContextsForComments.mockResolvedValue(new Map([
      ["video-1", parentContext],
    ]))
    let commentPage = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(new Headers(init?.headers).get("Access-Token")).toBe("business-access-token")
      if (url.pathname.endsWith("/business/video/list/")) {
        expect(url.searchParams.get("business_id")).toBe("business-1")
        return response({
          videos: [{ item_id: "video-1", share_url: "https://www.tiktok.com/@brand/video/video-1", caption: "Owned post", comments: 3 }],
          cursor: 0,
          has_more: false,
        })
      }
      if (url.pathname.endsWith("/business/comment/reply/list/")) {
        expect(url.searchParams.get("comment_id")).toBe("comment-1")
        return response({
          comments: [{ comment_id: "reply-1", parent_comment_id: "comment-1", video_id: "video-1", text: "A reply", create_time: 1782209401 }],
          cursor: 0,
          has_more: false,
        })
      }
      commentPage += 1
      if (commentPage === 1) {
        return response({
          comments: [{ comment_id: "comment-1", video_id: "video-1", text: "First", replies: 1, create_time: 1782209400 }],
          cursor: 2,
          has_more: true,
        })
      }
      expect(url.searchParams.get("cursor")).toBe("2")
      return response({
        comments: [
          { comment_id: "comment-1", video_id: "video-1", text: "First duplicate", replies: 0, create_time: 1782209400 },
          { comment_id: "comment-2", video_id: "video-1", text: "Second", replies: 0, create_time: 1782209402 },
        ],
        cursor: 0,
        has_more: false,
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runTikTokBusinessCommentsCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 3,
      newCount: 3,
      duplicateCount: 1,
      ignoredCount: 0,
      rawStats: expect.objectContaining({ videoPages: 1, commentPages: 2, replyPages: 1, coverageClass: "COMPLETE_FOR_INPUT" }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenCalledTimes(3)
    expect(deps.parentMatchContextsForComments).toHaveBeenCalledWith(
      "org-1",
      "tiktok",
      ["https://www.tiktok.com/@brand/video/video-1"],
      ["video-1"],
    )
    expect(deps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "reply-1",
      contentKind: "REPLY",
      parentExternalId: "comment-1",
      threadExternalId: "comment-1",
      depth: 1,
      sourceProvider: "native",
      parentMatchContext: parentContext,
    }))
  })

  it("drains top-level comments for every video before spending the item budget on replies", async () => {
    const requestOrder: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/business/video/list/")) {
        requestOrder.push("videos")
        return response({
          videos: [
            { item_id: "video-first", share_url: "https://tiktok.com/@brand/video/video-first" },
            { item_id: "video-later", share_url: "https://tiktok.com/@brand/video/video-later" },
          ],
          has_more: false,
        })
      }
      if (url.pathname.endsWith("/business/comment/reply/list/")) {
        requestOrder.push("replies-first")
        return response({
          comments: [
            { comment_id: "reply-first", text: "reply first" },
            { comment_id: "reply-over-cap", text: "reply over cap" },
          ],
          has_more: false,
        })
      }
      const videoId = url.searchParams.get("video_id")
      requestOrder.push(`comments-${videoId}`)
      return response({
        comments: [{
          comment_id: `top-${videoId}`,
          video_id: videoId,
          text: `top ${videoId}`,
          replies: videoId === "video-first" ? 2 : 0,
        }],
        has_more: false,
      })
    }))

    const result = await runTikTokBusinessCommentsCollector({
      ...source,
      routeExecution: { ...source.routeExecution!, maxItems: 3 },
    })

    expect(requestOrder).toEqual([
      "videos",
      "comments-video-first",
      "comments-video-later",
      "replies-first",
    ])
    expect(result).toMatchObject({
      status: "success",
      foundCount: 3,
      newCount: 3,
      rawStats: expect.objectContaining({
        commentPages: 2,
        replyPages: 1,
        deferredReplyThreads: 1,
        capped: true,
      }),
    })
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(1, expect.objectContaining({ externalId: "top-video-first" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(2, expect.objectContaining({ externalId: "top-video-later" }))
    expect(deps.ingestMentionWithResult).toHaveBeenNthCalledWith(3, expect.objectContaining({ externalId: "reply-first" }))
    expect(deps.ingestMentionWithResult).not.toHaveBeenCalledWith(expect.objectContaining({ externalId: "reply-over-cap" }))
  })

  it("returns truthful partial coverage on a repeated comment cursor", async () => {
    let page = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/business/video/list/")) return response({ videos: [{ item_id: "video-1", share_url: "https://tiktok.com/@brand/video/video-1", comments: 2 }], has_more: false })
      page += 1
      expect(page === 1 ? url.searchParams.get("cursor") : url.searchParams.get("cursor")).toBe(page === 1 ? null : "repeat")
      return response({ comments: [{ comment_id: "comment-" + page, video_id: "video-1", text: "page " + page, replies: 0 }], cursor: "repeat", has_more: true })
    }))
    await expect(runTikTokBusinessCommentsCollector(source)).resolves.toMatchObject({
      status: "partial", error: "tiktok_pagination_cursor_repeated", foundCount: 2,
      rawStats: expect.objectContaining({ commentPages: 2, coverageClass: "PARTIAL", watermarkEligible: false, resumeMode: "RETRY_FROM_START_WITH_TENANT_EXTERNAL_ID_DEDUPE" }),
    })
  })

  it("caps video listing when the provider keeps returning unique cursors", async () => {
    let page = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.pathname).toContain("/business/video/list/")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      page += 1
      if (page > 2) throw new Error("video listing exceeded maxPages")
      expect(url.searchParams.get("cursor")).toBe(page === 1 ? null : `cursor-${page - 1}`)
      return response({ videos: [], cursor: `cursor-${page}`, has_more: true })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runTikTokBusinessCommentsCollector({
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        maxPages: 2,
        maxVideos: 20,
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      error: "tiktok_pagination_max_pages",
      rawStats: expect.objectContaining({
        videoPages: 2,
        providerRequestDispatched: true,
        dispatchUnknown: false,
      }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("fails closed without a Business API token", async () => {
    deps.decryptToken.mockImplementation(() => { throw new Error("wrong token domain") })
    mockPrisma.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", handle: "business-1", accessToken: null, keywords: [] })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(runTikTokBusinessCommentsCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "tiktok_business_credentials_missing",
      rawStats: { failClosed: true, providerRequestDispatched: false, dispatchUnknown: false },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails before paid data dispatch when token refresh times out", async () => {
    vi.useFakeTimers()
    vi.stubEnv("TIKTOK_BUSINESS_CLIENT_ID", "client-1")
    vi.stubEnv("TIKTOK_BUSINESS_CLIENT_SECRET", "secret-1")
    mockPrisma.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      handle: "business-1",
      accessToken: "encrypted-business-token",
      tokenExpiresAt: new Date(Date.now() - 60_000),
      keywords: [],
    })
    deps.decryptToken.mockReturnValue("expired-access::refresh-1")
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const pending = runTikTokBusinessCommentsCollector(source)
    await flushAsyncCalls()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: "tiktok_business_token_refresh_timeout",
      rawStats: { failClosed: true, providerRequestDispatched: false, dispatchUnknown: false },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/tt_user/oauth2/refresh_token/")
    expect(mockPrisma.socialAccount.update).not.toHaveBeenCalled()
  })

  it("marks a timed-out paid data request as dispatched with an unknown outcome", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const pending = runTikTokBusinessCommentsCollector(source)
    await flushAsyncCalls()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: "tiktok_business_timeout",
      rawStats: expect.objectContaining({
        providerRequestDispatched: true,
        dispatchUnknown: true,
      }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/business/video/list/")
  })

  it("does not dispatch another paid page after a comment request outcome becomes unknown", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal("fetch", fetchMock)

    const pending = runTikTokBusinessCommentsCollector({
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        videoIds: ["video-1", "video-2"],
      },
    })
    await flushAsyncCalls()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: "tiktok_business_timeout",
      rawStats: expect.objectContaining({ dispatchUnknown: true }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("/business/comment/list/")
  })

  it.each([
    [429, "rate limit exceeded", "tiktok_business_rate_limited"],
    [403, "permission denied", "tiktok_business_permission_denied"],
  ] as const)("stops all paid target calls after a provider-wide HTTP %s response", async (status, message, expectedError) => {
    let calls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls += 1
      if (calls > 1) throw new Error("provider-wide rejection dispatched another paid target")
      expect(url.pathname).toContain("/business/comment/list/")
      expect(url.searchParams.get("video_id")).toBe("video-1")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ code: status, message, request_id: `request-${status}` }), { status })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runTikTokBusinessCommentsCollector({
      ...source,
      settings: {
        ...(source.settings as Record<string, unknown>),
        videoIds: ["video-1", "video-2"],
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      foundCount: 0,
      error: expectedError,
      rawStats: expect.objectContaining({
        providerRequestDispatched: true,
        dispatchUnknown: false,
      }),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refreshes an expired one-day Business token with the purpose-separated refresh token", async () => {
    vi.stubEnv("TIKTOK_BUSINESS_CLIENT_ID", "client-1")
    vi.stubEnv("TIKTOK_BUSINESS_CLIENT_SECRET", "secret-1")
    mockPrisma.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      handle: "business-1",
      accessToken: "encrypted-business-token",
      tokenExpiresAt: new Date(Date.now() - 60_000),
      keywords: [],
    })
    deps.decryptToken.mockReturnValue("expired-access::refresh-1")
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/tt_user/oauth2/refresh_token/")) {
        expect(init?.body).toBe(JSON.stringify({ client_id: "client-1", client_secret: "secret-1", grant_type: "refresh_token", refresh_token: "refresh-1" }))
        return new Response(JSON.stringify({ code: 0, data: { access_token: "fresh-access", refresh_token: "refresh-2", expires_in: 86400 } }), { status: 200 })
      }
      expect(new Headers(init?.headers).get("Access-Token")).toBe("fresh-access")
      return response({ videos: [], cursor: 0, has_more: false })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runTikTokBusinessCommentsCollector(source)).resolves.toMatchObject({ status: "success", foundCount: 0 })
    expect(deps.encryptToken).toHaveBeenCalledWith("fresh-access::refresh-2", "oauth:tiktok-business")
    expect(mockPrisma.socialAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "acc-1" },
      data: expect.objectContaining({ accessToken: "encrypted-refreshed-token", tokenExpiresAt: expect.any(Date) }),
    }))
  })
})
