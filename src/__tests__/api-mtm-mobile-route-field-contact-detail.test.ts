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

import { GET as getRouteFieldContact } from "@/app/api/v2/mtm/mobile/route-field/contacts/[id]/route"
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

function request(id = "contact-1", suffix = "") {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/route-field/contacts/${id}${suffix}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

function detail(id = "contact-1", suffix = "") {
  return getRouteFieldContact(request(id, suffix), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"))
  vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactChangeRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT,
    role: "AGENT",
    canPlanOwnRoutes: true,
  } as never)
  vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
    id: "contact-1",
    displayName: "Dr. Farid",
    specialtyName: "Cardiology",
    type: "DOCTOR",
    category: "A",
    status: "ACTIVE",
    email: "must-never-serialize@example.test",
    phone: "+994 50 must-never-serialize",
    mobilePhone: "+994 51 must-never-serialize",
    homePhone: "+994 12 must-never-serialize",
    messengerPhone: "+994 55 must-never-serialize",
    addressStreet: "must-never-serialize street",
    birthDate: new Date("1980-01-01T00:00:00.000Z"),
    notes: "must-never-serialize notes",
    agentAssignments: [{ agentId: "other-agent" }],
    fieldPotentials: [{ potentialValue: "100" }],
    workplaces: [{
      id: "workplace-1",
      isPrimary: true,
      jobTitle: "Doctor",
      phone: "+994 12 111 11 11",
      department: "must-never-serialize department",
      customerId: "customer-1",
      customer: {
        name: "North Clinic",
        city: "Baku",
        address: "Nizami 2",
        latitude: 40.4,
        longitude: 49.8,
        managingManager: { name: "must-never-serialize manager" },
      },
    }],
  } as never)
})

describe("GET /api/v2/mtm/mobile/route-field/contacts/:id", () => {
  it("uses an exact field projection, independently scopes workplaces, bounds rows and never serializes private data", async () => {
    const response = await detail("contact-1", "?include=everything")

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const args = vi.mocked(prisma.mtmContact.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
    }
    expect(args.where).toMatchObject({ id: "contact-1", organizationId: ORG, deletedAt: null, status: "ACTIVE" })
    expect(args.where.AND).toEqual(expect.any(Array))
    expect(args.where.AND).toMatchObject([{
      OR: [
        { agentAssignments: { some: { agentId: { in: [AGENT] }, deletedAt: null } } },
        { workplaces: { some: { deletedAt: null, endedOn: null } } },
      ],
    }])
    expect(args.select.email).toBeUndefined()
    expect(args.select.phone).toBeUndefined()
    expect(args.select.mobilePhone).toBeUndefined()
    expect(args.select.addressStreet).toBeUndefined()
    expect(args.select.agentAssignments).toBeUndefined()
    expect(args.select.fieldPotentials).toBeUndefined()
    expect(args.select.workplaces).toMatchObject({
      where: { deletedAt: null, endedOn: null, customer: { deletedAt: null } },
      take: 20,
    })
    const workplaceSelect = args.select.workplaces as { where: { customer: { AND?: unknown } } }
    expect(workplaceSelect.where.customer.AND).toEqual(expect.any(Array))

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: {
        workplaceLimit: 20,
        contact: {
          id: "contact-1",
          name: "Dr. Farid",
          workplaces: [{ id: "workplace-1", name: "North Clinic", phone: "+994 12 111 11 11" }],
        },
      },
    })
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      "must-never-serialize@example.test",
      "+994 50 must-never-serialize",
      "+994 51 must-never-serialize",
      "+994 12 must-never-serialize",
      "+994 55 must-never-serialize",
      "must-never-serialize street",
      "must-never-serialize notes",
      "must-never-serialize department",
      "must-never-serialize manager",
      "customerId",
      "latitude",
      "longitude",
      "agentAssignments",
      "fieldPotentials",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("tells the card what the agent may propose, from the organization's own lists", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "contactClasses", value: ["A", "B", "C", "VIP"] },
      { key: "contactSpecialties", value: ["Nevroloq", "Kardioloq"] },
    ] as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: "contact-1", displayName: "Farid Aliyev", firstName: "Farid", lastName: "Aliyev",
      updatedAt: new Date("2026-08-29T10:00:00.000Z"),
      // Graded D before the organization stopped offering it; a specialty off the list.
      specialtyName: "Cardiology", type: "DOCTOR", category: "D", status: "ACTIVE", workplaces: [],
    } as never)

    const { data } = await (await detail()).json()

    expect(data.contact).toMatchObject({
      firstName: "Farid", lastName: "Aliyev", updatedAt: "2026-08-29T10:00:00.000Z",
    })
    expect(data.changeRequest).toEqual({
      allowed: true,
      fields: ["category", "specialtyName", "firstName", "lastName"],
      // What the client already has stays among the choices.
      classes: ["A", "B", "C", "D", "VIP"],
      specialties: ["Nevroloq", "Kardioloq", "Cardiology"],
      latest: null,
    })
  })

  it("follows the organization's switch and the fields it turned off", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "agentContactChangeRequests", value: false },
      { key: "contactHiddenFields", value: ["specialtyName"] },
    ] as never)

    const { data } = await (await detail()).json()

    expect(data.changeRequest).toMatchObject({
      allowed: false,
      fields: ["category", "firstName", "lastName"],
      specialties: [],
    })
  })

  it("shows the agent what became of their own last request, and nobody else's", async () => {
    vi.mocked(prisma.mtmContactChangeRequest.findFirst).mockResolvedValue({
      id: "request-9", status: "REJECTED", reason: "Врач сказал на визите", decisionComment: "Класс подтверждён как B",
      submittedAt: new Date("2026-08-28T09:00:00.000Z"), reviewedAt: new Date("2026-08-29T09:00:00.000Z"),
    } as never)

    const { data } = await (await detail()).json()

    expect(data.changeRequest.latest).toEqual({
      id: "request-9", status: "REJECTED", reason: "Врач сказал на визите", decisionComment: "Класс подтверждён как B",
      submittedAt: "2026-08-28T09:00:00.000Z", reviewedAt: "2026-08-29T09:00:00.000Z",
    })
    expect(vi.mocked(prisma.mtmContactChangeRequest.findFirst).mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, contactId: "contact-1", requestedByAgentId: AGENT, kind: "CONTACT_UPDATE" },
      select: { id: true, status: true, reason: true, decisionComment: true, submittedAt: true, reviewedAt: true },
    })
  })

  it("rejects a disabled Route Field tenant before it queries route data", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({
      tenantCapabilities: { routeField: false, workforceHrm: false },
    }) as never)

    const response = await detail()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a principal without ROUTE_EXECUTE before it resolves scope", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "READ_ONLY" }) as never)

    const response = await detail()

    expect(response.status).toBe(403)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({
      code: "MTM_MOBILE_PERMISSION_REQUIRED",
      permission: "ROUTE_EXECUTE",
    })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findFirst).not.toHaveBeenCalled()
  })

  it("fails closed when the resolved actor is not the authenticated agent", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "MANAGER" }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: AGENT,
      role: "MANAGER",
      canPlanOwnRoutes: true,
    } as never)

    const response = await detail()

    expect(response.status).toBe(403)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmContact.findFirst).not.toHaveBeenCalled()
  })

  it("fails closed if an inconsistent actor resolves to another agent", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "resolved-agent-2",
      role: "AGENT",
      canPlanOwnRoutes: true,
    } as never)

    const response = await detail()

    expect(response.status).toBe(403)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmContact.findFirst).not.toHaveBeenCalled()
  })

  it("returns the same 404 for an out-of-scope, missing or cross-tenant contact", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue(null)

    const response = await detail("outside-scope")

    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_CONTACT_NOT_FOUND" })
    const args = vi.mocked(prisma.mtmContact.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>
    }
    expect(args.where).toMatchObject({ id: "outside-scope", organizationId: ORG, deletedAt: null, status: "ACTIVE" })
  })
})
