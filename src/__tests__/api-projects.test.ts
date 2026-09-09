import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(),
}))

import { GET, POST } from "@/app/api/v1/projects/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

const AUTH_OK = {
  orgId: "org-1",
  userId: "u-1",
  role: "admin" as const,
  email: "a@b.com",
  name: "Test",
}

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK)
  vi.mocked(isAuthError).mockImplementation((r) => r instanceof NextResponse)
})

// --------------- GET ---------------
describe("GET /api/v1/projects", () => {
  it("returns 401 when auth fails", async () => {
    const errResp = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireAuth).mockResolvedValue(errResp as any)

    const res = await GET(makeReq("http://localhost:3000/api/v1/projects"))

    expect(res.status).toBe(401)
    expect(prisma.project.findMany).not.toHaveBeenCalled()
  })

  it("returns projects with defaults (page=1, limit=50)", async () => {
    const projects = [{ id: "p1", name: "Alpha" }]
    vi.mocked(prisma.project.findMany).mockResolvedValue(projects as any)
    vi.mocked(prisma.project.count).mockResolvedValue(1)

    const res = await GET(makeReq("http://localhost:3000/api/v1/projects"))
    const json = await res.json()

    expect(json).toEqual({ success: true, data: { projects, total: 1, page: 1, limit: 50 } })
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 50,
        orderBy: { createdAt: "desc" },
        include: {
          company: { select: { id: true, name: true } },
          _count: { select: { tasks: true, members: true, milestones: true } },
        },
      })
    )
  })

  it("applies search filter (case insensitive)", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([])
    vi.mocked(prisma.project.count).mockResolvedValue(0)

    await GET(makeReq("http://localhost:3000/api/v1/projects?search=alpha"))

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: "alpha", mode: "insensitive" },
        }),
      })
    )
  })

  it("applies status, companyId, managerId filters", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([])
    vi.mocked(prisma.project.count).mockResolvedValue(0)

    await GET(
      makeReq(
        "http://localhost:3000/api/v1/projects?status=active&companyId=c-1&managerId=m-1"
      )
    )

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          status: "active",
          companyId: "c-1",
          managerId: "m-1",
        }),
      })
    )
  })

  it("respects page and limit params", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([])
    vi.mocked(prisma.project.count).mockResolvedValue(0)

    await GET(makeReq("http://localhost:3000/api/v1/projects?page=3&limit=10"))

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    )
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.project.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET(makeReq("http://localhost:3000/api/v1/projects"))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.success).toBe(false)
    expect(json.error).toBe("Internal server error")
  })
})

// --------------- POST ---------------
describe("POST /api/v1/projects", () => {
  it("returns 401 when auth fails", async () => {
    const errResp = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireAuth).mockResolvedValue(errResp as any)

    const res = await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      })
    )

    expect(res.status).toBe(401)
    expect(prisma.project.create).not.toHaveBeenCalled()
  })

  it("returns 400 when name is empty", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      })
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it("returns 400 when name exceeds 255 chars", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "x".repeat(256) }),
      })
    )

    expect(res.status).toBe(400)
  })

  it("rejects a negative project budget on create", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Unsafe", budget: -8 }),
      })
    )

    expect(res.status).toBe(400)
    expect(prisma.project.create).not.toHaveBeenCalled()
  })

  it("creates project with auto-generated code PRJ-001", async () => {
    vi.mocked(prisma.project.count).mockResolvedValue(0)
    vi.mocked(prisma.project.create).mockResolvedValue({ id: "p1", name: "New", code: "PRJ-001" } as any)

    const res = await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "New" }),
      })
    )

    expect(res.status).toBe(201)
    expect(prisma.project.count).toHaveBeenCalledWith({ where: { organizationId: "org-1" } })
    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: "PRJ-001", organizationId: "org-1" }),
      })
    )
  })

  it("uses provided code instead of auto-generating", async () => {
    vi.mocked(prisma.project.create).mockResolvedValue({ id: "p1", name: "X", code: "CUSTOM-1" } as any)

    await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "X", code: "CUSTOM-1" }),
      })
    )

    expect(prisma.project.count).not.toHaveBeenCalled()
    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: "CUSTOM-1" }),
      })
    )
  })

  it("converts startDate and endDate to Date objects", async () => {
    vi.mocked(prisma.project.count).mockResolvedValue(5)
    vi.mocked(prisma.project.create).mockResolvedValue({ id: "p1" } as any)

    await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "Dated",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        }),
      })
    )

    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-12-31"),
          code: "PRJ-006",
        }),
      })
    )
  })

  it("returns 500 on unexpected error", async () => {
    vi.mocked(prisma.project.count).mockResolvedValue(0)
    vi.mocked(prisma.project.create).mockRejectedValue(new Error("DB error"))

    const res = await POST(
      makeReq("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Fail" }),
      })
    )

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })
})
