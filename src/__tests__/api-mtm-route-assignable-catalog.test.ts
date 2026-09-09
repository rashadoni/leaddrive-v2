import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/routes/assignable-catalog/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-1"

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/routes/assignable-catalog?${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: "agent-1",
    name: "Agent One",
  } as never)
})

describe("GET /api/v1/mtm/routes/assignable-catalog", () => {
  it("returns a safe in-place doctor picker with the current owner shown", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-1",
      displayName: "Dr Aygun",
      externalCode: "D-100",
      specialtyName: "Pediatrics",
      workplaces: [{
        customer: {
          id: "clinic-1",
          name: "Central Clinic",
          code: "C-100",
          address: "Main street 1",
          city: "Baku",
          district: "Nasimi",
          territoryCode: "BAK-1",
          phone: null,
          contactPerson: null,
          latitude: 40.4,
          longitude: 49.8,
        },
      }],
      agentAssignments: [{
        role: "PRIMARY",
        agent: { id: "agent-other", name: "Other Agent" },
      }],
    }] as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-22&direction=DOCTOR"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      targetAgent: { id: "agent-1", name: "Agent One" },
      direction: "DOCTOR",
      items: [{
        id: "doctor-1",
        subjectType: "CONTACT",
        name: "Dr Aygun",
        currentOwner: { id: "agent-other", name: "Other Agent" },
        customer: { id: "clinic-1", name: "Central Clinic" },
        contact: { id: "doctor-1", displayName: "Dr Aygun" },
      }],
    })
    const query = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(query.where).toEqual(expect.objectContaining({
      organizationId: ORG,
      type: "DOCTOR",
      status: "ACTIVE",
    }))
    expect(query.include.workplaces.take).toBe(1)
    expect(query.take).toBe(21)
  })

  it("limits pharmacy recovery to active pharmacy organizations", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{
      id: "pharmacy-1",
      name: "Alpha Pharmacy",
      code: "P-1",
      address: "Market street 2",
      city: "Baku",
      district: "Yasamal",
      territoryCode: "BAK-2",
      phone: null,
      contactPerson: null,
      latitude: null,
      longitude: null,
      agentAssignments: [],
    }] as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-22&direction=PHARMACY&limit=2"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.items[0]).toMatchObject({
      subjectType: "ORGANIZATION",
      kind: "PHARMACY",
      currentOwner: null,
      customer: { id: "pharmacy-1", name: "Alpha Pharmacy" },
    })
    const query = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(query.where).toEqual(expect.objectContaining({
      organizationId: ORG,
      status: "ACTIVE",
      objectType: "PHARMACY",
    }))
    expect(query.take).toBe(3)
  })

  it("rejects missing route context before reading the catalogue", async () => {
    const response = await GET(request("direction=DOCTOR"))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_ASSIGNABLE_INPUT_INVALID" })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })

  it("does not expose the recovery catalogue to an agent", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "agent-user",
      role: "sales",
      email: "agent@example.com",
      name: "Field Agent",
    })
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      role: "AGENT",
      canPlanOwnRoutes: true,
    } as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-22&direction=DOCTOR"))

    expect(response.status).toBe(403)
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
  })
})
