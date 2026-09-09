/**
 * M4-5 — API route tests for /api/v1/mtm/regions (list + create)
 * and /api/v1/mtm/regions/[id] (detail + update + soft-delete).
 *
 * Spec: Region is the top-level tier in Region → Team → Agent hierarchy.
 * All routes gate on organizationId (multi-tenant). Deletes are soft
 * (isActive=false) to preserve FK integrity for child teams.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/mobile-auth", () => ({
  // Default: no mobile JWT (web admin panel caller) — passes the role gate
  getMobileAuth: vi.fn(() => null),
}))

import { GET as listRegions, POST as createRegion } from "@/app/api/v1/mtm/regions/route"
import { GET as getRegion, PATCH as patchRegion, DELETE as deleteRegion } from "@/app/api/v1/mtm/regions/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { getMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-mars"

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init)
}

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function patchReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function deleteReq(url: string): NextRequest {
  return new NextRequest(url, { method: "DELETE" })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  // Default: no mobile JWT → web admin panel caller, no role gate
  vi.mocked(getMobileAuth).mockReturnValue(null)
})

// ─── LIST ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/mtm/regions", () => {
  it("returns active regions by default", async () => {
    const regions = [
      { id: "r1", name: "Baku", isActive: true, _count: { teams: 3 } },
      { id: "r2", name: "Sumgait", isActive: true, _count: { teams: 1 } },
    ]
    vi.mocked(prisma.mtmRegion.findMany).mockResolvedValue(regions as any)

    const res = await listRegions(req("http://localhost/api/v1/mtm/regions"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.regions).toHaveLength(2)
    expect(body.data.total).toBe(2)

    // isActive=true filter applied by default
    const { where } = vi.mocked(prisma.mtmRegion.findMany).mock.calls[0][0] as any
    expect(where.isActive).toBe(true)
    expect(where.organizationId).toBe(ORG)
  })

  it("includes inactive regions when includeInactive=true", async () => {
    vi.mocked(prisma.mtmRegion.findMany).mockResolvedValue([
      { id: "r1", name: "Baku", isActive: false, _count: { teams: 0 } },
    ] as any)

    const res = await listRegions(
      req("http://localhost/api/v1/mtm/regions?includeInactive=true"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    const { where } = vi.mocked(prisma.mtmRegion.findMany).mock.calls[0][0] as any
    // isActive filter must be absent when includeInactive=true
    expect(where.isActive).toBeUndefined()
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await listRegions(req("http://localhost/api/v1/mtm/regions"))
    expect(res.status).toBe(401)
  })
})

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe("POST /api/v1/mtm/regions", () => {
  it("creates a region and returns 201", async () => {
    const created = {
      id: "r-new", organizationId: ORG, name: "Ganja", code: "GNJ",
      description: null, isActive: true,
    }
    vi.mocked(prisma.mtmRegion.create).mockResolvedValue(created as any)

    const res = await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { name: "Ganja", code: "GNJ" }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.region.name).toBe("Ganja")

    const { data } = vi.mocked(prisma.mtmRegion.create).mock.calls[0][0] as any
    expect(data.organizationId).toBe(ORG)
    expect(data.name).toBe("Ganja")
    expect(data.code).toBe("GNJ")
  })

  it("trims whitespace from name", async () => {
    vi.mocked(prisma.mtmRegion.create).mockResolvedValue({
      id: "r2", name: "Lenkoran", isActive: true,
    } as any)
    await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { name: "  Lenkoran  " }),
    )
    const { data } = vi.mocked(prisma.mtmRegion.create).mock.calls[0][0] as any
    expect(data.name).toBe("Lenkoran")
  })

  it("returns 400 when name is missing", async () => {
    const res = await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { code: "XX" }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/)
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { name: "X" }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when mobile JWT caller has AGENT role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "AGENT" } as any)
    const res = await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { name: "X" }),
    )
    expect(res.status).toBe(403)
  })

  it("allows mobile JWT caller with MANAGER role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "MANAGER" } as any)
    // DB re-check must confirm the agent still holds the role (P2 stale-JWT fix)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1" } as any)
    vi.mocked(prisma.mtmRegion.create).mockResolvedValue({ id: "r1", name: "X", isActive: true } as any)
    const res = await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { name: "X" }),
    )
    expect(res.status).toBe(201)
  })

  it("returns 403 when JWT claims MANAGER but DB re-check fails (stale JWT)", async () => {
    // Simulates a demoted agent: JWT still says MANAGER but the DB row was updated
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "MANAGER" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null) // DB: no longer admin
    const res = await createRegion(
      jsonReq("http://localhost/api/v1/mtm/regions", { name: "X" }),
    )
    expect(res.status).toBe(403)
  })
})

// ─── DETAIL ──────────────────────────────────────────────────────────────────

describe("GET /api/v1/mtm/regions/[id]", () => {
  const PARAMS = Promise.resolve({ id: "r1" })

  it("returns region with active teams", async () => {
    const region = {
      id: "r1", name: "Baku", isActive: true,
      teams: [
        { id: "t1", name: "North Team", isActive: true, _count: { agents: 5 } },
      ],
    }
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue(region as any)

    const res = await getRegion(req("http://localhost/api/v1/mtm/regions/r1"), { params: PARAMS })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.region.id).toBe("r1")
    expect(body.data.region.teams).toHaveLength(1)

    const { where } = vi.mocked(prisma.mtmRegion.findFirst).mock.calls[0][0] as any
    expect(where.id).toBe("r1")
    expect(where.organizationId).toBe(ORG)
  })

  it("returns 404 when region not in org", async () => {
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue(null)
    const res = await getRegion(req("http://localhost/api/v1/mtm/regions/r-missing"), { params: Promise.resolve({ id: "r-missing" }) })
    expect(res.status).toBe(404)
  })
})

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe("PATCH /api/v1/mtm/regions/[id]", () => {
  const PARAMS = Promise.resolve({ id: "r1" })

  it("updates name and returns updated region", async () => {
    vi.mocked(prisma.mtmRegion.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue({
      id: "r1", name: "Baku City", isActive: true,
    } as any)

    const res = await patchRegion(
      patchReq("http://localhost/api/v1/mtm/regions/r1", { name: "Baku City" }),
      { params: PARAMS },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.region.name).toBe("Baku City")

    const { data, where } = vi.mocked(prisma.mtmRegion.updateMany).mock.calls[0][0] as any
    expect(data.name).toBe("Baku City")
    expect(where.id).toBe("r1")
    expect(where.organizationId).toBe(ORG)
  })

  it("can soft-activate (isActive toggle)", async () => {
    vi.mocked(prisma.mtmRegion.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue({
      id: "r1", name: "Baku", isActive: false,
    } as any)

    const res = await patchRegion(
      patchReq("http://localhost/api/v1/mtm/regions/r1", { isActive: false }),
      { params: PARAMS },
    )
    const body = await res.json()
    expect(res.status).toBe(200)

    const { data } = vi.mocked(prisma.mtmRegion.updateMany).mock.calls[0][0] as any
    expect(data.isActive).toBe(false)
  })

  it("returns 404 when region not found (updateMany count=0)", async () => {
    vi.mocked(prisma.mtmRegion.updateMany).mockResolvedValue({ count: 0 })
    const res = await patchRegion(
      patchReq("http://localhost/api/v1/mtm/regions/r-gone", { name: "X" }),
      { params: Promise.resolve({ id: "r-gone" }) },
    )
    expect(res.status).toBe(404)
  })

  it("returns 403 when mobile JWT caller has SUPERVISOR role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "SUPERVISOR" } as any)
    const res = await patchRegion(
      patchReq("http://localhost/api/v1/mtm/regions/r1", { name: "X" }),
      { params: Promise.resolve({ id: "r1" }) },
    )
    expect(res.status).toBe(403)
  })
})

// ─── DELETE (soft-delete) ────────────────────────────────────────────────────

describe("DELETE /api/v1/mtm/regions/[id]", () => {
  it("soft-deletes region (sets isActive=false)", async () => {
    vi.mocked(prisma.mtmRegion.updateMany).mockResolvedValue({ count: 1 })

    const res = await deleteRegion(
      deleteReq("http://localhost/api/v1/mtm/regions/r1"),
      { params: Promise.resolve({ id: "r1" }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)

    const { data, where } = vi.mocked(prisma.mtmRegion.updateMany).mock.calls[0][0] as any
    expect(data.isActive).toBe(false)
    expect(where.id).toBe("r1")
    expect(where.organizationId).toBe(ORG)
  })

  it("returns 404 when region not found", async () => {
    vi.mocked(prisma.mtmRegion.updateMany).mockResolvedValue({ count: 0 })
    const res = await deleteRegion(
      deleteReq("http://localhost/api/v1/mtm/regions/r-gone"),
      { params: Promise.resolve({ id: "r-gone" }) },
    )
    expect(res.status).toBe(404)
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await deleteRegion(
      deleteReq("http://localhost/api/v1/mtm/regions/r1"),
      { params: Promise.resolve({ id: "r1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when mobile JWT caller has AGENT role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "AGENT" } as any)
    const res = await deleteRegion(
      deleteReq("http://localhost/api/v1/mtm/regions/r1"),
      { params: Promise.resolve({ id: "r1" }) },
    )
    expect(res.status).toBe(403)
  })
})
