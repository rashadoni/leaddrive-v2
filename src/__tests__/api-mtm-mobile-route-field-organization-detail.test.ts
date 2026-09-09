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

import { GET as getRouteFieldOrganization } from "@/app/api/v2/mtm/mobile/route-field/organizations/[id]/route"
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

function request(id = "customer-1") {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/route-field/organizations/${id}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

function detail(id = "customer-1") {
  return getRouteFieldOrganization(request(id), { params: Promise.resolve({ id }) })
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
  vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
    id: "customer-1",
    code: "CL-1",
    name: "North Clinic",
    objectType: "CLINIC",
    category: "A",
    status: "ACTIVE",
    address: "Baku",
    locality: "Nasimi",
    city: "Baku",
    district: "North",
    phone: "+994 12 000 00 00",
    managingManager: { name: "must never serialize" },
    agentAssignments: [{ agentId: "other-agent" }],
    fieldPotentials: [{ potentialValue: "100" }],
    contactWorkplaces: [{
      phone: "+994 12 111 11 11",
      isPrimary: true,
      jobTitle: "Doctor",
      department: "must never serialize",
      contactId: "redundant-contact-id",
      contact: {
        id: "contact-1",
        displayName: "Dr. Farid",
        specialtyName: "Cardiology",
        type: "DOCTOR",
        phone: "must never serialize personal phone",
        workPhone: "must never serialize",
        mobilePhone: "must never serialize",
        deletedAt: null,
      },
    }],
    visits: [{
      id: "visit-1",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-08-29T10:00:00.000Z"),
      outcome: "SUCCESSFUL",
      agentId: AGENT,
      resultNotes: "must never serialize",
    }],
  } as never)
})

describe("GET /api/v2/mtm/mobile/route-field/organizations/:id", () => {
  it("uses an exact mobile allowlist, self visit scope, bounded relations and no-store", async () => {
    const response = await detail()

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const args = vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
    }
    expect(args.where).toMatchObject({ id: "customer-1", organizationId: ORG, deletedAt: null, status: "ACTIVE" })
    expect(args.select.managingManager).toBeUndefined()
    expect(args.select.agentAssignments).toBeUndefined()
    expect(args.select.fieldPotentials).toBeUndefined()
    expect(args.select.contactWorkplaces).toMatchObject({
      where: { deletedAt: null, endedOn: null, contact: { deletedAt: null, status: "ACTIVE" } },
      take: 50,
    })
    const contactSelect = (args.select.contactWorkplaces as { select: { contact: { select: Record<string, unknown> } } }).select.contact.select
    expect(contactSelect.phone).toBeUndefined()
    expect(args.select.visits).toMatchObject({
      where: { deletedAt: null, agentId: AGENT },
      take: 15,
    })

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: {
        contactLimit: 50,
        visitLimit: 15,
        organization: {
          id: "customer-1",
          contacts: [{ id: "contact-1", phone: "+994 12 111 11 11", position: "Doctor" }],
          visits: [{ id: "visit-1", outcome: "SUCCESSFUL" }],
        },
      },
    })
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      "must never serialize",
      "managingManager",
      "agentAssignments",
      "fieldPotentials",
      "department",
      "contactId",
      "workPhone",
      "mobilePhone",
      "must never serialize personal phone",
      "resultNotes",
      "agentId",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("rejects a disabled Route Field tenant before it queries field data", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({
      tenantCapabilities: { routeField: false, workforceHrm: false },
    }) as never)

    const response = await detail()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findFirst).not.toHaveBeenCalled()
  })

  it("rejects a mobile principal without ROUTE_EXECUTE before it resolves scope", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "READ_ONLY" }) as never)

    const response = await detail()

    expect(response.status).toBe(403)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({
      code: "MTM_MOBILE_PERMISSION_REQUIRED",
      permission: "ROUTE_EXECUTE",
    })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 for an out-of-scope or absent organization without a broad fallback", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)

    const response = await detail("outside-scope")

    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_ORGANIZATION_NOT_FOUND" })
    const args = vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>
    }
    expect(args.where).toMatchObject({ id: "outside-scope", organizationId: ORG, deletedAt: null })
  })
})
