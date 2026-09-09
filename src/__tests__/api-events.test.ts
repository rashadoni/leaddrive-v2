import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  // events routes are getOrgId-only withRls handlers; withRls calls getSession
  // first, so default it to null to fall through to getOrgId (clearAllMocks keeps
  // this impl; no global mockReset configured).
  getSession: vi.fn().mockResolvedValue(null),
}))

import { GET, POST } from "@/app/api/v1/events/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const sampleEvent = {
  id: "evt-1",
  name: "Tech Conference 2026",
  organizationId: "org-1",
  type: "conference",
  status: "planned",
  startDate: new Date("2026-06-15"),
  endDate: new Date("2026-06-17"),
  location: "Baku",
  isOnline: false,
  budget: 5000,
  _count: { participants: 50 },
  createdAt: new Date("2026-01-01"),
}

describe("Events API — GET /api/v1/events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/events")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("returns paginated events with _count.participants", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.findMany).mockResolvedValue([sampleEvent] as any)
    vi.mocked(prisma.event.count).mockResolvedValue(1)

    const req = new NextRequest("http://localhost/api/v1/events?page=1&limit=10")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.events).toHaveLength(1)
    expect(json.data.events[0].name).toBe("Tech Conference 2026")
    expect(json.data.events[0]._count.participants).toBe(50)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(10)
  })

  it("includes _count.participants in findMany query", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.findMany).mockResolvedValue([])
    vi.mocked(prisma.event.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/events")
    await GET(req)

    const call = vi.mocked(prisma.event.findMany).mock.calls[0][0] as any
    expect(call.include).toEqual({ _count: { select: { participants: true } } })
    expect(call.orderBy).toEqual({ startDate: "desc" })
  })

  it("returns 400 for NaN page", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events?page=abc")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Invalid page or limit")
    expect(prisma.event.findMany).not.toHaveBeenCalled()
  })

  it("returns 400 for page < 1", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events?page=0")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Invalid page or limit")
  })

  it("returns 400 for limit > 200", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events?limit=201")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Invalid page or limit")
  })

  it("returns 400 for limit < 1", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events?limit=0")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Invalid page or limit")
  })

  it("passes search param to where clause", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.findMany).mockResolvedValue([])
    vi.mocked(prisma.event.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/events?search=Tech")
    await GET(req)

    const call = vi.mocked(prisma.event.findMany).mock.calls[0][0] as any
    expect(call.where.name).toEqual({ contains: "Tech", mode: "insensitive" })
  })

  it("filters by status param", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.findMany).mockResolvedValue([])
    vi.mocked(prisma.event.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/events?status=planned")
    await GET(req)

    const call = vi.mocked(prisma.event.findMany).mock.calls[0][0] as any
    expect(call.where.status).toBe("planned")
  })

  it("returns empty list when no events match", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.findMany).mockResolvedValue([])
    vi.mocked(prisma.event.count).mockResolvedValue(0)

    const req = new NextRequest("http://localhost/api/v1/events")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.events).toEqual([])
    expect(json.data.total).toBe(0)
  })
})

describe("Events API — POST /api/v1/events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ name: "New Event", startDate: "2026-06-01" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe("Unauthorized")
  })

  it("creates an event with valid data and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "evt-new", name: "New Event", organizationId: "org-1", type: "conference", status: "planned" }
    vi.mocked(prisma.event.create).mockResolvedValue(created as any)

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ name: "New Event", startDate: "2026-06-01" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("New Event")
    expect(prisma.event.create).toHaveBeenCalledOnce()
  })

  it("converts startDate and endDate to Date objects", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.create).mockResolvedValue({ id: "evt-1" } as any)

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ name: "Event", startDate: "2026-06-15", endDate: "2026-06-17" }),
      headers: { "Content-Type": "application/json" },
    })
    await POST(req)

    const call = vi.mocked(prisma.event.create).mock.calls[0][0] as any
    expect(call.data.startDate).toBeInstanceOf(Date)
    expect(call.data.endDate).toBeInstanceOf(Date)
  })

  it("defaults type to conference and status to planned", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.event.create).mockResolvedValue({ id: "evt-1" } as any)

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ name: "Minimal Event", startDate: "2026-06-01" }),
      headers: { "Content-Type": "application/json" },
    })
    await POST(req)

    const call = vi.mocked(prisma.event.create).mock.calls[0][0] as any
    expect(call.data.type).toBe("conference")
    expect(call.data.status).toBe("planned")
  })

  it("returns 400 when name is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-06-01" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("returns 400 when name is empty string", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ name: "", startDate: "2026-06-01" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("returns 400 when startDate is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const req = new NextRequest("http://localhost/api/v1/events", {
      method: "POST",
      body: JSON.stringify({ name: "No Date Event" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeDefined()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })
})
