import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/territory-scope", () => ({
  resolveAgentScope: vi.fn(),
}))

import { GET as approvalsGet } from "@/app/api/v1/mtm/mobile/manager/approvals/route"
import { GET as teamGet } from "@/app/api/v1/mtm/mobile/manager/team/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const AUTH = {
  orgId: "org-1",
  agentId: "manager-1",
  role: "MANAGER",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function request(path: "team" | "approvals") {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/manager/${path}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRouteChangeRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomerCreateRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactChangeRequest.findMany).mockResolvedValue([])
})

describe("mobile manager mixed workforce boundaries", () => {
  it("does not select active workdays for a Routes-only manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Agent",
      role: "AGENT",
      status: "ACTIVE",
      teamId: "team-1",
      isOnline: true,
      lastSeenAt: null,
    }] as never)

    const response = await teamGet(request("team"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.agents[0].workday).toBeNull()
    const query = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    expect(query.select.workdays).toBeUndefined()
  })

  it("returns active workdays for an HRM-only manager without route entitlement", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{
      id: "agent-1",
      name: "Agent",
      role: "AGENT",
      status: "ACTIVE",
      teamId: "team-1",
      isOnline: true,
      lastSeenAt: null,
      workdays: [{ id: "workday-1", status: "STARTED", startedAt: new Date(), pausedAt: null }],
    }] as never)

    const body = await (await teamGet(request("team"))).json()

    expect(body.data.agents[0].workday).toMatchObject({ id: "workday-1", status: "STARTED" })
    const query = vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0] as any
    expect(query.select.workdays).toEqual(expect.objectContaining({ take: 1 }))
  })

  it("does not read HRM request reasons for a Routes-only manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)

    const body = await (await approvalsGet(request("approvals"))).json()

    expect(body.data.counts.hrm).toBe(0)
    expect(body.data.hrm).toEqual([])
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmRouteChangeRequest.findMany).toHaveBeenCalledTimes(1)
  })

  it("reads only HRM approvals for an HRM-only manager", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AUTH,
      tenantCapabilities: { routeField: false, workforceHrm: true },
    } as never)
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{
      id: "request-1",
      agentId: "agent-1",
      type: "LEAVE",
      reason: "Annual leave",
    }] as never)

    const body = await (await approvalsGet(request("approvals"))).json()

    expect(body.data.counts).toMatchObject({ hrm: 1, routeChanges: 0, customers: 0, contactChanges: 0 })
    expect(body.data.hrm).toEqual([expect.objectContaining({ id: "request-1" })])
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmRouteChangeRequest.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmCustomerCreateRequest.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.findMany).not.toHaveBeenCalled()
  })
})
