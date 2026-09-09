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
