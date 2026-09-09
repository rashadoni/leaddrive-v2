/**
 * M4-5 — API route tests for /api/v1/mtm/teams (list + create)
 * and /api/v1/mtm/teams/[id] (detail + update + soft-delete).
 *
 * Spec: Team is the mid-level tier in Region → Team → Agent hierarchy.
 * Teams can be optionally scoped to a region. PATCH validates regionId
 * belongs to the same org before writing. Deletes are soft (isActive=false).
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
  getMobileAuth: vi.fn(() => null),
}))

import { GET as listTeams, POST as createTeam } from "@/app/api/v1/mtm/teams/route"
import { GET as getTeam, PATCH as patchTeam, DELETE as deleteTeam } from "@/app/api/v1/mtm/teams/[id]/route"
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
  vi.mocked(getMobileAuth).mockReturnValue(null)
})

// ─── LIST ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/mtm/teams", () => {
  it("returns active teams for the org", async () => {
    const teams = [
      { id: "t1", name: "Alpha", isActive: true, region: { id: "r1", name: "Baku" }, _count: { agents: 4 } },
      { id: "t2", name: "Bravo", isActive: true, region: null, _count: { agents: 2 } },
    ]
    vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue(teams as any)

    const res = await listTeams(req("http://localhost/api/v1/mtm/teams"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.teams).toHaveLength(2)
    expect(body.data.total).toBe(2)

    const { where } = vi.mocked(prisma.mtmTeam.findMany).mock.calls[0][0] as any
    expect(where.organizationId).toBe(ORG)
    expect(where.isActive).toBe(true)
    expect(where.regionId).toBeUndefined()
  })

  it("filters by regionId when provided", async () => {
    vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([
      { id: "t1", name: "Alpha", isActive: true, region: { id: "r1", name: "Baku" }, _count: { agents: 4 } },
    ] as any)

    const res = await listTeams(req("http://localhost/api/v1/mtm/teams?regionId=r1"))
    await res.json()

    const { where } = vi.mocked(prisma.mtmTeam.findMany).mock.calls[0][0] as any
    expect(where.regionId).toBe("r1")
  })

  it("includes inactive teams when includeInactive=true", async () => {
    vi.mocked(prisma.mtmTeam.findMany).mockResolvedValue([
      { id: "t-old", name: "Old Team", isActive: false, region: null, _count: { agents: 0 } },
    ] as any)

    const res = await listTeams(req("http://localhost/api/v1/mtm/teams?includeInactive=true"))
    await res.json()

    const { where } = vi.mocked(prisma.mtmTeam.findMany).mock.calls[0][0] as any
    expect(where.isActive).toBeUndefined()
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await listTeams(req("http://localhost/api/v1/mtm/teams"))
    expect(res.status).toBe(401)
  })
})

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe("POST /api/v1/mtm/teams", () => {
  it("creates a team without regionId", async () => {
    const created = { id: "t-new", name: "Delta", code: null, regionId: null, isActive: true }
    vi.mocked(prisma.mtmTeam.create).mockResolvedValue(created as any)

    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { name: "Delta" }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.team.name).toBe("Delta")

    const { data } = vi.mocked(prisma.mtmTeam.create).mock.calls[0][0] as any
    expect(data.organizationId).toBe(ORG)
    expect(data.regionId).toBeNull()
  })

  it("creates team with valid regionId (validates org ownership)", async () => {
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue({ id: "r1" } as any)
    vi.mocked(prisma.mtmTeam.create).mockResolvedValue({
      id: "t-new", name: "North Team", regionId: "r1", isActive: true,
      region: { id: "r1", name: "Baku" },
    } as any)

    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { name: "North Team", regionId: "r1" }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)

    // Region ownership check must use organizationId
    const regionQuery = vi.mocked(prisma.mtmRegion.findFirst).mock.calls[0][0] as any
    expect(regionQuery.where).toMatchObject({ id: "r1", organizationId: ORG })
  })

  it("returns 400 when regionId doesn't belong to org", async () => {
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue(null)

    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { name: "X", regionId: "r-foreign" }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/regionId/)
  })

  it("returns 400 when name is missing", async () => {
    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { code: "YY" }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name/)
  })

  it("returns 403 when mobile JWT caller has AGENT role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "AGENT" } as any)
    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { name: "X" }),
    )
    expect(res.status).toBe(403)
  })

  it("allows mobile JWT caller with ADMIN role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    // DB re-check must confirm the agent still holds the role (P2 stale-JWT fix)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1" } as any)
    vi.mocked(prisma.mtmTeam.create).mockResolvedValue({
      id: "t-new", name: "X", regionId: null, isActive: true, region: null,
    } as any)
    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { name: "X" }),
    )
    expect(res.status).toBe(201)
  })

  it("returns 403 when JWT claims ADMIN but DB re-check fails (stale JWT)", async () => {
    // Simulates a demoted agent: JWT still says ADMIN but the DB row was updated
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "ADMIN" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null) // DB: no longer admin
    const res = await createTeam(
      jsonReq("http://localhost/api/v1/mtm/teams", { name: "X" }),
    )
    expect(res.status).toBe(403)
  })
})

// ─── DETAIL ──────────────────────────────────────────────────────────────────

describe("GET /api/v1/mtm/teams/[id]", () => {
  it("returns team with active agents", async () => {
    const team = {
      id: "t1", name: "Alpha", isActive: true,
      region: { id: "r1", name: "Baku", code: "BAK" },
      agents: [
        { id: "a1", name: "Ali", role: "AGENT", email: null, avatar: null },
        { id: "a2", name: "Vali", role: "SUPERVISOR", email: "v@test.com", avatar: null },
      ],
    }
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue(team as any)

    const res = await getTeam(
      req("http://localhost/api/v1/mtm/teams/t1"),
      { params: Promise.resolve({ id: "t1" }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.team.id).toBe("t1")
    expect(body.data.team.agents).toHaveLength(2)

    const { where } = vi.mocked(prisma.mtmTeam.findFirst).mock.calls[0][0] as any
    expect(where).toMatchObject({ id: "t1", organizationId: ORG })
  })

  it("returns 404 when team not found", async () => {
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue(null)
    const res = await getTeam(
      req("http://localhost/api/v1/mtm/teams/t-gone"),
      { params: Promise.resolve({ id: "t-gone" }) },
    )
    expect(res.status).toBe(404)
  })
})

// ─── PATCH ───────────────────────────────────────────────────────────────────

describe("PATCH /api/v1/mtm/teams/[id]", () => {
  it("updates team name", async () => {
    vi.mocked(prisma.mtmTeam.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({
      id: "t1", name: "Alpha Renamed", isActive: true, region: null,
    } as any)

    const res = await patchTeam(
      patchReq("http://localhost/api/v1/mtm/teams/t1", { name: "Alpha Renamed" }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.team.name).toBe("Alpha Renamed")

    const { data, where } = vi.mocked(prisma.mtmTeam.updateMany).mock.calls[0][0] as any
    expect(data.name).toBe("Alpha Renamed")
    expect(where.id).toBe("t1")
    expect(where.organizationId).toBe(ORG)
  })

  it("validates regionId org-ownership on update", async () => {
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue({ id: "r2" } as any)
    vi.mocked(prisma.mtmTeam.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({
      id: "t1", name: "Alpha", regionId: "r2", isActive: true, region: { id: "r2", name: "Sumgait" },
    } as any)

    const res = await patchTeam(
      patchReq("http://localhost/api/v1/mtm/teams/t1", { regionId: "r2" }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(200)

    const regionQuery = vi.mocked(prisma.mtmRegion.findFirst).mock.calls[0][0] as any
    expect(regionQuery.where).toMatchObject({ id: "r2", organizationId: ORG })
  })

  it("returns 400 when new regionId not in org", async () => {
    vi.mocked(prisma.mtmRegion.findFirst).mockResolvedValue(null)

    const res = await patchTeam(
      patchReq("http://localhost/api/v1/mtm/teams/t1", { regionId: "r-foreign" }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/regionId/)
  })

  it("allows detaching from region (regionId: null)", async () => {
    vi.mocked(prisma.mtmTeam.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.mtmTeam.findFirst).mockResolvedValue({
      id: "t1", name: "Alpha", regionId: null, isActive: true, region: null,
    } as any)

    const res = await patchTeam(
      patchReq("http://localhost/api/v1/mtm/teams/t1", { regionId: null }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(200)

    const { data } = vi.mocked(prisma.mtmTeam.updateMany).mock.calls[0][0] as any
    expect(data.regionId).toBeNull()
    // Region ownership check is NOT called for null regionId
    expect(prisma.mtmRegion.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when team not found (updateMany count=0)", async () => {
    vi.mocked(prisma.mtmTeam.updateMany).mockResolvedValue({ count: 0 })
    const res = await patchTeam(
      patchReq("http://localhost/api/v1/mtm/teams/t-gone", { name: "X" }),
      { params: Promise.resolve({ id: "t-gone" }) },
    )
    expect(res.status).toBe(404)
  })

  it("returns 403 when mobile JWT caller has SUPERVISOR role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "SUPERVISOR" } as any)
    const res = await patchTeam(
      patchReq("http://localhost/api/v1/mtm/teams/t1", { name: "X" }),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(403)
  })
})

// ─── DELETE (soft-delete) ────────────────────────────────────────────────────

describe("DELETE /api/v1/mtm/teams/[id]", () => {
  it("soft-deletes team (sets isActive=false)", async () => {
    vi.mocked(prisma.mtmTeam.updateMany).mockResolvedValue({ count: 1 })

    const res = await deleteTeam(
      deleteReq("http://localhost/api/v1/mtm/teams/t1"),
      { params: Promise.resolve({ id: "t1" }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)

    const { data, where } = vi.mocked(prisma.mtmTeam.updateMany).mock.calls[0][0] as any
    expect(data.isActive).toBe(false)
    expect(where.id).toBe("t1")
    expect(where.organizationId).toBe(ORG)
  })

  it("returns 404 when team not found", async () => {
    vi.mocked(prisma.mtmTeam.updateMany).mockResolvedValue({ count: 0 })
    const res = await deleteTeam(
      deleteReq("http://localhost/api/v1/mtm/teams/t-gone"),
      { params: Promise.resolve({ id: "t-gone" }) },
    )
    expect(res.status).toBe(404)
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await deleteTeam(
      deleteReq("http://localhost/api/v1/mtm/teams/t1"),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when mobile JWT caller has AGENT role", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "a1", role: "AGENT" } as any)
    const res = await deleteTeam(
      deleteReq("http://localhost/api/v1/mtm/teams/t1"),
      { params: Promise.resolve({ id: "t1" }) },
    )
    expect(res.status).toBe(403)
  })
})
