/**
 * Tests for CLM Slice-3a: /api/v1/users/me/approval-delegates CRUD.
 *
 * Covers:
 *   GET  — returns only caller's delegations (fromUserId = me)
 *   POST — validates same-org toUser, date order, no self-delegation
 *   DELETE — deactivates own delegation; 404 for someone else's
 *   auth  — 401 when unauthenticated
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userApprovalDelegate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

import { GET, POST } from "@/app/api/v1/users/me/approval-delegates/route"
import { DELETE } from "@/app/api/v1/users/me/approval-delegates/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireSessionAuth, isAuthError } from "@/lib/api-auth"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTH = { orgId: "org-1", userId: "user-alice", role: "manager" }
const DELEGATE_USER = { id: "user-bob", name: "Bob", email: "bob@example.com" }

function makeGetReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/users/me/approval-delegates")
}

function makePostReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v1/users/me/approval-delegates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function makeDeleteReq(): NextRequest {
  return new NextRequest("http://localhost/api/v1/users/me/approval-delegates/del-1", {
    method: "DELETE",
  })
}

function makeDeleteParams(id = "del-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function makeDelegate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "del-1",
    organizationId: "org-1",
    fromUserId: "user-alice",
    toUserId: "user-bob",
    startDate: new Date("2026-06-10T00:00:00Z"),
    endDate: new Date("2026-06-20T00:00:00Z"),
    reason: "out_of_office",
    isActive: true,
    createdAt: new Date("2026-06-07T00:00:00Z"),
    updatedAt: new Date("2026-06-07T00:00:00Z"),
    toUser: DELEGATE_USER,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/users/me/approval-delegates", () => {
  beforeEach(() => {
    vi.mocked(requireSessionAuth).mockResolvedValue(AUTH as never)
    vi.mocked(isAuthError).mockReturnValue(false)
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(isAuthError).mockReturnValue(true)
    vi.mocked(requireSessionAuth).mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await GET(makeGetReq())
    expect(res.status).toBe(401)
  })

  it("returns caller's delegations", async () => {
    vi.mocked(prisma.userApprovalDelegate.findMany).mockResolvedValue([makeDelegate()] as never)
    const res = await GET(makeGetReq())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    expect(json.data[0].id).toBe("del-1")
  })

  it("queries only fromUserId = caller and org-scoped", async () => {
    vi.mocked(prisma.userApprovalDelegate.findMany).mockResolvedValue([] as never)
    await GET(makeGetReq())

    const call = vi.mocked(prisma.userApprovalDelegate.findMany).mock.calls[0][0] as {
      where: { organizationId: string; fromUserId: string; isActive: boolean }
    }
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.fromUserId).toBe("user-alice")
    expect(call.where.isActive).toBe(true)
  })
})

describe("POST /api/v1/users/me/approval-delegates", () => {
  beforeEach(() => {
    vi.mocked(requireSessionAuth).mockResolvedValue(AUTH as never)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(DELEGATE_USER as never)
    // FIX 7: by default, no overlapping delegation exists (happy path)
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.userApprovalDelegate.create).mockResolvedValue(makeDelegate() as never)
  })

  const validBody = {
    toUserId: "user-bob",
    startDate: "2026-06-10T00:00:00Z",
    endDate: "2026-06-20T00:00:00Z",
    reason: "out_of_office",
  }

  it("creates a delegation when request is valid", async () => {
    const res = await POST(makePostReq(validBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("del-1")
  })

  it("returns 400 when delegating to self", async () => {
    const body = { ...validBody, toUserId: "user-alice" } // same as AUTH.userId
    const res = await POST(makePostReq(body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/yourself/i)
  })

  it("returns 400 when endDate <= startDate", async () => {
    const body = {
      ...validBody,
      startDate: "2026-06-20T00:00:00Z",
      endDate: "2026-06-10T00:00:00Z", // before startDate
    }
    const res = await POST(makePostReq(body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/endDate/i)
  })

  it("returns 400 when endDate equals startDate", async () => {
    const body = {
      ...validBody,
      startDate: "2026-06-15T00:00:00Z",
      endDate: "2026-06-15T00:00:00Z",
    }
    const res = await POST(makePostReq(body))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/endDate/i)
  })

  it("returns 400 when toUser is not found in the org", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await POST(makePostReq(validBody))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/not found/i)
  })

  it("validates that toUserId is provided", async () => {
    const { toUserId: _omit, ...noUser } = validBody
    const res = await POST(makePostReq(noUser as Record<string, unknown>))

    expect(res.status).toBe(400)
  })

  it("validates startDate is a valid ISO datetime", async () => {
    const body = { ...validBody, startDate: "not-a-date" }
    const res = await POST(makePostReq(body))

    expect(res.status).toBe(400)
  })

  it("FIX 7: overlapping active delegation → 409", async () => {
    // user.findFirst (toUser) returns the delegate user (already set in beforeEach)
    // userApprovalDelegate.findFirst (overlap check) returns an existing overlap
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockResolvedValueOnce(makeDelegate() as never)

    const res = await POST(makePostReq(validBody))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/overlap/i)
  })

  it("FIX 7: non-overlapping windows → no 409 (creates successfully)", async () => {
    // overlap check returns null → no conflict
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockResolvedValueOnce(null)

    const res = await POST(makePostReq(validBody))
    expect(res.status).toBe(201)
  })
})

describe("DELETE /api/v1/users/me/approval-delegates/[id]", () => {
  beforeEach(() => {
    vi.mocked(requireSessionAuth).mockResolvedValue(AUTH as never)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockReset()
    vi.mocked(prisma.userApprovalDelegate.update).mockReset()
  })

  it("deactivates an owned delegation (sets isActive=false)", async () => {
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockResolvedValue(makeDelegate() as never)
    vi.mocked(prisma.userApprovalDelegate.update).mockResolvedValue(
      makeDelegate({ isActive: false }) as never,
    )

    const res = await DELETE(makeDeleteReq(), makeDeleteParams("del-1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.isActive).toBe(false)
    // Verify soft-delete call
    expect(vi.mocked(prisma.userApprovalDelegate.update)).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { isActive: false },
    })
  })

  it("returns 404 when delegation does not belong to caller", async () => {
    // findFirst returns null because fromUserId ≠ caller
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockResolvedValue(null)

    const res = await DELETE(makeDeleteReq(), makeDeleteParams("del-other"))
    expect(res.status).toBe(404)
  })

  it("is idempotent when delegation is already deactivated", async () => {
    vi.mocked(prisma.userApprovalDelegate.findFirst).mockResolvedValue(
      makeDelegate({ isActive: false }) as never,
    )

    const res = await DELETE(makeDeleteReq(), makeDeleteParams("del-1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // Should NOT call update for an already-inactive delegation
    expect(vi.mocked(prisma.userApprovalDelegate.update)).not.toHaveBeenCalled()
  })
})
