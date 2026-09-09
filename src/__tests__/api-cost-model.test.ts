import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    costEmployee: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    overheadCost: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pricingParameters: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    company: {
      aggregate: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof Response || (r && r.status !== undefined && typeof r.json === "function" && !r.orgId)),
}))

vi.mock("@/lib/cost-model/db", () => ({
  writeCostModelLog: vi.fn().mockResolvedValue(undefined),
  invalidateAiCache: vi.fn(),
  loadAndCompute: vi.fn(),
}))

vi.mock("@/lib/cost-model/types", () => ({
  isValidDepartment: vi.fn().mockReturnValue(true),
  isKnownOverheadCategory: vi.fn().mockReturnValue(true),
  isValidServiceType: vi.fn().mockReturnValue(true),
  INCOME_TAX_RATE: 0.14,
  DEPARTMENTS: ["dev", "qa", "pm", "design", "admin"],
}))

import { GET as GET_EMPLOYEES, POST as POST_EMPLOYEE } from "@/app/api/cost-model/employees/route"
import { PUT as PUT_EMPLOYEE, DELETE as DELETE_EMPLOYEE } from "@/app/api/cost-model/employees/[id]/route"
import { GET as GET_OVERHEAD, POST as POST_OVERHEAD } from "@/app/api/cost-model/overhead/route"
import { PUT as PUT_OVERHEAD, DELETE as DELETE_OVERHEAD } from "@/app/api/cost-model/overhead/[id]/route"
import { GET as GET_PARAMS, PUT as PUT_PARAMS } from "@/app/api/cost-model/parameters/route"
import { GET as GET_ANALYTICS } from "@/app/api/cost-model/analytics/route"
import { GET as GET_CLIENT_COSTS } from "@/app/api/cost-model/client-costs/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { loadAndCompute } from "@/lib/cost-model/db"
import { isValidDepartment, isKnownOverheadCategory } from "@/lib/cost-model/types"

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── EMPLOYEES ───────────────────────────────────────────────────────

describe("GET /api/cost-model/employees", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_EMPLOYEES(makeRequest("/api/cost-model/employees"))
    expect(res.status).toBe(401)
  })

  it("returns list of employees", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const employees = [{ id: "e1", department: "dev", position: "Senior Dev" }]
    vi.mocked(prisma.costEmployee.findMany).mockResolvedValue(employees as any)

    const res = await GET_EMPLOYEES(makeRequest("/api/cost-model/employees"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(employees)
    expect(prisma.costEmployee.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { department: "asc" },
    })
  })
})

describe("POST /api/cost-model/employees", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await POST_EMPLOYEE(makeRequest("/api/cost-model/employees", {
      method: "POST",
      body: JSON.stringify({ department: "dev", position: "Dev" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when department or position missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST_EMPLOYEE(makeRequest("/api/cost-model/employees", {
      method: "POST",
      body: JSON.stringify({ department: "dev" }),
    }))
    expect(res.status).toBe(400)
  })

  it("returns 409 on duplicate department+position", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.costEmployee.findFirst).mockResolvedValue({ id: "dup" } as any)

    const res = await POST_EMPLOYEE(makeRequest("/api/cost-model/employees", {
      method: "POST",
      body: JSON.stringify({ department: "dev", position: "Dev", netSalary: 1000 }),
    }))
    expect(res.status).toBe(409)
  })

  it("creates employee with salary calculations", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.costEmployee.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.pricingParameters.findUnique).mockResolvedValue({ employerTaxRate: 0.175 } as any)
    const created = { id: "e2", department: "dev", position: "Dev", netSalary: 1000 }
    vi.mocked(prisma.costEmployee.create).mockResolvedValue(created as any)

    const res = await POST_EMPLOYEE(makeRequest("/api/cost-model/employees", {
      method: "POST",
      body: JSON.stringify({ department: "dev", position: "Dev", netSalary: 1000 }),
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // Verify salary calculation: gross = 1000 / (1 - 0.14), superGross = gross * 1.175
    const expectedGross = 1000 / (1 - 0.14)
    const expectedSuperGross = expectedGross * 1.175
    const createCall = vi.mocked(prisma.costEmployee.create).mock.calls[0][0]
    expect(createCall.data.grossSalary).toBeCloseTo(expectedGross, 2)
    expect(createCall.data.superGross).toBeCloseTo(expectedSuperGross, 2)
  })
})

describe("PUT /api/cost-model/employees/[id]", () => {
  it("returns auth error when requireAuth fails", async () => {
    const authError = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    vi.mocked(requireAuth).mockResolvedValue(authError as any)

    const res = await PUT_EMPLOYEE(
      makeRequest("/api/cost-model/employees/e1", { method: "PUT", body: JSON.stringify({ position: "Lead" }) }),
      makeParams("e1"),
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when employee not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.costEmployee.findFirst).mockResolvedValue(null)

    const res = await PUT_EMPLOYEE(
      makeRequest("/api/cost-model/employees/e1", { method: "PUT", body: JSON.stringify({ position: "Lead" }) }),
      makeParams("e1"),
    )
    expect(res.status).toBe(404)
  })

  it("updates employee successfully", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.costEmployee.findFirst).mockResolvedValue({ id: "e1", netSalary: 1000 } as any)
    vi.mocked(prisma.costEmployee.update).mockResolvedValue({ id: "e1", position: "Lead" } as any)

    const res = await PUT_EMPLOYEE(
      makeRequest("/api/cost-model/employees/e1", { method: "PUT", body: JSON.stringify({ position: "Lead" }) }),
      makeParams("e1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })
})

describe("DELETE /api/cost-model/employees/[id]", () => {
  it("returns 404 when employee not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.costEmployee.findFirst).mockResolvedValue(null)

    const res = await DELETE_EMPLOYEE(
      makeRequest("/api/cost-model/employees/e1", { method: "DELETE" }),
      makeParams("e1"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes employee successfully", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.costEmployee.findFirst).mockResolvedValue({ id: "e1" } as any)
    vi.mocked(prisma.costEmployee.delete).mockResolvedValue({} as any)

    const res = await DELETE_EMPLOYEE(
      makeRequest("/api/cost-model/employees/e1", { method: "DELETE" }),
      makeParams("e1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("e1")
  })
})

// ─── OVERHEAD ────────────────────────────────────────────────────────

describe("GET /api/cost-model/overhead", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_OVERHEAD(makeRequest("/api/cost-model/overhead"))
    expect(res.status).toBe(401)
  })

  it("returns overhead costs sorted by sortOrder", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const items = [{ id: "o1", category: "office", label: "Rent", amount: 2000 }]
    vi.mocked(prisma.overheadCost.findMany).mockResolvedValue(items as any)

    const res = await GET_OVERHEAD(makeRequest("/api/cost-model/overhead"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(items)
    expect(prisma.overheadCost.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { sortOrder: "asc" },
    })
  })
})

describe("POST /api/cost-model/overhead", () => {
  it("returns 400 when category or label missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST_OVERHEAD(makeRequest("/api/cost-model/overhead", {
      method: "POST",
      body: JSON.stringify({ category: "office" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates overhead cost item", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const item = { id: "o2", category: "office", label: "Internet", amount: 100 }
    vi.mocked(prisma.overheadCost.create).mockResolvedValue(item as any)

    const res = await POST_OVERHEAD(makeRequest("/api/cost-model/overhead", {
      method: "POST",
      body: JSON.stringify({ category: "office", label: "Internet", amount: 100 }),
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(item)
  })
})

describe("DELETE /api/cost-model/overhead/[id]", () => {
  it("deletes overhead cost item", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.overheadCost.findFirst).mockResolvedValue({ id: "o1" } as any)
    vi.mocked(prisma.overheadCost.delete).mockResolvedValue({} as any)

    const res = await DELETE_OVERHEAD(
      makeRequest("/api/cost-model/overhead/o1", { method: "DELETE" }),
      makeParams("o1"),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.deleted).toBe("o1")
  })
})

// ─── PARAMETERS ──────────────────────────────────────────────────────

describe("GET /api/cost-model/parameters", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_PARAMS(makeRequest("/api/cost-model/parameters"))
    expect(res.status).toBe(401)
  })

  it("returns pricing parameters", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const params = { id: "p1", vatRate: 0.18, employerTaxRate: 0.175 }
    vi.mocked(prisma.pricingParameters.findUnique).mockResolvedValue(params as any)

    const res = await GET_PARAMS(makeRequest("/api/cost-model/parameters"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual(params)
  })
})

describe("PUT /api/cost-model/parameters", () => {
  it("upserts parameters with validation", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "admin" } as any)
    vi.mocked(prisma.pricingParameters.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.company.aggregate).mockResolvedValue({ _sum: { userCount: 50 } } as any)
    const updated = { id: "p1", vatRate: 0.18, monthlyWorkHours: 160 }
    vi.mocked(prisma.pricingParameters.upsert).mockResolvedValue(updated as any)

    const res = await PUT_PARAMS(makeRequest("/api/cost-model/parameters", {
      method: "PUT",
      body: JSON.stringify({ vatRate: 0.18, monthlyWorkHours: 160 }),
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(prisma.pricingParameters.upsert).toHaveBeenCalled()
  })
})

// ─── ANALYTICS & CLIENT COSTS ────────────────────────────────────────

describe("GET /api/cost-model/analytics", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET_ANALYTICS(makeRequest("/api/cost-model/analytics"))
    expect(res.status).toBe(401)
  })

  it("returns computed analytics data", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const result = { totalCost: 50000, hourlyRate: 25 }
    vi.mocked(loadAndCompute).mockResolvedValue(result as any)

    const res = await GET_ANALYTICS(makeRequest("/api/cost-model/analytics"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(result)
    expect(loadAndCompute).toHaveBeenCalledWith("org-1")
  })
})

describe("GET /api/cost-model/client-costs", () => {
  it("returns only clients portion of analytics", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const clients = [{ companyName: "Acme", monthlyCost: 5000 }]
    vi.mocked(loadAndCompute).mockResolvedValue({ clients, totalCost: 50000 } as any)

    const res = await GET_CLIENT_COSTS(makeRequest("/api/cost-model/client-costs"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(clients)
  })
})
