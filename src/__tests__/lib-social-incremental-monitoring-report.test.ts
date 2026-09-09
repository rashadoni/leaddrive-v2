import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findSubject: vi.fn(),
  findMentions: vi.fn(),
  findEnvelopes: vi.fn(),
  findRuns: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: { findFirst: mocks.findSubject },
    socialMention: { findMany: mocks.findMentions },
    ingestEnvelope: { findMany: mocks.findEnvelopes },
    collectorRun: { findMany: mocks.findRuns },
  },
}))

import {
  buildIncrementalMonitoringReport,
  getIncrementalMonitoringReport,
  type IncrementalReportCandidate,
} from "@/lib/social/incremental-monitoring-report"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"
import {
  socialReportEffectiveSubjectWhere,
  socialReportVisibleMentionWhere,
} from "@/lib/social/report-visibility"
import { operatorActionableReviewReasonWhere } from "@/lib/social/review-queue-policy"

const from = new Date("2026-07-18T00:00:00.000Z")
const to = new Date("2026-07-25T00:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findSubject.mockResolvedValue(null)
  mocks.findMentions.mockResolvedValue([])
  mocks.findEnvelopes.mockResolvedValue([])
  mocks.findRuns.mockResolvedValue([])
})

function candidate(
  overrides: Partial<IncrementalReportCandidate> & Pick<IncrementalReportCandidate, "id" | "uniqueKey">,
): IncrementalReportCandidate {
  return {
    state: "review",
    platform: "facebook",
    contentKind: "post",
    provider: "APIFY_ASYNC",
    sourceId: "source-facebook",
    sourceLabel: "Baku.es",
    publishedAt: new Date("2026-07-23T10:00:00.000Z"),
    discoveredAt: new Date("2026-07-24T10:00:00.000Z"),
    text: "New complaint",
    url: "https://facebook.com/posts/1",
    ...overrides,
  }
}

describe("incremental monitoring report", () => {
  it("excludes purged and source-deleted records from both report states", async () => {
    await getIncrementalMonitoringReport({
      organizationId: "org-1",
      from,
      to,
      days: 7,
      locale: "ru",
    })

    expect(mocks.findMentions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        purgedAt: null,
        deletedAtSource: null,
        AND: [riskRelevantMentionWhere(), socialReportVisibleMentionWhere()],
      }),
      select: expect.objectContaining({
        ingestEnvelopes: expect.objectContaining({
          where: { purgedAt: null, deletedAtSource: null },
        }),
      }),
    }))
    expect(mocks.findEnvelopes).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        purgedAt: null,
        deletedAtSource: null,
        AND: [operatorActionableReviewReasonWhere()],
      }),
    }))
  })

  it("applies negative feedback only to the requested subject", async () => {
    mocks.findSubject.mockResolvedValue({ id: "subject-1", name: "Baku Electronics" })

    await getIncrementalMonitoringReport({
      organizationId: "org-1",
      subjectId: "subject-1",
      from,
      to,
      days: 7,
      locale: "ru",
    })

    expect(mocks.findMentions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          riskRelevantMentionWhere(),
          socialReportVisibleMentionWhere(),
          socialReportEffectiveSubjectWhere({
            organizationId: "org-1",
            subjectIds: ["subject-1"],
            matchStatuses: ["MATCHED", "REVIEW"],
            excludeParentPostMatch: false,
          }),
        ],
      }),
    }))
  })

  it("counts only current-window findings and keeps an accepted record over its review envelope", () => {
    const report = buildIncrementalMonitoringReport({
      subject: { id: "subject-1", name: "Baku Electronics" },
      from,
      to,
      days: 7,
      locale: "ru",
      candidates: [
        candidate({
          id: "accepted-1",
          uniqueKey: "facebook:post-1",
          state: "accepted",
        }),
        candidate({
          id: "review-duplicate",
          uniqueKey: "facebook:post-1",
          state: "review",
        }),
        candidate({
          id: "old-archive",
          uniqueKey: "facebook:old",
          publishedAt: new Date("2026-07-10T00:00:00.000Z"),
        }),
        candidate({
          id: "unknown-date",
          uniqueKey: "facebook:unknown",
          publishedAt: null,
        }),
      ],
      runs: [
        { status: "success", foundCount: 10, newCount: 2, duplicateCount: 8, ignoredCount: 0 },
        { status: "partial", foundCount: 4, newCount: 1, duplicateCount: 1, ignoredCount: 2 },
        { status: "failed", foundCount: 0, newCount: 0, duplicateCount: 0, ignoredCount: 0 },
      ],
    })

    expect(report.totals).toMatchObject({
      newFindings: 1,
      accepted: 1,
      review: 0,
      archiveExcluded: 1,
      unknownDateExcluded: 1,
      duplicatesExcluded: 1,
      providerFound: 14,
      providerNew: 3,
      providerDuplicates: 9,
      providerIgnored: 2,
      runs: 3,
      partialRuns: 1,
      failedRuns: 1,
    })
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({ id: "accepted-1", state: "accepted" })
    expect(report.summaryText).toBe(
      "За последние 7 дней найдено 1 новых материалов: TikTok 0, Instagram 0, Facebook 1.",
    )
  })

  it("builds platform and source totals without merging distinct source observations", () => {
    const report = buildIncrementalMonitoringReport({
      subject: null,
      from,
      to,
      days: 7,
      locale: "az",
      candidates: [
        candidate({
          id: "facebook-post",
          uniqueKey: "facebook:post-1",
          state: "accepted",
        }),
        candidate({
          id: "instagram-comment",
          uniqueKey: "instagram:comment-1",
          platform: "Instagram",
          contentKind: "comment",
          sourceId: "source-instagram",
          sourceLabel: "baku.es",
          url: "https://instagram.com/p/1",
        }),
        candidate({
          id: "tiktok-video",
          uniqueKey: "tiktok:video-1",
          platform: "TikTok",
          contentKind: "video",
          sourceId: "source-tiktok",
          sourceLabel: "@reviewer",
          url: "https://tiktok.com/@reviewer/video/1",
        }),
      ],
      runs: [],
    })

    expect(report.platforms).toEqual([
      { platform: "facebook", total: 1, accepted: 1, review: 0 },
      { platform: "instagram", total: 1, accepted: 0, review: 1 },
      { platform: "tiktok", total: 1, accepted: 0, review: 1 },
    ])
    expect(report.sources).toHaveLength(3)
    expect(report.summaryText).toBe(
      "Son 7 gün ərzində 3 yeni material tapılıb: TikTok 1, Instagram 1, Facebook 1.",
    )
  })
})
