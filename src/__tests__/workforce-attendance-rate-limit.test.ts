import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (value: string) => `fingerprint:${value.length}`),
}))

import { checkRateLimit, hashForRateLimit } from "@/lib/rate-limit"
import { checkWorkforceAttendanceRateLimit } from "@/lib/workforce/attendance-rate-limit"

describe("Workforce attendance rate limit", () => {
  it("separates small security-sensitive buckets and gives the limiter only a fingerprint", async () => {
    const result = await checkWorkforceAttendanceRateLimit({
      operation: "DEVICE_ENROLLMENT_PROOF",
      organizationId: "org_sensitive",
      principalId: "agent_sensitive",
      resourceId: "enrollment_sensitive",
    })

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 60 })
    expect(hashForRateLimit).toHaveBeenCalledWith(expect.stringContaining("org_sensitive"))
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^workforce-attendance:DEVICE_ENROLLMENT_PROOF:fingerprint:\d+$/),
      expect.objectContaining({ maxRequests: 5, windowMs: 60_000 }),
    )
    expect(JSON.stringify(vi.mocked(checkRateLimit).mock.calls)).not.toContain("org_sensitive")
    expect(JSON.stringify(vi.mocked(checkRateLimit).mock.calls)).not.toContain("agent_sensitive")
    expect(JSON.stringify(vi.mocked(checkRateLimit).mock.calls)).not.toContain("enrollment_sensitive")
  })
})
