import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimitBatch: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({
  hashForRateLimit: vi.fn(async () => "partition-hash"),
}))

import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { requireWorkforceExceptionDecisionRateLimit } from "@/lib/workforce/exception-decision-rate-limit"

describe("Workforce exception-decision shared rate guard", () => {
  it("uses an opaque Redis-partitioned per-principal decision budget", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValue({
      allowed: true, unavailable: false, retryAfterSeconds: 0,
    })

    await expect(requireWorkforceExceptionDecisionRateLimit({
      organizationId: "org-1", principalUserId: "reviewer-1",
    })).resolves.toBeNull()

    expect(hashForRateLimit).toHaveBeenCalledWith(
      "workforce-exception-decision-partition:v1:org-1",
    )
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([expect.objectContaining({
      scope: "workforce-exception-decision:principal",
      identifier: "org-1:reviewer-1",
      identifierMode: "exact",
      redisHashTag: "workforce-exception-decision:partition-hash",
      policy: { maxRequests: 12, windowSeconds: 60, retryAfterSeconds: 60 },
    })])
  })

  it("returns bounded no-store denial or availability responses", async () => {
    vi.mocked(consumePublicRateLimitBatch)
      .mockResolvedValueOnce({ allowed: false, unavailable: false, retryAfterSeconds: 55 })
      .mockResolvedValueOnce({ allowed: false, unavailable: true, retryAfterSeconds: 1 })

    const denied = await requireWorkforceExceptionDecisionRateLimit({
      organizationId: "org-1", principalUserId: "reviewer-1",
    })
    const unavailable = await requireWorkforceExceptionDecisionRateLimit({
      organizationId: "org-1", principalUserId: "reviewer-1",
    })

    expect(denied?.status).toBe(429)
    expect(denied?.headers.get("retry-after")).toBe("55")
    await expect(denied?.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_RATE_LIMITED",
    })
    expect(unavailable?.status).toBe(503)
    await expect(unavailable?.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT_UNAVAILABLE",
    })
  })

  it("fails closed if hashing or the shared guard raises", async () => {
    vi.mocked(hashForRateLimit).mockRejectedValueOnce(new Error("guard dependency failure"))

    const response = await requireWorkforceExceptionDecisionRateLimit({
      organizationId: "org-1", principalUserId: "reviewer-1",
    })

    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("1")
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_DECISION_RATE_LIMIT_UNAVAILABLE",
    })
  })
})
