import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Sales forecast survived the removal of the budgeting module: it is the Sales
// module's own surface (/settings/sales-forecast), it just happens to live
// under the /api/budgeting prefix. The forecast/expense-forecast/rolling blocks
// that shared this file went with the routes they covered.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesForecast: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { GET as getSalesForecast, POST as postSalesForecast } from "@/app/api/budgeting/sales-forecast/route"

function makeReq(url: string, opts?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), opts)
}

const ORG = "org-test-789"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/budgeting/sales-forecast", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await getSalesForecast(makeReq("http://localhost:3000/api/budgeting/sales-forecast?year=2026"))
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid year", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await getSalesForecast(makeReq("http://localhost:3000/api/budgeting/sales-forecast?year=1900"))
    expect(res.status).toBe(400)
  })

  it("returns sales forecast entries", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([
      { id: "sf1", departmentId: "d1", month: 1, year: 2026, amount: 10000, budgetDept: { id: "d1", key: "it", label: "IT" } },
    ] as any)

    const res = await getSalesForecast(makeReq("http://localhost:3000/api/budgeting/sales-forecast?year=2026"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
  })
})

describe("POST /api/budgeting/sales-forecast", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await postSalesForecast(makeReq("http://localhost:3000/api/budgeting/sales-forecast", {
      method: "POST",
      body: JSON.stringify({ year: 2026, entries: [{ departmentId: "d1", month: 1, amount: 5000 }] }),
    }))
    expect(res.status).toBe(401)
  })

  it("upserts sales forecast entries via $transaction", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.$transaction).mockResolvedValue([{ id: "sf-new" }] as any)

    const res = await postSalesForecast(makeReq("http://localhost:3000/api/budgeting/sales-forecast", {
      method: "POST",
      body: JSON.stringify({ year: 2026, entries: [{ departmentId: "d1", month: 1, amount: 8000 }] }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.count).toBe(1)
  })

  it("returns 400 on validation failure (empty entries)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await postSalesForecast(makeReq("http://localhost:3000/api/budgeting/sales-forecast", {
      method: "POST",
      body: JSON.stringify({ year: 2026, entries: [] }),
    }))
    expect(res.status).toBe(400)
  })
})
