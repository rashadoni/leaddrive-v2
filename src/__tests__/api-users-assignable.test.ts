import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// ──────────────────────────────────────────────────────────────────────────────
// Mock setup. Real rate-limit module is used (not mocked) so the 429 branch
// actually exercises checkRateLimit's sliding-window. resetRateLimit is
// imported and called in beforeEach to keep specs isolated.
// ──────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET } from "@/app/api/v1/users/assignable/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { resetRateLimit } from "@/lib/rate-limit"

const USER_ID = "user-rl-test"
const RATE_KEY = `users-assignable:${USER_ID}`

function makeRequest(search = "") {
  return new Request(`http://localhost/api/v1/users/assignable${search}`) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: USER_ID, role: "sales" } as any)
  vi.mocked(isAuthError).mockReturnValue(false)
  resetRateLimit(RATE_KEY)
})

describe("GET /api/v1/users/assignable — rate-limit (Roadmap #16)", () => {
  it("returns 200 with user list under the limit", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "u-1", name: "Alice", email: "a@x", avatar: null },
    ] as any)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
  })

  it("can limit the assignment list to active sales users", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([] as any)

    const res = await GET(makeRequest("?role=sales"))

    expect(res.status).toBe(200)
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", isActive: true, role: "sales" },
    }))
  })

  it("returns 401 when not authenticated (does NOT consume rate-limit budget)", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireAuth).mockResolvedValueOnce(unauth as any)
    // Override the default false from beforeEach — for THIS call, the auth
    // result IS the error response, so isAuthError must say true.
    vi.mocked(isAuthError).mockReturnValueOnce(true)

    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    // findMany must not have been called
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("returns 429 after 120 requests in the window", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    // Burn the budget: 120 allowed
    for (let i = 0; i < 120; i++) {
      const res = await GET(makeRequest())
      expect(res.status).toBe(200)
    }
    // 121st request should be throttled
    const throttled = await GET(makeRequest())
    expect(throttled.status).toBe(429)
    const body = await throttled.json()
    expect(body.error).toContain("Too many requests")
    // After 429, the DB must NOT have been hit one extra time
    expect(prisma.user.findMany).toHaveBeenCalledTimes(120)
  })

  it("throttles only the specific user (per-userId key)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)

    // User A: burn the budget
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "user-a", role: "sales" } as any)
    resetRateLimit("users-assignable:user-a")
    for (let i = 0; i < 120; i++) await GET(makeRequest())
    const aThrottled = await GET(makeRequest())
    expect(aThrottled.status).toBe(429)

    // User B: same org, different userId — should still pass
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "user-b", role: "sales" } as any)
    resetRateLimit("users-assignable:user-b")
    const bRes = await GET(makeRequest())
    expect(bRes.status).toBe(200)
  })
})
