import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetPlan: { findFirst: vi.fn() },
    budgetLine: { findMany: vi.fn() },
    budgetActual: { findMany: vi.fn() },
    budgetForecastEntry: { findMany: vi.fn() },
    budgetDepartment: { findMany: vi.fn() },
    salesForecast: { findMany: vi.fn(), upsert: vi.fn() },
    pricingProfile: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/cost-model/db", () => ({
  loadAndCompute: vi.fn(() => Promise.resolve(null)),
}))

vi.mock("exceljs", () => {
  const addRowFn = vi.fn(() => ({
    font: {},
    fill: {},
    eachCell: vi.fn(),
    getCell: vi.fn(() => ({ numFmt: "", font: {}, fill: {}, value: 0 })),
  }))
  const getRowFn = vi.fn(() => ({
    height: 0,
    font: {},
    fill: {},
    eachCell: vi.fn(),
    getCell: vi.fn(() => ({ numFmt: "", font: {}, fill: {}, value: 0 })),
  }))
  const getColumnFn = vi.fn(() => ({ width: 0, numFmt: "" }))
  const getCell = vi.fn(() => ({ numFmt: "", font: {}, fill: {}, value: 0 }))

  class MockWorkbook {
    xlsx = {
      writeBuffer: vi.fn(() => Promise.resolve(Buffer.from("fake-xlsx"))),
      load: vi.fn(),
    }
    worksheets: any[] = []
    addWorksheet = vi.fn(() => ({
      addRow: addRowFn,
      getRow: getRowFn,
      getColumn: getColumnFn,
      getCell,
      views: [],
      autoFilter: null,
      columns: [],
    }))
  }

  return {
    default: { Workbook: MockWorkbook },
  }
})

vi.mock("@/lib/pricing-export", () => ({
  generateTemplate1: vi.fn(() => Promise.resolve(Buffer.from("template1"))),
  generateTemplate2: vi.fn(() => Promise.resolve(Buffer.from("template2"))),
  generateBudgetPL: vi.fn(() => Promise.resolve(Buffer.from("budget-pl"))),
}))

vi.mock("fs", () => ({
  default: { readFileSync: vi.fn(() => "{}") },
  readFileSync: vi.fn(() => "{}"),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const ORG = "org-1"

function makeReq(url: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method })
}

function makeJsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// Budgeting Export (GET)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Sales Forecast Export (GET)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/budgeting/sales-forecast/export", () => {
  let GET: typeof import("@/app/api/budgeting/sales-forecast/export/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/budgeting/sales-forecast/export/route")).GET })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET(makeReq("/api/budgeting/sales-forecast/export"))
    expect(res.status).toBe(401)
  })

  it("returns xlsx file with correct content-type", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.findMany).mockResolvedValue([
      { id: "d1", label: "Service A", hasRevenue: true, isActive: true, sortOrder: 0 },
    ] as any)
    vi.mocked(prisma.salesForecast.findMany).mockResolvedValue([])

    const res = await GET(makeReq("/api/budgeting/sales-forecast/export?year=2026"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toContain("sales-forecast-2026.xlsx")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Sales Forecast Import (POST)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/budgeting/sales-forecast/import", () => {
  let POST: typeof import("@/app/api/budgeting/sales-forecast/import/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/budgeting/sales-forecast/import/route")).POST })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const form = new FormData()
    form.append("file", new Blob(["test"]), "test.xlsx")
    const req = new NextRequest(new URL("http://localhost:3000/api/budgeting/sales-forecast/import"), { method: "POST", body: form })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 when file missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const form = new FormData()
    const req = new NextRequest(new URL("http://localhost:3000/api/budgeting/sales-forecast/import"), { method: "POST", body: form })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("file required")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Pricing Export (POST)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/pricing/export", () => {
  let POST: typeof import("@/app/api/v1/pricing/export/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/pricing/export/route")).POST })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST(makeJsonReq("/api/v1/pricing/export", { template: "1" }))
    expect(res.status).toBe(401)
  })

  it("returns xlsx with template 1", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.pricingProfile.findMany).mockResolvedValue([])
    const res = await POST(makeJsonReq("/api/v1/pricing/export", { template: "1" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toContain("SALES_2026.xlsx")
  })

  it("returns xlsx with template 2", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.pricingProfile.findMany).mockResolvedValue([])
    const res = await POST(makeJsonReq("/api/v1/pricing/export", { template: "2" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toContain("SALES_Report.xlsx")
  })

  it("returns budget PL with template 3", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.pricingProfile.findMany).mockResolvedValue([])
    const res = await POST(makeJsonReq("/api/v1/pricing/export", { template: "budget" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toContain("Budget_PL.xlsx")
  })
})
