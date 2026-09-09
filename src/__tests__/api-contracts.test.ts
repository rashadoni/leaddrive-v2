import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    // FIX 1: cross-tenant FK guard needs these look-ups
    company: { findFirst: vi.fn() },
    deal: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    contractTag: { count: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))

// FIX 1: routes now use requireAuth + isAuthError instead of getOrgId
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))
vi.mock("@/lib/constants", () => ({ PAGE_SIZE: { DEFAULT: 50, DASHBOARD_RECENT: 10, DASHBOARD_TASKS: 10 } }))
vi.mock("@/lib/contract-lifecycle/upsert-renewal-alerts", () => ({ upsertRenewalAlerts: vi.fn().mockResolvedValue(undefined) }))

import { GET, POST } from "@/app/api/v1/contracts/route"
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/v1/contracts/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

// Typed aliases for FK-guard mocks used in cross-tenant tests
const mockCompanyFindFirst = () => vi.mocked(prisma.company.findFirst)
const mockDealFindFirst = () => vi.mocked(prisma.deal.findFirst)
const mockContactFindFirst = () => vi.mocked(prisma.contact.findFirst)

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

/** Happy-path auth result (admin with contracts module enabled) */
const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "admin", email: "a@b.com", name: "Admin" }

beforeEach(() => {
  // resetAllMocks clears call history AND flushes queued mockResolvedValueOnce stacks,
  // preventing leftover once-mocks from leaking between tests.
  vi.resetAllMocks()
  // Default: auth succeeds — override per test for 401/403 cases
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)

  // FIX 1: default FK guard lookups — return a hit (same-org) so existing tests pass
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "comp-1" } as any)
  vi.mocked(prisma.deal.findFirst).mockResolvedValue({ id: "deal-1" } as any)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "contact-1" } as any)

  // Default $transaction: just run the callback and pass a tx-like prisma stub
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
    const txPrisma = {
      contract: {
        updateMany: vi.mocked(prisma.contract.updateMany),
        update: vi.mocked(prisma.contract.update),
      },
    }
    return cb(txPrisma)
  })
})

// ─── GET /api/v1/contracts ──────────────────────────────────────────

describe("GET /api/v1/contracts", () => {
  it("returns 401 when requireAuth returns 401 response", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )
    const res = await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled (requireAuth returns 403)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(res.status).toBe(403)
  })

  it("returns paginated contracts with defaults", async () => {
    const contracts = [{ id: "c1", title: "Contract A", valueAmount: null }]
    vi.mocked(prisma.contract.findMany).mockResolvedValue(contracts as any)
    vi.mocked(prisma.contract.count).mockResolvedValue(1)

    const res = await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.contracts).toEqual(contracts)
    expect(json.data.total).toBe(1)
    expect(json.data.page).toBe(1)
    expect(json.data.limit).toBe(50)
    expect(json.data.search).toBe("")
  })

  it("normalizes Decimal valueAmount to number in GET response", async () => {
    const decimalLike = { toNumber: () => 12500.5 }
    vi.mocked(prisma.contract.findMany).mockResolvedValue([
      { id: "c1", title: "Contract A", valueAmount: decimalLike } as any,
      { id: "c2", title: "Contract B", valueAmount: null } as any,
    ])
    vi.mocked(prisma.contract.count).mockResolvedValue(2)

    const res = await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    const json = await res.json()
    expect(json.data.contracts[0].valueAmount).toBe(12500.5)
    expect(json.data.contracts[1].valueAmount).toBeNull()
  })

  it("passes search, status and companyId filters", async () => {
    vi.mocked(prisma.contract.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.contract.count).mockResolvedValue(0)

    await GET(makeReq("http://localhost:3000/api/v1/contracts?search=test&status=active&companyId=comp-1&page=2&limit=10"))

    const call = vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
    // Slice 4b-1: search is now a 5-field OR (title, contractNumber, notes, renderedBody, company.name)
    expect(call.where.OR).toBeDefined()
    expect(call.where.OR).toHaveLength(5)
    const titleClause = call.where.OR.find((c: any) => c.title)
    expect(titleClause.title).toEqual({ contains: "test", mode: "insensitive" })
    expect(call.where.status).toBe("active")
    expect(call.where.companyId).toBe("comp-1")
    expect(call.skip).toBe(10) // (page 2 - 1) * limit 10
    expect(call.take).toBe(10)
  })

  it("FIX 2: tag include is org-filtered (where: { organizationId: orgId })", async () => {
    vi.mocked(prisma.contract.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.contract.count).mockResolvedValue(0)

    await GET(makeReq("http://localhost:3000/api/v1/contracts"))

    const call = vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any
    expect(call.include.tags.where).toEqual({ organizationId: "org-1" })
    expect(call.include.tags.select).toEqual({ id: true, name: true, color: true })
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contract.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })
})

// ─── POST /api/v1/contracts ─────────────────────────────────────────

describe("POST /api/v1/contracts", () => {
  it("returns 401 when requireAuth returns 401 response", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test" }),
    }))
    expect(res.status).toBe(403)
  })

  it("returns 400 when contractNumber is missing", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ title: "Test" }),
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when title is missing", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001" }),
    }))
    expect(res.status).toBe(400)
  })

  it("rejects a negative contract value on create", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Unsafe", valueAmount: -1 }),
    }))

    expect(res.status).toBe(400)
    expect(prisma.contract.create).not.toHaveBeenCalled()
  })

  it("rejects creating a contract directly in a non-draft lifecycle status", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test", status: "active" }),
    }))

    expect(res.status).toBe(400)
    expect(prisma.contract.create).not.toHaveBeenCalled()
  })

  it("creates contract with 201 and converts dates", async () => {
    const created = { id: "c1", contractNumber: "C-001", title: "Test", startDate: new Date("2026-01-01"), valueAmount: null }
    vi.mocked(prisma.contract.create).mockResolvedValue(created as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test", startDate: "2026-01-01", endDate: "2026-12-31" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("c1")

    const createCall = vi.mocked(prisma.contract.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
    expect(createCall.data.startDate).toEqual(new Date("2026-01-01"))
    expect(createCall.data.endDate).toEqual(new Date("2026-12-31"))
  })

  it("normalizes Decimal valueAmount to number in POST response", async () => {
    const decimalLike = { toNumber: () => 50000 }
    vi.mocked(prisma.contract.create).mockResolvedValue({ id: "c1", contractNumber: "C-001", title: "T", valueAmount: decimalLike } as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "T", valueAmount: 50000 }),
    }))
    const json = await res.json()
    expect(json.data.valueAmount).toBe(50000)
    expect(typeof json.data.valueAmount).toBe("number")
  })

  it("FIX 1: cross-tenant companyId on POST → 404", async () => {
    // company.findFirst returns null → belongs to another org
    mockCompanyFindFirst().mockResolvedValue(null)
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test", companyId: "foreign-comp" }),
    }))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Company not found in this tenant")
    // No contract created
    expect(prisma.contract.create).not.toHaveBeenCalled()
  })

  it("FIX 1: cross-tenant dealId on POST → 404", async () => {
    mockDealFindFirst().mockResolvedValue(null)
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test", dealId: "foreign-deal" }),
    }))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Deal not found in this tenant")
    expect(prisma.contract.create).not.toHaveBeenCalled()
  })

  it("FIX 1: cross-tenant contactId on POST → 404", async () => {
    mockContactFindFirst().mockResolvedValue(null)
    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test", contactId: "foreign-contact" }),
    }))
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Contact not found in this tenant")
    expect(prisma.contract.create).not.toHaveBeenCalled()
  })

  it("FIX 1: same-org companyId/dealId/contactId on POST → 201", async () => {
    // Default mocks return hits (same org) — contract creation should proceed
    const created = { id: "c1", contractNumber: "C-001", title: "Test", valueAmount: null }
    vi.mocked(prisma.contract.create).mockResolvedValue(created as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({
        contractNumber: "C-001",
        title: "Test",
        companyId: "comp-1",
        dealId: "deal-1",
        contactId: "contact-1",
      }),
    }))
    expect(res.status).toBe(201)
    expect(prisma.contract.create).toHaveBeenCalledOnce()
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contract.create).mockRejectedValue(new Error("DB error"))

    const res = await POST(makeReq("http://localhost:3000/api/v1/contracts", {
      method: "POST",
      body: JSON.stringify({ contractNumber: "C-001", title: "Test" }),
    }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })
})

// ─── GET /api/v1/contracts/:id ──────────────────────────────────────

describe("GET /api/v1/contracts/:id", () => {
  it("returns 401 when requireAuth returns 401 response", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )
    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled (viewer / contracts off)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(403)
  })

  it("returns contract with history", async () => {
    const contract = { id: "c1", title: "Contract A", organizationId: "org-1" }
    const history = [{ id: "log-1", action: "create" }]
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(contract as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue(history as any)

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("c1")
    expect(json.data.history).toEqual(history)
  })

  it("FIX 2: tag include in GET-by-id is org-filtered", async () => {
    const contract = { id: "c1", title: "C", organizationId: "org-1" }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(contract as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([])

    await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))

    const call = vi.mocked(prisma.contract.findFirst).mock.calls[0][0] as any
    expect(call.include.tags.where).toEqual({ organizationId: "org-1" })
  })

  it("normalizes Decimal valueAmount to number", async () => {
    const decimalLike = { toNumber: () => 9999.99 }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue({ id: "c1", valueAmount: decimalLike } as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([])

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    const json = await res.json()
    expect(json.data.valueAmount).toBe(9999.99)
  })

  it("returns 404 when not found", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/bad"), makeParams("bad"))
    expect(res.status).toBe(404)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.contract.findFirst).mockRejectedValue(new Error("DB crash"))

    const res = await GET_BY_ID(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Internal server error")
  })
})

// ─── PUT /api/v1/contracts/:id ──────────────────────────────────────

describe("PUT /api/v1/contracts/:id", () => {
  it("returns 401 when requireAuth returns 401 response", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("c1"),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled or viewer role", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("c1"),
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when old contract not found", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "Updated" }) }),
      makeParams("c1"),
    )
    expect(res.status).toBe(404)
  })

  it("rejects an unrealistically large contract value before loading the record", async () => {
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ valueAmount: 1_000_000_000_000 }),
      }),
      makeParams("c1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.contract.findFirst).not.toHaveBeenCalled()
  })

  it("rejects direct lifecycle status changes through the generic update route", async () => {
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", status: "draft", startDate: null, endDate: null }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(old as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ status: "active" }),
      }),
      makeParams("c1"),
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("LIFECYCLE_ACTION_REQUIRED")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("allows unchanged status in update payload but strips it from the scalar write", async () => {
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", status: "draft", startDate: null, endDate: null }
    const updated = { ...old, title: "New" }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce(updated as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ title: "New", status: "draft" }),
      }),
      makeParams("c1"),
    )

    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.contract.updateMany).mock.calls[0][0] as any
    expect(updateCall.where).toMatchObject({ id: "c1", organizationId: "org-1", status: "draft" })
    expect(updateCall.data.status).toBeUndefined()
  })

  it("FIX 4: scalar update + tag write run inside $transaction", async () => {
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null }
    const updated = { ...old, title: "New" }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce(updated as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.contractTag.count).mockResolvedValue(1) // tag "t1" belongs to org-1
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ title: "New", tagIds: ["t1"] }),
      }),
      makeParams("c1"),
    )

    // $transaction must have been called (wraps updateMany + tags.set)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it("updates contract and creates audit log on change", async () => {
    const old = { id: "c1", title: "Old Title", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null }
    const updated = { ...old, title: "New Title" }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)   // old values lookup
      .mockResolvedValueOnce(updated as any) // re-fetch after update
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "New Title" }) }),
      makeParams("c1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.title).toBe("New Title")

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    const auditCall = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any
    expect(auditCall.data.action).toBe("update")
    expect(auditCall.data.entityType).toBe("contract")
    expect(auditCall.data.entityId).toBe("c1")
  })

  it("normalizes Decimal valueAmount to number in PUT response", async () => {
    const decimalLike = { toNumber: () => 75000 }
    const old = { id: "c1", title: "T", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null, valueAmount: decimalLike }
    const updated = { ...old, valueAmount: decimalLike }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce(updated as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ valueAmount: 75000 }) }),
      makeParams("c1"),
    )
    const json = await res.json()
    expect(json.data.valueAmount).toBe(75000)
    expect(typeof json.data.valueAmount).toBe("number")
  })

  it("does not create audit log when valueAmount unchanged after Decimal migration", async () => {
    const decimalLike = { toNumber: () => 10000 }
    const old = { id: "c1", title: "T", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null, valueAmount: decimalLike }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce({ ...old } as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "T" }) }),
      makeParams("c1"),
    )
    // No valueAmount change → audit log must NOT be called for that field
    // (other fields didn't change either → auditLog.create not called at all)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("returns 404 when updateMany count is 0 and the contract no longer exists", async () => {
    const old = { id: "c1", title: "Title", organizationId: "org-1", status: "draft", startDate: null, endDate: null }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("c1"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 when updateMany misses because the contract state changed concurrently", async () => {
    const old = { id: "c1", title: "Title", organizationId: "org-1", status: "draft", startDate: null, endDate: null }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce({ id: "c1" } as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("c1"),
    )

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe("CONTRACT_STATE_CHANGED")
    expect(prisma.contract.update).not.toHaveBeenCalled()
  })

  it("FIX 1: cross-tenant companyId on PUT → 404, no write", async () => {
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(old as any)
    mockCompanyFindFirst().mockResolvedValue(null)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ companyId: "foreign-comp" }),
      }),
      makeParams("c1"),
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Company not found in this tenant")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("FIX 1: cross-tenant dealId on PUT → 404, no write", async () => {
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(old as any)
    mockDealFindFirst().mockResolvedValue(null)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ dealId: "foreign-deal" }),
      }),
      makeParams("c1"),
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Deal not found in this tenant")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("FIX 1: cross-tenant contactId on PUT → 404, no write", async () => {
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(old as any)
    mockContactFindFirst().mockResolvedValue(null)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ contactId: "foreign-contact" }),
      }),
      makeParams("c1"),
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe("Contact not found in this tenant")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("FIX 1: null companyId on PUT clears FK without validation (explicit null = clear)", async () => {
    // Sending null for companyId is an explicit clear — must NOT trigger FK lookup
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null, companyId: "comp-1" }
    const updated = { ...old, companyId: null }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce(updated as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ companyId: null }),
      }),
      makeParams("c1"),
    )
    expect(res.status).toBe(200)
    // company.findFirst must NOT have been called (no lookup for null/clear)
    expect(prisma.company.findFirst).not.toHaveBeenCalled()
  })

  it("FIX 1: same-org FK on PUT → proceeds normally", async () => {
    // Default mocks return hits — update should complete
    const old = { id: "c1", title: "Old", contractNumber: "C-001", organizationId: "org-1", startDate: null, endDate: null }
    const updated = { ...old, companyId: "comp-1" }
    vi.mocked(prisma.contract.findFirst)
      .mockResolvedValueOnce(old as any)
      .mockResolvedValueOnce(updated as any)
    vi.mocked(prisma.contract.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", {
        method: "PUT",
        body: JSON.stringify({ companyId: "comp-1" }),
      }),
      makeParams("c1"),
    )
    expect(res.status).toBe(200)
    expect(prisma.company.findFirst).toHaveBeenCalledOnce()
  })

  it("returns 500 on unexpected error", async () => {
    vi.mocked(prisma.contract.findFirst).mockRejectedValue(new Error("boom"))

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contracts/c1", { method: "PUT", body: JSON.stringify({ title: "X" }) }),
      makeParams("c1"),
    )
    expect(res.status).toBe(500)
  })
})

// ─── DELETE /api/v1/contracts/:id ───────────────────────────────────

describe("DELETE /api/v1/contracts/:id", () => {
  it("returns 401 when requireAuth returns 401 response", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )
    const res = await DELETE(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled or viewer role", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await DELETE(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(403)
  })

  it("deletes contract and logs audit", async () => {
    const contract = { id: "c1", title: "To Delete", organizationId: "org-1" }
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(contract as any)
    vi.mocked(prisma.contract.deleteMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

    const res = await DELETE(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("c1")

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    const auditCall = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any
    expect(auditCall.data.action).toBe("delete")
    expect(auditCall.data.entityType).toBe("contract")
  })

  it("returns 404 when deleteMany count is 0", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contract.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await DELETE(makeReq("http://localhost:3000/api/v1/contracts/bad"), makeParams("bad"))
    expect(res.status).toBe(404)
  })

  it("returns 500 on unexpected error", async () => {
    vi.mocked(prisma.contract.findFirst).mockRejectedValue(new Error("fail"))

    const res = await DELETE(makeReq("http://localhost:3000/api/v1/contracts/c1"), makeParams("c1"))
    expect(res.status).toBe(500)
  })
})
