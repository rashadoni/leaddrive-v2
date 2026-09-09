import { beforeEach, describe, expect, it, vi } from "vitest"

const { findMention, findSubject, upsertFeedback, queryRaw } = vi.hoisted(() => ({
  findMention: vi.fn(),
  findSubject: vi.fn(),
  upsertFeedback: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: { findFirst: findMention },
    monitoringSubject: { findFirst: findSubject },
    socialRelevanceFeedback: { upsert: upsertFeedback },
    $queryRaw: queryRaw,
  },
}))

import {
  getWeeklySocialRelevanceQualityReport,
  recordSocialRelevanceFeedback,
} from "@/lib/social/relevance-feedback"

beforeEach(() => {
  vi.clearAllMocks()
  findMention.mockResolvedValue({
    id: "mention-1",
    platform: "instagram",
    subjectMatches: [{ status: "MATCHED", matcherVersion: "subject_relevance_v2" }],
    ingestEnvelopes: [{ relevanceStatus: "ACCEPTED" }],
  })
  findSubject.mockResolvedValue({ id: "subject-1" })
  upsertFeedback.mockResolvedValue({ id: "feedback-1" })
  queryRaw.mockResolvedValue([])
})

describe("social relevance operator feedback", () => {
  it("upserts a tenant-bound feedback snapshot without raw mention content", async () => {
    await expect(recordSocialRelevanceFeedback("org-1", "user-1", {
      mentionId: "mention-1",
      subjectId: "subject-1",
      feedbackType: "RELEVANT",
    })).resolves.toEqual({ id: "feedback-1" })

    expect(findMention).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", id: "mention-1" },
    }))
    expect(findSubject).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", id: "subject-1", status: { not: "archived" } },
    }))
    expect(upsertFeedback).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_mentionId_subjectId: {
          organizationId: "org-1",
          mentionId: "mention-1",
          subjectId: "subject-1",
        },
      },
      create: {
        organizationId: "org-1",
        mentionId: "mention-1",
        subjectId: "subject-1",
        feedbackType: "RELEVANT",
        relevanceStatus: "ACCEPTED",
        matcherVersion: "subject_relevance_v2",
        platform: "instagram",
        decidedBy: "user-1",
      },
    }))
    expect(upsertFeedback.mock.calls[0][0].create).not.toHaveProperty("text")
    expect(upsertFeedback.mock.calls[0][0].create).not.toHaveProperty("rawPayload")
  })

  it("fails closed when mention or subject is outside the tenant scope", async () => {
    findMention.mockResolvedValueOnce(null)
    await expect(recordSocialRelevanceFeedback("org-1", "user-1", {
      mentionId: "other-mention",
      subjectId: "subject-1",
      feedbackType: "NOT_RELEVANT",
    })).rejects.toThrow("Social mention not found")
    expect(upsertFeedback).not.toHaveBeenCalled()
  })

  it("uses the latest match provenance when no envelope status is available", async () => {
    findMention.mockResolvedValueOnce({
      id: "mention-1",
      platform: "youtube",
      subjectMatches: [{ status: "REVIEW", matcherVersion: "matcher-custom" }],
      ingestEnvelopes: [],
    })

    await recordSocialRelevanceFeedback("org-1", "user-1", {
      mentionId: "mention-1",
      subjectId: "subject-1",
      feedbackType: "WRONG_SUBJECT",
    })

    expect(upsertFeedback).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ relevanceStatus: "REVIEW", matcherVersion: "matcher-custom" }),
    }))
  })
})

describe("weekly social relevance quality report", () => {
  it("returns tenant/subject/platform rollups and operator quality rates", async () => {
    queryRaw.mockResolvedValueOnce([{
      weekStart: new Date("2026-07-06T00:00:00.000Z"),
      subjectId: "subject-1",
      subjectName: "LeadDrive",
      platform: "instagram",
      relevanceStatus: "ACCEPTED",
      total: 10,
      relevant: 7,
      notRelevant: 1,
      duplicate: 1,
      wrongSubject: 1,
      missedRisk: 0,
    }])

    const report = await getWeeklySocialRelevanceQualityReport(
      "org-1",
      new Date("2026-07-01T00:00:00.000Z"),
      { subjectId: "subject-1", platform: "instagram" },
    )

    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(report.byWeek[0]).toMatchObject({
      subjectId: "subject-1",
      platform: "instagram",
      relevanceStatus: "ACCEPTED",
      total: 10,
    })
    expect(report.totals).toMatchObject({
      relevant: 7,
      notRelevant: 1,
      duplicate: 1,
      wrongSubject: 1,
      confirmedRelevantRate: 0.777778,
      falsePositiveRate: 0.222222,
      duplicateRate: 0.1,
      missedRiskRate: 0,
    })
  })
})
