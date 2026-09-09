import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  const getSession = vi.fn().mockResolvedValue(null)
  return {
    getOrgId,
    getSession,
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = (await getSession(req))?.orgId ?? await getOrgId(req)
      return orgId
        ? { orgId, userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})

import { GET, POST } from "@/app/api/v1/campaigns/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"

const sampleCampaign = {
  id: "camp-1",
  name: "Summer Sale",
  organizationId: "org-1",
  type: "email",
  status: "draft",
  description: "Summer promo",
  createdAt: new Date("2026-01-01"),
}

describe("Campaigns API — GET /api/v1/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/campaigns")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated campaigns list", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([sampleCampaign] as any)
    vi.mocked(prisma.campaign.count).mockResolvedValue(1)

    const req = new NextRequest("http://localhost/api/v1/campaigns?page=1&limit=10")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.campaigns).toHaveLength(1)
    expect(json.data.campaigns[0].name).toBe("Summer Sale")
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
  })

  it("passes search param to where clause", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([])
    vi.mocked(prisma.campaign.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/campaigns?search=Summer&page=2&limit=5")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.search).toBe("Summer")
    expect(json.data.page).toBe(2)
    expect(json.data.limit).toBe(5)

    const call = vi.mocked(prisma.campaign.findMany).mock.calls[0][0] as any
    expect(call.where).toHaveProperty("name")
    expect(call.where.name).toEqual({ contains: "Summer", mode: "insensitive" })
    expect(call.skip).toBe(5)
    expect(call.take).toBe(5)
  })

  it("filters by status param", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([])
    vi.mocked(prisma.campaign.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/campaigns?status=sent")
    const res = await GET(req)
    await res.json()

    const call = vi.mocked(prisma.campaign.findMany).mock.calls[0][0] as any
    expect(call.where.status).toBe("sent")
  })

  it("returns empty list when no campaigns match", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([])
    vi.mocked(prisma.campaign.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/campaigns")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.campaigns).toEqual([])
    expect(json.data.total).toBe(0)
  })

  it("uses default page=1 and limit=50 when not provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([])
    vi.mocked(prisma.campaign.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/campaigns")
    await GET(req)

    const call = vi.mocked(prisma.campaign.findMany).mock.calls[0][0] as any
    expect(call.skip).toBe(0)
    expect(call.take).toBe(50)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.findMany).mockRejectedValue(new Error("DB down"))

    const req = new NextRequest("http://localhost/api/v1/campaigns")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

describe("Campaigns API — POST /api/v1/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "New Campaign" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("does not create when campaigns:write authorization is denied", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    )

    const res = await POST(new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Blocked Campaign" }),
      headers: { "Content-Type": "application/json" },
    }))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "campaigns", "write")
    expect(prisma.campaign.create).not.toHaveBeenCalled()
  })

  it("creates a campaign with valid data and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "camp-new", name: "New Campaign", organizationId: "org-1" }
    vi.mocked(prisma.campaign.create).mockResolvedValue(created as any)

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "New Campaign", type: "email" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("New Campaign")
    expect(prisma.campaign.create).toHaveBeenCalledOnce()
  })

  it("passes organizationId to create", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.create).mockResolvedValue({ id: "c1" } as any)

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
      headers: { "Content-Type": "application/json" },
    })
    await POST(req)

    const call = vi.mocked(prisma.campaign.create).mock.calls[0][0] as any
    expect(call.data.organizationId).toBe("org-1")
    expect(call.data.name).toBe("Test")
  })

  it("returns 400 when name is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ type: "email" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.campaign.create).not.toHaveBeenCalled()
  })

  it("returns 400 when name is empty string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.campaign.create).not.toHaveBeenCalled()
  })

  it("rejects a negative campaign budget on create", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Unsafe Campaign", budget: -1 }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(prisma.campaign.create).not.toHaveBeenCalled()
  })

  it("returns 500 on internal error during creation", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.campaign.create).mockRejectedValue(new Error("DB error"))

    const req = new NextRequest("http://localhost/api/v1/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Fail Campaign" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})
