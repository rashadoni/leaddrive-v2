import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/public-abuse-guard", () => ({ consumePublicRateLimitBatch: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ hashForRateLimit: vi.fn(async () => "partition-hash") }))

import { consumePublicRateLimitBatch } from "@/lib/public-abuse-guard"
import { hashForRateLimit } from "@/lib/rate-limit"
import { requireWorkforceTimesheetExportRateLimit } from "@/lib/workforce/timesheet-export-rate-limit"

describe("Workforce approved-timesheet export shared rate guard", () => {
  it("uses an opaque Redis-partitioned low-volume per-principal budget", async () => {
    vi.mocked(consumePublicRateLimitBatch).mockResolvedValue({
      allowed: true, unavailable: false, retryAfterSeconds: 0,
    })

    await expect(requireWorkforceTimesheetExportRateLimit({
      organizationId: "org-1", principalUserId: "custodian-1",
    })).resolves.toBeNull()

    expect(hashForRateLimit).toHaveBeenCalledWith("workforce-timesheet-export-partition:v1:org-1")
    expect(consumePublicRateLimitBatch).toHaveBeenCalledWith([expect.objectContaining({
      scope: "workforce-timesheet-export:principal",
      identifier: "org-1:custodian-1",
      identifierMode: "exact",
      redisHashTag: "workforce-timesheet-export:partition-hash",
      policy: { maxRequests: 6, windowSeconds: 900, retryAfterSeconds: 900 },
    })])
  })

  it("returns bounded no-store denial or availability responses", async () => {
    vi.mocked(consumePublicRateLimitBatch)
      .mockResolvedValueOnce({ allowed: false, unavailable: false, retryAfterSeconds: 899 })
      .mockResolvedValueOnce({ allowed: false, unavailable: true, retryAfterSeconds: 1 })

    const denied = await requireWorkforceTimesheetExportRateLimit({ organizationId: "org-1", principalUserId: "custodian-1" })
    const unavailable = await requireWorkforceTimesheetExportRateLimit({ organizationId: "org-1", principalUserId: "custodian-1" })

    expect(denied?.status).toBe(429)
    expect(denied?.headers.get("cache-control")).toBe("private, no-store")
    expect(denied?.headers.get("retry-after")).toBe("899")
    await expect(denied?.json()).resolves.toMatchObject({ code: "WORKFORCE_TIMESHEET_EXPORT_RATE_LIMITED" })
    expect(unavailable?.status).toBe(503)
    expect(unavailable?.headers.get("cache-control")).toBe("private, no-store")
    await expect(unavailable?.json()).resolves.toMatchObject({ code: "WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT_UNAVAILABLE" })
  })

  it("fails closed if hashing or the shared guard raises", async () => {
    vi.mocked(hashForRateLimit).mockRejectedValueOnce(new Error("guard dependency failure"))
    const response = await requireWorkforceTimesheetExportRateLimit({ organizationId: "org-1", principalUserId: "custodian-1" })
    expect(response?.status).toBe(503)
    expect(response?.headers.get("retry-after")).toBe("1")
    await expect(response?.json()).resolves.toMatchObject({ code: "WORKFORCE_TIMESHEET_EXPORT_RATE_LIMIT_UNAVAILABLE" })
  })
})
