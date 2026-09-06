import { beforeEach, describe, expect, it, vi } from "vitest"

type TestAuth = { orgId: string; userId: string; role: string }
let auth: TestAuth = { orgId: "org-1", userId: "manager-1", role: "manager" }

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  },
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (request: Request, actor: TestAuth) => Promise<Response>) =>
    (request: Request) => handler(request, auth),
}))

import { GET, PATCH } from "@/app/api/v1/skill-routing/agents/route"
import { checkPermission } from "@/lib/permissions"
import { logAudit, prisma } from "@/lib/prisma"

const request = (init?: RequestInit) => new Request("http://localhost/api/v1/skill-routing/agents", init) as never

describe("skill routing agents API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth = { orgId: "org-1", userId: "manager-1", role: "manager" }
    vi.mocked(checkPermission).mockReturnValue(true)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
  })

  it("returns tenant routing agents and manager capability", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "a1", name: "Agent", role: "support", skills: ["billing"], isAvailable: true, isActive: true }] as never)
    const response = await GET(request({ headers: { "x-skill-routing-view": "routing" } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ permissions: { canWrite: true }, data: [{ id: "a1" }] })
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }))
  })

  it("keeps support agents read-only even when they can write tickets", async () => {
    auth = { orgId: "org-1", userId: "support-1", role: "support" }
    const response = await PATCH(request({ method: "PATCH", body: JSON.stringify({ agentIds: ["a1"], skills: ["billing"], mode: "add" }) }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "ROUTING_WRITE_FORBIDDEN" })
  })

  it("updates selected agents atomically and audits old and new skills", async () => {
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "a1", name: "Agent", skills: ["vip"] }] as never)
      .mockResolvedValueOnce([{ id: "a1", name: "Agent", role: "support", skills: ["billing", "vip"], isAvailable: true, isActive: true }] as never)
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "a1" } as never)
    const response = await PATCH(request({ method: "PATCH", body: JSON.stringify({ agentIds: ["a1"], skills: [" Billing "], mode: "add" }) }))
    expect(response.status).toBe(200)
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { skills: ["billing", "vip"] } })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledWith("org-1", "routing_skills_updated", "user", "a1", "Agent", expect.objectContaining({ oldValue: { skills: ["vip"] } }))
  })

  it("fails closed when any selected agent is outside the tenant or routing role set", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
    const response = await PATCH(request({ method: "PATCH", body: JSON.stringify({ agentIds: ["missing"], skills: ["billing"], mode: "remove" }) }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "ROUTING_AGENT_NOT_FOUND" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
