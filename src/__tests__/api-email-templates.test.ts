import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailTemplate: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from "@/app/api/v1/email-templates/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const sampleTemplate = {
  id: "tpl-1",
  name: "Welcome Email",
  subject: "Welcome to our platform",
  organizationId: "org-1",
  htmlBody: "<h1>Welcome</h1>",
  textBody: "Welcome",
  category: "onboarding",
  isActive: true,
  createdAt: new Date("2026-01-01"),
}

describe("Email Templates API — GET /api/v1/email-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/email-templates")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated templates list", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockResolvedValue([sampleTemplate] as any)
    vi.mocked(prisma.emailTemplate.count).mockResolvedValue(1)

    const req = new NextRequest("http://localhost/api/v1/email-templates?page=1&limit=10")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.templates).toHaveLength(1)
    expect(json.data.templates[0].name).toBe("Welcome Email")
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
  })

  it("passes search param to where clause", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockResolvedValue([])
    vi.mocked(prisma.emailTemplate.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/email-templates?search=Welcome&page=2&limit=5")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.search).toBe("Welcome")

    const call = vi.mocked(prisma.emailTemplate.findMany).mock.calls[0][0] as any
    expect(call.where.name).toEqual({ contains: "Welcome", mode: "insensitive" })
    expect(call.skip).toBe(5)
    expect(call.take).toBe(5)
  })

  it("filters by category param", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockResolvedValue([])
    vi.mocked(prisma.emailTemplate.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/email-templates?category=onboarding")
    await GET(req)

    const call = vi.mocked(prisma.emailTemplate.findMany).mock.calls[0][0] as any
    expect(call.where.category).toBe("onboarding")
  })

  it("does not include category in where when not provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockResolvedValue([])
    vi.mocked(prisma.emailTemplate.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/email-templates")
    await GET(req)

    const call = vi.mocked(prisma.emailTemplate.findMany).mock.calls[0][0] as any
    expect(call.where).not.toHaveProperty("category")
  })

  it("returns empty list when no templates match", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockResolvedValue([])
    vi.mocked(prisma.emailTemplate.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/email-templates")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.templates).toEqual([])
    expect(json.data.total).toBe(0)
  })

  it("uses default page=1 and limit=50 when not provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockResolvedValue([])
    vi.mocked(prisma.emailTemplate.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/email-templates")
    await GET(req)

    const call = vi.mocked(prisma.emailTemplate.findMany).mock.calls[0][0] as any
    expect(call.skip).toBe(0)
    expect(call.take).toBe(50)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.findMany).mockRejectedValue(new Error("DB down"))

    const req = new NextRequest("http://localhost/api/v1/email-templates")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})

describe("Email Templates API — POST /api/v1/email-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ name: "New Template", subject: "Hello" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("creates a template with valid data and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "tpl-new", name: "New Template", subject: "Hello", organizationId: "org-1" }
    vi.mocked(prisma.emailTemplate.create).mockResolvedValue(created as any)

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ name: "New Template", subject: "Hello", htmlBody: "<p>Hi</p>" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("New Template")
    expect(prisma.emailTemplate.create).toHaveBeenCalledOnce()
  })

  it("returns 400 when name is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ subject: "Hello" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.emailTemplate.create).not.toHaveBeenCalled()
  })

  it("returns 400 when name is empty string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ name: "", subject: "Hello" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.emailTemplate.create).not.toHaveBeenCalled()
  })

  it("returns 400 when subject is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Template" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.emailTemplate.create).not.toHaveBeenCalled()
  })

  it("returns 400 when subject is empty string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Template", subject: "" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.emailTemplate.create).not.toHaveBeenCalled()
  })

  it("returns 500 on internal error during creation", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.emailTemplate.create).mockRejectedValue(new Error("DB error"))

    const req = new NextRequest("http://localhost/api/v1/email-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Fail Template", subject: "Oops" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
  })
})
