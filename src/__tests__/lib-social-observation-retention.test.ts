import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  ingestEnvelope: { findMany: vi.fn(), updateMany: vi.fn() },
  rejectedObservationFingerprint: { findMany: vi.fn(), deleteMany: vi.fn() },
  socialProviderRun: { findMany: vi.fn(), updateMany: vi.fn() },
  mentionEvidence: { findMany: vi.fn(), updateMany: vi.fn() },
  socialMention: { findMany: vi.fn(), updateMany: vi.fn() },
  socialMentionVersion: { deleteMany: vi.fn() },
  socialMentionAiDraft: { deleteMany: vi.fn() },
  mediaObservation: { findMany: vi.fn(), updateMany: vi.fn() },
  mediaProcessingRun: { updateMany: vi.fn() },
  socialDeletionLedgerEntry: { upsert: vi.fn() },
  $transaction: vi.fn(),
}))
const mockFinalizeDueDiscoveryAutoReviewRuns = vi.hoisted(() => vi.fn())
const mockDeleteSocialMediaPreviewCache = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/secure-token", () => ({ hmacToken: (value: string) => `hmac-${value}` }))
vi.mock("@/lib/social/discovery-auto-review-apply", () => ({
  finalizeDueDiscoveryAutoReviewRuns: mockFinalizeDueDiscoveryAutoReviewRuns,
}))
vi.mock("@/lib/social/media-preview-cache", () => ({
  deleteSocialMediaPreviewCache: mockDeleteSocialMediaPreviewCache,
}))

import { purgeSocialObservationData } from "@/lib/social/observation-retention"

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
  mockPrisma.ingestEnvelope.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.rejectedObservationFingerprint.findMany.mockResolvedValue([])
  mockPrisma.rejectedObservationFingerprint.deleteMany.mockResolvedValue({ count: 1 })
  mockPrisma.socialProviderRun.findMany.mockResolvedValue([])
  mockPrisma.socialProviderRun.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.mentionEvidence.findMany.mockResolvedValue([])
  mockPrisma.mentionEvidence.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.socialMention.findMany.mockResolvedValue([])
  mockPrisma.socialMention.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.socialMentionVersion.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.socialMentionAiDraft.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.mediaObservation.findMany.mockResolvedValue([])
  mockPrisma.mediaObservation.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.mediaProcessingRun.updateMany.mockResolvedValue({ count: 0 })
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma))
  mockPrisma.socialDeletionLedgerEntry.upsert.mockResolvedValue({ id: "ledger-1" })
  mockDeleteSocialMediaPreviewCache.mockResolvedValue(undefined)
  mockFinalizeDueDiscoveryAutoReviewRuns.mockResolvedValue({
    runsFinalized: 0,
    rowsFinalized: 0,
    rowsSuperseded: 0,
    failures: 0,
  })
})

describe("social observation retention", () => {
  it("scrubs expired raw observation fields and records a non-reversible deletion ledger entry", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{ id: "env-1", organizationId: "org-1", relevanceStatus: "REJECTED" }])

    await expect(purgeSocialObservationData({ organizationId: "org-1", now })).resolves.toMatchObject({ envelopesPurged: 1, failures: 0 })
    expect(mockPrisma.ingestEnvelope.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        purgeAt: { lte: now },
        purgedAt: null,
        discoveryAutoReviewDecisions: {
          none: { state: "SUPPRESSED" },
        },
        AND: [{
          OR: [
            { reviewMutationUntil: null },
            { reviewMutationUntil: { lte: now } },
          ],
        }],
      },
      orderBy: { purgeAt: "asc" },
      take: 250,
      select: {
        id: true,
        organizationId: true,
        relevanceStatus: true,
      },
    })
    expect(mockPrisma.ingestEnvelope.updateMany).toHaveBeenCalledWith({
      where: {
        id: "env-1",
        organizationId: "org-1",
        purgedAt: null,
        // Список кандидатов отобран раньше и мог устареть: повторная доставка
        // продлевает окно хранения, и срок надо перепроверить здесь.
        purgeAt: { lte: now },
        discoveryAutoReviewDecisions: {
          none: { state: "SUPPRESSED" },
        },
        AND: [{
          OR: [
            { reviewMutationUntil: null },
            { reviewMutationUntil: { lte: now } },
          ],
        }],
      },
      data: expect.objectContaining({
        text: null,
        authorName: null,
        authorHandle: null,
        authorAvatar: null,
        url: null,
        canonicalUrl: null,
        parentPostUrl: null,
        rawPayload: {},
        relevanceStatus: "PURGED",
        purgedAt: now,
      }),
    })
    expect(mockPrisma.socialDeletionLedgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        targetType: "INGEST_ENVELOPE_RAW",
        targetKeyHmac: "hmac-env-1",
        status: "COMPLETED",
      }),
    }))
  })

  it("rechecks suppression and active review leases before scrubbing a selected envelope", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{
      id: "env-raced",
      organizationId: "org-1",
      relevanceStatus: "REVIEW",
    }])
    // A suppression decision or review lease can appear after selection. The
    // guarded compare-and-set then updates zero rows and must not emit a
    // deletion ledger entry.
    mockPrisma.ingestEnvelope.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(purgeSocialObservationData({
      organizationId: "org-1",
      now,
    })).resolves.toMatchObject({
      envelopesPurged: 0,
      failures: 0,
    })

    expect(mockPrisma.ingestEnvelope.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          discoveryAutoReviewDecisions: {
            none: { state: "SUPPRESSED" },
          },
          AND: [{
            OR: [
              { reviewMutationUntil: null },
              { reviewMutationUntil: { lte: now } },
            ],
          }],
        }),
      }),
    )
    expect(mockPrisma.socialDeletionLedgerEntry.upsert).not.toHaveBeenCalled()
  })

  it("finalizes expired automatic review batches before generic envelope purging", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockFinalizeDueDiscoveryAutoReviewRuns.mockResolvedValue({
      runsFinalized: 1,
      rowsFinalized: 4,
      rowsSuperseded: 1,
      failures: 0,
    })

    await expect(purgeSocialObservationData({ organizationId: "org-1", now }))
      .resolves.toMatchObject({
        autoReviewRunsFinalized: 1,
        autoReviewRowsFinalized: 4,
        autoReviewRowsSuperseded: 1,
        failures: 0,
      })
    expect(mockFinalizeDueDiscoveryAutoReviewRuns).toHaveBeenCalledWith({
      organizationId: "org-1",
      now,
      limit: 250,
    })
  })

  it("scrubs provider input once, queues external dataset deletion, and does not reset worker retry state", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockPrisma.socialProviderRun.findMany.mockResolvedValue([{
      id: "provider-run-1",
      organizationId: "org-1",
      providerKey: "APIFY",
      datasetId: "dataset-1",
    }])

    const result = await purgeSocialObservationData({ organizationId: "org-1", now })

    expect(result).toMatchObject({ providerRunsScrubbed: 1, providerDatasetsQueued: 1, failures: 0 })
    expect(mockPrisma.socialProviderRun.updateMany).toHaveBeenCalledWith({
      where: { id: "provider-run-1", organizationId: "org-1", purgedAt: null },
      data: { inputSnapshot: {}, purgedAt: now },
    })
    const queueCall = mockPrisma.socialDeletionLedgerEntry.upsert.mock.calls.find((call) => call[0].create?.targetType === "PROVIDER_DATASET")
    expect(queueCall?.[0]).toMatchObject({
      create: expect.objectContaining({ storageScope: "APIFY", status: "PENDING", nextRetryAt: now }),
      update: {},
    })
    expect(mockPrisma.socialDeletionLedgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        targetType: "PROVIDER_RUN_TRANSIT",
        status: "COMPLETED",
        metadata: { externalDatasetDeletionPending: true },
      }),
    }))
  })

  it("reports a failed purge without falsely completing its deletion ledger", async () => {
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([{ id: "env-1", organizationId: "org-1", relevanceStatus: "REVIEW" }])
    mockPrisma.ingestEnvelope.updateMany.mockRejectedValue(new Error("db unavailable"))

    await expect(purgeSocialObservationData()).resolves.toMatchObject({ envelopesPurged: 0, failures: 1 })
    expect(mockPrisma.socialDeletionLedgerEntry.upsert).not.toHaveBeenCalled()
  })

  it("scrubs accepted evidence payload after 30 days", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockPrisma.mentionEvidence.findMany.mockResolvedValue([{ id: "evidence-1", organizationId: "org-1" }])

    await expect(purgeSocialObservationData({ organizationId: "org-1", now })).resolves.toMatchObject({ mentionEvidencePurged: 1 })
    expect(mockPrisma.mentionEvidence.updateMany).toHaveBeenCalledWith({
      where: { id: "evidence-1", organizationId: "org-1", purgedAt: null },
      data: { permalink: null, screenshotUrl: null, rawSnippet: null, rawPayload: {}, purgedAt: now },
    })
  })

  it("removes the cached media preview before purging an expired observation", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockPrisma.mediaObservation.findMany.mockResolvedValue([{
      id: "observation-1",
      organizationId: "org-1",
      contentHmac: "content-hmac-1",
    }])

    await expect(purgeSocialObservationData({ organizationId: "org-1", now })).resolves.toMatchObject({
      mediaObservationsPurged: 1,
      failures: 0,
    })

    expect(mockDeleteSocialMediaPreviewCache).toHaveBeenCalledWith({
      organizationId: "org-1",
      observationId: "observation-1",
    })
    expect(mockDeleteSocialMediaPreviewCache).toHaveBeenCalledTimes(2)
    expect(mockPrisma.mediaObservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "observation-1", organizationId: "org-1", purgedAt: null },
      data: expect.objectContaining({
        sourceUrl: "",
        thumbnailUrl: null,
        status: "PURGED",
        purgedAt: now,
      }),
    }))
  })

  it("keeps an open legal hold, but a platform deletion signal overrides it", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    const held = {
      id: "mention-1",
      organizationId: "org-1",
      platform: "instagram",
      externalId: "comment-1",
      deletedAtSource: null,
      legalCandidates: [],
      legalCases: [{ id: "case-1" }],
    }
    mockPrisma.socialMention.findMany.mockResolvedValue([held])
    await expect(purgeSocialObservationData({ organizationId: "org-1", now })).resolves.toMatchObject({ mentionsPurged: 0 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()

    mockPrisma.socialMention.findMany.mockResolvedValue([{ ...held, deletedAtSource: now }])
    await expect(purgeSocialObservationData({ organizationId: "org-1", now })).resolves.toMatchObject({ mentionsPurged: 1 })
    expect(mockPrisma.socialMention.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ text: "", retentionClass: "PURGED_TOMBSTONE", purgedAt: now }),
    }))
  })

  it("keeps an active legal candidate even before it becomes a case", async () => {
    const now = new Date("2026-07-11T12:00:00Z")
    mockPrisma.socialMention.findMany.mockResolvedValue([{
      id: "mention-2",
      organizationId: "org-1",
      platform: "facebook",
      externalId: "comment-2",
      deletedAtSource: null,
      legalCandidates: [{ id: "candidate-1" }],
      legalCases: [],
    }])

    await expect(purgeSocialObservationData({ organizationId: "org-1", now })).resolves.toMatchObject({ mentionsPurged: 0 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})
