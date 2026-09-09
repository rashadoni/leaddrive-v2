import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// What is left of the budgeting API after the module was removed: the Sales
// module's /settings/sales-forecast page calls /api/budgeting/departments, so
// this route outlives the rest of /api/budgeting. Its sibling tests (actuals,
// templates, exchange-rates, analytics) went with the routes they covered.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetDepartment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { GET as getDepartments, POST as postDepartments, PUT as putDepartments, DELETE as deleteDepartments } from "@/app/api/budgeting/departments/route"

function makeReq(url: string, opts?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), opts)
}

const ORG = "org-test-789"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/budgeting/departments", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await getDepartments(makeReq("http://localhost:3000/api/budgeting/departments"))
    expect(res.status).toBe(401)
  })

  it("returns active departments by default", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.findMany).mockResolvedValue([
      { id: "d1", key: "it", label: "IT", isActive: true, sortOrder: 0 },
    ] as any)

    const res = await getDepartments(makeReq("http://localhost:3000/api/budgeting/departments"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    // Should filter active-only
    expect(prisma.budgetDepartment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    )
  })

  it("includes inactive departments when requested", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.findMany).mockResolvedValue([] as any)

    await getDepartments(makeReq("http://localhost:3000/api/budgeting/departments?includeInactive=true"))
    expect(prisma.budgetDepartment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ isActive: true }),
      }),
    )
  })
})

describe("POST /api/budgeting/departments", () => {
  it("returns 409 when key already exists", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.findUnique).mockResolvedValue({ id: "d-existing" } as any)

    const res = await postDepartments(makeReq("http://localhost:3000/api/budgeting/departments", {
      method: "POST",
      body: JSON.stringify({ key: "it", label: "IT" }),
    }))
    expect(res.status).toBe(409)
  })

  it("creates a new department", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.findUnique).mockResolvedValue(null as any)
    vi.mocked(prisma.budgetDepartment.create).mockResolvedValue({ id: "d-new", key: "sec", label: "Security" } as any)

    const res = await postDepartments(makeReq("http://localhost:3000/api/budgeting/departments", {
      method: "POST",
      body: JSON.stringify({ key: "sec", label: "Security", hasRevenue: false }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

describe("PUT /api/budgeting/departments", () => {
  it("updates a department", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.update).mockResolvedValue({ id: "d1", label: "IT Dept Updated" } as any)

    const res = await putDepartments(makeReq("http://localhost:3000/api/budgeting/departments", {
      method: "PUT",
      body: JSON.stringify({ id: "d1", label: "IT Dept Updated" }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

describe("DELETE /api/budgeting/departments (soft delete)", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await deleteDepartments(makeReq("http://localhost:3000/api/budgeting/departments?id=d1", { method: "DELETE" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when id is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await deleteDepartments(makeReq("http://localhost:3000/api/budgeting/departments", { method: "DELETE" }))
    expect(res.status).toBe(400)
  })

  it("soft-deletes a department (sets isActive=false)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.budgetDepartment.update).mockResolvedValue({ id: "d1", isActive: false } as any)

    const res = await deleteDepartments(makeReq("http://localhost:3000/api/budgeting/departments?id=d1", { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(prisma.budgetDepartment.update).toHaveBeenCalledWith({
      where: { id: "d1", organizationId: ORG },
      data: { isActive: false },
    })
  })
})
