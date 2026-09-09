/**
 * C9 attribution-models route tests.
 *
 * Focuses on the Decimal-normalization regression guard: the route reads
 * `campaignInfluence.groupBy._sum.attributedRevenue` which returns a
 * Prisma.Decimal object after the Float→Decimal migration. A bare `?? 0`
 * would pass the Decimal object through (it is truthy), serializing as the
 * Prisma string "1234.5600" instead of the number 1234.56 in the JSON
 * response. `decimalToNumber()` fixes this.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ── mocks ──────────────────────────────────────────────────────────────── */

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn().mockResolvedValue("org-1"),
  // GET migrated to withRls, which resolves getSession(req) ?? getOrgId(req).
  // Default getSession→null so withRls falls through to the getOrgId mock above.
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attributionModel:          { findMany: vi.fn() },
    attributionCalculationRun: { findFirst: vi.fn() },
    campaignInfluence:         { groupBy: vi.fn() },
    campaignTouchpoint:        { count: vi.fn() },
  },
}))

import { GET } from "@/app/api/v1/attribution-models/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

const MODEL = "model-1"

function makeReq(url: string): NextRequest {
  return new NextRequest(url)
}

function modelRow(overrides = {}) {
  return {
    id: MODEL,
    name: "Linear",
    description: null,
    modelType: "linear",
    config: {},
    status: "active",
    isDefault: true,
    archivedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

/* ── tests ──────────────────────────────────────────────────────────────── */

describe("GET /api/v1/attribution-models", () => {
  it("returns 401 when org not resolved", async () => {
    vi.mocked(getOrgId).mockResolvedValueOnce(null)
    const res = await GET(makeReq("http://localhost/api/v1/attribution-models"))
    expect(res.status).toBe(401)
  })

  it("returns 500 on DB error (bare error envelope, no success:true swallow)", async () => {
    vi.mocked(prisma.attributionModel.findMany).mockRejectedValue(new Error("DB down"))
    const res = await GET(makeReq("http://localhost/api/v1/attribution-models"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBeDefined()
    expect(json.success).toBeUndefined()
  })

  it("returns empty list when org has no models", async () => {
    vi.mocked(prisma.attributionModel.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.campaignInfluence.groupBy).mockResolvedValue([] as never)
    vi.mocked(prisma.campaignTouchpoint.count).mockResolvedValue(0)
    const res = await GET(makeReq("http://localhost/api/v1/attribution-models"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.models).toEqual([])
  })

  it("Decimal-normalization: attributedRevenue from _sum is a JS number, not a Decimal string", async () => {
    // Simulate what Prisma.groupBy returns for a Decimal column: an object with
    // .toNumber() — NOT a primitive number. Without decimalToNumber(), the value
    // would serialize as "1234.5600" (Decimal.toString()) — a string.
    const decimalMock = { toNumber: () => 1234.56, toString: () => "1234.5600" }

    vi.mocked(prisma.attributionModel.findMany).mockResolvedValue([modelRow()] as never)
    vi.mocked(pr.attributionCalculationRun.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.campaignInfluence.groupBy).mockResolvedValue([
      {
        modelId: MODEL,
        _count: { _all: 42 },
        _sum: { attributedRevenue: decimalMock },
      },
    ] as never)
    vi.mocked(prisma.campaignTouchpoint.count).mockResolvedValue(100)

    const res = await GET(makeReq("http://localhost/api/v1/attribution-models"))
    expect(res.status).toBe(200)
    const json = await res.json()
    const m = json.models[0]

    // Core regression guard: attributedRevenue must be a number in the response
    expect(typeof m.attributedRevenue).toBe("number")
    expect(m.attributedRevenue).toBe(1234.56)
    expect(m.influenceCount).toBe(42)
  })

  it("Decimal-normalization: null _sum (no influences) → attributedRevenue === 0", async () => {
    // Prisma returns null for _sum when there are no matching rows
    vi.mocked(prisma.attributionModel.findMany).mockResolvedValue([modelRow()] as never)
    vi.mocked(pr.attributionCalculationRun.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.campaignInfluence.groupBy).mockResolvedValue([
      {
        modelId: MODEL,
        _count: { _all: 0 },
        _sum: { attributedRevenue: null },
      },
    ] as never)
    vi.mocked(prisma.campaignTouchpoint.count).mockResolvedValue(0)

    const res = await GET(makeReq("http://localhost/api/v1/attribution-models"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.models[0].attributedRevenue).toBe(0)
    expect(typeof json.models[0].attributedRevenue).toBe("number")
  })
})
