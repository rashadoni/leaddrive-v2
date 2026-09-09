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

import { GET as getPlanningTargets } from "@/app/api/v2/mtm/mobile/route-field/planning-targets/route"
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

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/route-field/planning-targets${query}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

function lookup(query = "") {
  return getPlanningTargets(request(query))
}

function organization(id = "customer-1", name = "North Clinic") {
  return {
    id,
    name,
    address: "Baku, route-safe address",
    city: "Baku",
    managingManager: { name: "must-never-serialize manager" },
    agentAssignments: [{ agentId: "other-agent" }],
    latitude: 40.4,
    longitude: 49.8,
    notes: "must-never-serialize notes",
  }
}

function workplace(customerId = "customer-1", isPrimary = true) {
  return {
    customerId,
    isPrimary,
    startedOn: new Date("2026-01-01T00:00:00.000Z"),
    endedOn: null,
    customer: {
      name: "North Clinic",
      address: "Baku, route-safe address",
      city: "Baku",
      latitude: 40.4,
      longitude: 49.8,
    },
  }
}

function contact(id = "contact-1", displayName = "Dr. Farid", workplaces = [workplace()]) {
  return {
    id,
    displayName,
    email: "must-never-serialize@example.test",
    phone: "+994 50 must-never-serialize",
    mobilePhone: "+994 51 must-never-serialize",
    fieldPotentials: [{ potentialValue: "must-never-serialize-potential" }],
    agentAssignments: [{ agentId: AGENT }],
    workplaces,
  }
}

function restoreAgentAuth() {
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT,
    role: "AGENT",
    canPlanOwnRoutes: true,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"))
  restoreAgentAuth()
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([])
})

describe("GET /api/v2/mtm/mobile/route-field/planning-targets", () => {
  it("uses a tenant-bound opaque keyset for a fixed, date-assigned organization projection", async () => {
    const alpha = organization("customer-a", "Alpha Clinic")
    const bravo = organization("customer-b", "Bravo Clinic")
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValueOnce([alpha, bravo] as never)

    const firstResponse = await lookup("?kind=organization&date=2026-08-30&limit=1&objectType=CLINIC&search=clinic&ownerAgentId=other-agent&include=everything")
    expect(firstResponse.status).toBe(200)
    expect(firstResponse.headers.get("Cache-Control")).toBe("no-store")
    const firstArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
      take: number
    }
    expect(firstArgs.where).toMatchObject({
      organizationId: ORG,
      deletedAt: null,
      status: "ACTIVE",
      objectType: "CLINIC",
    })
    const serializedWhere = JSON.stringify(firstArgs.where)
    // A2: the planner asks the same scope as the write validator — an
    // assignment OR an actionable route. It used to ask for assignments only,
    // so it offered strictly less than the server accepts. Both arms must be
    // in the query, and both must stay bound to this agent and this date.
    expect(serializedWhere).toContain('"agentId":{"in":["agent-1"]}')
    expect(serializedWhere).toContain('"effectiveFrom":{"lte":"2026-08-30T00:00:00.000Z"}')
    expect(serializedWhere).toContain('"effectiveTo":{"gt":"2026-08-30T00:00:00.000Z"}')
    expect(serializedWhere).toContain('"status":{"in":["PLANNED","IN_PROGRESS","INCOMPLETE"]}')
    expect(serializedWhere).toContain('"role":{"not":"OBSERVER"}')
    for (const ignoredFilter of ["ownerAgentId", "include"]) {
      expect(serializedWhere).not.toContain(ignoredFilter)
    }
    expect(firstArgs.take).toBe(2)
    expect(firstArgs.select).toEqual({ id: true, name: true, address: true, city: true })
    expect(prisma.mtmCustomer.count).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    const firstPayload = await firstResponse.json()
    expect(firstPayload).toMatchObject({
      success: true,
      data: {
        date: "2026-08-30",
        limit: 1,
        targets: [{ kind: "organization", customerId: "customer-a", name: "Alpha Clinic" }],
      },
    })
    expect(firstPayload.data.nextPage).toMatch(/^v1:/)
    expect(firstPayload.data.nextPage).not.toContain("customer-a")
    const serializedPayload = JSON.stringify(firstPayload)
    for (const forbidden of ["must-never-serialize manager", "must-never-serialize notes", "latitude", "longitude", "agentAssignments"]) {
      expect(serializedPayload).not.toContain(forbidden)
    }

    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValueOnce([bravo] as never)
    const secondResponse = await lookup(`?kind=organization&date=2026-08-30&limit=1&objectType=CLINIC&search=clinic&page=${encodeURIComponent(firstPayload.data.nextPage)}`)
    expect(secondResponse.status).toBe(200)
    const secondArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[1][0] as { where: unknown }
    expect(JSON.stringify(secondArgs.where)).toContain('"name":{"gt":"Alpha Clinic"}')
    expect(await secondResponse.json()).toMatchObject({
      success: true,
      data: { targets: [{ customerId: "customer-b", name: "Bravo Clinic" }], nextPage: null },
    })

    vi.clearAllMocks()
    restoreAgentAuth()
    const replayedForAnotherDate = await lookup(`?kind=organization&date=2026-08-31&limit=1&objectType=CLINIC&search=clinic&page=${encodeURIComponent(firstPayload.data.nextPage)}`)
    expect(replayedForAnotherDate.status).toBe(400)
    expect(await replayedForAnotherDate.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_TARGET_PAGE_INVALID" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("keeps direct and customer assignment contact phases disjoint and strips personal fields", async () => {
    const direct = contact("contact-direct", "Dr. Direct")
    const customerAssigned = contact("contact-customer", "Dr. Customer")
    vi.mocked(prisma.mtmContact.findMany)
      .mockResolvedValueOnce([direct] as never)
      .mockResolvedValueOnce([customerAssigned] as never)

    const directResponse = await lookup("?kind=contact&date=2026-08-30&search=Dr")
    expect(directResponse.status).toBe(200)
    const directArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
      take: number
    }
    expect(directArgs.where).toMatchObject({ organizationId: ORG, deletedAt: null, status: "ACTIVE", type: "DOCTOR" })
    const directWhere = JSON.stringify(directArgs.where)
    expect(directWhere).toContain('"agentAssignments":{"some":{"agentId":"agent-1"')
    expect(directWhere).toContain('"organizationId":"org-1"')
    expect(directWhere).toContain('"effectiveTo":{"gt":"2026-08-30T00:00:00.000Z"}')
    expect(directWhere).not.toContain("routePoints")
    expect(directArgs.take).toBe(26)
    expect(directArgs.select.email).toBeUndefined()
    expect(directArgs.select.phone).toBeUndefined()
    expect(directArgs.select.agentAssignments).toBeUndefined()
    expect(directArgs.select.fieldPotentials).toBeUndefined()
    expect(directArgs.select.workplaces).toMatchObject({ take: 2, select: { customerId: true, isPrimary: true } })
    const directWorkplace = directArgs.select.workplaces as { select: Record<string, unknown> }
    expect(directWorkplace.select.startedOn).toBeUndefined()
    expect(directWorkplace.select.endedOn).toBeUndefined()
    const directWorkplaceCustomer = (directWorkplace.select.customer as { select: Record<string, unknown> }).select
    expect(directWorkplaceCustomer.latitude).toBeUndefined()
    expect(directWorkplaceCustomer.longitude).toBeUndefined()

    const directPayload = await directResponse.json()
    expect(directPayload).toMatchObject({
      success: true,
      data: {
        targets: [{
          kind: "contact",
          contactId: "contact-direct",
          customerId: "customer-1",
          name: "Dr. Direct",
          organizationName: "North Clinic",
        }],
      },
    })
    expect(directPayload.data.nextPage).toMatch(/^v1:/)

    const customerResponse = await lookup(`?kind=contact&date=2026-08-30&search=Dr&page=${encodeURIComponent(directPayload.data.nextPage)}`)
    expect(customerResponse.status).toBe(200)
    const customerArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[1][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
    }
    expect(customerArgs.where.agentAssignments).toMatchObject({ none: { agentId: AGENT } })
    const customerWhere = JSON.stringify(customerArgs.where)
    expect(customerWhere).toContain('"agentAssignments":{"none":{"agentId":"agent-1"')
    expect(customerWhere).toContain('"agentAssignments":{"some":{"agentId":"agent-1"')
    expect(customerWhere).not.toContain("routePoints")
    const customerWorkplace = customerArgs.select.workplaces as { where: { customer: Record<string, unknown> } }
    expect(customerWorkplace.where.customer).toMatchObject({ organizationId: ORG, status: "ACTIVE" })

    const customerPayload = await customerResponse.json()
    expect(customerPayload).toMatchObject({
      success: true,
      data: {
        targets: [{ kind: "contact", contactId: "contact-customer", customerId: "customer-1", name: "Dr. Customer" }],
        nextPage: null,
      },
    })
    const serializedPayload = JSON.stringify({ directPayload, customerPayload })
    for (const forbidden of [
      "must-never-serialize@example.test",
      "+994 50 must-never-serialize",
      "+994 51 must-never-serialize",
      "must-never-serialize-potential",
      "startedOn",
      "endedOn",
      "agentAssignments",
      "latitude",
      "longitude",
    ]) {
      expect(serializedPayload).not.toContain(forbidden)
    }
  })

  it("fails closed for an ambiguous direct workplace and never falls through in the same request", async () => {
    const ambiguous = contact("contact-ambiguous", "Dr. Ambiguous", [
      workplace("customer-a", false),
      workplace("customer-b", false),
    ])
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([ambiguous] as never)

    const directResponse = await lookup("?kind=contact&date=2026-08-30")
    const directPayload = await directResponse.json()
    expect(directResponse.status).toBe(200)
    expect(directPayload).toMatchObject({ success: true, data: { targets: [] } })
    expect(directPayload.data.nextPage).toMatch(/^v1:/)
    expect(prisma.mtmContact.findMany).toHaveBeenCalledTimes(1)

    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([])
    const customerResponse = await lookup(`?kind=contact&date=2026-08-30&page=${encodeURIComponent(directPayload.data.nextPage)}`)
    expect(customerResponse.status).toBe(200)
    const customerArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[1][0] as { where: Record<string, unknown> }
    expect(customerArgs.where.agentAssignments).toMatchObject({ none: { agentId: AGENT } })
    expect(await customerResponse.json()).toMatchObject({ success: true, data: { targets: [], nextPage: null } })
  })

  it("rejects unavailable tenant capability, invalid principal, disabled self planning and invalid dates before candidate queries", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({
      tenantCapabilities: { routeField: false, workforceHrm: false },
    }) as never)
    const disabled = await lookup("?kind=organization&date=2026-08-30")
    expect(disabled.status).toBe(403)
    expect(await disabled.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "other-agent", role: "AGENT", canPlanOwnRoutes: true } as never)
    const mismatch = await lookup("?kind=organization&date=2026-08-30")
    expect(mismatch.status).toBe(403)
    expect(await mismatch.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "AGENT", canPlanOwnRoutes: false } as never)
    const planningDisabled = await lookup("?kind=organization&date=2026-08-30")
    expect(planningDisabled.status).toBe(403)
    expect(await planningDisabled.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLAN_PERMISSION_REQUIRED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    restoreAgentAuth()
    const invalidDate = await lookup("?kind=contact&date=2026-08-29")
    expect(invalidDate.status).toBe(400)
    expect(await invalidDate.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_DATE_INVALID" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })

  it("fails closed for invalid filters and malformed opaque pages before candidate queries", async () => {
    const unsupportedObjectType = await lookup("?kind=organization&date=2026-08-30&objectType=DOCTOR")
    expect(unsupportedObjectType.status).toBe(400)
    expect(await unsupportedObjectType.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_TARGET_FILTER_INVALID" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    restoreAgentAuth()
    const contactFilter = await lookup("?kind=contact&date=2026-08-30&organizationKind=clinic")
    expect(contactFilter.status).toBe(400)
    expect(await contactFilter.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_TARGET_FILTER_INVALID" })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    restoreAgentAuth()
    const malformedPage = await lookup("?kind=contact&date=2026-08-30&page=not-a-cursor")
    expect(malformedPage.status).toBe(400)
    expect(await malformedPage.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_TARGET_PAGE_INVALID" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })
})
