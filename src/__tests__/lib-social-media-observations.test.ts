import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  mediaProcessingPolicy: { upsert: vi.fn() },
  monitoringSubject: { count: vi.fn() },
  monitoringSource: { count: vi.fn() },
  discoveryLead: { upsert: vi.fn(), update: vi.fn() },
  mediaObservation: { upsert: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  resolveSocialMediaAssets: vi.fn(),
  getMediaProviderReadiness: vi.fn(),
  hmacToken: vi.fn(),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/social/social-media-assets", () => ({
  resolveSocialMediaAssets: deps.resolveSocialMediaAssets,
  getMediaProviderReadiness: deps.getMediaProviderReadiness,
}))
vi.mock("@/lib/secure-token", () => ({ hmacToken: deps.hmacToken }))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: deps.withTenantFence,
}))

import {
  scheduleMentionMedia,
  scheduleRejectedMediaCandidate,
  submitDiscoveryLead,
} from "@/lib/social/media-observations"

const policy = {
  enabled: true,
  coverOcrEnabled: true,
  frameOcrEnabled: true,
  asrEnabled: true,
  multimodalEnabled: false,
  preferPlatformTranscript: true,
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 50,
  perObservationBudgetUsd: 1,
  maxFramesPerVideo: 8,
  frameCandidatePercent: 100,
  asrCandidatePercent: 100,
  multimodalCandidatePercent: 0,
  mediaRetentionDays: 30,
  signalRetentionDays: 180,
  policyVersion: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.monitoringSubject.count.mockResolvedValue(1)
  mockPrisma.monitoringSource.count.mockResolvedValue(1)
  mockPrisma.mediaProcessingPolicy.upsert.mockResolvedValue(policy)
  mockPrisma.discoveryLead.upsert.mockResolvedValue({ id: "lead-1", status: "VALIDATED" })
  mockPrisma.discoveryLead.update.mockResolvedValue({ id: "lead-1" })
  mockPrisma.mediaObservation.upsert.mockResolvedValue({ id: "observation-1", status: "QUEUED" })
  deps.withTenantFence.mockImplementation(async (
    _organizationId: string,
    callback: () => Promise<unknown>,
  ) => ({ allowed: true, value: await callback() }))
  deps.hmacToken.mockImplementation((value: string) => `hmac:${value.length}`)
  deps.resolveSocialMediaAssets.mockResolvedValue({
    status: "RESOLVED",
    platform: "tiktok",
    mediaType: "VIDEO",
    canonicalUrl: "https://tiktok.com/@brand/video/1",
    title: "Brand review",
    authorName: "Reporter",
    mediaUrl: "https://cdn.example/video.mp4",
    thumbnailUrl: "https://cdn.example/cover.jpg",
    audioUrl: "https://cdn.example/audio.m4a",
    frameUrls: ["https://cdn.example/frame-1.jpg"],
    platformTranscript: null,
    language: "ru",
    durationMs: 30_000,
    provider: "external-asset-resolver",
    resolvedCapabilities: ["THUMBNAIL", "FRAMES", "AUDIO_SOURCE"],
    blockers: [],
  })
})

describe("manual social media discovery", () => {
  it("persists resolved cover, frames and audio into a processable observation", async () => {
    const result = await submitDiscoveryLead("org-1", "user-1", {
      submittedUrl: "https://www.tiktok.com/@brand/video/1",
      subjectId: "subject-1",
      mediaType: "AUTO",
    })

    expect(result).toMatchObject({
      observation: { id: "observation-1", status: "QUEUED" },
      resolution: { status: "RESOLVED", provider: "external-asset-resolver" },
    })
    expect(mockPrisma.discoveryLead.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        platformHint: "tiktok",
        mediaType: "VIDEO",
        title: "Brand review",
        thumbnailUrl: "https://cdn.example/cover.jpg",
        candidateMetadata: expect.objectContaining({
          mediaUrl: "https://cdn.example/video.mp4",
          audioUrl: "https://cdn.example/audio.m4a",
          frameUrls: ["https://cdn.example/frame-1.jpg"],
        }),
      }),
    }))
    expect(mockPrisma.mediaObservation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: "QUEUED",
        mediaType: "VIDEO",
        sourceUrl: "https://cdn.example/video.mp4",
        thumbnailUrl: "https://cdn.example/cover.jpg",
        audioUrl: "https://cdn.example/audio.m4a",
        extractionPlan: expect.objectContaining({ frameUrls: ["https://cdn.example/frame-1.jpg"] }),
      }),
    }))
  })

  it("does not resolve or persist a manual lead while the clean-slate fence is closed", async () => {
    deps.withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(submitDiscoveryLead("org-1", "user-1", {
      submittedUrl: "https://www.tiktok.com/@brand/video/1",
    })).rejects.toThrow("blocked for clean-slate reset")

    expect(deps.resolveSocialMediaAssets).not.toHaveBeenCalled()
    expect(mockPrisma.discoveryLead.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.mediaObservation.upsert).not.toHaveBeenCalled()
  })

  it("does not persist ingest-scheduled media history while the fence is closed", async () => {
    deps.withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const input = {
      organizationId: "org-1",
      platform: "instagram",
      sourceMetadata: {
        mediaUrl: "https://cdn.example/cover.jpg",
        mediaType: "IMAGE",
      },
    } as Parameters<typeof scheduleMentionMedia>[0]

    await expect(scheduleMentionMedia(input, "mention-1")).rejects.toThrow(
      "blocked for clean-slate reset",
    )
    await expect(scheduleRejectedMediaCandidate(input, "source-1")).resolves.toBeNull()

    expect(mockPrisma.discoveryLead.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.mediaObservation.upsert).not.toHaveBeenCalled()
  })
})
