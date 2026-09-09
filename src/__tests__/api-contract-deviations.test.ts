/**
 * CLM Slice 4c — API tests for:
 *   GET    /api/v1/contracts/[id]/deviations
 *   PATCH  /api/v1/contracts/[id]/deviations/[flagId]
 *   POST   /api/v1/contracts/[id]/deviations/rescan
 *   GET    /api/v1/contracts (hasDeviations filter)
 *
 * Coverage:
 *   - GET list: org-scoped; 404 when contract not found in org
 *   - PATCH acknowledge: sets status "acknowledged"; returns updated flag
 *   - PATCH waive:       sets status "waived" + waivedBy + waivedAt + waivedReason
 *   - PATCH viewer role: requireAuth write → 403 (viewer only has read)
 *   - PATCH cross-tenant flag (different org): 404
 *   - Rescan: deletes flagged, preserves waived, re-detects, returns count
 *   - hasDeviations filter in GET /api/v1/contracts: wire check
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
      findMany:  vi.fn(),
      count:     vi.fn(),
    },
    contractDeviationFlag: {
      findMany:     vi.fn(),
      findFirst:    vi.fn(),
      update:       vi.fn(),
      updateMany:   vi.fn(),
      deleteMany:   vi.fn(),
      createMany:   vi.fn(),
    },
    contractTemplate: {
      findFirst: vi.fn(),
    },
    contractClause: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

vi.mock("@/lib/prisma-decimal", () => ({
  normalizeContractRow: (c: any) => c,
}))

vi.mock("@/lib/contract-lifecycle/upsert-renewal-alerts", () => ({
  upsertRenewalAlerts: vi.fn(),
}))

import { GET as listDeviations } from "@/app/api/v1/contracts/[id]/deviations/route"
import { PATCH as patchFlag } from "@/app/api/v1/contracts/[id]/deviations/[flagId]/route"
import { POST as rescan } from "@/app/api/v1/contracts/[id]/deviations/rescan/route"
import { GET as listContracts } from "@/app/api/v1/contracts/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", "x-organization-id": "org-1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function makeContractParams(id = "ctr-1") {
  return { params: Promise.resolve({ id }) }
}
function makeFlagParams(id = "ctr-1", flagId = "flag-1") {
  return { params: Promise.resolve({ id, flagId }) }
}

const authRead  = { orgId: "org-1", userId: "user-1" }
const authWrite = { orgId: "org-1", userId: "user-1" }
const auth403   = new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403 })

const mockContract = { id: "ctr-1", organizationId: "org-1", templateId: "tmpl-1" }

const mockFlag = {
  id: "flag-1",
  organizationId: "org-1",
  contractId: "ctr-1",
  clauseId: "lib-1",
  clauseTitle: "Indemnity",
  deviationType: "high_risk",
  severity: "critical",
  status: "flagged",
  waivedBy: null,
  waivedAt: null,
  waivedReason: null,
  detectedAt: new Date().toISOString(),
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(authRead as any)
  vi.mocked((prisma as any).contract.findFirst).mockResolvedValue(mockContract)
  vi.mocked((prisma as any).contractDeviationFlag.findMany).mockResolvedValue([mockFlag])
  vi.mocked((prisma as any).contractDeviationFlag.findFirst).mockResolvedValue(mockFlag)
  vi.mocked((prisma as any).contractDeviationFlag.update).mockImplementation(
    async ({ data }: any) => ({ ...mockFlag, ...data })
  )
  // updateMany returns count: 1 on success (CAS guard)
  vi.mocked((prisma as any).contractDeviationFlag.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked((prisma as any).contractDeviationFlag.deleteMany).mockResolvedValue({ count: 1 })
  vi.mocked((prisma as any).contractDeviationFlag.createMany).mockResolvedValue({ count: 2 })
  // $transaction: execute the array of operations sequentially
  vi.mocked((prisma as any).$transaction).mockImplementation(async (ops: any[]) => {
    const results = []
    for (const op of ops) results.push(await op)
    return results
  })
})

// ─── GET list ─────────────────────────────────────────────────────────────────

describe("GET /api/v1/contracts/[id]/deviations", () => {
  it("returns the list of flags for the contract (org-scoped)", async () => {
    const res = await listDeviations(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations"),
      makeContractParams(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data[0].id).toBe("flag-1")
  })

  it("returns 404 when the contract does not belong to this org", async () => {
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue(null)
    const res = await listDeviations(
      makeReq("http://localhost/api/v1/contracts/ctr-other/deviations"),
      makeContractParams("ctr-other"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 403 when auth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const res = await listDeviations(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations"),
      makeContractParams(),
    )
    expect(res.status).toBe(403)
  })
})

// ─── PATCH acknowledge ────────────────────────────────────────────────────────

describe("PATCH /api/v1/contracts/[id]/deviations/[flagId] — acknowledge", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    // updateMany count:1 = success; findFirst re-fetch returns updated flag
    vi.mocked((prisma as any).contractDeviationFlag.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked((prisma as any).contractDeviationFlag.findFirst).mockResolvedValue({
      ...mockFlag,
      status: "acknowledged",
    })
  })

  it("sets status to acknowledged", async () => {
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-1", "PATCH", { action: "acknowledge" }),
      makeFlagParams(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.status).toBe("acknowledged")
  })

  it("uses updateMany with full id+org+contract predicate (CAS guard)", async () => {
    await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-1", "PATCH", { action: "acknowledge" }),
      makeFlagParams(),
    )
    expect(vi.mocked((prisma as any).contractDeviationFlag.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "flag-1",
          organizationId: "org-1",
          contractId: "ctr-1",
        }),
      }),
    )
  })

  it("returns 404 when updateMany count is 0 (stale/foreign flag — CAS miss)", async () => {
    // Flag present in findFirst guard but gone by write time (TOCTOU scenario)
    vi.mocked((prisma as any).contractDeviationFlag.updateMany).mockResolvedValue({ count: 0 })
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-other", "PATCH", { action: "acknowledge" }),
      makeFlagParams("ctr-1", "flag-other"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when flag not found in initial org-scope guard", async () => {
    vi.mocked((prisma as any).contractDeviationFlag.findFirst).mockResolvedValue(null)
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-other", "PATCH", { action: "acknowledge" }),
      makeFlagParams("ctr-1", "flag-other"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer (requireAuth write gate)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(auth403 as any)
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-1", "PATCH", { action: "acknowledge" }),
      makeFlagParams(),
    )
    expect(res.status).toBe(403)
  })
})

// ─── PATCH waive ──────────────────────────────────────────────────────────────

describe("PATCH /api/v1/contracts/[id]/deviations/[flagId] — waive", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    vi.mocked((prisma as any).contractDeviationFlag.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked((prisma as any).contractDeviationFlag.findFirst).mockResolvedValue({
      ...mockFlag,
      status:       "waived",
      waivedBy:     "user-1",
      waivedAt:     new Date(),
      waivedReason: "Approved by legal",
    })
  })

  it("sets status to waived with waivedBy, waivedAt, waivedReason", async () => {
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-1", "PATCH", {
        action: "waive",
        reason: "Approved by legal",
      }),
      makeFlagParams(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.status).toBe("waived")
    expect(json.data.waivedBy).toBe("user-1")
    expect(json.data.waivedReason).toBe("Approved by legal")
  })

  it("cross-tenant flag returns 404 (initial findFirst guard)", async () => {
    // findFirst org-scope guard returns null → 404 before updateMany is reached
    vi.mocked((prisma as any).contractDeviationFlag.findFirst).mockResolvedValue(null)
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-1", "PATCH", { action: "waive" }),
      makeFlagParams(),
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when updateMany count is 0 (CAS miss on waive)", async () => {
    // Guard passes but write misses (TOCTOU)
    vi.mocked((prisma as any).contractDeviationFlag.updateMany).mockResolvedValue({ count: 0 })
    const res = await patchFlag(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/flag-1", "PATCH", { action: "waive" }),
      makeFlagParams(),
    )
    expect(res.status).toBe(404)
  })
})

// ─── POST rescan ──────────────────────────────────────────────────────────────

describe("POST /api/v1/contracts/[id]/deviations/rescan", () => {
  const mockTemplate = {
    id: "tmpl-1",
    organizationId: "org-1",
    clauses: [
      { id: "c1", title: "Risky Clause", body: "…" },
      { id: "c2", title: "Standard Clause", body: "…" },
    ],
  }
  const mockLibrary = [
    { id: "lib-1", title: "Risky Clause", riskLevel: "high_risk", status: "approved", fallbackOfClauseId: null },
    { id: "lib-2", title: "Standard Clause", riskLevel: "standard", status: "approved", fallbackOfClauseId: null },
  ]

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(authWrite as any)
    vi.mocked((prisma as any).contractTemplate.findFirst).mockResolvedValue(mockTemplate)
    vi.mocked((prisma as any).contractClause.findMany).mockResolvedValue(mockLibrary)
    vi.mocked((prisma as any).contractDeviationFlag.deleteMany).mockResolvedValue({ count: 1 })
    vi.mocked((prisma as any).contractDeviationFlag.createMany).mockResolvedValue({ count: 1 })
  })

  it("deletes flagged flags and creates new ones via $transaction (atomic)", async () => {
    const res = await rescan(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/rescan", "POST"),
      makeContractParams(),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    // Only 1 deviation (Risky Clause is high_risk; Standard Clause is standard → no flag)
    expect(json.data.created).toBe(1)

    // $transaction must have been called (atomic delete + create)
    expect(vi.mocked((prisma as any).$transaction)).toHaveBeenCalledTimes(1)

    // deleteMany and createMany were called (via the transaction array)
    expect(vi.mocked((prisma as any).contractDeviationFlag.deleteMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "flagged" }),
      }),
    )
  })

  it("waived flags are preserved (deleteMany filters by status:flagged)", async () => {
    await rescan(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/rescan", "POST"),
      makeContractParams(),
    )
    // deleteMany where predicate must include status:"flagged" so waived/acknowledged are not deleted
    const deleteCall = vi.mocked((prisma as any).contractDeviationFlag.deleteMany).mock.calls[0][0]
    expect(deleteCall.where.status).toBe("flagged")
  })

  it("returns 422 when contract has no template", async () => {
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue({ id: "ctr-1", organizationId: "org-1", templateId: null })
    const res = await rescan(
      makeReq("http://localhost/api/v1/contracts/ctr-1/deviations/rescan", "POST"),
      makeContractParams(),
    )
    expect(res.status).toBe(422)
  })

  it("returns 404 when contract not in org", async () => {
    vi.mocked((prisma as any).contract.findFirst).mockResolvedValue(null)
    const res = await rescan(
      makeReq("http://localhost/api/v1/contracts/ctr-other/deviations/rescan", "POST"),
      makeContractParams("ctr-other"),
    )
    expect(res.status).toBe(404)
  })
})

// ─── hasDeviations filter in GET /api/v1/contracts ───────────────────────────

describe("GET /api/v1/contracts — hasDeviations filter", () => {
  const mockContracts = [{ id: "ctr-1", organizationId: "org-1", deviationFlags: [{ id: "f1", severity: "critical" }], company: null, deal: null, contact: null, tags: [] }]

  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue(authRead as any)
    vi.mocked((prisma as any).contract.findMany).mockResolvedValue(mockContracts)
    vi.mocked((prisma as any).contract.count).mockResolvedValue(1)
  })

  it("passes hasDeviations filter with status:flagged AND organizationId scoping to query", async () => {
    const res = await listContracts(
      makeReq("http://localhost/api/v1/contracts?hasDeviations=true"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    // The where clause must include org-scoped deviationFlags filter (defense-in-depth)
    const findManyCall = vi.mocked((prisma as any).contract.findMany).mock.calls[0][0]
    expect(findManyCall.where).toMatchObject({
      deviationFlags: { some: { status: "flagged", organizationId: "org-1" } },
    })
  })

  it("does not include deviationFlags filter when hasDeviations is not set", async () => {
    const res = await listContracts(
      makeReq("http://localhost/api/v1/contracts"),
    )
    expect(res.status).toBe(200)
    const findManyCall = vi.mocked((prisma as any).contract.findMany).mock.calls[0][0]
    expect(findManyCall.where?.deviationFlags).toBeUndefined()
  })
})
