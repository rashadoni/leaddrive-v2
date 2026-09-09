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

import { GET as getRouteFieldOrganizations } from "@/app/api/v2/mtm/mobile/route-field/organizations/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"

function mobileAuth(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    agentId: AGENT,
    userId: "user-1",
    email: "agent@example.test",
    name: "Agent",
    role: "AGENT",
    tenantCapabilities: { routeField: true, workforceHrm: false },
    ...overrides,
  }
}

function organization(id = "customer-1", name = "North Clinic") {
  return {
    id,
    code: "CL-1",
    name,
    objectType: "CLINIC",
    category: "A",
    status: "ACTIVE",
    address: "Baku",
    phone: "+994 12 000 00 00",
    managingManager: { name: "must-never-serialize manager" },
    agentAssignments: [{ agentId: "other-agent" }],
    visits: [{ id: "must-never-serialize-visit" }],
    routePoints: [{ id: "must-never-serialize-route-point" }],
    fieldPotentials: [{ potentialValue: "must-never-serialize-potential" }],
    latitude: 40.4,
    longitude: 49.8,
    contactPerson: "must-never-serialize contact person",
    notes: "must-never-serialize notes",
    _count: { contactWorkplaces: 3 },
  }
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/route-field/organizations${query}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

function list(query = "") {
  return getRouteFieldOrganizations(request(query))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"))
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT,
    role: "AGENT",
    canPlanOwnRoutes: true,
  } as never)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([organization()] as never)
})

describe("GET /api/v2/mtm/mobile/route-field/organizations", () => {
  it("uses a fixed active-organization projection, scoped active-contact count and no-store", async () => {
    const response = await list("?search=North&limit=999&ownerAgentId=other-agent&include=everything")

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
      take: number
    }
    expect(args.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      status: "ACTIVE",
      objectType: { not: "DOCTOR" },
    })
    expect(args.take).toBe(51)
    const serializedWhere = JSON.stringify(args.where)
    for (const forbiddenSearchField of ["ownerAgentId", "include", "managingManagerId", "assignedAgentId"]) {
      expect(serializedWhere).not.toContain(forbiddenSearchField)
    }
    expect(args.select.managingManager).toBeUndefined()
    expect(args.select.agentAssignments).toBeUndefined()
    expect(args.select.visits).toBeUndefined()
    expect(args.select.routePoints).toBeUndefined()
    expect(args.select.fieldPotentials).toBeUndefined()
    expect(args.select.latitude).toBeUndefined()
    expect(args.select.longitude).toBeUndefined()
    expect(args.select._count).toMatchObject({
      select: {
        contactWorkplaces: {
          where: { deletedAt: null, endedOn: null, contact: { deletedAt: null, status: "ACTIVE" } },
        },
      },
    })
    expect(prisma.mtmCustomer.count).not.toHaveBeenCalled()

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: {
        limit: 50,
        nextPage: null,
        organizations: [{
          id: "customer-1",
          name: "North Clinic",
          contactsCount: 3,
        }],
      },
    })
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      "must-never-serialize manager",
      "must-never-serialize-visit",
      "must-never-serialize-route-point",
      "must-never-serialize-potential",
      "must-never-serialize contact person",
      "must-never-serialize notes",
      "latitude",
      "longitude",
      "agentAssignments",
      "managingManager",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("rejects a disabled tenant and missing ROUTE_EXECUTE before querying organizations", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({
      tenantCapabilities: { routeField: false, workforceHrm: false },
    }) as never)

    const disabled = await list()

    expect(disabled.status).toBe(403)
    expect(await disabled.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "READ_ONLY" }) as never)
    const denied = await list()

    expect(denied.status).toBe(403)
    expect(denied.headers.get("Cache-Control")).toBe("no-store")
    expect(await denied.json()).toMatchObject({ code: "MTM_MOBILE_PERMISSION_REQUIRED", permission: "ROUTE_EXECUTE" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("fails closed for a manager or an inconsistent resolved agent", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "MANAGER" }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "MANAGER", canPlanOwnRoutes: true } as never)

    const manager = await list()

    expect(manager.status).toBe(403)
    expect(await manager.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "resolved-agent-2", role: "AGENT", canPlanOwnRoutes: true } as never)
    const mismatch = await list()
    expect(mismatch.status).toBe(403)
    expect(await mismatch.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("uses an opaque keyset page with fixed filters and rejects a page from another agent", async () => {
    const first = organization("customer-a", "Alpha Clinic")
    const second = organization("customer-b", "Bravo Clinic")
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([first, second] as never)

    const firstResponse = await list("?limit=1&search=clinic&objectType=CLINIC")
    const firstPayload = await firstResponse.json()
    expect(firstResponse.status).toBe(200)
    expect(firstPayload.data.organizations.map((item: { id: string }) => item.id)).toEqual(["customer-a"])
    expect(firstPayload.data.nextPage).toMatch(/^v1:/)

    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([second] as never)
    const secondResponse = await list(`?limit=1&search=clinic&objectType=CLINIC&page=${encodeURIComponent(firstPayload.data.nextPage)}`)
    const secondPayload = await secondResponse.json()
    expect(secondResponse.status).toBe(200)
    expect(secondPayload.data.organizations.map((item: { id: string }) => item.id)).toEqual(["customer-b"])
    expect(secondPayload.data.nextPage).toBeNull()
    const secondArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[1][0] as { where: unknown }
    expect(JSON.stringify(secondArgs.where)).toContain('"name":{"gt":"Alpha Clinic"}')

    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ agentId: "agent-2" }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2", role: "AGENT", canPlanOwnRoutes: true } as never)
    const callsBeforeForeignPage = vi.mocked(prisma.mtmCustomer.findMany).mock.calls.length
    const foreignPage = await list(`?limit=1&search=clinic&objectType=CLINIC&page=${encodeURIComponent(firstPayload.data.nextPage)}`)
    expect(foreignPage.status).toBe(400)
    expect(await foreignPage.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_ORGANIZATION_PAGE_INVALID" })
    expect(prisma.mtmCustomer.findMany).toHaveBeenCalledTimes(callsBeforeForeignPage)
  })

  it("rejects malformed pages and overlong filters before the catalog query", async () => {
    const malformed = await list("?page=not-a-cursor")
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_ORGANIZATION_PAGE_INVALID" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "AGENT", canPlanOwnRoutes: true } as never)
    const tooLong = await list(`?search=${"x".repeat(121)}`)
    expect(tooLong.status).toBe(400)
    expect(await tooLong.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_ORGANIZATION_SEARCH_TOO_LONG" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })
})
