/**
 * CLM Slice 5d — Tests for GET /api/v1/contract-milestones (org-wide list)
 *
 * Coverage:
 *   - 401 when unauthenticated
 *   - 403 when user lacks contracts read permission
 *   - All queries carry organizationId (org-scoped, no cross-tenant leak)
 *   - Default response shape: data[], pagination{total,page,pageSize,totalPages}
 *   - ?status= filter forwarded to Prisma where
 *   - ?overdue=true → dueAt < now AND status NOT IN (completed, cancelled)
 *   - ?upcoming=N  → dueAt in [now, now+N days] AND status NOT IN (completed, cancelled)
 *   - overdue supersedes upcoming when both set
 *   - ownerName joined from User.name (batch, not N+1)
 *   - pagination: page + pageSize params respected; totalPages computed
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractMilestone: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

import { GET } from "@/app/api/v1/contract-milestones/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url = "http://localhost/api/v1/contract-milestones"): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: { "x-organization-id": "org-1" },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authRead = { orgId: "org-1", userId: "user-1" } as any
const auth401 = new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
const auth403 = new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })

const NOW = new Date("2026-06-07T10:00:00Z")

function makeMilestone(overrides: Partial<{
  id: string; contractId: string; contractNumber: string; contractTitle: string;
  label: string; status: string; dueAt: Date; ownerUserId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "ms-1",
    organizationId: "org-1",
    contractId: overrides.contractId ?? "contract-1",
    label: overrides.label ?? "Sign addendum",
    description: null,
    dueAt: overrides.dueAt ?? new Date("2026-07-01T00:00:00Z"),
    completedAt: null,
    status: overrides.status ?? "pending",
    ownerUserId: overrides.ownerUserId ?? null,
    lastRemindedAt: null,
    metadata: {},
    createdBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    contract: {
      id: overrides.contractId ?? "contract-1",
      contractNumber: overrides.contractNumber ?? "CNT-001",
      title: overrides.contractTitle ?? "Master Service Agreement",
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/v1/contract-milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(NOW)

    // Default: empty result set
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(0)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([])
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
  })

  // ── Auth guards ────────────────────────────────────────────────────────────

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth401)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("returns 403 when user lacks contracts read permission", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  // ── Org-scoping ───────────────────────────────────────────────────────────

  it("scopes all queries to the authenticated org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq())

    const countCall = vi.mocked(prisma.contractMilestone.count).mock.calls[0][0]
    expect(countCall?.where).toMatchObject({ organizationId: "org-1" })

    const findManyCall = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]
    expect(findManyCall?.where).toMatchObject({ organizationId: "org-1" })
  })

  // ── Default response shape ────────────────────────────────────────────────

  it("returns success:true with data[] and pagination on happy path", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(1)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([makeMilestone()])

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.pagination).toMatchObject({
      total: 1, page: 1, pageSize: 50, totalPages: 1,
    })
  })

  it("includes contractNumber, contractTitle, ownerName in each row", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(1)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([
      makeMilestone({ contractNumber: "CNT-999", contractTitle: "Acme SLA", ownerUserId: "user-42" }),
    ])
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-42", name: "Alice Smith" } as any,
    ])

    const body = await (await GET(makeReq())).json()
    const row = body.data[0]
    expect(row.contractNumber).toBe("CNT-999")
    expect(row.contractTitle).toBe("Acme SLA")
    expect(row.ownerName).toBe("Alice Smith")
  })

  // ── status filter ─────────────────────────────────────────────────────────

  it("forwards ?status= to the Prisma where clause", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?status=in_progress"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    expect(where).toMatchObject({ status: "in_progress" })
  })

  it("ignores unknown status values (no filter applied)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?status=bogus"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    // unknown status → no status key in where
    expect(where).not.toHaveProperty("status")
  })

  // ── status combined with a date window ────────────────────────────────────

  it("narrows overdue by the chosen status instead of dropping it", async () => {
    // The defect this pins: status used to be ignored whenever overdue or
    // upcoming was on, so the screen showed a selected status and returned
    // everything. A wrong list that looks filtered is worse than an empty one.
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?overdue=true&status=in_progress"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    expect(where).toMatchObject({ dueAt: { lt: NOW } })
    expect(where?.AND).toContainEqual({ status: "in_progress" })
    expect(where?.AND).toContainEqual({ status: { notIn: ["completed", "cancelled"] } })
  })

  it("keeps status filtering alone when no date window is chosen", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?status=completed"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    expect(where).toMatchObject({ status: "completed" })
    expect(where?.AND).toBeUndefined()
  })

  // ── overdue filter ────────────────────────────────────────────────────────

  it("?overdue=true sets dueAt < now AND status notIn terminal statuses", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?overdue=true"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    expect(where).toMatchObject({ organizationId: "org-1", dueAt: { lt: NOW } })
    // Terminal statuses now live in AND so a chosen status can narrow the same
    // query instead of replacing it. Asserted by behaviour, not by shape: the
    // previous version pinned the object layout and broke on a fix that changed
    // nothing a caller can observe.
    expect(where?.AND).toContainEqual({ status: { notIn: ["completed", "cancelled"] } })
  })

  it("computes isOverdue:true on rows where dueAt < now AND status is non-terminal", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    const pastDue = new Date(NOW.getTime() - 24 * 60 * 60 * 1000) // yesterday
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(1)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([
      makeMilestone({ status: "pending", dueAt: pastDue }),
    ])

    const body = await (await GET(makeReq())).json()
    expect(body.data[0].isOverdue).toBe(true)
  })

  it("computes isOverdue:false on completed rows even if dueAt is in the past", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    const pastDue = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(1)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([
      makeMilestone({ status: "completed", dueAt: pastDue }),
    ])

    const body = await (await GET(makeReq())).json()
    expect(body.data[0].isOverdue).toBe(false)
  })

  // ── upcoming filter ────────────────────────────────────────────────────────

  it("?upcoming=30 sets dueAt gte:now lte:now+30d AND status notIn terminal", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?upcoming=30"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    const expected30d = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
    expect(where).toMatchObject({
      dueAt: { gte: NOW, lte: expected30d },
    })
    expect(where?.AND).toContainEqual({ status: { notIn: ["completed", "cancelled"] } })
  })

  it("?overdue=true supersedes ?upcoming when both provided", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?overdue=true&upcoming=14"))

    const where = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.where
    // overdue branch: dueAt lt NOW — not a gte/lte range
    expect(where).toMatchObject({ dueAt: { lt: NOW } })
    expect(where?.dueAt).not.toHaveProperty("gte")
  })

  // ── pagination ────────────────────────────────────────────────────────────

  it("respects ?page=2&pageSize=10 and computes totalPages", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(25)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([])

    const res = await GET(makeReq("http://localhost/api/v1/contract-milestones?page=2&pageSize=10"))
    const body = await res.json()

    const findCall = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]
    expect(findCall?.skip).toBe(10)  // (page-1) * pageSize
    expect(findCall?.take).toBe(10)

    expect(body.pagination).toMatchObject({
      total: 25, page: 2, pageSize: 10, totalPages: 3,
    })
  })

  it("clamps pageSize to 200 max", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)

    await GET(makeReq("http://localhost/api/v1/contract-milestones?pageSize=9999"))

    const take = vi.mocked(prisma.contractMilestone.findMany).mock.calls[0][0]?.take
    expect(take).toBe(200)
  })

  // ── owner name batch load ─────────────────────────────────────────────────

  it("batch-loads owner names in a single user findMany (no N+1)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(2)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([
      makeMilestone({ id: "ms-1", ownerUserId: "user-10" }),
      makeMilestone({ id: "ms-2", ownerUserId: "user-11" }),
    ])
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-10", name: "Bob" } as any,
      { id: "user-11", name: "Carol" } as any,
    ])

    await GET(makeReq())

    // Exactly one user query for all owner ids
    expect(vi.mocked(prisma.user.findMany)).toHaveBeenCalledTimes(1)
    const userWhere = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where
    expect(userWhere).toMatchObject({ id: { in: expect.arrayContaining(["user-10", "user-11"]) } })
  })

  it("skips user query when no milestones have an ownerUserId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    vi.mocked(prisma.contractMilestone.count).mockResolvedValue(1)
    vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([
      makeMilestone({ ownerUserId: null }),
    ])

    await GET(makeReq())

    expect(vi.mocked(prisma.user.findMany)).not.toHaveBeenCalled()
  })

  // ── error handling ────────────────────────────────────────────────────────

  it("returns 500 on unexpected Prisma error", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead)
    vi.mocked(prisma.contractMilestone.count).mockRejectedValue(new Error("db down"))

    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ error: "Internal server error" })
  })
})
