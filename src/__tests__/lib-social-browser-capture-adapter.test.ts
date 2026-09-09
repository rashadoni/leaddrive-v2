import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mentionEvidence: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}))

const mockDeps = vi.hoisted(() => ({
  classifySentiment: vi.fn(),
  findMatchedKeyword: vi.fn(),
  ingestMentionWithResult: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/sentiment", () => ({ classifySentiment: mockDeps.classifySentiment }))
vi.mock("@/lib/social/ingest-mention", () => ({
  findMatchedKeyword: mockDeps.findMatchedKeyword,
  ingestMentionWithResult: mockDeps.ingestMentionWithResult,
}))

import { prisma } from "@/lib/prisma"
import { ingestMentionWithResult } from "@/lib/social/ingest-mention"
import { runBrowserCaptureCollector } from "@/lib/social/browser-capture-adapter"
import type { MonitoringSourceForRun } from "@/lib/social/monitoring-collector"

const source: MonitoringSourceForRun = {
  id: "source-browser",
  organizationId: "org-1",
  platform: "instagram",
  sourceType: "hashtag",
  collectionMode: "browser_capture",
  status: "active",
  cadenceMinutes: 720,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  lastError: null,
  keywords: ["LeadDrive"],
  settings: {
    browserCapture: {
      approved: true,
      captures: [
        {
          operatorApproved: true,
          platform: "instagram",
          text: "LeadDrive CRM mentioned in visible hashtag result",
          permalink: "https://instagram.com/p/browser-visible",
          screenshotUrl: "https://evidence.example.com/browser-visible.png",
          authorHandle: "aysel",
          publishedAt: "2026-07-05T09:00:00.000Z",
        },
        {
          operatorApproved: false,
          text: "Should not be captured",
          permalink: "https://instagram.com/p/not-approved",
        },
        {
          operatorApproved: true,
          text: "",
          permalink: "https://instagram.com/p/malformed",
        },
      ],
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(prisma.mentionEvidence.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mentionEvidence.create).mockResolvedValue({ id: "evidence-1" } as never)
  mockDeps.classifySentiment.mockResolvedValue("positive")
  mockDeps.findMatchedKeyword.mockReturnValue("LeadDrive")
  mockDeps.ingestMentionWithResult.mockResolvedValue({ id: "mention-1", created: true })
})

describe("browser-capture social monitoring adapter", () => {
  it("stays disabled unless the feature flag is enabled", async () => {
    await expect(runBrowserCaptureCollector(source)).resolves.toMatchObject({
      status: "skipped",
      error: "browser_capture_feature_disabled",
      rawStats: { manualActionOnly: true, noAutomationBypass: true },
    })
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("requires explicit operator approval before processing captures", async () => {
    vi.stubEnv("SOCIAL_BROWSER_CAPTURE_ENABLED", "1")

    await expect(runBrowserCaptureCollector({ ...source, settings: { browserCapture: { approved: false, captures: [] } } })).resolves.toMatchObject({
      status: "skipped",
      error: "browser_capture_not_approved",
      rawStats: { manualActionOnly: true, noAutomationBypass: true },
    })
    expect(ingestMentionWithResult).not.toHaveBeenCalled()
  })

  it("ingests only visible operator-approved captures with T5 evidence and manual-only metadata", async () => {
    vi.stubEnv("SOCIAL_BROWSER_CAPTURE_ENABLED", "1")

    const result = await runBrowserCaptureCollector(source)

    expect(result).toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 1,
      duplicateCount: 0,
      ignoredCount: 2,
      rawStats: { manualActionOnly: true, noAutomationBypass: true },
    })
    expect(ingestMentionWithResult).toHaveBeenCalledTimes(1)
    expect(ingestMentionWithResult).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      platform: "instagram",
      externalId: "browser:https://instagram.com/p/browser-visible",
      sourceProvider: "browser_capture",
      sourceMetadata: expect.objectContaining({
        monitoringSourceId: "source-browser",
        collector: "browser_capture",
        operatorApproved: true,
        replyPolicy: "manual_only",
        noAutomationBypass: true,
      }),
      matchedTerm: "LeadDrive",
      sentiment: null,
    }))
    expect(mockDeps.classifySentiment).not.toHaveBeenCalled()
    expect(prisma.mentionEvidence.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mentionId: "mention-1",
        sourceId: "source-browser",
        permalink: "https://instagram.com/p/browser-visible",
        screenshotUrl: "https://evidence.example.com/browser-visible.png",
        sourceTrustTier: "T5",
        confidence: 0.6,
      }),
    }))
  })

  it("counts duplicate captures without creating duplicate evidence", async () => {
    vi.stubEnv("SOCIAL_BROWSER_CAPTURE_ENABLED", "1")
    mockDeps.ingestMentionWithResult.mockResolvedValueOnce({ id: "mention-1", created: false })
    vi.mocked(prisma.mentionEvidence.findFirst).mockResolvedValueOnce({ id: "evidence-existing" } as never)

    await expect(runBrowserCaptureCollector(source)).resolves.toMatchObject({
      status: "success",
      foundCount: 1,
      newCount: 0,
      duplicateCount: 1,
      ignoredCount: 2,
    })
    expect(prisma.mentionEvidence.create).not.toHaveBeenCalled()
  })
})
