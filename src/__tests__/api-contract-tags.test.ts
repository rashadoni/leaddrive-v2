import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// Mock Prisma — include contractTag model methods
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractTag: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    contract: {
      update: vi.fn(),
    },
  },
}))

// FIX 2: routes now use requireAuth + isAuthError (same as contracts CRUD)
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST } from "@/app/api/v1/contract-tags/route"
import { PUT, DELETE } from "@/app/api/v1/contract-tags/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

/** Happy-path auth result (admin with contracts module enabled) */
const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "admin", email: "a@b.com", name: "Admin" }

beforeEach(() => {
  vi.resetAllMocks()
  // Default: auth succeeds — override per test for 401/403 cases
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
  vi.mocked(isAuthError).mockImplementation((r): r is NextResponse => r instanceof NextResponse)
})

// ─── GET /api/v1/contract-tags ───────────────────────────────────────

describe("GET /api/v1/contract-tags", () => {
  it("returns 401 when requireAuth returns 401 response", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled or insufficient role", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(res.status).toBe(403)
  })

  it("FIX 2: GET uses requireAuth(contracts, read)", async () => {
    vi.mocked(prisma.contractTag.findMany).mockResolvedValue([] as any)
    await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "contracts", "read")
  })

  it("returns org-scoped tags with contract count", async () => {
    vi.mocked(prisma.contractTag.findMany).mockResolvedValue([
      { id: "t1", name: "Priority", color: "#ff0000", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(), _count: { contracts: 3 } },
    ] as any)

    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data[0].id).toBe("t1")
    expect(json.data[0].contractCount).toBe(3)

    const call = vi.mocked(prisma.contractTag.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
  })
})

// ─── POST /api/v1/contract-tags ──────────────────────────────────────

describe("POST /api/v1/contract-tags", () => {
  it("FIX 2: viewer (read-only role) → 403 on POST", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "NDA" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(403)
    // requireAuth must have been called with "write" action
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "contracts", "write")
    // No tag created
    expect(prisma.contractTag.create).not.toHaveBeenCalled()
  })

  it("FIX 2: write-capable role → 201 on POST (requireAuth called with write)", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t2", name: "NDA", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "NDA" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "contracts", "write")
  })

  it("creates a tag with name only", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t2", name: "NDA", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "NDA" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("NDA")
  })

  it("creates a tag with name and color", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t3", name: "Priority", color: "#4f46e5", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "Priority", color: "#4f46e5" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.color).toBe("#4f46e5")
  })

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ color: "#ff0000" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when color format is invalid", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "MyTag", color: "red" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(400)
  })

  it("returns 409 on duplicate name (Prisma P2002)", async () => {
    vi.mocked(prisma.contractTag.create).mockRejectedValue({ code: "P2002" })
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "NDA" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(409)
  })

  it("scopes creation to requesting org", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t4", name: "Test", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
      headers: { "Content-Type": "application/json" },
    }))
    const createCall = vi.mocked(prisma.contractTag.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
  })
})

// ─── PUT /api/v1/contract-tags/[id] ──────────────────────────────────

describe("PUT /api/v1/contract-tags/[id]", () => {
  it("FIX 2: viewer (read-only role) → 403 on PUT", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/t1", {
        method: "PUT",
        body: JSON.stringify({ name: "Renamed" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "contracts", "write")
    expect(prisma.contractTag.update).not.toHaveBeenCalled()
  })

  it("returns 404 when tag not found in org", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue(null)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/t99", {
        method: "PUT",
        body: JSON.stringify({ name: "Renamed" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("t99"),
    )
    expect(res.status).toBe(404)
  })

  it("renames and recolors a tag (org-scoped)", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue({
      id: "t1", name: "Old", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    vi.mocked(prisma.contractTag.update).mockResolvedValue({
      id: "t1", name: "Renamed", color: "#00ff00", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/t1", {
        method: "PUT",
        body: JSON.stringify({ name: "Renamed", color: "#00ff00" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Renamed")
    expect(json.data.color).toBe("#00ff00")

    // Verify findFirst was called with orgId guard
    const findCall = vi.mocked(prisma.contractTag.findFirst).mock.calls[0][0] as any
    expect(findCall.where.organizationId).toBe("org-1")
  })

  it("blocks cross-tenant: tag from org-2 returns 404 for org-1 request", async () => {
    // findFirst returns null (org-scoped — org-2 tag won't match)
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue(null)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/other-org-tag", {
        method: "PUT",
        body: JSON.stringify({ name: "Stolen" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("other-org-tag"),
    )
    expect(res.status).toBe(404)
  })
})

// ─── DELETE /api/v1/contract-tags/[id] ───────────────────────────────

describe("DELETE /api/v1/contract-tags/[id]", () => {
  it("FIX 2: viewer (read-only role) → 403 on DELETE", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any
    )
    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-tags/t1", { method: "DELETE" }),
      makeParams("t1"),
    )
    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "contracts", "delete")
    expect(prisma.contractTag.delete).not.toHaveBeenCalled()
  })

  it("deletes tag and returns 200", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue({
      id: "t1", name: "Obsolete", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    vi.mocked(prisma.contractTag.delete).mockResolvedValue({} as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-tags/t1", { method: "DELETE" }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe("t1")
  })

  it("returns 404 for cross-tenant tag", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue(null)
    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-tags/not-mine", { method: "DELETE" }),
      makeParams("not-mine"),
    )
    expect(res.status).toBe(404)
  })
})
