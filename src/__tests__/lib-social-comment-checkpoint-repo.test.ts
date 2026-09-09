import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  markCommentCheckpointsDispatched,
  recordCommentCheckpointBatch,
  registerAndSelectDueCommentCheckpoints,
  type SocialCommentCheckpointStore,
} from "@/lib/social/comment-checkpoint-repo"

function store(overrides: Partial<SocialCommentCheckpointStore> = {}): SocialCommentCheckpointStore {
  return {
    upsert: vi.fn(async () => ({})),
    findDue: vi.fn(async () => []),
    findByUrls: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    ...overrides,
  }
}

describe("social comment checkpoint repository", () => {
  const now = new Date("2026-07-22T21:00:00.000Z")

  it("registers canonical source-scoped parents and returns only due rows", async () => {
    const upsert = vi.fn(async () => ({}))
    const findDue = vi.fn(async () => [{ id: "cp-1", canonicalParentUrl: "https://instagram.com/p/one", parentExternalId: null }])
    const result = await registerAndSelectDueCommentCheckpoints({
      organizationId: "org-1",
      sourceId: "source-1",
      platform: "instagram",
      candidateUrls: ["https://www.instagram.com/p/one/?utm_source=test"],
      now,
      limit: 10,
    }, store({ upsert, findDue }))

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ organizationId: "org-1", sourceId: "source-1", canonicalParentUrl: "https://instagram.com/p/one", nextDueAt: now }),
    }))
    expect(result).toEqual([{ canonicalUrl: "https://instagram.com/p/one", parentExternalId: null }])
  })

  it("registers both halves of a paired discovery before selecting the due cap", async () => {
    const upsert = vi.fn(async () => ({}))
    const findDue = vi.fn(async () => [])

    await registerAndSelectDueCommentCheckpoints({
      organizationId: "org-1",
      sourceId: "source-1",
      platform: "instagram",
      candidateUrls: Array.from(
        { length: 120 },
        (_, index) => `https://instagram.com/${index % 2 === 0 ? "p" : "reel"}/item-${index}`,
      ),
      now,
      limit: 50,
    }, store({ upsert, findDue }))

    expect(upsert).toHaveBeenCalledTimes(100)
    expect(findDue).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }))
  })

  it("lets an explicit manual check select inactive parents without a due-date gate", async () => {
    const findDue = vi.fn(async () => [{
      id: "cp-inactive",
      canonicalParentUrl: "https://instagram.com/p/old-negative",
      parentExternalId: "old-negative",
    }])

    const result = await registerAndSelectDueCommentCheckpoints({
      organizationId: "org-1",
      sourceId: "source-1",
      platform: "instagram",
      candidateUrls: [],
      now,
      limit: 10,
      includeInactive: true,
    }, store({ findDue }))

    expect(findDue).toHaveBeenCalledWith({
      organizationId: "org-1",
      sourceId: "source-1",
      platform: "instagram",
      now,
      limit: 10,
      includeInactive: true,
    })
    expect(result).toEqual([{
      canonicalUrl: "https://instagram.com/p/old-negative",
      parentExternalId: "old-negative",
    }])
  })

  it("leases dispatched parents so a second collector cannot immediately resend them", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    await markCommentCheckpointsDispatched({
      organizationId: "org-1",
      sourceId: "source-1",
      urls: ["https://instagram.com/p/one"],
      providerRunId: "run-1",
      now,
    }, store({ updateMany }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastAttemptAt: now, nextDueAt: new Date("2026-07-23T03:00:00.000Z"), lastProviderRunId: "run-1" }),
    }))
  })

  it("leases inactive parents selected by an explicit manual check", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    await markCommentCheckpointsDispatched({
      organizationId: "org-1",
      sourceId: "source-1",
      urls: ["https://facebook.com/page/posts/old-negative"],
      providerRunId: "run-manual",
      now,
      includeInactive: true,
    }, store({ updateMany }))

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["ACTIVE", "INACTIVE"] },
        canonicalParentUrl: { in: ["https://facebook.com/page/posts/old-negative"] },
      }),
    }))
  })

  it("records activity and schedules a young parent one hour after successful import", async () => {
    const update = vi.fn(async () => ({}))
    const row = {
      id: "cp-1",
      canonicalParentUrl: "https://instagram.com/p/one",
      parentExternalId: null,
      discoveredAt: new Date("2026-07-22T20:00:00.000Z"),
      lastActivityAt: new Date("2026-07-22T20:00:00.000Z"),
      lastAttemptAt: null,
      lastSuccessfulAt: null,
      status: "ACTIVE",
      consecutiveNoChange: 0,
      lastSeenCommentCount: 0,
      lastSeenCommentExternalId: null,
    }
    await recordCommentCheckpointBatch({
      organizationId: "org-1",
      sourceId: "source-1",
      urls: [row.canonicalParentUrl],
      providerRunId: "run-1",
      observedCommentCounts: new Map([[row.canonicalParentUrl, 3]]),
      activityUrls: new Set([row.canonicalParentUrl]),
      coverageClass: "COMPLETE",
      successful: true,
      now,
    }, store({ findByUrls: vi.fn(async () => [row]), update }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastActivityAt: now,
        lastSuccessfulAt: now,
        nextDueAt: new Date("2026-07-22T22:00:00.000Z"),
        lastSeenCommentCount: 3,
      }),
    }))
  })

  it("reactivates an inactive parent when a manual check observes new activity", async () => {
    const update = vi.fn(async () => ({}))
    const row = {
      id: "cp-inactive",
      canonicalParentUrl: "https://instagram.com/p/old-negative",
      parentExternalId: "old-negative",
      discoveredAt: new Date("2026-05-01T00:00:00.000Z"),
      lastActivityAt: new Date("2026-06-01T00:00:00.000Z"),
      lastAttemptAt: new Date("2026-07-01T00:00:00.000Z"),
      lastSuccessfulAt: new Date("2026-07-01T00:00:00.000Z"),
      status: "INACTIVE",
      consecutiveNoChange: 30,
      lastSeenCommentCount: 5,
      lastSeenCommentExternalId: "comment-old",
    }

    await recordCommentCheckpointBatch({
      organizationId: "org-1",
      sourceId: "source-1",
      urls: [row.canonicalParentUrl],
      providerRunId: "run-manual",
      observedCommentCounts: new Map([[row.canonicalParentUrl, 6]]),
      latestCommentExternalIds: new Map([[row.canonicalParentUrl, "comment-new"]]),
      coverageClass: "COMPLETE",
      successful: true,
      now,
    }, store({ findByUrls: vi.fn(async () => [row]), update }))

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "ACTIVE",
        lastActivityAt: now,
        nextDueAt: new Date("2026-07-23T21:00:00.000Z"),
        consecutiveNoChange: 0,
        lastSeenCommentCount: 6,
        lastSeenCommentExternalId: "comment-new",
      }),
    }))
  })

  it("backs a failed parent off for a day without marking it successful", async () => {
    const update = vi.fn(async (input: Record<string, unknown>) => {
      void input
      return {}
    })
    const row = {
      id: "cp-1",
      canonicalParentUrl: "https://facebook.com/page/posts/one",
      parentExternalId: null,
      discoveredAt: new Date("2026-07-20T20:00:00.000Z"),
      lastActivityAt: new Date("2026-07-20T20:00:00.000Z"),
      lastAttemptAt: null,
      lastSuccessfulAt: null,
      status: "ACTIVE",
      consecutiveNoChange: 0,
      lastSeenCommentCount: 0,
      lastSeenCommentExternalId: null,
    }
    await recordCommentCheckpointBatch({
      organizationId: "org-1",
      sourceId: "source-1",
      urls: [row.canonicalParentUrl],
      providerRunId: "run-1",
      coverageClass: "FAILED",
      error: "provider_failed",
      successful: false,
      now,
    }, store({ findByUrls: vi.fn(async () => [row]), update }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nextDueAt: new Date("2026-07-23T21:00:00.000Z"), lastError: "provider_failed" }),
    }))
    expect(update.mock.calls[0]?.[0]?.data).not.toHaveProperty("lastSuccessfulAt")
  })
})
