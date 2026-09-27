/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: (() => {
    const client = {
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
      delete: vi.fn(),
    },
    ticket: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    ticketComment: {
      create: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    }
    client.$transaction.mockImplementation(async (input: unknown) => typeof input === "function"
      ? (input as (tx: typeof client) => unknown)(client)
      : Promise.all(input as Promise<unknown>[]))
    return client
  })(),
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
import { POST as POST_MACRO_CATEGORY, PATCH as PATCH_MACRO_CATEGORY, DELETE as DELETE_MACRO_CATEGORY } from "@/app/api/v1/ticket-macros/categories/route"
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
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as any)
  vi.mocked(prisma.organization.update).mockResolvedValue({} as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.user.count).mockResolvedValue(0)
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
    expect(json.permissions).toEqual({ canWrite: true })
    expect(prisma.ticketQueue.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { priority: "desc" },
    })
  })

  it("allows managers to read and manage routing queues", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "manager-1", role: "manager" } as any)
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([] as any)
    const response = await GET_QUEUES(makeReq("http://localhost/api/v1/ticket-queues"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ permissions: { canWrite: true } })
  })

  it("lets support inspect queues without exposing write capability", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "support-1", role: "support" } as any)
    vi.mocked(prisma.ticketQueue.findMany).mockResolvedValue([] as any)
    const response = await GET_QUEUES(makeReq("http://localhost/api/v1/ticket-queues"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ permissions: { canWrite: false } })
  })
})

describe("POST /api/v1/ticket-queues", () => {
  it("blocks support agents from changing routing configuration", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "support-1", role: "support" } as any)
    const response = await POST_QUEUE(makeReq("http://localhost/api/v1/ticket-queues", {
      method: "POST",
      body: JSON.stringify({ name: "Billing" }),
    }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "ROUTING_WRITE_FORBIDDEN" })
    expect(prisma.ticketQueue.create).not.toHaveBeenCalled()
  })

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

  it("normalizes queue skills at the API boundary", async () => {
    vi.mocked(prisma.ticketQueue.create).mockResolvedValue({ id: "q1" } as any)
    const response = await POST_QUEUE(makeReq("http://localhost/api/v1/ticket-queues", {
      method: "POST",
      body: JSON.stringify({ name: " Billing ", skills: [" Billing ", "billing", "VIP"] }),
    }))
    expect(response.status).toBe(201)
    expect(prisma.ticketQueue.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Billing", skills: ["billing", "vip"] }) })
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
  it("returns 401 when authorization fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    const res = await GET_MACROS(makeReq("http://localhost/api/v1/ticket-macros"))
    expect(res.status).toBe(401)
  })

  it("returns macros with shared categories, scoped agents, and permissions", async () => {
    const macros = [{ id: "m1", name: "Close Ticket", category: "support" }]
    vi.mocked(prisma.ticketMacro.findMany).mockResolvedValue(macros as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { ticketMacroCategories: ["Escalations"] } } as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u1", name: "Agent" }] as any)
    const res = await GET_MACROS(makeReq("http://localhost/api/v1/ticket-macros"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(macros)
    expect(json.categories).toEqual(expect.arrayContaining(["general", "Escalations", "support"]))
    expect(json.agents).toEqual([{ id: "u1", name: "Agent" }])
    expect(json.permissions).toEqual({ canWrite: true })
  })

  it("allows support to read but reports read-only capability", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "support-1", role: "support" } as any)
    vi.mocked(prisma.ticketMacro.findMany).mockResolvedValue([])
    const res = await GET_MACROS(makeReq("http://localhost/api/v1/ticket-macros"))
    expect(res.status).toBe(200)
    expect((await res.json()).permissions).toEqual({ canWrite: false })
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

  it("denies support mutations", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "support-1", role: "support" } as any)
    const res = await POST_MACRO(makeReq("http://localhost/api/v1/ticket-macros", {
      method: "POST",
      body: JSON.stringify({ name: "No", actions: [{ type: "set_status", value: "closed" }] }),
    }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("MACRO_WRITE_FORBIDDEN")
  })

  it("rejects an assignee outside the scoped active user list", async () => {
    vi.mocked(prisma.user.count).mockResolvedValue(0)
    const res = await POST_MACRO(makeReq("http://localhost/api/v1/ticket-macros", {
      method: "POST",
      body: JSON.stringify({ name: "Assign", actions: [{ type: "set_assignee", value: "foreign-user" }] }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("MACRO_ASSIGNEE_INVALID")
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
    vi.mocked(prisma.ticketMacro.findFirst).mockResolvedValue({ id: "m1" } as any)
    vi.mocked(prisma.ticketMacro.delete).mockResolvedValue({} as any)
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
      isActive: true,
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

  it("refuses to execute inactive macros", async () => {
    vi.mocked(prisma.ticketMacro.findFirst).mockResolvedValue({ id: "m1", isActive: false, actions: [] } as any)
    const res = await APPLY_MACRO(
      makeReq("http://localhost/api/v1/ticket-macros/m1/apply", { method: "POST", body: JSON.stringify({ ticketId: "t1" }) }),
      makeParams("m1"),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("MACRO_INACTIVE")
  })
})

describe("/api/v1/ticket-macros/categories", () => {
  it("persists a category in organization settings", async () => {
    const res = await POST_MACRO_CATEGORY(makeReq("http://localhost/api/v1/ticket-macros/categories", {
      method: "POST",
      body: JSON.stringify({ name: "Escalations" }),
    }))
    expect(res.status).toBe(201)
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "org-1" },
      data: { settings: { ticketMacroCategories: ["Escalations"] } },
    }))
  })

  it("renames the category and every matching macro atomically", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { ticketMacroCategories: ["Old"] } } as any)
    vi.mocked(prisma.ticketMacro.updateMany).mockResolvedValue({ count: 2 } as any)
    const res = await PATCH_MACRO_CATEGORY(makeReq("http://localhost/api/v1/ticket-macros/categories", {
      method: "PATCH",
      body: JSON.stringify({ name: "Old", newName: "New" }),
    }))
    expect(res.status).toBe(200)
    expect(prisma.ticketMacro.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", category: "Old" },
      data: { category: "New" },
    })
  })

  it("moves macros to General when a shared custom category is deleted", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { ticketMacroCategories: ["Legacy"] } } as any)
    vi.mocked(prisma.ticketMacro.updateMany).mockResolvedValue({ count: 3 } as any)
    const res = await DELETE_MACRO_CATEGORY(makeReq("http://localhost/api/v1/ticket-macros/categories", {
      method: "DELETE",
      body: JSON.stringify({ name: "Legacy" }),
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.moved).toBe(3)
  })
})
