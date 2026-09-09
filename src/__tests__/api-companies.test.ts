import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contact: { count: vi.fn() },
    task: { updateMany: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => {
  const getSession = vi.fn()
  const getOrgId = vi.fn()
  return {
    getSession,
    getOrgId,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const session = await getSession(req)
      if (session) return session
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((data) => data),
  filterWritableFields: vi.fn().mockImplementation((data) => data),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn().mockImplementation((_o, _u, _r, _e, where) => where),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

import { GET, POST } from "@/app/api/v1/companies/route"
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from "@/app/api/v1/companies/[id]/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId, requireAuth } from "@/lib/api-auth"

const mockSession = {
  orgId: "org-1",
  userId: "user-1",
  role: "admin",
  email: "a@b.com",
  name: "Test",
}

const sampleCompany = {
  id: "comp-1",
  name: "Acme Corp",
  organizationId: "org-1",
  industry: "Tech",
  website: "https://acme.com",
  phone: "+1234567890",
  email: "info@acme.com",
  address: "123 Main St",
  city: "Baku",
  country: "Azerbaijan",
  description: "A test company",
  status: "active",
  category: "client",
  _count: { contacts: 5, deals: 2, contracts: 1 },
  slaPolicy: null,
}

describe("Companies API — GET /api/v1/companies", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no session and no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/companies")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated companies list", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.findMany).mockResolvedValue([sampleCompany] as never)
    vi.mocked(prisma.company.count).mockResolvedValue(1)
    vi.mocked(prisma.company.aggregate).mockResolvedValue({
      _sum: { userCount: 10 },
      _count: 1,
    } as never)
    vi.mocked(prisma.contact.count).mockResolvedValue(25)

    const req = new NextRequest("http://localhost/api/v1/companies?page=1&limit=10")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.companies).toHaveLength(1)
    expect(json.data.companies[0].name).toBe("Acme Corp")
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
    expect(json.data.totalUsers).toBe(10)
    expect(json.data.totalContacts).toBe(25)
  })

  it("passes search param to findMany where clause", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.findMany).mockResolvedValue([])
    vi.mocked(prisma.company.count).mockResolvedValue(0)
    vi.mocked(prisma.company.aggregate).mockResolvedValue({
      _sum: { userCount: 0 },
      _count: 0,
    } as never)
    vi.mocked(prisma.contact.count).mockResolvedValue(0)

    const req = new NextRequest(
      "http://localhost/api/v1/companies?search=Acme&page=2&limit=5"
    )
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.search).toBe("Acme")
    expect(json.data.page).toBe(2)
    expect(json.data.limit).toBe(5)

    const findManyCall = vi.mocked(prisma.company.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      skip: number
      take: number
    }
    expect(findManyCall.where).toHaveProperty("name")
    expect(findManyCall.skip).toBe(5)
    expect(findManyCall.take).toBe(5)
  })

  it("returns empty list when no companies match", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.findMany).mockResolvedValue([])
    vi.mocked(prisma.company.count).mockResolvedValue(0)
    vi.mocked(prisma.company.aggregate).mockResolvedValue({
      _sum: { userCount: 0 },
      _count: 0,
    } as never)
    vi.mocked(prisma.contact.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/companies")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.companies).toEqual([])
    expect(json.data.total).toBe(0)
  })

  it("returns 500 on internal error", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.findMany).mockRejectedValue(new Error("DB down"))

    const req = new NextRequest("http://localhost/api/v1/companies")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

describe("Companies API — POST /api/v1/companies", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no session and no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: "New Corp" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("does not create when companies:write authorization is denied", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )

    const res = await POST(new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Blocked Corp" }),
      headers: { "Content-Type": "application/json" },
    }))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "companies", "write")
    expect(prisma.company.create).not.toHaveBeenCalled()
  })

  it("creates a company with valid data and returns 201", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    const created = { id: "comp-new", name: "New Corp", organizationId: "org-1" }
    vi.mocked(prisma.company.create).mockResolvedValue(created as never)

    const req = new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: "New Corp", industry: "SaaS" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("New Corp")
    expect(prisma.company.create).toHaveBeenCalledOnce()
  })

  it("returns 400 when name is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)

    const req = new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ industry: "Tech" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.company.create).not.toHaveBeenCalled()
  })

  it("returns 400 when name is empty string", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)

    const req = new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.company.create).not.toHaveBeenCalled()
  })

  it("rejects a negative credit limit on create", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)

    const req = new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Unsafe Corp", creditLimit: -1 }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(prisma.company.create).not.toHaveBeenCalled()
  })

  it("returns 500 on internal error during creation", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.create).mockRejectedValue(new Error("DB error"))

    const req = new NextRequest("http://localhost/api/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: "Fail Corp" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

describe("Companies API — GET /api/v1/companies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1")
    const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("returns company when found", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.findFirst).mockResolvedValue(sampleCompany as never)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1")
    const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Acme Corp")
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "comp-1", organizationId: "org-1" },
      })
    )
  })

  it("returns 404 when company not found", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/companies/nonexistent")
    const res = await GET_BY_ID(req, {
      params: Promise.resolve({ id: "nonexistent" }),
    })
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toBe("Not found")
  })
})

describe("Companies API — PUT /api/v1/companies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("updates a company with valid data", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.updateMany).mockResolvedValue({ count: 1 } as never)
    const updated = { ...sampleCompany, name: "Updated Corp" }
    vi.mocked(prisma.company.findFirst).mockResolvedValue(updated as never)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated Corp" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Updated Corp")
    expect(prisma.company.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "comp-1", organizationId: "org-1" },
      })
    )
  })

  it("returns 404 when company to update not found", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)
    vi.mocked(prisma.company.updateMany).mockResolvedValue({ count: 0 } as never)

    const req = new NextRequest("http://localhost/api/v1/companies/nonexistent", {
      method: "PUT",
      body: JSON.stringify({ name: "Ghost" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await PUT(req, {
      params: Promise.resolve({ id: "nonexistent" }),
    })
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toBe("Not found")
  })

  it("returns 400 for invalid update data", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1", {
      method: "PUT",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.company.updateMany).not.toHaveBeenCalled()
  })

  it("rejects an overflow-style credit limit on update", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1", {
      method: "PUT",
      body: JSON.stringify({ creditLimit: 1_000_000_000_000 }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "comp-1" }) })

    expect(res.status).toBe(400)
    expect(prisma.company.updateMany).not.toHaveBeenCalled()
  })
})

describe("Companies API — DELETE /api/v1/companies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 } as never)
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1", {
      method: "DELETE",
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("deletes a company and returns deleted id", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      name: "Acme Corp",
    } as never)
    vi.mocked(prisma.company.deleteMany).mockResolvedValue({ count: 1 } as never)

    const req = new NextRequest("http://localhost/api/v1/companies/comp-1", {
      method: "DELETE",
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: "comp-1" }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("comp-1")
    expect(prisma.company.deleteMany).toHaveBeenCalledWith({
      where: { id: "comp-1", organizationId: "org-1" },
    })
  })

  it("returns 404 when company to delete not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.company.deleteMany).mockResolvedValue({ count: 0 } as never)

    const req = new NextRequest("http://localhost/api/v1/companies/nonexistent", {
      method: "DELETE",
    })
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "nonexistent" }),
    })
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toBe("Not found")
  })
})
