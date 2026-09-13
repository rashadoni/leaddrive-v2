import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimitBatch: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({
  hashForRateLimit: vi.fn(async () => "partition-hash"),
}))

import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { requireWorkforceDirectTimeCorrectionRateLimit } from "@/lib/workforce/direct-time-correction-rate-limit"

describe("Workforce direct time-correction shared rate guard", () => {
  it("uses an opaque Redis-partitioned per-principal correction budget", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValue({
      allowed: true, unavailable: false, retryAfterSeconds: 0,
    })

    await expect(requireWorkforceDirectTimeCorrectionRateLimit({
      organizationId: "org-1", principalUserId: "approver-1",
    })).resolves.toBeNull()

    expect(hashForRateLimit).toHaveBeenCalledWith(
      "workforce-direct-time-correction-partition:v1:org-1",
    )
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([expect.objectContaining({
      scope: "workforce-direct-time-correction:principal",
      identifier: "org-1:approver-1",
      identifierMode: "exact",
      redisHashTag: "workforce-direct-time-correction:partition-hash",
      policy: { maxRequests: 12, windowSeconds: 60, retryAfterSeconds: 60 },
    })])
  })

  it("returns bounded no-store denial or availability responses", async () => {
    vi.mocked(consumePublicRateLimitBatch)
      .mockResolvedValueOnce({ allowed: false, unavailable: false, retryAfterSeconds: 55 })
      .mockResolvedValueOnce({ allowed: false, unavailable: true, retryAfterSeconds: 1 })

    const denied = await requireWorkforceDirectTimeCorrectionRateLimit({
      organizationId: "org-1", principalUserId: "approver-1",
    })
    const unavailable = await requireWorkforceDirectTimeCorrectionRateLimit({
      organizationId: "org-1", principalUserId: "approver-1",
    })

    expect(denied?.status).toBe(429)
    expect(denied?.headers.get("retry-after")).toBe("55")
    await expect(denied?.json()).resolves.toMatchObject({
      code: "WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMITED",
    })
    expect(unavailable?.status).toBe(503)
    await expect(unavailable?.json()).resolves.toMatchObject({
      code: "WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT_UNAVAILABLE",
    })
  })

  it("fails closed if hashing or the shared guard raises", async () => {
    vi.mocked(hashForRateLimit).mockRejectedValueOnce(new Error("guard dependency failure"))

    const response = await requireWorkforceDirectTimeCorrectionRateLimit({
      organizationId: "org-1", principalUserId: "approver-1",
    })

    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("1")
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_DIRECT_TIME_CORRECTION_RATE_LIMIT_UNAVAILABLE",
    })
  })
})
