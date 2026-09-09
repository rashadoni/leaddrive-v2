import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: vi.fn(),
}))

import { GET } from "@/app/api/v1/mtm/routes/needs-attention/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

const ORG = "org-1"
const adminAuth = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(adminAuth as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({
    agentId: "manager-1",
    role: "MANAGER",
    scopedAgentIds: ["agent-1", "agent-2"],
  } as never)
  vi.mocked(prisma.mtmRouteChangeRequest.count).mockResolvedValue(2 as never)
  vi.mocked(prisma.mtmCustomerCreateRequest.count).mockResolvedValue(3 as never)
})

describe("GET /mtm/routes/needs-attention", () => {
  it("returns aggregate counts under the same scoped queue predicates without request data", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/routes/needs-attention"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        schemaVersion: 1,
        total: 5,
        categories: {
          routeChanges: { count: 2 },
          customerRequests: { count: 3 },
        },
      },
    })
    expect(prisma.mtmRouteChangeRequest.count).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
        OR: [
          { requestedByAgentId: { in: ["agent-1", "agent-2"] } },
          { route: { agentId: { in: ["agent-1", "agent-2"] } } },
        ],
      },
    })
    expect(prisma.mtmCustomerCreateRequest.count).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        status: { in: ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] },
        requestedByAgentId: { in: ["agent-1", "agent-2"] },
      },
    })
  })

  it("denies non-reviewers before issuing either count", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)

    const response = await GET(new NextRequest("http://localhost:3000/api/v1/mtm/routes/needs-attention"))

    expect(response.status).toBe(403)
    expect(prisma.mtmRouteChangeRequest.count).not.toHaveBeenCalled()
    expect(prisma.mtmCustomerCreateRequest.count).not.toHaveBeenCalled()
  })
})
