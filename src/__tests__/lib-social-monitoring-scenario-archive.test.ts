import { beforeEach, describe, expect, it, vi } from "vitest"

const { mentionFindMany, mentionUpdate, subjectMatchUpsert } = vi.hoisted(() => ({
  mentionFindMany: vi.fn(),
  mentionUpdate: vi.fn(),
  subjectMatchUpsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: { findMany: mentionFindMany, update: mentionUpdate },
    socialMentionSubjectMatch: { upsert: subjectMatchUpsert },
  },
}))

import { backfillMonitoringScenarioFromArchive } from "@/lib/social/monitoring-scenario-archive"
import type { MonitoringScenario } from "@/lib/social/monitoring-scenarios"

const scenario: MonitoringScenario = {
  id: "scenario-zeytun",
  subjectId: "subject-zeytun",
  subjectName: "Zeytun Pharmaceuticals",
  name: "Zeytun monitoring",
  description: null,
  status: "active",
  platforms: ["instagram", "web"],
  search: {
    topics: ["Zeytun Pharmaceuticals"],
    keywords: ["Pharmonline", "Pharmastore", "Bəhruz Şiraliyev"],
    hashtags: [],
    handles: [],
    urls: [],
    useHashtagFallback: true,
    includeOwnedComments: true,
    includeExternalComments: true,
  },
  ai: { sentiments: ["negative", "complaint"], minConfidence: 80, action: "draft_reply", directions: ["general_reputation"] },
  reply: {
    identityId: null,
    identityLabel: null,
    mode: "manual_approval",
    autoReplyEnabled: false,
    liveSendAllowed: false,
  },
  archive: {
    startAt: "2026-01-01T00:00:00.000Z",
    lastBackfilledAt: null,
    scannedCount: 0,
    matchedCount: 0,
    status: "pending",
  },
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
}

describe("monitoring scenario archive backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mentionUpdate.mockResolvedValue({})
    subjectMatchUpsert.mockResolvedValue({})
    mentionFindMany.mockResolvedValue([
      {
        id: "mention-1",
        platform: "instagram",
        sourceType: "post",
        sourceProvider: "search_index",
        sourceMetadata: { archiveOnly: true, restoredFrom: "paid-provider-dataset" },
        text: "Pharmonline Zeytun Pharmaceuticals tərəfindən təqdim edildi",
        matchedTerm: null,
        url: "https://instagram.com/p/example",
        authorHandle: "pharmonline",
        status: "ignored",
        publishedAt: new Date("2026-06-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
      {
        id: "mention-2",
        platform: "instagram",
        sourceType: "post",
        sourceProvider: "search_index",
        sourceMetadata: { archiveOnly: true },
        text: "Tamamilə başqa xəbər",
        matchedTerm: null,
        url: "https://instagram.com/p/unrelated",
        authorHandle: "news",
        status: "ignored",
        publishedAt: new Date("2026-06-02T00:00:00.000Z"),
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      },
    ])
  })

  it("activates only matching retained rows without calling a provider", async () => {
    const result = await backfillMonitoringScenarioFromArchive("org-1", scenario)

    expect(result).toMatchObject({ available: true, status: "complete", scannedCount: 2, matchedCount: 1 })
    expect(mentionUpdate).toHaveBeenCalledTimes(1)
    expect(mentionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mention-1" },
      data: expect.objectContaining({
        status: "new",
        matchedTerm: "Zeytun Pharmaceuticals",
        sourceMetadata: expect.objectContaining({
          archiveOnly: false,
          archiveReuse: expect.objectContaining({ scenarioIds: ["scenario-zeytun"], liveSendAllowed: false }),
          socialScenario: expect.objectContaining({ primaryScenarioId: "scenario-zeytun", liveSendAllowed: false }),
        }),
      }),
    }))
    expect(subjectMatchUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mentionId: "mention-1",
        subjectId: "subject-zeytun",
        reason: "monitoring_scenario_archive_match",
      }),
    }))
  })

  it("applies the configured archive start date to the database scan", async () => {
    await backfillMonitoringScenarioFromArchive("org-1", scenario)

    expect(mentionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { sourceProvider: "search_index" },
              { platform: "web", sourceProvider: "notification_inbox" },
            ]),
          }),
          expect.objectContaining({
            OR: expect.arrayContaining([
              { publishedAt: { gte: new Date("2026-01-01T00:00:00.000Z") } },
            ]),
          }),
        ]),
      }),
    }))
  })
})
