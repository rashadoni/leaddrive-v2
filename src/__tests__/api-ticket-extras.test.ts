import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticketQueue: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    ticketMacro: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    ticket: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    ticketComment: {
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((result: any) => result instanceof NextResponse),
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}))

import { GET as GET_QUEUES, POST as POST_QUEUE } from "@/app/api/v1/ticket-queues/route"
import { PATCH as PATCH_QUEUE, DELETE as DELETE_QUEUE } from "@/app/api/v1/ticket-queues/[id]/route"
import { GET as GET_MACROS, POST as POST_MACRO } from "@/app/api/v1/ticket-macros/route"
import { GET as GET_MACRO, PUT as PUT_MACRO, DELETE as DELETE_MACRO } from "@/app/api/v1/ticket-macros/[id]/route"
import { POST as APPLY_MACRO } from "@/app/api/v1/ticket-macros/[id]/apply/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin" } as any)
})

// ─── Ticket Queues ──────────────────────────────────────────────────

describe("GET /api/v1/ticket-queues", () => {
  it("returns 401 when requireAuth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    const res = await GET_QUEUES(makeReq("http://localhost/api/v1/ticket-queues"))
    expect(res.status).toBe(401)
  })

  it("returns queues ordered by priority desc", async () => {
    const queues = [{ id: "q1", name: "Support", priority: 10 }]
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue(queues as any)
    const res = await GET_QUEUES(makeReq("http://localhost/api/v1/ticket-queues"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(queues)
    expect(prisma.ticketQueue.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { priority: "desc" },
    })
  })
})

describe("POST /api/v1/ticket-queues", () => {
  it("returns 400 for invalid body (missing name)", async () => {
    const res = await POST_QUEUE(makeReq("http://localhost/api/v1/ticket-queues", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
  })

  it("creates a queue and returns 201", async () => {
    const queue = { id: "q1", name: "Billing", skills: ["billing"], priority: 5 }
    vi.mocked(prisma.ticketQueue.create).mockResolvedValue(queue as any)
    const res = await POST_QUEUE(makeReq("http://localhost/api/v1/ticket-queues", {
      method: "POST",
      body: JSON.stringify({ name: "Billing", skills: ["billing"], priority: 5 }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Billing")
  })
})

describe("PATCH /api/v1/ticket-queues/[id]", () => {
  it("returns 404 when queue not found", async () => {
    vi.mocked(prisma.ticketQueue.findFirst).mockResolvedValue(null)
    const res = await PATCH_QUEUE(
      makeReq("http://localhost/api/v1/ticket-queues/q1", { method: "PATCH", body: JSON.stringify({ name: "New" }) }),
      makeParams("q1"),
    )
    expect(res.status).toBe(404)
  })

  it("updates queue successfully", async () => {
    vi.mocked(prisma.ticketQueue.findFirst).mockResolvedValue({ id: "q1" } as any)
    vi.mocked(prisma.ticketQueue.update).mockResolvedValue({ id: "q1", name: "Renamed" } as any)
    const res = await PATCH_QUEUE(
      makeReq("http://localhost/api/v1/ticket-queues/q1", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
      makeParams("q1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Renamed")
  })
})

describe("DELETE /api/v1/ticket-queues/[id]", () => {
  it("returns 404 when queue not found", async () => {
    vi.mocked(prisma.ticketQueue.findFirst).mockResolvedValue(null)
    const res = await DELETE_QUEUE(
      makeReq("http://localhost/api/v1/ticket-queues/q1", { method: "DELETE" }),
      makeParams("q1"),
    )
    expect(res.status).toBe(404)
  })

  it("deletes queue and returns deleted id", async () => {
    vi.mocked(prisma.ticketQueue.findFirst).mockResolvedValue({ id: "q1" } as any)
    vi.mocked(prisma.ticketQueue.delete).mockResolvedValue({} as any)
    const res = await DELETE_QUEUE(
      makeReq("http://localhost/api/v1/ticket-queues/q1", { method: "DELETE" }),
      makeParams("q1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe("q1")
  })
})

// ─── Ticket Macros ──────────────────────────────────────────────────

describe("GET /api/v1/ticket-macros", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_MACROS(makeReq("http://localhost/api/v1/ticket-macros"))
    expect(res.status).toBe(401)
  })

  it("returns macros with optional category filter", async () => {
    const macros = [{ id: "m1", name: "Close Ticket" }]
    vi.mocked(prisma.ticketMacro.findMany).mockResolvedValue(macros as any)
    const res = await GET_MACROS(makeReq("http://localhost/api/v1/ticket-macros?category=support"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(macros)
  })
})

describe("POST /api/v1/ticket-macros", () => {
  it("returns 400 for missing actions", async () => {
    const res = await POST_MACRO(makeReq("http://localhost/api/v1/ticket-macros", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates macro with actions and returns 201", async () => {
    const macro = { id: "m1", name: "Quick Close", actions: [{ type: "set_status", value: "closed" }] }
    vi.mocked(prisma.ticketMacro.create).mockResolvedValue(macro as any)
    const res = await POST_MACRO(makeReq("http://localhost/api/v1/ticket-macros", {
      method: "POST",
      body: JSON.stringify({ name: "Quick Close", actions: [{ type: "set_status", value: "closed" }] }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.name).toBe("Quick Close")
  })
})

describe("GET /api/v1/ticket-macros/[id]", () => {
  it("returns 404 when macro not found", async () => {
    vi.mocked(prisma.ticketMacro.findFirst).mockResolvedValue(null)
    const res = await GET_MACRO(makeReq("http://localhost/api/v1/ticket-macros/m1"), makeParams("m1"))
    expect(res.status).toBe(404)
  })
})

describe("PUT /api/v1/ticket-macros/[id]", () => {
  it("returns 404 when updateMany matches zero", async () => {
    vi.mocked(prisma.ticketMacro.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PUT_MACRO(
      makeReq("http://localhost/api/v1/ticket-macros/m1", { method: "PUT", body: JSON.stringify({ name: "X" }) }),
      makeParams("m1"),
    )
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/v1/ticket-macros/[id]", () => {
  it("deletes macro and returns deleted id", async () => {
    vi.mocked(prisma.ticketMacro.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE_MACRO(
      makeReq("http://localhost/api/v1/ticket-macros/m1", { method: "DELETE" }),
      makeParams("m1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe("m1")
  })
})

// ─── Apply Macro ────────────────────────────────────────────────────

describe("POST /api/v1/ticket-macros/[id]/apply", () => {
  it("returns 400 when ticketId missing", async () => {
    const res = await APPLY_MACRO(
      makeReq("http://localhost/api/v1/ticket-macros/m1/apply", { method: "POST", body: JSON.stringify({}) }),
      makeParams("m1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when macro not found", async () => {
    vi.mocked(prisma.ticketMacro.findFirst).mockResolvedValue(null)
    const res = await APPLY_MACRO(
      makeReq("http://localhost/api/v1/ticket-macros/m1/apply", { method: "POST", body: JSON.stringify({ ticketId: "t1" }) }),
      makeParams("m1"),
    )
    expect(res.status).toBe(404)
  })

  it("applies set_status action and increments usage count", async () => {
    vi.mocked(prisma.ticketMacro.findFirst).mockResolvedValue({
      id: "m1",
      actions: [{ type: "set_status", value: "resolved" }],
    } as any)
    vi.mocked(prisma.ticket.findFirst)
      .mockResolvedValueOnce({ id: "t1", tags: [] } as any) // ticket lookup
      .mockResolvedValueOnce({ id: "t1", status: "resolved", comments: [] } as any) // final return
    vi.mocked(prisma.ticket.update).mockResolvedValue({} as any)
    vi.mocked(prisma.ticketMacro.update).mockResolvedValue({} as any)

    const res = await APPLY_MACRO(
      makeReq("http://localhost/api/v1/ticket-macros/m1/apply", { method: "POST", body: JSON.stringify({ ticketId: "t1" }) }),
      makeParams("m1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "resolved" },
    })
    expect(prisma.ticketMacro.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { usageCount: { increment: 1 } },
    })
  })
})
