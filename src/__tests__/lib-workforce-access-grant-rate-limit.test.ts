import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimitBatch: vi.fn(),
}))
vi.mock("@/lib/rate-limit", () => ({
  hashForRateLimit: vi.fn(async () => "partition-hash"),
}))

import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"

describe("Workforce access-grant shared rate guard", () => {
  it("uses opaque Redis-partitioned per-principal policies for grant mutations and inventory", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValue({
      allowed: true, unavailable: false, retryAfterSeconds: 0,
    })

    await expect(requireWorkforceAccessGrantRateLimit({
      operation: "MUTATION", organizationId: "org-1", principalUserId: "admin-1",
    })).resolves.toBeNull()
    await expect(requireWorkforceAccessGrantRateLimit({
      operation: "INVENTORY", organizationId: "org-1", principalUserId: "admin-1",
    })).resolves.toBeNull()

    expect(hashForRateLimit).toHaveBeenCalledWith("workforce-access-grant-partition:v1:org-1")
    expect(consumePublicRateLimitBatch).toHaveBeenNthCalledWith(1, [expect.objectContaining({
      scope: "workforce-access-grant:MUTATION:principal",
      identifier: "org-1:admin-1",
      identifierMode: "exact",
      redisHashTag: "workforce-access-grant:partition-hash",
      policy: { maxRequests: 12, windowSeconds: 60, retryAfterSeconds: 60 },
    })])
    expect(consumePublicRateLimitBatch).toHaveBeenNthCalledWith(2, [expect.objectContaining({
      scope: "workforce-access-grant:INVENTORY:principal",
      policy: { maxRequests: 30, windowSeconds: 60, retryAfterSeconds: 30 },
    })])
  })

  it("returns bounded no-store denial or availability responses instead of weakening the control", async () => {
    vi.mocked(consumePublicRateLimitBatch)
      .mockResolvedValueOnce({ allowed: false, unavailable: false, retryAfterSeconds: 55 })
      .mockResolvedValueOnce({ allowed: false, unavailable: true, retryAfterSeconds: 1 })

    const denied = await requireWorkforceAccessGrantRateLimit({
      operation: "MUTATION", organizationId: "org-1", principalUserId: "admin-1",
    })
    const unavailable = await requireWorkforceAccessGrantRateLimit({
      operation: "INVENTORY", organizationId: "org-1", principalUserId: "admin-1",
    })

    expect(denied?.status).toBe(429)
    expect(denied?.headers.get("retry-after")).toBe("55")
    await expect(denied?.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_RATE_LIMITED" })
    expect(unavailable?.status).toBe(503)
    await expect(unavailable?.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_RATE_LIMIT_UNAVAILABLE" })
  })

  it("fails closed on an unexpected shared-guard failure", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockRejectedValue(new Error("guard dependency failure"))

    const response = await requireWorkforceAccessGrantRateLimit({
      operation: "MUTATION", organizationId: "org-1", principalUserId: "admin-1",
    })

    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("1")
    await expect(response?.json()).resolves.toMatchObject({ code: "WORKFORCE_ACCESS_GRANT_RATE_LIMIT_UNAVAILABLE" })
  })
})
