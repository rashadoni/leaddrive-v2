import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ claimToken: "", findCalls: 0 }))

const mockPrisma = vi.hoisted(() => ({
  mediaObservation: {
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  mediaProcessingRun: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mediaSignal: { create: vi.fn() },
  socialMention: { updateMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}))

const deps = vi.hoisted(() => ({
  resolveVisionOcrClient: vi.fn(),
  resolveTranscriptionClient: vi.fn(),
  evaluateSubjectRelevance: vi.fn(),
  persistSubjectMatches: vi.fn(),
  getOrCreateMediaPolicy: vi.fn(),
  withTenantFence: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/vision/resolve", () => ({ resolveVisionOcrClient: deps.resolveVisionOcrClient }))
vi.mock("@/lib/transcription/transcribe", () => ({ resolveTranscriptionClient: deps.resolveTranscriptionClient }))
vi.mock("@/lib/social/subject-relevance", () => ({
  evaluateSubjectRelevance: deps.evaluateSubjectRelevance,
  persistSubjectMatches: deps.persistSubjectMatches,
}))
vi.mock("@/lib/social/media-observations", () => ({ getOrCreateMediaPolicy: deps.getOrCreateMediaPolicy }))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: deps.withTenantFence,
}))

import { processMediaObservation, processMediaQueue } from "@/lib/social/media-pipeline"

const basePolicy = {
  enabled: true,
  coverOcrEnabled: true,
  frameOcrEnabled: false,
  asrEnabled: false,
  multimodalEnabled: false,
  preferPlatformTranscript: true,
  maxFramesPerVideo: 8,
  frameCandidatePercent: 0,
  asrCandidatePercent: 0,
  multimodalCandidatePercent: 0,
  dailyBudgetUsd: 10,
  monthlyBudgetUsd: 100,
  perObservationBudgetUsd: 2,
  signalRetentionDays: 30,
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: "observation-1",
    organizationId: "org-1",
    claimToken: state.claimToken,
    claimVersion: 1,
    mediaType: "IMAGE",
    sourceUrl: "https://cdn.example/cover.jpg",
    canonicalMediaUrl: "https://cdn.example/cover.jpg",
    thumbnailUrl: "https://cdn.example/cover.jpg",
    audioUrl: null,
    platformTranscript: null,
    language: "en",
    durationMs: null,
    extractionPlan: { frameUrls: [] },
    relevanceScore: 0.99,
    platform: "instagram",
    mentionId: "mention-1",
    mention: { id: "mention-1", matchedTerm: null },
    discoveryLead: null,
    idempotencyKey: "media:observation-1",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.claimToken = ""
  state.findCalls = 0
  mockPrisma.mediaObservation.updateMany.mockImplementation(async (args: { data?: { claimToken?: string } }) => {
    if (args.data?.claimToken) state.claimToken = args.data.claimToken
    return { count: 1 }
  })
  mockPrisma.mediaObservation.findUniqueOrThrow.mockImplementation(async () => {
    state.findCalls += 1
    return state.findCalls === 1 ? { claimVersion: 1 } : observation()
  })
  mockPrisma.mediaProcessingRun.findMany.mockResolvedValue([])
  mockPrisma.mediaProcessingRun.findUnique.mockResolvedValue(null)
  mockPrisma.mediaProcessingRun.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data }))
  mockPrisma.mediaProcessingRun.update.mockResolvedValue({ id: "run-1" })
  mockPrisma.mediaSignal.create.mockResolvedValue({ id: "signal-1" })
  mockPrisma.socialMention.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.$queryRaw.mockResolvedValue([])
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: Record<string, unknown>) => unknown) => callback({
    $executeRaw: vi.fn(),
    $queryRaw: mockPrisma.$queryRaw,
    mediaProcessingRun: mockPrisma.mediaProcessingRun,
  }))
  deps.getOrCreateMediaPolicy.mockResolvedValue(basePolicy)
  deps.withTenantFence.mockImplementation(async (
    _organizationId: string,
    callback: () => Promise<unknown>,
  ) => ({ allowed: true, value: await callback() }))
  deps.evaluateSubjectRelevance.mockResolvedValue({
    reason: "subject_alias_match",
    matches: [{ status: "MATCHED", confidence: 0.95, subjectId: "subject-1", matchedTerms: ["LeadDrive"], reason: "alias" }],
  })
  deps.persistSubjectMatches.mockResolvedValue(undefined)
})

describe("social media processing pipeline", () => {
  it("reads cover text and sends the detected text through subject matching", async () => {
    const detectText = vi.fn().mockResolvedValue({
      fullText: "LeadDrive haqqında xəbər",
      blocks: [{ text: "LeadDrive", confidence: 0.94 }],
      provider: "google-vision",
      modelVersion: "text-detection-v1",
    })
    deps.resolveVisionOcrClient.mockReturnValue({ detectText })

    await expect(processMediaObservation("org-1", "observation-1")).resolves.toMatchObject({
      status: "completed",
      signals: 1,
    })
    expect(detectText).toHaveBeenCalledWith({ imageUrl: "https://cdn.example/cover.jpg", languageHints: ["en"] })
    expect(deps.evaluateSubjectRelevance).toHaveBeenCalledWith(expect.objectContaining({ text: "LeadDrive haqqında xəbər" }))
    expect(mockPrisma.mediaSignal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ signalType: "COVER_OCR", subjectId: "subject-1", matchedTerms: ["LeadDrive"] }),
    }))
  })

  it("transcribes a supplied audio URL and sends the transcript through subject matching", async () => {
    const transcribe = vi.fn().mockResolvedValue({ transcript: "В ролике обсуждают LeadDrive", provider: "openai-whisper", language: "ru" })
    deps.resolveTranscriptionClient.mockReturnValue({ transcribe })
    deps.getOrCreateMediaPolicy.mockResolvedValue({ ...basePolicy, coverOcrEnabled: false, asrEnabled: true, asrCandidatePercent: 100 })
    mockPrisma.mediaObservation.findUniqueOrThrow.mockImplementation(async () => {
      state.findCalls += 1
      return state.findCalls === 1 ? { claimVersion: 1 } : observation({
        mediaType: "AUDIO",
        sourceUrl: "https://cdn.example/audio.mp3",
        canonicalMediaUrl: "https://cdn.example/audio.mp3",
        thumbnailUrl: null,
        audioUrl: "https://cdn.example/audio.mp3",
        language: "ru",
        durationMs: 30_000,
      })
    })

    await expect(processMediaObservation("org-1", "observation-1")).resolves.toMatchObject({
      status: "completed",
      signals: 1,
    })
    expect(transcribe).toHaveBeenCalledWith({ audioUrl: "https://cdn.example/audio.mp3", language: "ru" })
    expect(deps.evaluateSubjectRelevance).toHaveBeenCalledWith(expect.objectContaining({ text: "В ролике обсуждают LeadDrive" }))
    expect(mockPrisma.mediaSignal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ signalType: "ASR", subjectId: "subject-1", matchedTerms: ["LeadDrive"] }),
    }))
  })

  it("keeps hidden pre-reset media spend in the current budget gate", async () => {
    const capturedAt = new Date()
    const dayStart = new Date(Date.UTC(
      capturedAt.getUTCFullYear(),
      capturedAt.getUTCMonth(),
      capturedAt.getUTCDate(),
    ))
    const monthStart = new Date(Date.UTC(
      capturedAt.getUTCFullYear(),
      capturedAt.getUTCMonth(),
      1,
    ))
    const detectText = vi.fn()
    deps.resolveVisionOcrClient.mockReturnValue({ detectText })
    deps.getOrCreateMediaPolicy.mockResolvedValue({
      ...basePolicy,
      dailyBudgetUsd: 0.002,
      monthlyBudgetUsd: 0.01,
      perObservationBudgetUsd: 0.01,
    })
    mockPrisma.$queryRaw.mockResolvedValue([{
      resetNewValue: {
        budgetCarryForward: {
          schemaVersion: "social-monitoring-budget-carry-v1",
          capturedAt: capturedAt.toISOString(),
          utcDayStart: dayStart.toISOString(),
          utcMonthStart: monthStart.toISOString(),
          provider: {
            dayChargeUsd: 0,
            monthChargeUsd: 0,
            runsToday: 0,
          },
          paidRunAuthorization: {
            dayReservedUsd: 0,
            monthReservedUsd: 0,
            runsToday: 0,
          },
          media: {
            dayCostUsd: 0.001,
            monthCostUsd: 0.001,
          },
          ai: {
            dayCostUsd: 0,
            monthCostUsd: 0,
          },
        },
      },
      resetCreatedAt: capturedAt,
    }])

    await expect(processMediaObservation("org-1", "observation-1")).resolves.toMatchObject({
      status: "blocked",
      signals: 0,
    })

    expect(detectText).not.toHaveBeenCalled()
    expect(mockPrisma.mediaProcessingRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "BLOCKED_BUDGET",
        reservedCostUsd: 0,
      }),
    })
  })

  it("does not claim or process a media observation while the clean-slate fence is closed", async () => {
    deps.withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(processMediaObservation("org-1", "observation-1")).rejects.toThrow(
      "blocked for clean-slate reset",
    )

    expect(mockPrisma.mediaObservation.updateMany).not.toHaveBeenCalled()
    expect(deps.resolveVisionOcrClient).not.toHaveBeenCalled()
  })

  it("does not let the queue claim a candidate after its tenant fence closes", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{
      id: "observation-1",
      organizationId: "org-1",
    }])
    deps.withTenantFence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })

    await expect(processMediaQueue(1)).resolves.toMatchObject({
      claimed: 0,
      blocked: 1,
    })

    expect(mockPrisma.mediaObservation.updateMany).not.toHaveBeenCalled()
    expect(deps.resolveVisionOcrClient).not.toHaveBeenCalled()
  })

  it("claims and processes an eligible queued observation inside the tenant fence", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{
      id: "observation-1",
      organizationId: "org-1",
    }])
    deps.resolveVisionOcrClient.mockReturnValue({
      detectText: vi.fn().mockResolvedValue({
        fullText: "LeadDrive",
        blocks: [{ text: "LeadDrive", confidence: 0.95 }],
        provider: "google-vision",
        modelVersion: "text-detection-v1",
      }),
    })

    await expect(processMediaQueue(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      failed: 0,
    })

    expect(deps.withTenantFence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(mockPrisma.mediaObservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        id: "observation-1",
        status: { in: ["QUEUED"] },
      }),
    }))
  })
})
