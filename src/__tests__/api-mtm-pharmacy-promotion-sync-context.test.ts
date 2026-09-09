import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authState = vi.hoisted(() => ({ organizationId: "org-1", userId: "agent-user" }))

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-mtm-rls-auth", () => ({
  withMtmRlsAuth: (_module: unknown, _action: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest) => handler(req, {
      orgId: authState.organizationId,
      userId: authState.userId,
      role: "member",
      email: "agent@example.com",
      name: "Agent",
      agentId: "agent-1",
      principal: "web",
    }),
}))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { GET as getSyncContext } from "@/app/api/v1/mtm/pharmacy-promotion-executions/sync-context/route"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

function request() {
  return new NextRequest("http://localhost/api/v1/mtm/pharmacy-promotion-executions/sync-context")
}

describe("SWM-09 tenant/principal outbox partition", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.organizationId = "org-1"
    authState.userId = "agent-user"
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    })
  })

  it("returns an opaque scope bound to organization, user and agent", async () => {
    const response = await getSyncContext(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        scopeKey: pharmacyPromotionHash({
          organizationId: "org-1",
          userId: "agent-user",
          agentId: "agent-1",
        }),
        canFieldExecute: true,
      },
    })

    authState.organizationId = "org-2"
    const otherTenant = await getSyncContext(request())
    expect((await otherTenant.json()).data.scopeKey).not.toBe(
      pharmacyPromotionHash({ organizationId: "org-1", userId: "agent-user", agentId: "agent-1" }),
    )
  })

  it("does not enable field sync for a manager and rejects an inactive actor", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "manager-1",
      role: "MANAGER",
      scopedAgentIds: ["agent-1"],
    })
    const manager = await getSyncContext(request())
    expect(manager.status).toBe(200)
    expect(await manager.json()).toMatchObject({ data: { canFieldExecute: false } })

    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
    const inactive = await getSyncContext(request())
    expect(inactive.status).toBe(403)
    expect(await inactive.json()).toMatchObject({ code: "MTM_AGENT_INACTIVE" })
  })
})
