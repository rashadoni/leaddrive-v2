import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { findFirst: vi.fn() },
  mentionEvidence: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
  refreshYouTubeToken: vi.fn(),
  parentMatchContextsForComments: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: deps.findMatchedKeyword,
  ingestMentionWithResult: deps.ingestMentionWithResult,
}))
vi.mock("@/lib/social/youtube-poller", () => ({
  refreshYouTubeToken: deps.refreshYouTubeToken,
}))
vi.mock("@/lib/social/parent-match-context", () => ({
  parentMatchContextsForComments: deps.parentMatchContextsForComments,
}))

import { runYouTubeCommentsCollector } from "@/lib/social/youtube-comments-adapter"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-youtube",
  organizationId: "org-1",
  platform: "youtube",
  sourceType: "post",
  ownership: "external",
  collectionMode: "official_api",
  status: "active",
  cadenceMinutes: 60,
  url: "https://www.youtube.com/watch?v=video-1",
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: {},
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-1",
    capability: "READ_EXTERNAL_COMMENTS",
    adapterKey: "YOUTUBE_DATA_API",
    acquisitionMode: "OFFICIAL_API",
    maxItems: 10,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubEnv("YOUTUBE_API_KEY", "youtube-api-key")
  mockPrisma.socialAccount.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.create.mockResolvedValue({ id: "evidence-1" })
  mockPrisma.mentionEvidence.update.mockResolvedValue({ id: "evidence-1" })
  deps.findMatchedKeyword.mockReturnValue(null)
  deps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
  deps.parentMatchContextsForComments.mockResolvedValue(new Map())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("YouTube monitoring provider timeout boundary", () => {
  it("passes an AbortSignal to the Data API fetch", async () => {
    const requestedPaths: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      expect(url.searchParams.get("key")).toBe("youtube-api-key")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runYouTubeCommentsCollector(source)).resolves.toMatchObject({
      status: "success",
      foundCount: 0,
    })
    expect(requestedPaths).toEqual(["/youtube/v3/videos", "/youtube/v3/commentThreads"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
