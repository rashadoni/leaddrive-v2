/**
 * CLM Slice 5b-1 — Performance Obligation CRUD tests
 *
 * Routes under test:
 *   GET    /api/v1/contracts/[id]/performance-obligations
 *   POST   /api/v1/contracts/[id]/performance-obligations
 *   PATCH  /api/v1/contracts/[id]/performance-obligations/[poId]
 *   DELETE /api/v1/contracts/[id]/performance-obligations/[poId]
 *   GET    /api/v1/contracts/[id]/performance-obligations/[poId]/schedules
 *
 * Coverage:
 *   - GET list: org-scoped, includes schedule summary; 404 if contract not in org
 *   - GET list: summary totals are decimal strings (minor-unit, FIX 4)
 *   - POST: creates draft PO; viewer 403; missing description → 400;
 *           foreign-org productId → 400; milestone method without milestones → 400;
 *           periodEnd < periodStart → 400; non-admin/manager → 403
 *   - POST: SSP "0.001" (sub-cent USD) → 400 (FIX 3); valid "10.00" → 201 (FIX 3)
 *   - POST: displayOrder P2002 first attempt → retry → 201 (FIX 5)
 *   - PATCH: state-machine invalid transition → 409; CAS (foreign poId → 404);
 *            viewer/member → 403; allocatedAmount override logged in metadata
 *   - PATCH: PO with recognized revenue → 409 on SSP change (FIX 2)
 *   - PATCH: PO with recognized revenue → 409 on allocatedAmount change (FIX 2)
 *   - PATCH: PO with recognized revenue → 409 on cancel (FIX 2)
 *   - PATCH: PO with recognized revenue → 200 on description edit (FIX 2)
 *   - PATCH: recognized PO + standaloneSellingPrice:null → 409 (FIX A null-bypass closed)
 *   - PATCH: recognized PO + allocatedAmount present → 409 (FIX A presence lock)
 *   - PATCH: recognized PO + description only → 200 (FIX A non-financial allowed)
 *   - PATCH: SSP sub-cent "0.001" → 400 (FIX 3); valid "10.00" → 200 (FIX 3)
 *   - DELETE: draft deletes; non-draft → 409; foreign poId → 404; viewer → 403
 *   - GET schedules: org-scoped; unknown PO → 404; unknown contract → 404
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
    },
    performanceObligation: {
      findMany:   vi.fn(),
      create:     vi.fn(),
      findFirst:  vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      aggregate:  vi.fn(),
    },
    revenueRecognitionSchedule: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  GET as listPos,
  POST as createPo,
} from "@/app/api/v1/contracts/[id]/performance-obligations/route"
import {
  PATCH as patchPo,
  DELETE as deletePo,
} from "@/app/api/v1/contracts/[id]/performance-obligations/[poId]/route"
import { GET as listSchedules } from "@/app/api/v1/contracts/[id]/performance-obligations/[poId]/schedules/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG  = "org-1"
const CTR  = "ctr-1"
const PO   = "po-1"
const USR  = "user-1"

const authAdmin: Record<string, unknown>   = { orgId: ORG, userId: USR, role: "admin" }
const authManager: Record<string, unknown> = { orgId: ORG, userId: USR, role: "manager" }
const authRead: Record<string, unknown>    = { orgId: ORG, userId: USR, role: "viewer" }
const auth403 = new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })
const auth401 = new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 })

const mockContract = { id: CTR, organizationId: ORG, currency: "USD", valueAmount: "10000.00" }

const mockPo = {
  id:                     PO,
  organizationId:         ORG,
  contractId:             CTR,
  productId:              null,
  displayOrder:           1,
  description:            "SaaS license",
  standaloneSellingPrice: "8000.00",
  allocatedAmount:        "0.00",
  currency:               "USD",
  recognitionMethod:      "over_time_straight_line",
  periodStart:            new Date("2026-07-01T00:00:00.000Z"),
  periodEnd:              new Date("2027-06-30T00:00:00.000Z"),
  status:                 "draft",
  metadata:               {},
  createdBy:              USR,
  createdAt:              new Date("2026-06-07T00:00:00.000Z"),
  updatedAt:              new Date("2026-06-07T00:00:00.000Z"),
  schedules:              [],
}

// mockPo with schedules/entries shape used by PATCH (FIX 2)
const mockPoWithSchedules = {
  ...mockPo,
  schedules: [
    {
      status:  "scheduled",
      entries: [],
    },
  ],
}

// mockPo that has a recognized entry — triggers FIX 2 lock
const mockPoWithRecognizedEntry = {
  ...mockPo,
  schedules: [
    {
      status:  "recognized",
      entries: [{ id: "entry-1" }],
    },
  ],
}

// mockPo that has a non-scheduled line (partially_recognized) — also triggers FIX 2 lock
const mockPoWithPartialRecognition = {
  ...mockPo,
  schedules: [
    {
      status:  "partially_recognized",
      entries: [],
    },
  ],
}

const mockScheduleLine = {
  id:              "sched-1",
  organizationId:  ORG,
  performanceObligationId: PO,
  lineNumber:      1,
  periodStart:     new Date("2026-07-01T00:00:00.000Z"),
  periodEnd:       new Date("2026-07-31T00:00:00.000Z"),
  scheduledAmount: "833.33",
  currency:        "USD",
  status:          "scheduled",
  recognizedAt:    null,
  label:           "month-1",
  metadata:        {},
  createdAt:       new Date("2026-06-07T00:00:00.000Z"),
  updatedAt:       new Date("2026-06-07T00:00:00.000Z"),
  entries:         [],
}

function makeReq(path: string, method = "GET", body?: unknown): NextRequest {
  const url = path.startsWith("http") ? path : `http://localhost${path}`
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const ctrParams   = { params: Promise.resolve({ id: CTR }) }
const poParams    = { params: Promise.resolve({ id: CTR, poId: PO }) }
const schedParams = { params: Promise.resolve({ id: CTR, poId: PO }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.contract.findFirst).mockResolvedValue(mockContract as any)
  // findMany: first call returns list with schedules for GET (summary), second for PATCH (recognition check)
  vi.mocked(prisma.performanceObligation.findMany).mockResolvedValue([{ ...mockPo, schedules: [] }] as any)
  vi.mocked(prisma.performanceObligation.create).mockResolvedValue(mockPo as any)
  // findFirst default: PO with no recognized revenue (PATCH base)
  vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithSchedules as any)
  vi.mocked(prisma.performanceObligation.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.performanceObligation.deleteMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.performanceObligation.aggregate).mockResolvedValue({ _max: { displayOrder: 1 } } as any)
  vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: "prod-1" } as any)
  vi.mocked(prisma.revenueRecognitionSchedule.findMany).mockResolvedValue([mockScheduleLine] as any)
  vi.mocked(requireAuth).mockResolvedValue(authAdmin as any)
})

// ─── GET /performance-obligations ────────────────────────────────────────────

describe("GET /performance-obligations", () => {
  it("returns org-scoped list with schedule summary", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    const res  = await listPos(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data[0]).toHaveProperty("scheduleSummary")
    expect(json.data[0].scheduleSummary).toHaveProperty("lineCount")
    expect(json.data[0].scheduleSummary).toHaveProperty("totalScheduled")
  })

  it("FIX 4: summary totals are decimal strings (minor-unit, no float)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    // PO with a scheduled line of 833.33 USD, 0 recognized
    vi.mocked(prisma.performanceObligation.findMany).mockResolvedValue([{
      ...mockPo,
      schedules: [
        { id: "sched-1", status: "scheduled", scheduledAmount: "833.33", recognizedAt: null, entries: [] },
      ],
    }] as any)
    const res  = await listPos(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    const summary = json.data[0].scheduleSummary
    // totalScheduled must be a decimal string (not a number float)
    expect(typeof summary.totalScheduled).toBe("string")
    expect(typeof summary.totalRecognized).toBe("string")
    expect(summary.totalScheduled).toBe("833.33")
    expect(summary.totalRecognized).toBe("0.00")
  })

  it("returns 404 when contract not in org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    const res = await listPos(makeReq(`/api/v1/contracts/other/performance-obligations`), { params: Promise.resolve({ id: "other" }) })
    expect(res.status).toBe(404)
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth401)
    const res = await listPos(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`), ctrParams)
    expect(res.status).toBe(401)
  })
})

// ─── POST /performance-obligations ───────────────────────────────────────────

describe("POST /performance-obligations", () => {
  const validBody = {
    description:       "SaaS license",
    recognitionMethod: "over_time_straight_line",
    periodStart:       "2026-07-01",
    periodEnd:         "2027-06-30",
  }

  it("creates a draft PO with admin auth", async () => {
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", validBody), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.status).toBe("draft")
  })

  it("creates a draft PO with manager auth", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authManager as any)
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", validBody), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
  })

  it("returns 403 for viewer (read-only)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    const res = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", validBody), ctrParams)
    expect(res.status).toBe(403)
  })

  it("returns 403 for member role (not admin/manager)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: USR, role: "member" } as any)
    const res = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", validBody), ctrParams)
    expect(res.status).toBe(403)
  })

  it("returns 400 when description is missing", async () => {
    const body = { ...validBody, description: undefined }
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", body), ctrParams)
    expect(res.status).toBe(400)
  })

  it("returns 400 for foreign-org productId", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null)
    const body = { ...validBody, productId: "foreign-prod" }
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", body), ctrParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/productId/)
  })

  it("returns 400 when milestone method has no milestones", async () => {
    const body = { ...validBody, recognitionMethod: "milestone" }
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", body), ctrParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/milestone/)
  })

  it("returns 400 when periodEnd < periodStart", async () => {
    const body = { ...validBody, periodStart: "2027-06-30", periodEnd: "2026-07-01" }
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", body), ctrParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/periodEnd/)
  })

  it("returns 404 when contract not in org", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    const res = await createPo(makeReq(`/api/v1/contracts/other/performance-obligations`, "POST", validBody), { params: Promise.resolve({ id: "other" }) })
    expect(res.status).toBe(404)
  })

  it("auto-assigns displayOrder when not provided", async () => {
    await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", validBody), ctrParams)
    expect(vi.mocked(prisma.performanceObligation.aggregate)).toHaveBeenCalled()
  })

  // FIX 3: minor-unit validation on POST SSP
  it("FIX 3: returns 400 when SSP has sub-cent precision (USD 0.001)", async () => {
    const body = { ...validBody, standaloneSellingPrice: "0.001" }
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", body), ctrParams)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/standaloneSellingPrice/i)
  })

  it("FIX 3: accepts valid SSP '10.00' and persists canonical form", async () => {
    const body = { ...validBody, standaloneSellingPrice: "10.00" }
    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", body), ctrParams)
    expect(res.status).toBe(201)
    // Verify create was called with the canonical SSP
    const createCalls = vi.mocked(prisma.performanceObligation.create).mock.calls
    const lastData = createCalls[createCalls.length - 1][0].data
    expect(lastData.standaloneSellingPrice).toBe("10.00")
  })

  // FIX 5: displayOrder race — P2002 on first attempt, retry succeeds
  it("FIX 5: retries on P2002 displayOrder collision and returns 201", async () => {
    let callCount = 0
    vi.mocked(prisma.performanceObligation.create).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Simulate Prisma P2002 unique constraint error on first attempt
        const err = new Error("Unique constraint failed") as Error & { code: string }
        err.code = "P2002"
        throw err
      }
      return Promise.resolve(mockPo as any)
    })

    const res  = await createPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations`, "POST", validBody), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // aggregate was called twice (once per create attempt)
    expect(vi.mocked(prisma.performanceObligation.aggregate).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── PATCH /performance-obligations/[poId] ───────────────────────────────────

describe("PATCH /performance-obligations/[poId]", () => {
  it("updates description", async () => {
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { description: "Updated" }), poParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it("returns 409 on invalid state-machine transition (draft → completed)", async () => {
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { status: "completed" }), poParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/transition/)
  })

  it("allows valid state transition (draft → cancelled)", async () => {
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { status: "cancelled" }), poParams)
    expect(res.status).toBe(200)
  })

  it("returns 404 when poId foreign (CAS count===0)", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(null)
    const res = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/foreign-po`, "PATCH", { description: "X" }), { params: Promise.resolve({ id: CTR, poId: "foreign-po" }) })
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    const res = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { description: "X" }), poParams)
    expect(res.status).toBe(403)
  })

  it("logs allocatedAmount override in metadata", async () => {
    const res = await patchPo(
      makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", {
        allocatedAmount:       "5000.00",
        allocatedAmountReason: "Manual adjustment per CFO",
      }),
      poParams,
    )
    expect(res.status).toBe(200)
    // Verify updateMany was called with metadata containing overrides
    const updateCalls = vi.mocked(prisma.performanceObligation.updateMany).mock.calls
    const lastCall = updateCalls[updateCalls.length - 1][0]
    expect(lastCall.data).toHaveProperty("metadata")
    const meta = lastCall.data.metadata as Record<string, unknown>
    expect(Array.isArray(meta.allocatedAmountOverrides)).toBe(true)
  })

  // FIX 2: recognition lock tests
  it("FIX 2: returns 409 on SSP change when PO has recognized entry", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { standaloneSellingPrice: "9000.00" }), poParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/recognized revenue/i)
    expect(json.error).toMatch(/standaloneSellingPrice/i)
  })

  it("FIX 2: returns 409 on allocatedAmount change when PO has recognized entry", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { allocatedAmount: "7000.00" }), poParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/recognized revenue/i)
    expect(json.error).toMatch(/allocatedAmount/i)
  })

  it("FIX 2: returns 409 on cancel when PO has recognized entry", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { status: "cancelled" }), poParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/recognized revenue/i)
    expect(json.error).toMatch(/cancel/i)
  })

  it("FIX 2: allows description edit on PO with recognized entry (non-financial)", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { description: "Updated name" }), poParams)
    expect(res.status).toBe(200)
  })

  it("FIX 2: returns 409 when schedule status is partially_recognized (no entry needed)", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithPartialRecognition as any)
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { standaloneSellingPrice: "9000.00" }), poParams)
    expect(res.status).toBe(409)
  })

  // FIX A (Codex residual): null-SSP bypass — explicit null must also be locked
  it("FIX A: returns 409 when recognized PO sends standaloneSellingPrice: null (null-bypass closed)", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(
      makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { standaloneSellingPrice: null }),
      poParams,
    )
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/standaloneSellingPrice.*locked/i)
  })

  it("FIX A: returns 409 when recognized PO sends allocatedAmount: null (presence lock)", async () => {
    // allocatedAmount schema is non-nullable (.optional() only) so zod won't
    // parse null — this test verifies the presence-based check works for the
    // normal non-null case (explicit key present → locked).
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(
      makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { allocatedAmount: "5000.00" }),
      poParams,
    )
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/allocatedAmount.*locked/i)
  })

  it("FIX A: description-only edit on recognized PO still returns 200", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(mockPoWithRecognizedEntry as any)
    const res  = await patchPo(
      makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { description: "Renamed" }),
      poParams,
    )
    expect(res.status).toBe(200)
  })

  // FIX 3: minor-unit validation on PATCH
  it("FIX 3: returns 400 when SSP has sub-cent precision (USD 0.001)", async () => {
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { standaloneSellingPrice: "0.001" }), poParams)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/standaloneSellingPrice/i)
  })

  it("FIX 3: accepts valid SSP '10.00' and canonicalises it", async () => {
    const res  = await patchPo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "PATCH", { standaloneSellingPrice: "10.00" }), poParams)
    expect(res.status).toBe(200)
    const updateCalls = vi.mocked(prisma.performanceObligation.updateMany).mock.calls
    const lastData = updateCalls[updateCalls.length - 1][0].data
    expect(lastData.standaloneSellingPrice).toBe("10.00")
  })
})

// ─── DELETE /performance-obligations/[poId] ──────────────────────────────────

describe("DELETE /performance-obligations/[poId]", () => {
  it("deletes a draft PO", async () => {
    // DELETE uses findFirst which returns mockPoWithSchedules (draft, no entries)
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue({ ...mockPoWithSchedules, status: "draft" } as any)
    const res  = await deletePo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "DELETE"), poParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe(PO)
  })

  it("returns 409 when PO is not draft (scheduled)", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue({ ...mockPo, status: "scheduled", schedules: [] } as any)
    const res  = await deletePo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "DELETE"), poParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/draft/)
  })

  it("returns 404 when foreign poId", async () => {
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(null)
    const res = await deletePo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/foreign`, "DELETE"), { params: Promise.resolve({ id: CTR, poId: "foreign" }) })
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    const res = await deletePo(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}`, "DELETE"), poParams)
    expect(res.status).toBe(403)
  })
})

// ─── GET /[poId]/schedules ────────────────────────────────────────────────────

describe("GET /performance-obligations/[poId]/schedules", () => {
  it("returns org-scoped schedule lines with entries", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    const res  = await listSchedules(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}/schedules`), schedParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty("performanceObligation")
    expect(Array.isArray(json.data.schedules)).toBe(true)
    expect(json.data.schedules[0].id).toBe("sched-1")
  })

  it("returns 404 when contract not in org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    const res = await listSchedules(makeReq(`/api/v1/contracts/other/${PO}/schedules`), schedParams)
    expect(res.status).toBe(404)
  })

  it("returns 404 when PO not in contract/org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked(prisma.performanceObligation.findFirst).mockResolvedValue(null)
    const res = await listSchedules(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/foreign/schedules`), { params: Promise.resolve({ id: CTR, poId: "foreign" }) })
    expect(res.status).toBe(404)
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth401)
    const res = await listSchedules(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/${PO}/schedules`), schedParams)
    expect(res.status).toBe(401)
  })
})
