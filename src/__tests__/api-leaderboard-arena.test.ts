import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "u1" } }) }))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: (m: string) => NextResponse.json({ error: "Forbidden", module: m }, { status: 403 }),
}))

const AGENTS = vi.hoisted(() => [
  { id: "x", name: "X", rank: 1, volume: 1, volumeFormat: "count", attainmentPct: 100, status: "on_track", metrics: [] },
])
vi.mock("@/lib/leaderboard/sales", () => ({ computeSalesLeaderboard: vi.fn().mockResolvedValue(AGENTS) }))
vi.mock("@/lib/leaderboard/mtm", () => ({ computeMtmLeaderboard: vi.fn().mockResolvedValue(AGENTS) }))
vi.mock("@/lib/leaderboard/tickets", () => ({ computeTicketsLeaderboard: vi.fn().mockResolvedValue(AGENTS) }))
vi.mock("@/lib/leaderboard/projects", () => ({ computeProjectsLeaderboard: vi.fn().mockResolvedValue(AGENTS) }))
vi.mock("@/lib/leaderboard/tasks", () => ({ computeTasksLeaderboard: vi.fn().mockResolvedValue(AGENTS) }))
// C3: the route loads per-org config; mock it to frozen defaults so the test
// exercises routing/RBAC, not the DB-backed loader.
vi.mock("@/lib/leaderboard/config-loader", () => ({
  loadLeaderboardConfig: vi.fn().mockResolvedValue({
    mtmWeights: { task: 0.5, photo: 0.3, route: 0.2 },
    statusThresholds: { exceeding: 110, on_track: 90, behind: 70, at_risk: 50 },
  }),
}))

import { GET } from "@/app/api/v1/leaderboard/arena/route"
import { getSession, getOrgId, orgHasModule } from "@/lib/api-auth"

function req(qs: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/v1/leaderboard/arena${qs}`))
}
function setSession(role: string) {
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u1", role, email: "a@b", name: "A" } as any)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(orgHasModule).mockResolvedValue(true)
})

describe("GET /api/v1/leaderboard/arena", () => {
  it("400 on a missing/invalid group", async () => {
    setSession("admin")
    expect((await GET(req("?group=nope"))).status).toBe(400)
    expect((await GET(req(""))).status).toBe(400)
  })

  it("403 when a non-manager requests a group outside their department", async () => {
    setSession("sales")
    const res = await GET(req("?group=tickets"))
    expect(res.status).toBe(403)
  })

  it("returns normalized agents for an allowed group", async () => {
    setSession("sales")
    const res = await GET(req("?group=sales"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.group).toBe("sales")
    expect(body.period).toBe("quarter") // sales default snaps to quarter
    expect(body.agents).toEqual(AGENTS)
    expect(body.meta.attainmentLabelKey).toBe("leaderboard.att.quota")
  })

  it("403 when the group's module is disabled for the org", async () => {
    setSession("manager")
    vi.mocked(orgHasModule).mockResolvedValue(false)
    const res = await GET(req("?group=mtm"))
    expect(res.status).toBe(403)
    expect((await res.json()).module).toBe("mtm")
  })

  it("superadmin bypasses the module gate", async () => {
    setSession("superadmin")
    const res = await GET(req("?group=mtm"))
    expect(res.status).toBe(200)
    expect(orgHasModule).not.toHaveBeenCalled()
  })

  it("managers can reach every group", async () => {
    setSession("manager")
    for (const g of ["sales", "mtm", "tickets", "projects", "tasks"]) {
      expect((await GET(req(`?group=${g}`))).status).toBe(200)
    }
  })
})
