/**
 * CLM Slice 5a — API tests for contract milestones
 *
 * Routes under test:
 *   GET    /api/v1/contracts/[id]/milestones
 *   POST   /api/v1/contracts/[id]/milestones
 *   PATCH  /api/v1/contracts/[id]/milestones/[milestoneId]
 *   DELETE /api/v1/contracts/[id]/milestones/[milestoneId]
 *
 * Coverage:
 *   - GET:    org-scoped list, ordered by dueAt; 404 when contract not in org
 *   - POST:   create with label+dueAt; ownerUserId foreign-org → 400;
 *             requireAuth write → viewer 403; missing label → 400;
 *             status=completed → completedAt set (non-null);
 *             invalid dueAt → 400 (not 500)
 *   - PATCH:  update; status→completed sets completedAt; status→other clears completedAt;
 *             foreign milestoneId (CAS count===0) → 404; ownerUserId foreign-org → 400;
 *             requireAuth write → viewer 403; invalid dueAt → 400 (not 500)
 *   - DELETE: foreign milestoneId → 404; requireAuth delete → viewer 403
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
    },
    contractMilestone: {
      findMany:   vi.fn(),
      create:     vi.fn(),
      findFirst:  vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

import { GET as listMilestones, POST as createMilestone } from "@/app/api/v1/contracts/[id]/milestones/route"
import { PATCH as patchMilestone, DELETE as deleteMilestone } from "@/app/api/v1/contracts/[id]/milestones/[milestoneId]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG     = "org-1"
const CTR     = "ctr-1"
const MLSTN   = "ms-1"
const USER    = "user-1"

const authRead  = { orgId: ORG, userId: USER }
const authWrite = { orgId: ORG, userId: USER }
const authDel   = { orgId: ORG, userId: USER }
const auth403   = new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })

const mockContract = { id: CTR, organizationId: ORG }

const mockMilestone = {
  id:             MLSTN,
  organizationId: ORG,
  contractId:     CTR,
  label:          "Deliver phase-1 report",
  description:    null,
  dueAt:          new Date("2026-07-01T00:00:00.000Z"),
  completedAt:    null,
  status:         "pending",
  ownerUserId:    null,
  lastRemindedAt: null,
  metadata:       {},
  createdBy:      USER,
  createdAt:      new Date("2026-06-07T00:00:00.000Z"),
  updatedAt:      new Date("2026-06-07T00:00:00.000Z"),
}

function makeReq(path: string, method = "GET", body?: unknown): NextRequest {
  const url = path.startsWith("http") ? path : `http://localhost${path}`
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", "x-organization-id": ORG },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const contractParams = { params: Promise.resolve({ id: CTR }) }
const msParams       = { params: Promise.resolve({ id: CTR, milestoneId: MLSTN }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.contract.findFirst).mockResolvedValue(mockContract as any)
  vi.mocked(prisma.contractMilestone.findMany).mockResolvedValue([mockMilestone] as any)
  vi.mocked(prisma.contractMilestone.create).mockResolvedValue(mockMilestone as any)
  vi.mocked(prisma.contractMilestone.findFirst).mockResolvedValue(mockMilestone as any)
  vi.mocked(prisma.contractMilestone.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.contractMilestone.deleteMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "owner-1" } as any)
  vi.mocked(requireAuth).mockResolvedValue(authRead as any)
})

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /milestones", () => {
  it("returns org-scoped list", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    const res  = await listMilestones(makeReq(`/api/v1/contracts/${CTR}/milestones`), contractParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data[0].id).toBe(MLSTN)
  })

  it("returns 404 when contract not in org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    const res = await listMilestones(makeReq(`/api/v1/contracts/${CTR}/milestones`), contractParams)
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer (requireAuth read)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const res = await listMilestones(makeReq(`/api/v1/contracts/${CTR}/milestones`), contractParams)
    expect(res.status).toBe(403)
  })
})

// ─── POST ────────────────────────────────────────────────────────────────────

describe("POST /milestones", () => {
  it("creates milestone with label and dueAt", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const body = { label: "Deliver report", dueAt: "2026-07-01" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.id).toBe(MLSTN)
  })

  it("returns 400 when label is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const body = { dueAt: "2026-07-01" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    expect(res.status).toBe(400)
  })

  it("returns 400 when dueAt is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const body = { label: "Report" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    expect(res.status).toBe(400)
  })

  it("returns 400 when ownerUserId is from a foreign org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)  // foreign user
    const body = { label: "Report", dueAt: "2026-07-01", ownerUserId: "foreign-user-99" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("ownerUserId")
  })

  it("returns 404 when contract not in org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    const body = { label: "Report", dueAt: "2026-07-01" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer (requireAuth write)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const body = { label: "Report", dueAt: "2026-07-01" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    expect(res.status).toBe(403)
  })

  it("sets completedAt when status=completed on create", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const completedMs = { ...mockMilestone, status: "completed", completedAt: new Date() }
    vi.mocked(prisma.contractMilestone.create).mockResolvedValue(completedMs as any)
    const body = { label: "Report", dueAt: "2026-07-01", status: "completed" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    const json = await res.json()
    expect(res.status).toBe(201)
    // Verify that the create call included a non-null completedAt
    const createCall = vi.mocked(prisma.contractMilestone.create).mock.calls[0][0]
    expect(createCall.data).toHaveProperty("completedAt")
    expect(createCall.data.completedAt).not.toBeNull()
    expect(createCall.data.completedAt).toBeInstanceOf(Date)
    expect(json.data.status).toBe("completed")
  })

  it("returns 400 when dueAt is an invalid date string (POST)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const body = { label: "Report", dueAt: "not-a-date" }
    const res  = await createMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones`, "POST", body), contractParams)
    expect(res.status).toBe(400)
  })
})

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe("PATCH /milestones/[milestoneId]", () => {
  it("updates label", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const updated = { ...mockMilestone, label: "Updated label" }
    vi.mocked(prisma.contractMilestone.findFirst).mockResolvedValue(updated as any)
    const res  = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "PATCH", { label: "Updated label" }), msParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.label).toBe("Updated label")
  })

  it("sets completedAt when status→completed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const completedMs = { ...mockMilestone, status: "completed", completedAt: new Date() }
    vi.mocked(prisma.contractMilestone.findFirst).mockResolvedValue(completedMs as any)
    vi.mocked(prisma.contractMilestone.updateMany).mockResolvedValue({ count: 1 })
    const res  = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "PATCH", { status: "completed" }), msParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    // updateMany was called with completedAt set
    const updateCall = vi.mocked(prisma.contractMilestone.updateMany).mock.calls[0][0]
    expect(updateCall.data).toHaveProperty("completedAt")
    expect(updateCall.data.completedAt).not.toBeNull()
    expect(json.data.status).toBe("completed")
  })

  it("clears completedAt when status transitions away from completed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const pendingMs = { ...mockMilestone, status: "pending", completedAt: null }
    vi.mocked(prisma.contractMilestone.findFirst).mockResolvedValue(pendingMs as any)
    vi.mocked(prisma.contractMilestone.updateMany).mockResolvedValue({ count: 1 })
    const res = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "PATCH", { status: "pending" }), msParams)
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.contractMilestone.updateMany).mock.calls[0][0]
    expect(updateCall.data.completedAt).toBeNull()
  })

  it("returns 404 when milestoneId is foreign (CAS count===0)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    vi.mocked(prisma.contractMilestone.updateMany).mockResolvedValue({ count: 0 })
    const res = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/foreign-ms`, "PATCH", { label: "X" }), { params: Promise.resolve({ id: CTR, milestoneId: "foreign-ms" }) })
    expect(res.status).toBe(404)
  })

  it("returns 400 when ownerUserId is from foreign org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "PATCH", { ownerUserId: "foreign-owner" }), msParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("ownerUserId")
  })

  it("returns 403 for viewer (requireAuth write)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const res = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "PATCH", { label: "X" }), msParams)
    expect(res.status).toBe(403)
  })

  it("returns 400 when dueAt is an invalid date string (PATCH)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    const res = await patchMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "PATCH", { dueAt: "not-a-date" }), msParams)
    expect(res.status).toBe(400)
  })
})

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe("DELETE /milestones/[milestoneId]", () => {
  it("deletes milestone", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authDel as any)
    const res  = await deleteMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "DELETE"), msParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe(MLSTN)
  })

  it("returns 404 when milestoneId is foreign (CAS count===0)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authDel as any)
    vi.mocked(prisma.contractMilestone.deleteMany).mockResolvedValue({ count: 0 })
    const res = await deleteMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/foreign-ms`, "DELETE"), { params: Promise.resolve({ id: CTR, milestoneId: "foreign-ms" }) })
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer (requireAuth delete)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const res = await deleteMilestone(makeReq(`/api/v1/contracts/${CTR}/milestones/${MLSTN}`, "DELETE"), msParams)
    expect(res.status).toBe(403)
  })
})
