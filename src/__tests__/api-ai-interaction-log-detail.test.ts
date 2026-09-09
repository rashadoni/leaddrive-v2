import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * A5 — single AI interaction log (debug view). Contracts: admin/manager only
 * (the row carries the raw customer message + model output), org-scoped lookup.
 */

type Auth = { orgId: string; session: { userId: string; role: string } | null }
type RouteHandler = (req: NextRequest, auth: Auth, ctx?: unknown) => Promise<Response>

const state = vi.hoisted(() => ({ role: "admin" }))

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: RouteHandler) => (req: NextRequest, ctx?: unknown) =>
    handler(req, { orgId: "o1", session: { userId: "u1", role: state.role } }, ctx),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { aiInteractionLog: { findFirst: vi.fn() } },
}))

import { GET } from "@/app/api/v1/ai-interaction-logs/[id]/route"
import { prisma } from "@/lib/prisma"

const req = () => new NextRequest("http://localhost/api/v1/ai-interaction-logs/log1")
const ctx = { params: Promise.resolve({ id: "log1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "admin"
  vi.mocked(prisma.aiInteractionLog.findFirst).mockResolvedValue({
    id: "log1", userMessage: "q", aiResponse: "a", kbArticlesUsed: ["Returns"], toolsCalled: [],
  } as never)
})

describe("GET /ai-interaction-logs/[id]", () => {
  it("returns the log for an admin, org-scoped", async () => {
    const res = await GET(req(), ctx as never)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.aiInteractionLog.findFirst).mock.calls[0][0]).toMatchObject({
      where: { id: "log1", organizationId: "o1" },
    })
  })

  it("managers allowed, agents forbidden", async () => {
    state.role = "manager"
    expect((await GET(req(), ctx as never)).status).toBe(200)
    state.role = "agent"
    const res = await GET(req(), ctx as never)
    expect(res.status).toBe(403)
    expect(prisma.aiInteractionLog.findFirst).toHaveBeenCalledTimes(1) // only the manager call hit the DB
  })

  it("404 for another org's log (scoped where finds nothing)", async () => {
    vi.mocked(prisma.aiInteractionLog.findFirst).mockResolvedValue(null as never)
    expect((await GET(req(), ctx as never)).status).toBe(404)
  })
})
