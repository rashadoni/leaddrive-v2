import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    planTemplate: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    organization: { count: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: vi.fn() }))

import { GET, POST } from "@/app/api/v1/admin/plans/route"
import { PATCH, DELETE } from "@/app/api/v1/admin/plans/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"

const AUTH = { orgId: "org-1", userId: "user-1", role: "superadmin", email: "a@b.c", name: "A" }
const makeReq = (init?: any) => new NextRequest(new URL("http://localhost/api/v1/admin/plans"), init)
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSuperAdmin).mockResolvedValue(AUTH as any)
})

describe("GET /api/v1/admin/plans", () => {
  it("lists plans for superadmin", async () => {
    vi.mocked(prisma.planTemplate.findMany).mockResolvedValue([{ id: "p1", key: "starter" }] as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(1)
  })
})

describe("POST /api/v1/admin/plans", () => {
  it("rejects an unknown feature key (400)", async () => {
    const res = await POST(makeReq({ method: "POST", body: JSON.stringify({ key: "pharma", name: "Pharma", features: ["nope"], addons: [], maxUsers: 10, maxContacts: 100 }) }))
    expect(res.status).toBe(400)
  })
  it("creates a valid plan (201)", async () => {
    vi.mocked(prisma.planTemplate.create).mockResolvedValue({ id: "p9", key: "pharma" } as any)
    // Group-vocab feature — legacy fine ids (e.g. "deals") left FEATURE_CATALOG
    // at the narrow-union task and are rejected like any unknown key.
    const res = await POST(makeReq({ method: "POST", body: JSON.stringify({ key: "pharma", name: "Pharma", features: ["crm"], addons: ["ai"], maxUsers: 40, maxContacts: 9000 }) }))
    expect(res.status).toBe(201)
  })
})

describe("DELETE /api/v1/admin/plans/[id]", () => {
  it("blocks delete when the plan is in use (409)", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.planTemplate.findUnique).mockResolvedValue({ id: "p1", key: "starter" } as any)
    vi.mocked(prisma.organization.count).mockResolvedValue(2)
    const res = await DELETE(makeReq({ method: "DELETE" }), makeParams("p1"))
    expect(res.status).toBe(409)
  })
  it("deletes when unused (200)", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.planTemplate.findUnique).mockResolvedValue({ id: "p1", key: "ghost" } as any)
    vi.mocked(prisma.organization.count).mockResolvedValue(0)
    vi.mocked(prisma.planTemplate.delete).mockResolvedValue({ id: "p1" } as any)
    const res = await DELETE(makeReq({ method: "DELETE" }), makeParams("p1"))
    expect(res.status).toBe(200)
  })
})

describe("PATCH /api/v1/admin/plans/[id]", () => {
  it("rejects unknown addon (400)", async () => {
    const res = await PATCH(makeReq({ method: "PATCH", body: JSON.stringify({ addons: ["nope"] }) }), makeParams("p1"))
    expect(res.status).toBe(400)
  })
  it("updates a plan (200)", async () => {
    vi.mocked(prisma.planTemplate.update).mockResolvedValue({ id: "p1", name: "Renamed" } as any)
    const res = await PATCH(makeReq({ method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }), makeParams("p1"))
    expect(res.status).toBe(200)
  })
})
