import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mentionEvidence: { findFirst: vi.fn(), create: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: deps.findMatchedKeyword,
  ingestMentionWithResult: deps.ingestMentionWithResult,
}))

import { runVkCommentsCollector } from "@/lib/social/vk-comments-adapter"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-vk",
  organizationId: "org-1",
  platform: "vkontakte",
  sourceType: "post",
  ownership: "external",
  collectionMode: "official_api",
  status: "active",
  cadenceMinutes: 60,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  settings: { ownerId: -100, postId: 42 },
  routeExecution: {
    collectorRunId: "collector-1",
    routePlanId: "route-1",
    capability: "READ_EXTERNAL_COMMENTS",
    adapterKey: "VK_API",
    acquisitionMode: "OFFICIAL_API",
    maxItems: 10,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubEnv("VK_SERVICE_TOKEN", "vk-service-token")
  mockPrisma.mentionEvidence.findFirst.mockResolvedValue(null)
  mockPrisma.mentionEvidence.create.mockResolvedValue({ id: "evidence-1" })
  deps.findMatchedKeyword.mockReturnValue(null)
  deps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("VK comments provider timeout boundary", () => {
  it("passes an AbortSignal to the VK API fetch", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.hostname).toBe("api.vk.com")
      expect(url.searchParams.get("access_token")).toBe("vk-service-token")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ response: { count: 0, items: [] } }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(runVkCommentsCollector(source)).resolves.toMatchObject({
      status: "success",
      foundCount: 0,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
