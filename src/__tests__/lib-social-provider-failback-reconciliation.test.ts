import { beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  ingestEnvelope: { findMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

import {
  auditProviderFailback,
  evaluateFailbackReconciliation,
} from "@/lib/social/provider-failback-reconciliation"

function observation(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "APIFY",
    canonicalUrl: "https://instagram.com/p/post-1",
    url: "https://instagram.com/p/post-1?utm_source=test",
    idempotencyKey: "envelope-1",
    acceptedMentionId: "mention-1",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.ingestEnvelope.findMany.mockResolvedValue([])
})

describe("provider failback reconciliation", () => {
  it("accepts a retained fallback observation that resolves to the same canonical mention", () => {
    const result = evaluateFailbackReconciliation([
      observation(),
      observation({ providerKey: "bright-data", idempotencyKey: "envelope-2" }),
    ], "bright-data", ["APIFY"])

    expect(result).toMatchObject({
      reconciled: true,
      evidenceAvailable: true,
      fallbackIdentityCount: 1,
      primaryIdentityCount: 1,
      retainedFallbackCount: 1,
      matchedByPrimaryCount: 1,
      unresolvedGapCount: 0,
      identityConflictCount: 0,
    })
  })

  it("blocks failback when a fallback identity is neither retained nor rediscovered", () => {
    const result = evaluateFailbackReconciliation([
      observation({ acceptedMentionId: null }),
    ], "bright-data", ["APIFY"])

    expect(result).toMatchObject({ reconciled: false, unresolvedGapCount: 1 })
    expect(result.unresolvedIdentityHashes[0]).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(result)).not.toContain("instagram.com")
  })

  it("blocks failback when one canonical identity points to different accepted mentions", () => {
    const result = evaluateFailbackReconciliation([
      observation(),
      observation({ providerKey: "bright-data", acceptedMentionId: "mention-2" }),
    ], "bright-data", ["APIFY"])

    expect(result).toMatchObject({ reconciled: false, identityConflictCount: 1 })
    expect(result.conflictingIdentityHashes).toHaveLength(1)
  })

  it("queries a bounded overlap window using provider identities, not adapter payloads", async () => {
    mockPrisma.ingestEnvelope.findMany.mockResolvedValue([observation()])
    const now = new Date("2026-07-14T12:00:00.000Z")

    const result = await auditProviderFailback({
      organizationId: "org-1",
      routePlanId: "route-1",
      primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
      fallbackAdapters: ["APIFY_ASYNC", "MANUAL_TASK"],
      rateLimit: { failbackOverlapMinutes: 120 },
      now,
    })

    expect(result.reconciled).toBe(true)
    expect(mockPrisma.ingestEnvelope.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        routePlanId: "route-1",
        providerKey: { in: ["bright-data", "APIFY"] },
        createdAt: { gte: new Date("2026-07-14T10:00:00.000Z") },
        purgedAt: null,
      }),
    }))
  })
})
