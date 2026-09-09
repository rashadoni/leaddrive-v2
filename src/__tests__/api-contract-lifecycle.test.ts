/**
 * Contract Lifecycle dashboard API — GET /api/v1/contract-lifecycle.
 *
 * Focus: the renewal-alert DEDUP (P1 critique fix). A contract has one alert
 * row PER threshold (90/60/30/14d); the dashboard must show ONE row per
 * contract (its most-urgent alert) and the 90d KPI must count CONTRACTS, not
 * alert records.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockGetOrgId = vi.fn()
const mockRenewalFindMany = vi.fn()
const mockStageFindMany = vi.fn()

vi.mock("@/lib/api-auth", () => ({
  getOrgId: (...a: unknown[]) => mockGetOrgId(...a),
  getSession: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractRenewalAlert: { findMany: (...a: unknown[]) => mockRenewalFindMany(...a) },
    contractApprovalStage: { findMany: (...a: unknown[]) => mockStageFindMany(...a) },
  },
}))

import { GET } from "@/app/api/v1/contract-lifecycle/route"

const ORG = "org-1"
const now = Date.now()
const inDays = (d: number) => new Date(now + d * 86_400_000)

/** One alert row (DB shape). */
function alert(id: string, contractId: string, dueDays: number, threshold: number, company = "Acme") {
  return {
    id,
    contractId,
    dueAt: inDays(dueDays),
    daysBeforeExpiry: threshold,
    status: "pending",
    deliveredVia: null,
    deliveredAt: null,
    createdAt: inDays(-1),
    contract: {
      contractNumber: `CTR-${contractId}`,
      title: "Service Agreement",
      endDate: inDays(dueDays),
      valueAmount: null,
      currency: "USD",
      status: "active",
      company: company ? { name: company } : null,
    },
  }
}

/** One pending approval stage (DB shape). `company=""` → contract.company null. */
function stage(id: string, contractId: string, company = "Acme", label = "Finance") {
  return {
    id,
    contractId,
    order: 1,
    label,
    status: "pending",
    assigneeUserId: null,
    assigneeRole: "manager",
    createdAt: inDays(-2),
    contract: {
      contractNumber: `CTR-${contractId}`,
      title: "Service Agreement",
      status: "pending_approval",
      valueAmount: null,
      currency: "USD",
      company: company ? { name: company } : null,
    },
  }
}

function makeReq() {
  return new NextRequest("http://localhost/api/v1/contract-lifecycle")
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOrgId.mockResolvedValue(ORG)
  mockStageFindMany.mockResolvedValue([])
})

describe("GET /contract-lifecycle — renewal dedup", () => {
  it("queries renewal alerts only for live active/renewing contracts", async () => {
    mockRenewalFindMany.mockResolvedValue([])

    await GET(makeReq())

    const call = mockRenewalFindMany.mock.calls[0][0]
    expect(call.where.contract.status.in).toEqual(["active", "renewing"])
  })

  it("collapses a contract's multiple threshold alerts to ONE row (its most urgent)", async () => {
    // Contract A: 3 alerts (5d/20d/40d out), ordered dueAt-asc as the DB returns them.
    // Contract B: 1 alert. Expect 2 rows total, A kept at its soonest (5d).
    mockRenewalFindMany.mockResolvedValue([
      alert("a-5", "A", 5, 14),
      alert("a-20", "A", 20, 30),
      alert("a-40", "A", 40, 90),
      alert("b-10", "B", 10, 30, "Beta"),
    ])

    const res = await GET(makeReq())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.renewals.items).toHaveLength(2) // A once + B once
    expect(json.renewals.total).toBe(2) // KPI counts contracts, not the 4 alert rows

    const a = json.renewals.items.find((r: { contractId: string }) => r.contractId === "A")
    // kept the soonest alert for A — daysBeforeExpiry=14 uniquely identifies the
    // a-5 row (the only 14d-threshold one); days-until is ~5 (floor + a few ms of
    // clock drift between the test's `now` and the route's `new Date()`).
    expect(a.daysBeforeExpiry).toBe(14)
    expect(a.daysUntilDue).toBeGreaterThanOrEqual(4)
    expect(a.daysUntilDue).toBeLessThanOrEqual(5)
  })

  it("overdueCount is computed on the deduped set", async () => {
    mockRenewalFindMany.mockResolvedValue([
      alert("a-neg", "A", -3, 14), // overdue, most urgent for A
      alert("a-pos", "A", 10, 30),
      alert("c-2", "C", 2, 14, "Gamma"),
    ])
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.renewals.items).toHaveLength(2)
    expect(json.renewals.overdueCount).toBe(1) // only A (kept the -3d row), not double-counted
  })

  it("returns companyName=null (not a hardcoded string) when the contract has no company", async () => {
    // P2 fix: the API must not bake an English 'Unknown company' string — it
    // returns null and the client localizes the fallback.
    mockRenewalFindMany.mockResolvedValue([alert("d-3", "D", 3, 14, "")]) // "" → company:null
    mockStageFindMany.mockResolvedValue([stage("s-1", "D", "")]) // approvals path too
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.renewals.items[0].companyName).toBeNull()
    expect(json.approvals.items[0].companyName).toBeNull() // both map sites localized
  })

  it("bottleneckStage + bottleneckCount = the busiest approval-stage group", async () => {
    // 2 contracts stuck at "Finance", 1 at "Legal" → Finance is the bottleneck (2).
    mockRenewalFindMany.mockResolvedValue([])
    mockStageFindMany.mockResolvedValue([
      stage("s1", "C1", "Acme", "Finance"),
      stage("s2", "C2", "Beta", "Finance"),
      stage("s3", "C3", "Gamma", "Legal"),
    ])
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.approvals.bottleneckStage).toBe("Finance")
    expect(json.approvals.bottleneckCount).toBe(2)
  })

  it("unauthorized when no org", async () => {
    mockGetOrgId.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })
})
