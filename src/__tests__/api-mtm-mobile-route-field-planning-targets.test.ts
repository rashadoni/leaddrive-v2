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

function organization(id = "customer-1", name = "North Clinic", objectType = "CLINIC", doctors = 0) {
  return {
    id,
    name,
    address: "Baku, route-safe address",
    city: "Baku",
    objectType,
    _count: { contactWorkplaces: doctors },
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
    expect(firstArgs.select).toMatchObject({ id: true, name: true, address: true, city: true, objectType: true })
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
    expect(directArgs.select.workplaces).toMatchObject({ take: 6, select: { customerId: true, isPrimary: true } })
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

  it("looks up one exact date-eligible client and binds that id into the cursor", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([
      contact("contact-1", "Dr. Farid"),
    ] as never)

    const response = await lookup("?kind=contact&date=2026-08-30&targetId=contact-1&search=Dr.%20Farid")
    expect(response.status).toBe(200)
    const query = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as { where: unknown }
    expect(JSON.stringify(query.where)).toContain('"id":"contact-1"')
    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: { targets: [{ kind: "contact", contactId: "contact-1", customerId: "customer-1" }] },
    })
    expect(payload.data.nextPage).toMatch(/^v1:/)

    const replay = await lookup(`?kind=contact&date=2026-08-30&targetId=contact-2&search=Dr.%20Farid&page=${encodeURIComponent(payload.data.nextPage)}`)
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_TARGET_PAGE_INVALID" })
  })

  it("says, on every organization row, its type and how many doctors work there on the route date (Zeytun 2026-11-13)", async () => {
    // «Bütün müştərilər» lists clinics too; the app opens a clinic's doctors
    // from there only if the row says it has some.
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValueOnce([
      organization("clinic-1", "ATU Tədris Cərrahiyyə Klinikası", "CLINIC", 4),
      organization("pharmacy-1", "Aptek 12", "PHARMACY", 0),
    ] as never)

    const response = await lookup("?kind=organization&date=2026-08-30")
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as { select: Record<string, unknown> }
    const counted = JSON.stringify(args.select)
    // Only doctors who work there on the route date and are active.
    expect(counted).toContain('"contactWorkplaces":{"where":')
    expect(counted).toContain('"type":"DOCTOR"')
    expect(counted).toContain('"status":"ACTIVE"')
    expect(counted).toContain('"endedOn":{"gt":"2026-08-30T00:00:00.000Z"}')
    expect((await response.json()).data.targets).toEqual([
      expect.objectContaining({ customerId: "clinic-1", objectType: "CLINIC", doctorCount: 4 }),
      expect.objectContaining({ customerId: "pharmacy-1", objectType: "PHARMACY", doctorCount: 0 }),
    ])
  })

  it("offers a clinic where one of the agent's own doctors works, even if the clinic is not his (Zeytun 2026-11-13)", async () => {
    await lookup("?kind=organization&date=2026-08-30&objectType=CLINIC")
    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as { where: { AND: Array<Record<string, any>> } }
    const scope = args.where.AND[0]
    expect(scope.OR).toHaveLength(2)
    const viaDoctor = scope.OR[1]
    // Not a pharmacy: a pharmacy is a stop of its own, and only its own scope may offer it.
    expect(viaDoctor.objectType).toEqual({ not: "PHARMACY" })
    const doctor = viaDoctor.contactWorkplaces.some.contact
    expect(doctor).toMatchObject({ organizationId: ORG, deletedAt: null, status: "ACTIVE", type: "DOCTOR" })
    expect(doctor.agentAssignments.some).toMatchObject({ agentId: "agent-1", deletedAt: null, effectiveFrom: { lte: new Date("2026-08-30T00:00:00.000Z") } })
    // The doctor works there on the route date.
    expect(JSON.stringify(viaDoctor.contactWorkplaces.some)).toContain('"endedOn":{"gt":"2026-08-30T00:00:00.000Z"}')
  })

  it("looks up one exact date-eligible organization for quick route add", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValueOnce([
      organization("customer-quick", "Quick Clinic"),
    ] as never)

    const response = await lookup("?kind=organization&date=2026-08-30&targetId=customer-quick&search=Quick%20Clinic")
    expect(response.status).toBe(200)
    const query = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as { where: unknown }
    expect(JSON.stringify(query.where)).toContain('"id":"customer-quick"')
    expect(await response.json()).toMatchObject({
      success: true,
      data: { targets: [{ kind: "organization", customerId: "customer-quick", name: "Quick Clinic" }] },
    })
  })

  it("opens one clinic's doctors, each placed at that clinic, and binds the clinic into the cursor (Zeytun 2026-11-13)", async () => {
    // The database answers with the workplace the query asked for: Klinika 3.
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([
      contact("contact-1", "Dr. Əliyeva", [workplace("clinic-3", false)]),
    ] as never)

    const response = await lookup("?kind=contact&date=2026-08-30&customerId=clinic-3")
    expect(response.status).toBe(200)
    const query = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as {
      where: { AND?: unknown[] }
      select: { workplaces: { where: Record<string, unknown> } }
    }
    // Only doctors working at the clinic on that day …
    expect(query.where.AND).toContainEqual({ workplaces: { some: expect.objectContaining({ customerId: "clinic-3" }) } })
    // … and the clinic, not the doctor's primary place, is the stop.
    expect(query.select.workplaces.where).toMatchObject({ customerId: "clinic-3" })
    const payload = await response.json()
    expect(payload).toMatchObject({ success: true, data: { targets: [{ kind: "contact", contactId: "contact-1", customerId: "clinic-3" }] } })

    // The next page belongs to that clinic only.
    const elsewhere = await lookup(`?kind=contact&date=2026-08-30&customerId=clinic-7&page=${encodeURIComponent(payload.data.nextPage)}`)
    expect(elsewhere.status).toBe(400)
  })

  it("takes a clinic only with doctors", async () => {
    const response = await lookup("?kind=organization&date=2026-08-30&customerId=clinic-3")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_PLANNING_TARGET_FILTER_INVALID" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  // Zeytun 2026-11-13: «некоторые врачи бывают в разных клиниках… чтоб агент
  // сам принимал решение». Without a single primary clinic such a doctor used
  // to vanish from the planner; the client's file has no primary at all.
  it("lists a doctor with two clinics: the clinic of his last visit first, both offered to the agent", async () => {
    const twoClinics = contact("contact-two", "Dr. Two Clinics", [
      workplace("customer-a", false),
      workplace("customer-b", false),
    ])
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([twoClinics, contact("contact-one", "Dr. One")] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValueOnce([{ contactId: "contact-two", customerId: "customer-b" }] as never)

    const response = await lookup("?kind=contact&date=2026-08-30")
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.targets).toEqual([
      expect.objectContaining({
        contactId: "contact-two",
        customerId: "customer-b",
        workplaces: [
          { customerId: "customer-b", name: "North Clinic", address: "Baku, route-safe address", lastVisited: true },
          { customerId: "customer-a", name: "North Clinic", address: "Baku, route-safe address", lastVisited: false },
        ],
      }),
      expect.objectContaining({ contactId: "contact-one", customerId: "customer-1" }),
    ])
    // One clinic: nothing to choose, and the row stays as older apps read it.
    expect(payload.data.targets[1].workplaces).toBeUndefined()
    // The last visit is asked only for the doctor with several clinics, inside the tenant.
    const visitQuery = vi.mocked(prisma.mtmVisit.findMany).mock.calls[0][0] as { where: Record<string, unknown>; distinct: unknown }
    expect(visitQuery.where).toMatchObject({ organizationId: ORG, deletedAt: null, contactId: { in: ["contact-two"] } })
    expect(visitQuery.distinct).toEqual(["contactId"])
  })

  it("never visited: the primary clinic first, and no visit query for single-clinic doctors", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([
      contact("contact-two", "Dr. Two Clinics", [workplace("customer-main", true), workplace("customer-side", false)]),
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValueOnce([] as never)
    const payload = await (await lookup("?kind=contact&date=2026-08-30")).json()
    expect(payload.data.targets[0]).toMatchObject({ customerId: "customer-main" })
    expect(payload.data.targets[0].workplaces.map((place: { customerId: string }) => place.customerId)).toEqual(["customer-main", "customer-side"])

    vi.mocked(prisma.mtmVisit.findMany).mockClear()
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValueOnce([contact("contact-one", "Dr. One")] as never)
    await lookup("?kind=contact&date=2026-08-30")
    expect(prisma.mtmVisit.findMany).not.toHaveBeenCalled()
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
