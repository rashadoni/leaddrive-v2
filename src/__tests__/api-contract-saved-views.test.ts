/**
 * Contract saved views — CLM Slice 4b-2
 *
 * Tests the generic /api/v1/saved-views endpoints exercised with
 * entityType="contracts". Covers:
 *   - CRUD org-scoped + module-gated
 *   - Visibility: own private + org-shared visible; other user's private hidden
 *   - Config validation (unknown entityType rejected)
 *   - Cross-tenant 404
 *   - Delete permission (owner / admin only)
 *   - FIX 3: contracts views require contracts module; tasks views still work (backward-compat)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

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

const AUTH_OK = { orgId: "org-contracts", userId: "u-owner", role: "sales" } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)
})

// ---------------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------------

describe("GET /api/v1/saved-views?entityType=contracts", () => {
  it("returns 400 for unknown entityType (sanity: contracts keyword must be registered)", async () => {
    const res = await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=widgets"))
    expect(res.status).toBe(400)
  })

  it("accepts entityType=contracts (not 400)", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
    const res = await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=contracts"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("scopes by orgId and entityType", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
    await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=contracts"))

    const call = vi.mocked(prisma.savedView.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-contracts")
    expect(call.where.entityType).toBe("contracts")
  })

  it("visibility: caller sees own private + org-shared views only", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
    await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=contracts"))

    const call = vi.mocked(prisma.savedView.findMany).mock.calls[0][0] as any
    expect(call.where.OR).toEqual([
      { userId: "u-owner" },
      { isShared: true },
    ])
    // This OR clause ensures other users' private views (isShared=false, userId≠caller)
    // are excluded — the DB filters them out naturally.
  })

  it("returns both personal and shared views for the caller", async () => {
    const ownView = {
      id: "v-own", entityType: "contracts", organizationId: "org-contracts",
      userId: "u-owner", name: "My View", filters: {}, isDefault: false, isShared: false,
      createdAt: new Date().toISOString(), user: { id: "u-owner", name: "Owner" },
    }
    const sharedView = {
      id: "v-shared", entityType: "contracts", organizationId: "org-contracts",
      userId: "u-other", name: "Team View", filters: {}, isDefault: false, isShared: true,
      createdAt: new Date().toISOString(), user: { id: "u-other", name: "Other" },
    }
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([ownView, sharedView] as any)

    const res = await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=contracts"))
    const body = await res.json()
    expect(body.data).toHaveLength(2)
    expect(body.data.map((v: any) => v.id)).toContain("v-own")
    expect(body.data.map((v: any) => v.id)).toContain("v-shared")
  })
})

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------

describe("POST /api/v1/saved-views (entityType=contracts)", () => {
  it("rejects unknown entityType", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "invoices_bad", name: "X" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects missing name", async () => {
    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "contracts" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates a personal contract view", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({
      id: "v-new", organizationId: "org-contracts", userId: "u-owner",
      entityType: "contracts", name: "Active NDA",
      filters: { status: "active", type: "nda" }, isDefault: false, isShared: false,
    } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({
        entityType: "contracts",
        name: "Active NDA",
        filters: { status: "active", type: "nda" },
      }),
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.name).toBe("Active NDA")

    const createCall = vi.mocked(prisma.savedView.create).mock.calls[0][0] as any
    expect(createCall.data.entityType).toBe("contracts")
    expect(createCall.data.organizationId).toBe("org-contracts")
    expect(createCall.data.userId).toBe("u-owner")
  })

  it("creates a shared contract view (visible org-wide)", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({
      id: "v-shared", entityType: "contracts", name: "Expiring Soon",
      isShared: true,
    } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "contracts", name: "Expiring Soon", isShared: true }),
    }))
    expect(res.status).toBe(201)
    const createCall = vi.mocked(prisma.savedView.create).mock.calls[0][0] as any
    expect(createCall.data.isShared).toBe(true)
  })

  it("captures full contract filter config in filters blob", async () => {
    const contractFilters = {
      status: "renewing",
      tagIds: ["tag-1", "tag-2"],
      valueMin: "5000",
      valueMax: "50000",
      startFrom: "2026-01-01",
      startTo: "2026-06-30",
      endFrom: "2026-07-01",
      endTo: "2026-12-31",
      type: "nda",
      sort: "expiry",
    }
    vi.mocked(prisma.savedView.create).mockResolvedValue({ id: "v-full" } as any)

    await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "contracts", name: "Q2 NDA expiry", filters: contractFilters }),
    }))

    const createCall = vi.mocked(prisma.savedView.create).mock.calls[0][0] as any
    expect(createCall.data.filters).toMatchObject(contractFilters)
  })

  it("clears existing default when creating new default view (atomic via $transaction)", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({ id: "v-def", name: "My Default" } as any)

    await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "contracts", name: "My Default", isDefault: true }),
    }))

    expect(prisma.savedView.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-contracts", userId: "u-owner", entityType: "contracts", isDefault: true },
      data: { isDefault: false },
    })
    expect((prisma as any).$transaction).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// PATCH — update (rename / change config)
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/saved-views/[id] (contract views)", () => {
  it("cross-tenant: returns 404 when view belongs to different org", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue(null)
    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v-x", {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    }), makeParams("v-x"))
    expect(res.status).toBe(404)
  })

  it("returns 403 when caller is not owner and not admin", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-other", organizationId: "org-contracts", userId: "u-other", isShared: true,
    } as any)
    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v-other", {
      method: "PATCH",
      body: JSON.stringify({ name: "Stolen rename" }),
    }), makeParams("v-other"))
    expect(res.status).toBe(403)
    expect(prisma.savedView.update).not.toHaveBeenCalled()
  })

  it("allows owner to rename their view", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-own", organizationId: "org-contracts", userId: "u-owner", entityType: "contracts",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v-own", name: "Renamed" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v-own", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    }), makeParams("v-own"))
    expect(res.status).toBe(200)
    expect(prisma.savedView.update).toHaveBeenCalled()
  })

  it("allows admin to edit another user's contract view", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH_OK, role: "admin" } as any)
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-other", organizationId: "org-contracts", userId: "u-other", entityType: "contracts",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v-other" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v-other", {
      method: "PATCH",
      body: JSON.stringify({ name: "Admin edit" }),
    }), makeParams("v-other"))
    expect(res.status).toBe(200)
  })

  it("allows owner to update filter config (e.g. change sort or tags)", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-own", organizationId: "org-contracts", userId: "u-owner", entityType: "contracts",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v-own" } as any)

    const newFilters = { status: "active", sort: "value_desc", tagIds: ["tag-3"] }
    const res = await PATCH(makeRequest("http://localhost/api/v1/saved-views/v-own", {
      method: "PATCH",
      body: JSON.stringify({ filters: newFilters }),
    }), makeParams("v-own"))
    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.savedView.update).mock.calls[0][0] as any
    expect(updateCall.data.filters).toMatchObject(newFilters)
  })
})

// ---------------------------------------------------------------------------
// DELETE — remove
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/saved-views/[id] (contract views)", () => {
  it("cross-tenant: returns 404 when view not found in org", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue(null)
    const res = await DELETE(
      makeRequest("http://localhost/api/v1/saved-views/v-x", { method: "DELETE" }),
      makeParams("v-x"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 403 when non-owner non-admin tries to delete", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-shared", organizationId: "org-contracts", userId: "u-other", name: "Team View",
    } as any)
    const res = await DELETE(
      makeRequest("http://localhost/api/v1/saved-views/v-shared", { method: "DELETE" }),
      makeParams("v-shared"),
    )
    expect(res.status).toBe(403)
    expect(prisma.savedView.delete).not.toHaveBeenCalled()
  })

  it("allows owner to delete their own view", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-own", organizationId: "org-contracts", userId: "u-owner", name: "My NDA",
    } as any)
    vi.mocked(prisma.savedView.delete).mockResolvedValue({ id: "v-own" } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/saved-views/v-own", { method: "DELETE" }),
      makeParams("v-own"),
    )
    expect(res.status).toBe(200)
    expect(prisma.savedView.delete).toHaveBeenCalledWith({ where: { id: "v-own" } })
  })

  it("allows admin to delete any view in org (even another user's)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...AUTH_OK, role: "admin" } as any)
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-other", organizationId: "org-contracts", userId: "u-other", name: "Stale View",
    } as any)
    vi.mocked(prisma.savedView.delete).mockResolvedValue({ id: "v-other" } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/saved-views/v-other", { method: "DELETE" }),
      makeParams("v-other"),
    )
    expect(res.status).toBe(200)
    expect(prisma.savedView.delete).toHaveBeenCalledWith({ where: { id: "v-other" } })
  })
})

// ---------------------------------------------------------------------------
// FIX 3 — per-entityType module authorization
// ---------------------------------------------------------------------------

describe("FIX 3: saved-views authorize by entityType's module, not hardcoded 'tasks'", () => {
  it("GET contracts view: requireAuth called with 'contracts' module (not 'tasks')", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
    await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=contracts"))

    // The route should call requireAuth with 'contracts' module (not 'tasks')
    expect(requireAuth).toHaveBeenCalledWith(
      expect.anything(),
      "contracts",
      "read",
    )
  })

  it("GET tasks view: requireAuth called with 'tasks' module (backward-compat)", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
    await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=tasks"))

    expect(requireAuth).toHaveBeenCalledWith(
      expect.anything(),
      "tasks",
      "read",
    )
  })

  it("GET contracts view: 403 when requireAuth returns forbidden (contracts module disabled)", async () => {
    // First call (contracts module gate) returns 403
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await GET(makeRequest("http://localhost/api/v1/saved-views?entityType=contracts"))
    expect(res.status).toBe(403)
  })

  it("POST contracts view: requireAuth called with 'contracts' module", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({ id: "v-new", name: "X" } as any)

    await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "contracts", name: "My View" }),
    }))

    expect(requireAuth).toHaveBeenCalledWith(
      expect.anything(),
      "contracts",
      "read",
    )
  })

  it("POST tasks view: requireAuth called with 'tasks' module (backward-compat)", async () => {
    vi.mocked(prisma.savedView.create).mockResolvedValue({ id: "v-task", name: "Task View" } as any)

    await POST(makeRequest("http://localhost/api/v1/saved-views", {
      method: "POST",
      body: JSON.stringify({ entityType: "tasks", name: "Task View" }),
    }))

    expect(requireAuth).toHaveBeenCalledWith(
      expect.anything(),
      "tasks",
      "read",
    )
  })

  it("PATCH contract view: requireAuth called with 'contracts' module (view.entityType drives gate)", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-c", organizationId: "org-contracts", userId: "u-owner",
      entityType: "contracts",
    } as any)
    vi.mocked(prisma.savedView.update).mockResolvedValue({ id: "v-c", name: "Renamed" } as any)

    await PATCH(makeRequest("http://localhost/api/v1/saved-views/v-c", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    }), makeParams("v-c"))

    // requireAuth called twice: first minimal (no module, for orgId), then with contracts
    const calls = vi.mocked(requireAuth).mock.calls
    const moduleCall = calls.find(c => c[1] === "contracts")
    expect(moduleCall).toBeDefined()
    expect(moduleCall![2]).toBe("read")
  })

  it("DELETE contract view: requireAuth called with 'contracts' module", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-c", organizationId: "org-contracts", userId: "u-owner",
      entityType: "contracts", name: "My View",
    } as any)
    vi.mocked(prisma.savedView.delete).mockResolvedValue({ id: "v-c" } as any)

    await DELETE(makeRequest("http://localhost/api/v1/saved-views/v-c", {
      method: "DELETE",
    }), makeParams("v-c"))

    const calls = vi.mocked(requireAuth).mock.calls
    const moduleCall = calls.find(c => c[1] === "contracts")
    expect(moduleCall).toBeDefined()
  })

  it("DELETE tasks view: requireAuth called with 'tasks' module (backward-compat)", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({
      id: "v-t", organizationId: "org-contracts", userId: "u-owner",
      entityType: "tasks", name: "Task View",
    } as any)
    vi.mocked(prisma.savedView.delete).mockResolvedValue({ id: "v-t" } as any)

    await DELETE(makeRequest("http://localhost/api/v1/saved-views/v-t", {
      method: "DELETE",
    }), makeParams("v-t"))

    const calls = vi.mocked(requireAuth).mock.calls
    const taskModuleCall = calls.find(c => c[1] === "tasks")
    expect(taskModuleCall).toBeDefined()
    // And definitely no hardcoded tasks call that would incorrectly gate a contracts view
    const contractsModuleCall = calls.find(c => c[1] === "contracts")
    expect(contractsModuleCall).toBeUndefined()
  })
})
