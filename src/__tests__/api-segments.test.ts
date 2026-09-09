import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contactSegment: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      count: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  // segments routes are getOrgId-only withRls handlers; withRls calls getSession
  // first, so default it to null to fall through to getOrgId (clearAllMocks keeps
  // this impl; no global mockReset configured).
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/segment-conditions", () => ({
  buildContactWhere: vi.fn().mockReturnValue({ organizationId: "org-1" }),
}))

import { GET, POST } from "@/app/api/v1/segments/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { buildContactWhere } from "@/lib/segment-conditions"

const staticSegment = {
  id: "seg-1",
  name: "VIP Clients",
  organizationId: "org-1",
  isDynamic: false,
  contactCount: 10,
  conditions: null,
  createdAt: new Date("2026-01-01"),
}

const dynamicSegment = {
  id: "seg-2",
  name: "Active Users",
  organizationId: "org-1",
  isDynamic: true,
  contactCount: 5,
  conditions: { field: "status", operator: "eq", value: "active" },
  createdAt: new Date("2026-01-02"),
}

describe("Segments API — GET /api/v1/segments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/segments")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated segments list", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([staticSegment] as any)
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(1)

    const req = new NextRequest("http://localhost/api/v1/segments?page=1&limit=10")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.segments).toHaveLength(1)
    expect(json.data.segments[0].name).toBe("VIP Clients")
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
  })

  it("passes search param to where clause", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([])
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/segments?search=VIP&page=2&limit=5")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.search).toBe("VIP")

    const call = vi.mocked(prisma.contactSegment.findMany).mock.calls[0][0] as any
    expect(call.where.name).toEqual({ contains: "VIP", mode: "insensitive" })
    expect(call.skip).toBe(5)
    expect(call.take).toBe(5)
  })

  it("does not recalculate contactCount for static segments", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([staticSegment] as any)
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(1)

    const req = new NextRequest("http://localhost/api/v1/segments")
    const res = await GET(req)
    const json = await res.json()

    expect(json.data.segments[0].contactCount).toBe(10)
    expect(buildContactWhere).not.toHaveBeenCalled()
    expect(prisma.contact.count).not.toHaveBeenCalled()
  })

  it("recalculates contactCount for dynamic segments using buildContactWhere", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([dynamicSegment] as any)
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(1)
    vi.mocked(prisma.contact.count).mockResolvedValue(42)
    vi.mocked(prisma.contactSegment.update).mockResolvedValue({} as any)

    const req = new NextRequest("http://localhost/api/v1/segments")
    const res = await GET(req)
    const json = await res.json()

    expect(buildContactWhere).toHaveBeenCalledWith("org-1", dynamicSegment.conditions)
    expect(prisma.contact.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
    })
    expect(json.data.segments[0].contactCount).toBe(42)
  })

  it("fires update when dynamic segment contactCount changes", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([dynamicSegment] as any)
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(1)
    vi.mocked(prisma.contact.count).mockResolvedValue(99)
    vi.mocked(prisma.contactSegment.update).mockResolvedValue({} as any)

    const req = new NextRequest("http://localhost/api/v1/segments")
    await GET(req)

    // fire-and-forget update since 99 !== 5
    expect(prisma.contactSegment.update).toHaveBeenCalledWith({
      where: { id: "seg-2" },
      data: { contactCount: 99 },
    })
  })

  it("does not fire update when dynamic count is unchanged", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const segSameCount = { ...dynamicSegment, contactCount: 42 }
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([segSameCount] as any)
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(1)
    vi.mocked(prisma.contact.count).mockResolvedValue(42)

    const req = new NextRequest("http://localhost/api/v1/segments")
    await GET(req)

    expect(prisma.contactSegment.update).not.toHaveBeenCalled()
  })

  it("returns empty list when no segments match", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockResolvedValue([])
    vi.mocked(prisma.contactSegment.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/segments")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.segments).toEqual([])
    expect(json.data.total).toBe(0)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findMany).mockRejectedValue(new Error("DB down"))

    const req = new NextRequest("http://localhost/api/v1/segments")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

describe("Segments API — POST /api/v1/segments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/segments", {
      method: "POST",
      body: JSON.stringify({ name: "New Segment" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("creates a segment with valid data and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "seg-new", name: "New Segment", organizationId: "org-1" }
    vi.mocked(prisma.contactSegment.create).mockResolvedValue(created as any)

    const req = new NextRequest("http://localhost/api/v1/segments", {
      method: "POST",
      body: JSON.stringify({ name: "New Segment", isDynamic: true }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("New Segment")
    expect(prisma.contactSegment.create).toHaveBeenCalledOnce()
  })

  it("returns 400 when name is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/segments", {
      method: "POST",
      body: JSON.stringify({ isDynamic: true }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.contactSegment.create).not.toHaveBeenCalled()
  })

  it("returns 400 when name is empty string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/segments", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.contactSegment.create).not.toHaveBeenCalled()
  })

  it("returns 500 on internal error during creation", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.create).mockRejectedValue(new Error("DB error"))

    const req = new NextRequest("http://localhost/api/v1/segments", {
      method: "POST",
      body: JSON.stringify({ name: "Fail Segment" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})
