import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * GET/PUT/DELETE /api/v1/leaderboard/config — the KPI Arena per-org config (Phase C4).
 * GET returns the EFFECTIVE config (row merged onto defaults) + a `customized` flag;
 * PUT validates ranges + descending bands + non-zero weight sum, then upserts;
 * DELETE resets to defaults.
 */
const db: { row: { mtmWeights: unknown; statusThresholds: unknown } | null } = { row: null }

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leaderboardConfig: {
      findUnique: vi.fn(async () => db.row),
      upsert: vi.fn(async ({ create, update }: any) => {
        db.row = db.row ? { ...db.row, ...update } : create
        return db.row
      }),
      deleteMany: vi.fn(async () => {
        db.row = null
        return { count: 1 }
      }),
    },
  },
}))
vi.mock("@/lib/with-rls", () => ({
  withRls: (h: any) => (req: any) => h(req, { orgId: "org_1" }),
  withRlsAuth: (_m: string, _a: string, h: any) => (req: any) => h(req, { orgId: "org_1" }),
}))

import { GET, PUT, DELETE } from "@/app/api/v1/leaderboard/config/route"

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/leaderboard/config", {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}
const valid = {
  mtmWeights: { task: 0.5, photo: 0.3, route: 0.2 },
  statusThresholds: { exceeding: 110, on_track: 90, behind: 70, at_risk: 50 },
}

beforeEach(() => {
  db.row = null
  vi.clearAllMocks()
})

describe("leaderboard config route", () => {
  it("GET returns defaults + customized:false when no row", async () => {
    const r = await GET(req("GET"))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.customized).toBe(false)
    expect(j.data.mtmWeights).toEqual({ task: 0.5, photo: 0.3, route: 0.2 })
    expect(j.data.statusThresholds.on_track).toBe(90)
  })

  it("GET merges an existing row over defaults + customized:true", async () => {
    db.row = { mtmWeights: { task: 0.7 }, statusThresholds: { on_track: 80 } }
    const r = await GET(req("GET"))
    const j = await r.json()
    expect(j.customized).toBe(true)
    expect(j.data.mtmWeights.task).toBe(0.7) // override
    expect(j.data.mtmWeights.photo).toBe(0.3) // default kept
    expect(j.data.statusThresholds.on_track).toBe(80) // override
    expect(j.data.statusThresholds.exceeding).toBe(110) // default kept
  })

  it("PUT saves a valid config (upsert) + returns customized:true", async () => {
    const r = await PUT(req("PUT", valid))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.success).toBe(true)
    expect(j.customized).toBe(true)
    expect(db.row).toMatchObject({ mtmWeights: { task: 0.5 } })
  })

  it("PUT rejects an out-of-range weight (>1)", async () => {
    const r = await PUT(req("PUT", { ...valid, mtmWeights: { task: 2, photo: 0.3, route: 0.2 } }))
    expect(r.status).toBe(400)
  })

  it("PUT rejects all-zero weights (sum 0)", async () => {
    const r = await PUT(req("PUT", { ...valid, mtmWeights: { task: 0, photo: 0, route: 0 } }))
    const j = await r.json()
    expect(r.status).toBe(400)
    expect(j.error).toMatch(/weight/i)
  })

  it("PUT rejects non-descending thresholds", async () => {
    const r = await PUT(
      req("PUT", { ...valid, statusThresholds: { exceeding: 80, on_track: 90, behind: 70, at_risk: 50 } }),
    )
    const j = await r.json()
    expect(r.status).toBe(400)
    expect(j.error).toMatch(/descend/i)
  })

  it("DELETE resets to defaults", async () => {
    db.row = { mtmWeights: { task: 0.9 }, statusThresholds: {} }
    const r = await DELETE(req("DELETE"))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.customized).toBe(false)
    expect(db.row).toBeNull()
    expect(j.data.mtmWeights.task).toBe(0.5)
  })
})
