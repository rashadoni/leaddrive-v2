import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * B1 — per-channel AI aggregates. Contracts: org comes from RLS (parameterized into
 * the SQL), days clamps to 7|30, percentages derived server-side with null guards
 * (0 resolved → null effectiveness, not 0% — "no data" ≠ "AI closes nothing").
 */
type RouteHandler = (req: NextRequest, auth: { orgId: string; session: unknown }, ctx?: unknown) => Promise<Response>
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) => (req: NextRequest, ctx?: unknown) =>
    handler(req, { orgId: "o1", session: null }, ctx),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }))

import { GET } from "@/app/api/v1/inbox/stats/channels/route"
import { prisma } from "@/lib/prisma"

const req = (q = "") => new NextRequest(`http://localhost/api/v1/inbox/stats/channels${q}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([
    { channel: "web-chat", volume: 10, avg_frt_min: 1.234, resolved: 4, ai_resolved: 3, escalated: 2 },
    { channel: "telegram", volume: 5, avg_frt_min: null, resolved: 0, ai_resolved: 0, escalated: 0 },
  ] as never)
})

describe("GET /inbox/stats/channels", () => {
  it("returns derived percentages and rounded FRT", async () => {
    const res = await GET(req("?days=30"), {} as never)
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(j.data.days).toBe(30)
    const [wc, tg] = j.data.channels
    expect(wc).toMatchObject({
      channel: "web-chat", volume: 10, avgFirstResponseMinutes: 1.2,
      aiEffectivenessPct: 75, escalationSharePct: 20,
    })
    // zero resolved → null effectiveness (no data), not 0%
    expect(tg.aiEffectivenessPct).toBeNull()
    expect(tg.avgFirstResponseMinutes).toBeNull()
  })

  it("clamps days to the 7|30 whitelist (default 7)", async () => {
    const j = await (await GET(req("?days=9999"), {} as never)).json()
    expect(j.data.days).toBe(7)
  })

  it("parameterizes the org id into the SQL (tenant scoping)", async () => {
    await GET(req(), {} as never)
    const args = vi.mocked(prisma.$queryRaw).mock.calls[0]
    expect(JSON.stringify(args.slice(1))).toContain("o1")
  })
})
