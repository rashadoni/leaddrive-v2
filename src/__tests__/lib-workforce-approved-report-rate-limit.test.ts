import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimitBatch: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({
  hashForRateLimit: vi.fn(async () => "partition-hash"),
}))

import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import {
  requireWorkforceApprovedReportRateLimit,
  requireWorkforceExceptionReportRateLimit,
  requireWorkforceSiteTransitionReportRateLimit,
} from "@/lib/workforce/approved-report-rate-limit"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requireWorkforceApprovedReportRateLimit", () => {
  it("uses a distributed tenant/principal budget without plaintext in its partition tag", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({ allowed: true } as never)

    const result = await requireWorkforceApprovedReportRateLimit({
      organizationId: "org-private",
      principalUserId: "user-private",
    })

    expect(result).toBeNull()
    expect(hashForRateLimit).toHaveBeenCalledWith("workforce-approved-report-partition:v1:org-private")
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([expect.objectContaining({
      scope: "workforce-approved-report:principal",
      identifier: "org-private:user-private",
      identifierMode: "exact",
      redisHashTag: "workforce-approved-report:partition-hash",
      policy: { maxRequests: 30, windowSeconds: 900, retryAfterSeconds: 900 },
    })])
  })

  it("returns a bounded private 429 response", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      retryAfterSeconds: 5_000,
    } as never)

    const response = await requireWorkforceApprovedReportRateLimit({
      organizationId: "org-1",
      principalUserId: "user-1",
    })

    expect(response?.status).toBe(429)
    expect(response?.headers.get("retry-after")).toBe("900")
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_APPROVED_REPORT_RATE_LIMITED",
      retryAfterSeconds: 900,
    })
  })

  it("fails closed when the distributed limiter is unavailable", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockRejectedValueOnce(new Error("redis private detail"))

    const response = await requireWorkforceApprovedReportRateLimit({
      organizationId: "org-1",
      principalUserId: "user-1",
    })

    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("1")
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_APPROVED_REPORT_RATE_LIMIT_UNAVAILABLE",
      retryAfterSeconds: 1,
    })
  })

  it("keeps exception reports in a separate distributed budget", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      retryAfterSeconds: 30,
    } as never)

    const response = await requireWorkforceExceptionReportRateLimit({
      organizationId: "org-private",
      principalUserId: "user-private",
    })

    expect(hashForRateLimit).toHaveBeenCalledWith("workforce-exception-report-partition:v1:org-private")
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([expect.objectContaining({
      scope: "workforce-exception-report:principal",
      redisHashTag: "workforce-exception-report:partition-hash",
    })])
    expect(response?.status).toBe(429)
    await expect(response?.json()).resolves.toMatchObject({
      code: "WORKFORCE_EXCEPTION_REPORT_RATE_LIMITED",
      retryAfterSeconds: 30,
    })
  })

  it("keeps site-transition reports in their own distributed budget", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValueOnce({ allowed: true } as never)

    await expect(requireWorkforceSiteTransitionReportRateLimit({
      organizationId: "org-private",
      principalUserId: "user-private",
    })).resolves.toBeNull()

    expect(hashForRateLimit).toHaveBeenCalledWith("workforce-site-transition-report-partition:v1:org-private")
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([expect.objectContaining({
      scope: "workforce-site-transition-report:principal",
      redisHashTag: "workforce-site-transition-report:partition-hash",
    })])
  })
})
