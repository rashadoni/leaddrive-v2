/**
 * CLM Slice 3d — Tests for Contract Intake Forms CRUD:
 *   GET  /api/v1/contract-intake-forms  — org-scoped list
 *   POST /api/v1/contract-intake-forms  — create (admin only)
 *   GET  /api/v1/contract-intake-forms/:id
 *   PUT  /api/v1/contract-intake-forms/:id  — update (admin only)
 *   DELETE /api/v1/contract-intake-forms/:id  — soft-deactivate (admin only)
 *
 * Coverage:
 *   - Module gate (403 when contracts module off)
 *   - Org-scope: form in another org → 404
 *   - Admin-only writes: member/manager → 403
 *   - Validation: missing required questions fields → 400
 *   - defaultStages max 10
 *   - DELETE is soft (isActive→false), not hard-delete
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractIntakeForm: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(
    (_moduleId: string) =>
      new NextResponse(JSON.stringify({ error: "Module disabled" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

import { GET, POST } from "@/app/api/v1/contract-intake-forms/route"
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/v1/contract-intake-forms/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const ADMIN_SESSION = { userId: "u1", orgId: "org-1", role: "admin" }
const MEMBER_SESSION = { userId: "u2", orgId: "org-1", role: "member" }
const MANAGER_SESSION = { userId: "u3", orgId: "org-1", role: "manager" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue(ADMIN_SESSION as any)
  vi.mocked(orgHasModule).mockResolvedValue(true)
})

// ─── GET /api/v1/contract-intake-forms ─────────────────────────────────────

describe("GET /api/v1/contract-intake-forms", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-intake-forms"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when contracts module disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as any)
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-intake-forms"))
    expect(res.status).toBe(403)
  })

  it("returns forms for the org", async () => {
    const forms = [{ id: "f1", name: "NDA Request", isActive: true, _count: { submissions: 2 } }]
    vi.mocked(prisma.contractIntakeForm.findMany).mockResolvedValue(forms as any)
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-intake-forms"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(forms)
  })

  it("passes isActive filter to Prisma", async () => {
    vi.mocked(prisma.contractIntakeForm.findMany).mockResolvedValue([])
    await GET(makeReq("http://localhost:3000/api/v1/contract-intake-forms?isActive=false"))
    const call = vi.mocked(prisma.contractIntakeForm.findMany).mock.calls[0][0] as any
    expect(call.where.isActive).toBe(false)
  })
})

// ─── POST /api/v1/contract-intake-forms ────────────────────────────────────

describe("POST /api/v1/contract-intake-forms", () => {
  const validPayload = {
    name: "Service Agreement Request",
    contractType: "service_agreement",
    questions: [
      { id: "q1", label: "Project name", type: "text", required: true },
    ],
    mapping: { q1: "title" },
    defaultStages: [],
  }

  it("returns 403 for member role", async () => {
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as any)
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify(validPayload),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 403 for manager role", async () => {
    vi.mocked(getSession).mockResolvedValue(MANAGER_SESSION as any)
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify(validPayload),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 400 when name is missing", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify({ ...validPayload, name: "" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when question is missing id", async () => {
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify({
          ...validPayload,
          questions: [{ label: "Foo", type: "text", required: true }],
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when defaultStages exceeds 10", async () => {
    const tooManyStages = Array.from({ length: 11 }, (_, i) => ({ label: `Stage ${i + 1}` }))
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify({ ...validPayload, defaultStages: tooManyStages }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("creates form and returns 201 for admin", async () => {
    const created = { id: "f1", ...validPayload, isActive: true, createdAt: new Date().toISOString() }
    vi.mocked(prisma.contractIntakeForm.create).mockResolvedValue(created as any)
    const res = await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify(validPayload),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("f1")
  })

  it("passes organizationId + createdBy from session", async () => {
    vi.mocked(prisma.contractIntakeForm.create).mockResolvedValue({ id: "f1" } as any)
    await POST(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms", {
        method: "POST",
        body: JSON.stringify(validPayload),
        headers: { "Content-Type": "application/json" },
      }),
    )
    const callData = vi.mocked(prisma.contractIntakeForm.create).mock.calls[0][0].data
    expect(callData.organizationId).toBe("org-1")
    expect(callData.createdBy).toBe("u1")
  })
})

// ─── GET /api/v1/contract-intake-forms/:id ─────────────────────────────────

describe("GET /api/v1/contract-intake-forms/:id", () => {
  it("returns 404 when form belongs to another org", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(null)
    const res = await GET_BY_ID(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f-other"),
      makeParams("f-other"),
    )
    expect(res.status).toBe(404)
  })

  it("returns form when org matches", async () => {
    const form = { id: "f1", name: "NDA Request", isActive: true, _count: { submissions: 0 } }
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(form as any)
    const res = await GET_BY_ID(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f1"),
      makeParams("f1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.id).toBe("f1")
  })
})

// ─── PUT /api/v1/contract-intake-forms/:id ─────────────────────────────────

describe("PUT /api/v1/contract-intake-forms/:id", () => {
  it("returns 403 for member", async () => {
    vi.mocked(getSession).mockResolvedValue(MEMBER_SESSION as any)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f1", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("f1"),
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when form not in org", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue(null)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f-other", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("f-other"),
    )
    expect(res.status).toBe(404)
  })

  it("updates and returns form", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue({ id: "f1" } as any)
    const updated = { id: "f1", name: "Updated" }
    vi.mocked(prisma.contractIntakeForm.update).mockResolvedValue(updated as any)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f1", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("f1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Updated")
  })
})

// ─── DELETE /api/v1/contract-intake-forms/:id ──────────────────────────────

describe("DELETE /api/v1/contract-intake-forms/:id", () => {
  it("returns 403 for manager", async () => {
    vi.mocked(getSession).mockResolvedValue(MANAGER_SESSION as any)
    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f1", { method: "DELETE" }),
      makeParams("f1"),
    )
    expect(res.status).toBe(403)
  })

  it("soft-deactivates (sets isActive=false) rather than hard-deleting", async () => {
    vi.mocked(prisma.contractIntakeForm.findFirst).mockResolvedValue({ id: "f1" } as any)
    vi.mocked(prisma.contractIntakeForm.update).mockResolvedValue({ id: "f1", isActive: false } as any)
    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-intake-forms/f1", { method: "DELETE" }),
      makeParams("f1"),
    )
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.contractIntakeForm.update).mock.calls[0][0]
    expect(updateCall.data.isActive).toBe(false)
    // Ensure delete was NOT called
    expect(vi.mocked(prisma.contractIntakeForm).delete).toBeUndefined()
  })
})
