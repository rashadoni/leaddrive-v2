import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  collectorRun: {
    create: vi.fn(),
    update: vi.fn(),
  },
  monitoringSource: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
  ingestEnvelope: {
    findMany: vi.fn(),
  },
  socialAccount: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  socialConnectionCursor: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  mentionEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  channelConfig: {
    findFirst: vi.fn(),
  },
  sourceRoutePlan: {
    findMany: vi.fn(),
  },
}))

const mockDeps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}))

vi.mock("@/lib/secure-token", () => ({
  decryptToken: mockDeps.decryptToken,
}))

vi.mock("@/lib/sentiment", () => ({
  classifySentiment: mockDeps.classifySentiment,
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mockDeps.findMatchedKeyword,
  ingestMentionWithResult: mockDeps.ingestMentionWithResult,
}))

vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: mockDeps.parentMatchContextsForComments,
}))

vi.mock("@/lib/social/source-route-plan", () => ({
  SOURCE_ROUTE_POLICY_VERSION: "social-monitoring-v2-pr2",
  ROUTE_ADAPTERS: {
    META_GRAPH: "META_GRAPH",
    YOUTUBE_DATA_API: "YOUTUBE_DATA_API",
    VK_API: "VK_API",
    TELEGRAM_BOT_API: "TELEGRAM_BOT_API",
    TIKTOK_BUSINESS_API: "TIKTOK_BUSINESS_API",
    X_API: "X_API",
    LICENSED_PROVIDER: "LICENSED_PROVIDER",
    BRIGHT_DATA_SNAPSHOT: "BRIGHT_DATA_SNAPSHOT",
    APIFY_ASYNC: "APIFY_ASYNC",
    SEARCH_INDEX_GENERIC: "SEARCH_INDEX_GENERIC",
    NOTIFICATION_INBOX: "NOTIFICATION_INBOX",
    BROWSER_CAPTURE_READ_ONLY: "BROWSER_CAPTURE_READ_ONLY",
    MANUAL_TASK: "MANUAL_TASK",
  },
  compileSourceRoutePlans: vi.fn(async () => []),
  recordSourceRouteResult: vi.fn(async () => undefined),
  selectedAdapterForPlan: vi.fn((plan: { primaryAdapter: string }) => plan.primaryAdapter),
}))

import { runMonitoringSource, type MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import { prisma } from "@/lib/prisma"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"

const source: MonitoringSourceForRun = {
  id: "source-1",
  organizationId: "org-1",
  platform: "facebook",
  sourceType: "page",
  collectionMode: "official_api",
  status: "active",
  cadenceMinutes: 30,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: {},
}

const account = {
  id: "account-1",
  platform: "facebook",
  handle: "brand",
  displayName: "Brand",
  accessToken: "encrypted",
  keywords: ["LeadDrive"],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function expectBearerGraphCalls(fetchMock: ReturnType<typeof vi.fn>) {
  for (const [input, init] of fetchMock.mock.calls) {
    expect(String(input)).not.toContain("access_token=")
    expect((init as RequestInit | undefined)?.headers).toMatchObject({ Authorization: "Bearer plain-token" })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation(async (
    callback: (tx: typeof mockPrisma) => unknown,
  ) => callback(mockPrisma))
  mockPrisma.$executeRawUnsafe.mockResolvedValue(1)
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.monitoringSource.findMany).mockResolvedValue([{
    ...source,
    ownership: "external",
    subjectSources: [],
  }] as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as never)
  vi.mocked(prisma.ingestEnvelope.findMany).mockResolvedValue([] as never)
  vi.unstubAllGlobals()
  vi.mocked(prisma.collectorRun.create).mockResolvedValue({ id: "run-1" } as never)
  vi.mocked(prisma.collectorRun.update).mockResolvedValue({ id: "run-1" } as never)
  vi.mocked(prisma.monitoringSource.findFirst).mockResolvedValue({
    runClaimVersion: 1,
    runClaimExpiresAt: new Date(Date.now() + 15 * 60_000),
  } as never)
  vi.mocked(prisma.monitoringSource.update).mockResolvedValue(source as never)
  vi.mocked(prisma.monitoringSource.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([account] as never)
  vi.mocked(prisma.socialAccount.findFirst).mockResolvedValue(account as never)
  vi.mocked(prisma.socialConnectionCursor.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.socialConnectionCursor.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.socialConnectionCursor.upsert).mockResolvedValue({ id: "cursor-1" } as never)
  vi.mocked(prisma.socialConnectionCursor.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mentionEvidence.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mentionEvidence.create).mockResolvedValue({ id: "evidence-1" } as never)
  mockDeps.decryptToken.mockReturnValue("plain-token")
  mockDeps.classifySentiment.mockResolvedValue("neutral")
  mockDeps.findMatchedKeyword.mockReturnValue("LeadDrive")
  mockDeps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
  mockDeps.parentMatchContextsForComments.mockResolvedValue(new Map())
  const metaPlan = {
    id: "route-1",
    routeKey: "compiled-route",
    policyVersion: "social-monitoring-v2-pr2",
    status: "ACTIVE",
    capability: "READ_OWNED_COMMENTS",
    contentScope: "OWNED",
    primaryAdapter: "META_GRAPH",
    fallbackAdapters: [],
    capabilityProofId: null,
    capabilityProof: null,
    connectionAccountId: "account-1",
    acquisitionMode: "OFFICIAL_API",
    dependsOnCapability: null,
    budget: { maxItems: 100, timeoutSeconds: 900 },
    rateLimit: {},
    circuitOpenUntil: null,
  }
  vi.mocked(prisma.sourceRoutePlan.findMany)
    .mockResolvedValueOnce([{ routeKey: "compiled-route", policyVersion: "social-monitoring-v2-pr2" }] as never)
    .mockResolvedValueOnce([metaPlan] as never)
})

describe("official social monitoring collector", () => {
  it("ingests Facebook comments and tagged posts through shared mention ingestion with evidence", async () => {
    const negativeParentContext = {
      parentMentionId: "parent-facebook",
      matchedTerm: "LeadDrive",
      subjectIds: ["subject-1"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-1"],
    }
    mockDeps.parentMatchContextsForComments.mockResolvedValue(new Map([
      ["post-1", negativeParentContext],
      ["https://facebook.com/post-1", negativeParentContext],
    ]))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/me/posts")) {
        return jsonResponse({ data: [{ id: "post-1", created_time: "2026-07-05T08:00:00+0000", permalink_url: "https://facebook.com/post-1" }] })
      }
      if (url.includes("/post-1/comments")) {
        return jsonResponse({
          data: [
            { id: "comment-1", message: "LeadDrive info please", from: { id: "u1", name: "User One" }, created_time: "2026-07-05T08:05:00+0000", like_count: 3 },
            { id: "empty", message: "" },
          ],
        })
      }
      if (url.includes("/me/tagged")) {
        return jsonResponse({ data: [{ id: "tag-1", story: "Brand tagged LeadDrive", created_time: "2026-07-05T08:10:00+0000", permalink_url: "https://facebook.com/tag-1", from: { id: "u2", name: "User Two" } }] })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.mocked(ingestMentionWithResult)
      .mockResolvedValueOnce({ id: "mention-comment", created: true })
      .mockResolvedValueOnce({ id: "mention-tag", created: false })

    const lastSuccessfulAt = new Date("2026-07-01T00:00:00.000Z")
    const result = await runMonitoringSource({
      ...source,
      lastCheckedAt: new Date("2026-07-05T00:00:00.000Z"),
      lastSuccessfulAt,
    })

    expect(result).toMatchObject({
      status: "success",
      foundCount: 2,
      newCount: 1,
      duplicateCount: 1,
      ignoredCount: 1,
      error: null,
    })
    const urls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes("/me/posts"))).toBe(true)
    const postsUrl = urls.find(url => url.includes("/me/posts"))
    expect(new URL(postsUrl || "https://invalid").searchParams.get("since")).toBe(String(Math.floor(lastSuccessfulAt.getTime() / 1000)))
    const cycleUntil = Number(new URL(postsUrl || "https://invalid").searchParams.get("until"))
    expect(Number.isSafeInteger(cycleUntil)).toBe(true)
    expect(cycleUntil).toBeGreaterThan(0)
    expect(urls.some((url) => url.includes("/post-1/comments"))).toBe(true)
    expect(urls.some((url) => url.includes("/me/tagged"))).toBe(true)
    expectBearerGraphCalls(fetchMock)
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      accountId: "account-1",
      platform: "facebook",
      externalId: "c:comment-1",
      sourceType: "comment",
      sourceProvider: "native",
      parentPostUrl: "https://facebook.com/post-1",
      parentMatchContext: negativeParentContext,
      sourceMetadata: expect.objectContaining({ monitoringSourceId: "source-1", collector: "official_api" }),
    }))
    expect(mockDeps.parentMatchContextsForComments).toHaveBeenCalledWith(
      "org-1",
      "facebook",
      ["https://facebook.com/post-1"],
      ["post-1"],
    )
    expect(prisma.mentionEvidence.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        mentionId: "mention-comment",
        sourceId: "source-1",
        sourceTrustTier: "T1",
      }),
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "source-1", organizationId: "org-1", runClaimVersion: 1 }),
      data: expect.objectContaining({
        status: "active",
        lastError: null,
        lastSuccessfulAt: new Date(cycleUntil * 1_000),
      }),
    }))
    expect(prisma.socialConnectionCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        cursorKey: "source:source-1:facebook:watch:post-1",
        cursorValue: JSON.stringify({ url: "https://facebook.com/post-1" }),
      }),
    }))
  })

  it("records Meta permission failures as limited source health", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing permissions", { status: 403 })))

    const result = await runMonitoringSource(source)

    expect(result).toMatchObject({ status: "failed", error: "official_permission_error" })
    expect(prisma.collectorRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", error: "official_permission_error" }),
    }))
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "limited", lastError: "official_permission_error" }),
    }))
  })

  it("paginates Facebook comments and ingests embedded paginated replies", async () => {
    const negativeParentContext = {
      parentMentionId: "parent-facebook",
      matchedTerm: "LeadDrive",
      subjectIds: ["subject-1"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-1"],
    }
    mockDeps.parentMatchContextsForComments.mockResolvedValue(new Map([["post-1", negativeParentContext]]))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/me/posts")) {
        return jsonResponse({ data: [{ id: "post-1", permalink_url: "https://facebook.com/post-1" }] })
      }
      if (url.includes("/comment-1/comments")) {
        expect(url).not.toContain("access_token")
        return jsonResponse({
          data: [{ id: "reply-2", message: "second reply", parent: { id: "comment-1" } }],
        })
      }
      if (url.includes("/post-1/comments") && url.includes("after=top-page-2")) {
        expect(url).not.toContain("access_token")
        return jsonResponse({ data: [{ id: "comment-2", message: "second top-level comment" }] })
      }
      if (url.includes("/post-1/comments")) {
        return jsonResponse({
          data: [{
            id: "comment-1",
            message: "first top-level comment",
            comments: {
              data: [{ id: "reply-1", message: "first reply", parent: { id: "comment-1" } }],
              paging: {
                next: "https://graph.facebook.com/v21.0/comment-1/comments?after=reply-page-2&access_token=secret",
              },
            },
          }],
          paging: {
            next: "https://graph.facebook.com/v21.0/post-1/comments?after=top-page-2&access_token=secret",
          },
        })
      }
      if (url.includes("/me/tagged")) return jsonResponse({ data: [] })
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runMonitoringSource(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 4,
      newCount: 4,
      error: null,
      rawStats: {
        routePlanExecution: true,
        routeResults: [expect.objectContaining({
          partialCoverage: false,
          commentCoverage: expect.objectContaining({
            pages: 4,
            records: 4,
            replies: 2,
            capped: false,
            complete: true,
          }),
        })],
      },
    })
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "c:reply-1",
      sourceType: "reply",
      contentKind: "REPLY",
      postExternalId: "post-1",
      replyToExternalId: "comment-1",
      parentMatchContext: negativeParentContext,
    }))
    expect(mockDeps.ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "c:reply-2",
      contentKind: "REPLY",
      replyToExternalId: "comment-1",
    }))
  })

  it("runs Instagram hashtag search when an official IG account is connected", async () => {
    vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([{ ...account, platform: "instagram", handle: "17841400000000000" }] as never)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/ig_hashtag_search")) return jsonResponse({ data: [{ id: "hash-1", name: "leaddrive" }] })
      if (url.includes("/hash-1/recent_media")) {
        return jsonResponse({ data: [{ id: "media-1", caption: "Testing #leaddrive", permalink: "https://instagram.com/p/1", timestamp: "2026-07-05T08:00:00+0000", username: "creator", media_type: "VIDEO", like_count: 4, comments_count: 2 }] })
      }
      return jsonResponse({}, 404)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await runMonitoringSource({
      ...source,
      platform: "instagram",
      sourceType: "hashtag",
      query: "leaddrive",
    } as MonitoringSourceForRun)

    expect(result).toMatchObject({ status: "success", foundCount: 1, newCount: 1 })
    const urls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes("ig_hashtag_search"))).toBe(true)
    expect(urls.some((url) => url.includes("/hash-1/recent_media"))).toBe(true)
    expectBearerGraphCalls(fetchMock)
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      platform: "instagram",
      externalId: "h:hash-1:media-1",
      sourceType: "mention",
      contentKind: "VIDEO",
      sourceProvider: "native",
      sourceMetadata: expect.objectContaining({
        hashtagId: "hash-1",
        mediaType: "VIDEO",
        monitoringSourceId: "source-1",
      }),
    }))
  })

  it("fails closed for TikTok Business comments when the capability proof is absent", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    vi.mocked(prisma.sourceRoutePlan.findMany)
      .mockReset()
      .mockResolvedValueOnce([{ routeKey: "compiled-tiktok", policyVersion: "social-monitoring-v2-pr2" }] as never)
      .mockResolvedValueOnce([{
        id: "route-tiktok",
        status: "ACTIVE",
        capability: "READ_OWNED_COMMENTS",
        contentScope: "OWNED",
        primaryAdapter: "TIKTOK_BUSINESS_API",
        fallbackAdapters: [],
        capabilityProofId: null,
        capabilityProof: null,
        connectionAccountId: "account-1",
        acquisitionMode: "OFFICIAL_API",
        dependsOnCapability: null,
        budget: { maxItems: 100, timeoutSeconds: 900 },
        rateLimit: {},
        circuitOpenUntil: null,
      }] as never)
    const result = await runMonitoringSource({
      ...source,
      platform: "tiktok",
      sourceType: "page",
      collectionMode: "official_api",
    })

    expect(result).toMatchObject({
      status: "failed",
      error: "capability_proof_missing",
      foundCount: 0,
      newCount: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.monitoringSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "limited", lastError: "capability_proof_missing" }),
    }))
  })
})
