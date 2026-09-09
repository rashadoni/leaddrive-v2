import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// Routes wrap clear-then-write in `prisma.$transaction(async tx => …)`.
// Mock invokes the callback with the same prisma stub so call assertions
// still work against `prisma.savedView.*` references — the tx object is
// just an alias of the same model methods.
vi.mock("@/lib/prisma", () => {
  const savedView = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn(),
  }
  return {
    prisma: {
      savedView,
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb({ savedView })),
    },
    logAudit: vi.fn(),
  }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/saved-views/route"
import { PATCH, DELETE } from "@/app/api/v1/saved-views/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

function makeRequest(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "sales" } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)
})

describe("GET /api/v1/saved-views", () => {
  it("returns 400 when entityType missing", async () => {
    const res = await GET(makeRequest("http://localhost/api/v1/saved-views"))
    expect(res.status).toBe(400)
  })

  it("returns 400 on unknown entityType", async () => {
    const res = await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=widgets"))
    expect(res.status).toBe(400)
  })

  it("scopes by orgId + (ownedByCaller OR isShared)", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([] as any)
    const res = await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=tasks"))
    expect(res.status).toBe(200)

    const call = vi.mocked(prisma.savedView.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    expect(call.where.entityType).toBe("tasks")
    expect(call.where.OR).toEqual([
      { userId: "u-1" },
      { isShared: true },
    ])
  })
})

describe("POST /api/v1/saved-views", () => {
  it("403s a non-admin creating a reserved __-prefixed view (org-default gate)", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "__table_default__", isShared: true }),
    }))
    expect(res.status).toBe(403)
    expect(prisma.savedView.create).not.toHaveBeenCalled()
  })

  it("allows an admin to create the reserved __table_default__ view", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
    vi.mocked(prisma.savedView.create).mockResolvedValue({ id: "v9", name: "__table_default__" } as any)
    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "__table_default__", isShared: true }),
    }))
    expect(res.status).toBe(201)
  })

  it("rejects unknown entityType", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "widgets", name: "X" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects name longer than 80 chars", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "x".repeat(81) }),
    }))
    expect(res.status).toBe(400)
  })

  it("clears existing default when creating new default view", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "u-1", entityType: "tasks", name: "VIP",
    } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "VIP", isDefault: true }),
    }))
    expect(res.status).toBe(201)

    expect(prisma.savedView.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", userId: "u-1", entityType: "tasks", isDefault: true },
      data: { isDefault: false },
    })
    const createCall = vi.mocked(prisma.savedView.create).mock.calls[0][0] as any
    expect(createCall.data.isDefault).toBe(true)
    expect(createCall.data.userId).toBe("u-1")
    expect(createCall.data.organizationId).toBe("org-1")
  })

  it("does NOT clear default when creating a non-default view", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({
      id: "v2", name: "VIP",
    } as any)

    await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "VIP", isDefault: false }),
    }))
    expect(prisma.savedView.updateMany).not.toHaveBeenCalled()
  })

  it("wraps clear-then-create in $transaction (architect P1 race fix)", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({ id: "v3", name: "X" } as any)
    await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "X", isDefault: true }),
    }))
    // Two concurrent POSTs with isDefault=true could both pass the
    // clear and both commit a default without the transaction. The
    // mock wraps the callback so both updateMany + create run inside.
    expect((prisma as any).$transaction).toHaveBeenCalledOnce()
  })
})

describe("PATCH /api/v1/saved-views/[id]", () => {
  it("returns 404 when view doesn't exist in caller's org", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue(null)
    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v1", {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    }), makeParams("v1"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when caller is not owner and not admin", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "OTHER", isShared: true,
    } as any)
    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v1", {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    }), makeParams("v1"))
    expect(res.status).toBe(403)
    expect(prisma.savedView.update).not.toHaveBeenCalled()
  })

  it("allows owner to edit", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "u-1", entityType: "tasks",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v1", name: "Renamed" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    }), makeParams("v1"))
    expect(res.status).toBe(200)
    expect(prisma.savedView.update).toHaveBeenCalled()
  })

  it("allows admin to edit another user's view", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH_OK, role: "admin" } as any)
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "OTHER", entityType: "tasks",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v1" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Cleaned up" }),
    }), makeParams("v1"))
    expect(res.status).toBe(200)
  })

  it("clears other defaults when setting isDefault=true (scoped to view.userId)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH_OK, role: "admin" } as any)
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "OTHER", entityType: "tasks",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v1" } as any)

    await PATCH(makeRequest("http://localhost/api/v1/saved-views/v1", {
      method: "PATCH",
      body: JSON.stringify({ isDefault: true }),
    }), makeParams("v1"))

    const clearCall = vi.mocked(prisma.savedView.updateMany).mock.calls[0]?.[0] as any
    expect(clearCall.where.userId).toBe("OTHER")
    expect(clearCall.where.NOT).toEqual({ id: "v1" })
    // Architect P1 race fix — same atomic guarantee as POST.
    expect((prisma as any).$transaction).toHaveBeenCalledOnce()
  })
})

describe("DELETE /api/v1/saved-views/[id]", () => {
  it("returns 404 when view doesn't exist", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue(null)
    const res = await DELETE(makeRequest("http://localhost/api/v1/saved-views/v1", { method: "DELETE" }), makeParams("v1"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when caller is not owner", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "OTHER",
    } as any)
    const res = await DELETE(makeRequest("http://localhost/api/v1/saved-views/v1", { method: "DELETE" }), makeParams("v1"))
    expect(res.status).toBe(403)
    expect(prisma.savedView.delete).not.toHaveBeenCalled()
  })

  it("allows owner to delete", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v1", organizationId: "org-1", userId: "u-1", name: "VIP",
    } as any)
    vi.mocked(prisma.savedView.delete).mockResolvedValue({ id: "v1" } as any)

    const res = await DELETE(makeRequest("http://localhost/api/v1/saved-views/v1", { method: "DELETE" }), makeParams("v1"))
    expect(res.status).toBe(200)
    expect(prisma.savedView.delete).toHaveBeenCalledWith({ where: { id: "v1" } })
  })
})
