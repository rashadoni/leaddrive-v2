import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimitBatch: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({
  hashForRateLimit: vi.fn(async () => "partition-hash"),
}))

import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { requireWorkforceExceptionResponseCycleAuditRateLimit } from "@/lib/workforce/exception-response-cycle-audit-rate-limit"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requireWorkforceExceptionResponseCycleAuditRateLimit", () => {
  it("atomically charges separate low-frequency principal and tenant buckets", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({ allowed: true } as never)

    await expect(requireWorkforceExceptionResponseCycleAuditRateLimit({
      organizationId: "org-private",
      principalUserId: "user-private",
    })).resolves.toBeNull()

    expect(hashForRateLimit).toHaveBeenCalledWith(
      "workforce-exception-response-cycle-audit-partition:v1:org-private",
    )
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([
      {
        scope: "workforce-exception-response-cycle-audit:principal",
        identifier: "org-private:user-private",
        identifierMode: "exact",
        redisHashTag: "workforce-exception-response-cycle-audit:partition-hash",
        policy: { maxRequests: 3, windowSeconds: 900 },
      },
      {
        scope: "workforce-exception-response-cycle-audit:tenant",
        identifier: "org-private",
        identifierMode: "exact",
        redisHashTag: "workforce-exception-response-cycle-audit:partition-hash",
        policy: { maxRequests: 12, windowSeconds: 900 },
      },
    ])
  })

  it("returns a bounded private denial", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      retryAfterSeconds: 5_000,
    } as never)

    const response = await requireWorkforceExceptionResponseCycleAuditRateLimit({
      organizationId: "org-a",
      principalUserId: "user-a",
    })

    expect(response?.status).toBe(429)
    expect(response?.headers.get("retry-after")).toBe("900")
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_RATE_LIMITED",
      retryAfterSeconds: 900,
    })
  })

  it("fails closed when hashing or the shared guard is unavailable", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockRejectedValueOnce(
      new Error("private redis detail"),
    )

    const response = await requireWorkforceExceptionResponseCycleAuditRateLimit({
      organizationId: "org-a",
      principalUserId: "user-a",
    })

    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("1")
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_RESPONSE_CYCLE_AUDIT_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    })
  })
})
