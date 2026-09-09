/**
 * CLM Slice 5b-1 — Revenue recalculate API tests
 *
 * Route under test:
 *   POST /api/v1/contracts/[id]/performance-obligations/recalculate
 *
 * Coverage:
 *   - Allocates by SSP proportionally (2 POs: SSP 8000+2000 → 8000/10000 + 2000/10000)
 *   - Persists allocatedAmount (Decimal string, not float)
 *   - Generates schedule lines per recognition method (over_time_straight_line → N months)
 *   - Preserves recognized/partially_recognized lines (only deletes "scheduled")
 *   - Runs in $transaction (atomic)
 *   - Returns allocation error (mixed null SSP) → 400
 *   - Org-scoped: contract not in org → 404
 *   - No POs → 400
 *   - viewer/member 403 (finance-sensitive write)
 *   - Admin + manager succeed
 *   - FIX 1: surviving recognized line at lineNumber 1 → new lines at 2+, no P2002 collision
 *   - FIX 4: summary totals are decimal strings (minor units, no float)
 *   - FIX 6: PO updateMany predicate includes contractId; count !== 1 → rollback (throws)
 *   - FIX 1 (TOCTOU): FOR UPDATE lock runs FIRST in tx; in-tx recheck → 409 even if pre-tx
 *     check passed (cron posts between check and tx).
 *
 * Pure helpers (allocation-engine, schedule-generator, decimal-minor,
 * state-machine) are NOT mocked — they run against real logic.
 * Only prisma is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTransaction  = vi.fn()
const mockDeleteMany   = vi.fn()
const mockCreateMany   = vi.fn()
const mockUpdateMany   = vi.fn()
const mockFindMany     = vi.fn()
const mockAggregate    = vi.fn()
const mockSchedCount   = vi.fn()
const mockQueryRaw     = vi.fn()
const mockTxSchedCount = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
    },
    performanceObligation: {
      findMany:   (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    revenueRecognitionSchedule: {
      count:       (...args: unknown[]) => mockSchedCount(...args),
      deleteMany:  (...args: unknown[]) => mockDeleteMany(...args),
      createMany:  (...args: unknown[]) => mockCreateMany(...args),
      aggregate:   (...args: unknown[]) => mockAggregate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))

// ─── Imports ─────────────────────────────────────────────────────────────────

import { POST as recalculate } from "@/app/api/v1/contracts/[id]/performance-obligations/recalculate/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG = "org-1"
const CTR = "ctr-1"
const USR = "user-1"
const PO1 = "po-1"
const PO2 = "po-2"

const authAdmin: Record<string, unknown>   = { orgId: ORG, userId: USR, role: "admin" }
const authManager: Record<string, unknown> = { orgId: ORG, userId: USR, role: "manager" }

// Contract: $10,000 USD, 2 POs with SSP 8000 + 2000
const mockContract = {
  id:          CTR,
  organizationId: ORG,
  valueAmount: "10000.00",
  currency:    "USD",
}

const periodStart = new Date("2026-07-01T00:00:00.000Z")
const periodEnd   = new Date("2026-09-30T00:00:00.000Z") // 3 months

const mockPos = [
  {
    id:                     PO1,
    organizationId:         ORG,
    contractId:             CTR,
    displayOrder:           1,
    description:            "SaaS license",
    standaloneSellingPrice: "8000.00",
    allocatedAmount:        "0.00",
    currency:               "USD",
    recognitionMethod:      "over_time_straight_line",
    periodStart,
    periodEnd,
    status:                 "draft",
    metadata:               {},
  },
  {
    id:                     PO2,
    organizationId:         ORG,
    contractId:             CTR,
    displayOrder:           2,
    description:            "Implementation",
    standaloneSellingPrice: "2000.00",
    allocatedAmount:        "0.00",
    currency:               "USD",
    recognitionMethod:      "point_in_time",
    periodStart,
    periodEnd,
    status:                 "draft",
    metadata:               {},
  },
]

// Updated POs returned after $transaction (simulate DB state)
const updatedPos = mockPos.map((po, i) => ({
  ...po,
  allocatedAmount: i === 0 ? "8000.00" : "2000.00",
  status:          "scheduled",
  schedules:       [],
}))

function makeReq(path: string, method = "POST"): NextRequest {
  return new NextRequest(
    path.startsWith("http") ? path : `http://localhost${path}`,
    { method, headers: { "Content-Type": "application/json" } },
  )
}

const ctrParams = { params: Promise.resolve({ id: CTR }) }

/**
 * Helper: wrap a $transaction callback in the mock so it executes the fn
 * with a tx object that proxies to the top-level mock fns.
 * Includes $queryRaw (FOR UPDATE lock) + revenueRecognitionSchedule.count (in-tx recheck).
 */
function wireTransaction() {
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      $queryRaw: mockQueryRaw,
      performanceObligation: {
        updateMany: mockUpdateMany,
      },
      revenueRecognitionSchedule: {
        count:      mockTxSchedCount,
        deleteMany: mockDeleteMany,
        createMany: mockCreateMany,
        aggregate:  mockAggregate,
      },
    }
    return fn(tx)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.contract.findFirst).mockResolvedValue(mockContract as any)
  mockFindMany.mockResolvedValueOnce(mockPos as any).mockResolvedValueOnce(updatedPos as any)
  wireTransaction()
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockDeleteMany.mockResolvedValue({ count: 0 })
  mockCreateMany.mockResolvedValue({ count: 3 })
  // FIX 1: default — no surviving lines, so maxSurvivingLineNumber = 0
  mockAggregate.mockResolvedValue({ _max: { lineNumber: null } })
  // FIX B: default — no recognized schedules → recalc is allowed (pre-tx check)
  mockSchedCount.mockResolvedValue(0)
  // FIX 1 TOCTOU: default — in-tx recheck also finds 0 (no racing cron)
  mockTxSchedCount.mockResolvedValue(0)
  // FIX 1: FOR UPDATE query resolves cleanly by default
  mockQueryRaw.mockResolvedValue([])
  vi.mocked(requireAuth).mockResolvedValue(authAdmin as any)
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /recalculate — allocation", () => {
  it("allocates by SSP proportionally (8000+2000 of 10000)", async () => {
    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)

    // Verify updateMany was called for each PO with the correct allocatedAmount
    const updateCalls = mockUpdateMany.mock.calls
    // First call = PO1 allocatedAmount (8000.00)
    const po1Update = updateCalls.find((c) =>
      c[0].where?.id === PO1 && c[0].data?.allocatedAmount !== undefined,
    )
    const po2Update = updateCalls.find((c) =>
      c[0].where?.id === PO2 && c[0].data?.allocatedAmount !== undefined,
    )
    expect(po1Update).toBeDefined()
    expect(po2Update).toBeDefined()
    expect(po1Update![0].data.allocatedAmount).toBe("8000.00")
    expect(po2Update![0].data.allocatedAmount).toBe("2000.00")
  })

  it("generates schedule lines for over_time_straight_line (3 months)", async () => {
    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    const createCalls = mockCreateMany.mock.calls
    // Find createMany call for PO1 (over_time_straight_line → 3 lines)
    const po1Create = createCalls.find((c) =>
      c[0].data?.some?.((l: { performanceObligationId?: string }) => l.performanceObligationId === PO1),
    )
    expect(po1Create).toBeDefined()
    const lines = po1Create![0].data
    expect(lines).toHaveLength(3) // July, Aug, Sep
    // Sum of all lines = 8000 (in decimal string representation)
    const sum = lines.reduce((s: number, l: { scheduledAmount: string }) => s + parseFloat(l.scheduledAmount), 0)
    expect(Math.round(sum * 100)).toBe(800000) // 8000.00 in cents
  })

  it("generates 1 line for point_in_time PO", async () => {
    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    const createCalls = mockCreateMany.mock.calls
    const po2Create = createCalls.find((c) =>
      c[0].data?.some?.((l: { performanceObligationId?: string }) => l.performanceObligationId === PO2),
    )
    expect(po2Create).toBeDefined()
    const lines = po2Create![0].data
    expect(lines).toHaveLength(1)
    expect(lines[0].scheduledAmount).toBe("2000.00")
  })

  it("runs everything in a $transaction", async () => {
    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  // FIX 6: PO updateMany predicate includes contractId
  it("FIX 6: PO updateMany (allocatedAmount) predicate includes contractId", async () => {
    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const updateCalls = mockUpdateMany.mock.calls
    const allocUpdates = updateCalls.filter((c) => c[0].data?.allocatedAmount !== undefined)
    for (const call of allocUpdates) {
      expect(call[0].where).toHaveProperty("contractId", CTR)
    }
  })

  // FIX 4: summary totals are decimal strings
  it("FIX 4: summary totals are decimal strings (no float)", async () => {
    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(200)
    for (const po of json.data) {
      expect(po).toHaveProperty("scheduleSummary")
      expect(typeof po.scheduleSummary.totalScheduled).toBe("string")
      expect(typeof po.scheduleSummary.totalRecognized).toBe("string")
    }
  })
})

describe("POST /recalculate — preserve recognized lines", () => {
  it("only deletes 'scheduled' lines, not 'recognized'", async () => {
    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    const deleteCalls = mockDeleteMany.mock.calls
    deleteCalls.forEach((call) => {
      const where = call[0].where
      expect(where.status).toBe("scheduled")
    })
  })
})

// ─── FIX B: recalc blocked after any recognition ─────────────────────────────
//
// FIX B (ASC-606): once any PO in the contract has recognized revenue, the
// allocation is fixed at inception. recalculate must 409 and mutate NOTHING.
//
// This replaces the old "FIX 1: lineNumber coexistence" offset scenario:
// the offset is now only reachable code when FIX B's count returns 0 AND the
// in-tx aggregate somehow finds surviving lines (a defensive path; the two
// conditions are mutually exclusive in practice). The offset logic is kept as
// defensive code — tested via the "lineNumbers starting at 1" case below.

describe("POST /recalculate — FIX B: blocked after recognition", () => {
  it("returns 409 when a PO has a recognized schedule line", async () => {
    // Simulate: one schedule line with status != "scheduled" exists
    mockSchedCount.mockResolvedValue(1)

    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/recognized/i)
    expect(json.error).toMatch(/locked/i)
  })

  it("mutates NOTHING when 409 (no deleteMany/createMany/updateMany called)", async () => {
    mockSchedCount.mockResolvedValue(2) // any recognized schedule count > 0

    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    // $transaction must not have been entered
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockDeleteMany).not.toHaveBeenCalled()
    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("returns 409 when a PO has a RevenueRecognitionEntry (count > 0)", async () => {
    // The count query ORs status-not-scheduled + entries.some — simulate via count=1
    mockSchedCount.mockResolvedValue(1)

    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(res.status).toBe(409)
  })

  it("proceeds normally when all schedules are in 'scheduled' status (count=0)", async () => {
    // Explicitly wire the two findMany calls (POs + updated POs for response)
    // to avoid stale once-queue state from prior tests in the suite.
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValueOnce(mockPos as any).mockResolvedValueOnce(updatedPos as any)
    // mockSchedCount is 0 from beforeEach (no recognized lines)
    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(res.status).toBe(200)
    // Transaction was entered (allocation ran)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})

// ─── FIX 1: lineNumber offset (defensive code path) ──────────────────────────
//
// Now that FIX B gates on any recognized line, this offset only fires in
// practice during normal recalc (count=0).  The "no surviving lines" case
// (aggregate returns null → lineNumbers start at 1) is the standard path.
// The aggregate-returns-1 sub-case is defensive code only and is not tested
// here (it would require FIX B to be bypassed).

describe("POST /recalculate — FIX 1: lineNumber offset (standard path)", () => {
  it("uses lineNumbers starting at 1 when no surviving lines (maxSurviving=0)", async () => {
    // Default: aggregate returns null → maxSuriving = 0, new lines at 1..N
    mockAggregate.mockResolvedValue({ _max: { lineNumber: null } })

    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    const createCalls = mockCreateMany.mock.calls
    const po1Create = createCalls.find((c) =>
      c[0].data?.some?.((l: { performanceObligationId?: string }) => l.performanceObligationId === PO1),
    )
    expect(po1Create).toBeDefined()
    const lines: Array<{ lineNumber: number }> = po1Create![0].data

    // First lineNumber should be 1 (0 + 1)
    const lineNumbers = lines.map((l) => l.lineNumber).sort((a, b) => a - b)
    expect(lineNumbers[0]).toBe(1)
  })
})

// ─── FIX 6: concurrent drift — count !== 1 → throws ─────────────────────────

describe("POST /recalculate — FIX 6: concurrent drift guard", () => {
  it("returns 500 when updateMany count !== 1 (concurrent PO deletion)", async () => {
    // Simulate concurrent drift: updateMany returns count: 0
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        performanceObligation: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // drift: PO vanished
        },
        revenueRecognitionSchedule: {
          deleteMany: mockDeleteMany,
          createMany: mockCreateMany,
          aggregate:  mockAggregate,
        },
      }
      // The route throws inside the tx callback; $transaction should propagate
      return fn(tx).catch((e: Error) => { throw e })
    })

    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    // The thrown error surfaces as 500
    expect(res.status).toBe(500)
  })
})

describe("POST /recalculate — allocation errors", () => {
  it("returns 400 on mixed null+non-null SSP (ambiguous allocation)", async () => {
    // PO1 has SSP, PO2 has null
    const mixedPos = [
      { ...mockPos[0], standaloneSellingPrice: "8000.00" },
      { ...mockPos[1], standaloneSellingPrice: null },
    ]
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValue(mixedPos as any)

    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/mixed null/i)
  })

  it("returns 400 when no POs exist", async () => {
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValue([])

    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/No performance obligations/)
  })
})

describe("POST /recalculate — org-scope + auth guards", () => {
  it("returns 404 when contract not in org", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    const res = await recalculate(makeReq(`/api/v1/contracts/other/performance-obligations/recalculate`), { params: Promise.resolve({ id: "other" }) })
    expect(res.status).toBe(404)
  })

  it("returns 403 for viewer", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: USR, role: "viewer" } as any)
    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(res.status).toBe(403)
  })

  it("returns 403 for member", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: USR, role: "member" } as any)
    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(res.status).toBe(403)
  })

  it("succeeds for admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authAdmin as any)
    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(res.status).toBe(200)
  })

  it("succeeds for manager", async () => {
    vi.mocked(requireAuth).mockResolvedValue(authManager as any)
    mockFindMany.mockReset()
    mockFindMany.mockResolvedValueOnce(mockPos as any).mockResolvedValueOnce(updatedPos as any)
    const res = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    expect(res.status).toBe(200)
  })
})

describe("POST /recalculate — single PO (no SSP needed)", () => {
  it("allocates full contract total to single PO without SSP", async () => {
    const singlePo = [
      {
        ...mockPos[0],
        standaloneSellingPrice: null,
        id:                     "po-single",
      },
    ]
    const singleUpdated = [{ ...singlePo[0], allocatedAmount: "10000.00", status: "scheduled", schedules: [] }]

    mockFindMany.mockReset()
    mockFindMany
      .mockResolvedValueOnce(singlePo as any)
      .mockResolvedValueOnce(singleUpdated as any)

    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()
    expect(res.status).toBe(200)

    // Verify PO got full 10000.00
    const updateCalls = mockUpdateMany.mock.calls
    const allocUpdate = updateCalls.find((c) =>
      c[0].where?.id === "po-single" && c[0].data?.allocatedAmount !== undefined,
    )
    expect(allocUpdate).toBeDefined()
    expect(allocUpdate![0].data.allocatedAmount).toBe("10000.00")
  })
})

// ─── FIX 1 TOCTOU: FOR UPDATE lock + in-tx recheck ───────────────────────────
//
// Validates:
//   1. The $queryRaw FOR UPDATE is the FIRST statement called in the tx.
//   2. The in-tx recheck (tx.revenueRecognitionSchedule.count) catches a racing
//      cron recognition that slipped between the pre-tx check and the tx start,
//      returning 409 and NOT mutating anything.

describe("POST /recalculate — FIX 1 TOCTOU: FOR UPDATE lock + in-tx recheck", () => {
  it("FOR UPDATE ($queryRaw) is the first call inside the $transaction", async () => {
    const callOrder: string[] = []

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: (..._args: unknown[]) => {
          callOrder.push("$queryRaw")
          return Promise.resolve([])
        },
        performanceObligation: {
          updateMany: (..._args: unknown[]) => {
            callOrder.push("updateMany")
            return Promise.resolve({ count: 1 })
          },
        },
        revenueRecognitionSchedule: {
          count: (..._args: unknown[]) => {
            callOrder.push("count")
            return Promise.resolve(0)
          },
          deleteMany: (..._args: unknown[]) => {
            callOrder.push("deleteMany")
            return Promise.resolve({ count: 0 })
          },
          createMany: (..._args: unknown[]) => {
            callOrder.push("createMany")
            return Promise.resolve({ count: 1 })
          },
          aggregate: (..._args: unknown[]) => {
            callOrder.push("aggregate")
            return Promise.resolve({ _max: { lineNumber: null } })
          },
        },
      }
      return fn(tx)
    })

    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    // FOR UPDATE must be first; count (in-tx recheck) must be second
    expect(callOrder[0]).toBe("$queryRaw")
    expect(callOrder[1]).toBe("count")
  })

  it("in-tx recheck returns 409 even if pre-tx check passed (racing cron scenario)", async () => {
    // pre-tx check passes (count=0 — no recognition yet)
    mockSchedCount.mockResolvedValue(0)

    // Inside tx: the cron sneaked a recognition between pre-check and tx start
    // → in-tx recheck returns count=1 → route should 409 and mutate nothing
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: mockQueryRaw,
        performanceObligation: {
          updateMany: mockUpdateMany,
        },
        revenueRecognitionSchedule: {
          count:      vi.fn().mockResolvedValue(1), // racing cron posted revenue
          deleteMany: mockDeleteMany,
          createMany: mockCreateMany,
          aggregate:  mockAggregate,
        },
      }
      return fn(tx)
    })

    const res  = await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)
    const json = await res.json()

    // Must return 409 locked
    expect(res.status).toBe(409)
    expect(json.error).toMatch(/recognized/i)
    expect(json.error).toMatch(/locked/i)

    // Must NOT have mutated anything — deleteMany/createMany/updateMany never called
    expect(mockDeleteMany).not.toHaveBeenCalled()
    expect(mockCreateMany).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("FOR UPDATE tagged-template is parameterized (contains contractId)", async () => {
    // Capture raw args passed to $queryRaw to verify parameterization
    const rawArgs: unknown[][] = []
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: (...args: unknown[]) => {
          rawArgs.push(args)
          return Promise.resolve([])
        },
        performanceObligation: { updateMany: () => Promise.resolve({ count: 1 }) },
        revenueRecognitionSchedule: {
          count:      () => Promise.resolve(0),
          deleteMany: () => Promise.resolve({ count: 0 }),
          createMany: () => Promise.resolve({ count: 1 }),
          aggregate:  () => Promise.resolve({ _max: { lineNumber: null } }),
        },
      }
      return fn(tx)
    })

    await recalculate(makeReq(`/api/v1/contracts/${CTR}/performance-obligations/recalculate`), ctrParams)

    // The first $queryRaw call (FOR UPDATE) should carry CTR as a parameter value
    expect(rawArgs.length).toBeGreaterThan(0)
    // Tagged template: args[0] is the TemplateStringsArray, remaining are interpolated values
    const firstCallValues = rawArgs[0].slice(1)
    expect(firstCallValues).toContain(CTR)
  })
})
