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

vi.mock("@/lib/mtm/territory-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/territory-scope")>()
  return { ...actual, resolveAgentScope: vi.fn() }
})

import { GET } from "@/app/api/v1/mtm/mobile/routes/targets/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { eligibleFieldCustomerWhere } from "@/lib/mtm/field-eligibility"

const ORG = "org-1"
const AGENT_AUTH = {
  orgId: ORG,
  agentId: "agent-1",
  userId: "user-1",
  email: "agent@example.com",
  name: "Aysel",
  role: "AGENT",
}

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/routes/targets?${query}`, {
    headers: { Authorization: "Bearer mobile" },
  })
}

function agentRow(id: string, role = "AGENT", canPlanOwnRoutes = true) {
  return {
    id,
    name: id === "agent-1" ? "Aysel" : "Nigar",
    role,
    status: "ACTIVE",
    canPlanOwnRoutes,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AGENT_AUTH as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockImplementation(async (args: any) => {
    const id = args?.where?.id
    return typeof id === "string" ? agentRow(id) as never : null as never
  })
})

describe("GET /api/v1/mtm/mobile/routes/targets", () => {
  it("returns only selected-date customer assignments for the route owner", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{
      id: "clinic-1",
      name: "Central Clinic",
      code: "C-100",
      objectType: "CLINIC",
      category: "A",
      address: "Nizami 1",
      city: "Baku",
      phone: null,
      latitude: 40.4,
      longitude: 49.8,
      agentAssignments: [{
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
      }],
    }] as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-25&targetTypeId=clinics"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      targetAgent: { id: "agent-1", name: "Aysel" },
      date: "2026-08-25",
      targetType: { id: "clinics", direction: "ORGANIZATION", objectType: "CLINIC" },
      selectionScope: {
        mode: "EFFECTIVE_ASSIGNMENTS",
        // A2: an organization point is now workable through an actionable
        // route too, so an assignment is no longer required here. `mode` keeps
        // its shipped value until the app moves to the eligibility block.
        assignmentRequired: false,
        agentId: "agent-1",
        effectiveOn: "2026-08-25",
      },
      items: [{
        targetKey: "customer:clinic-1",
        subjectType: "ORGANIZATION",
        customer: { id: "clinic-1", name: "Central Clinic" },
        contact: null,
        availability: {
          source: "CUSTOMER_ASSIGNMENT",
          validFrom: "2026-08-01",
          validThrough: "2026-08-31",
        },
      }],
    })
    const query = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0]?.[0] as any
    expect(query.where).toMatchObject({
      organizationId: ORG,
      status: "ACTIVE",
      objectType: "CLINIC",
    })
    // A2: the picker no longer writes its own ownership clause. It asks the
    // shared definition, the same one Visits and Customers ask, so the three
    // screens cannot drift apart again — that drift is what made one agent
    // read 0 candidates here and 3 on the other two screens.
    expect(query.where.AND).toContainEqual(
      eligibleFieldCustomerWhere({ agentId: "agent-1", date: new Date("2026-08-25T00:00:00.000Z") }),
    )
    const [assignmentArm] = query.where.AND.at(-1).OR
    expect(assignmentArm).toMatchObject({
      agentAssignments: {
        some: {
          // The shared scope speaks in employee lists, because a supervisor
          // asks it for several agents at once; the picker asks for exactly one.
          agentId: { in: ["agent-1"] },
          effectiveFrom: { lte: new Date("2026-08-25T00:00:00.000Z") },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: new Date("2026-08-25T00:00:00.000Z") } },
          ],
        },
      },
    })
    expect(query).toMatchObject({ skip: 0, take: 21 })
  })

  it("maps a doctor only to an active workplace assigned on the selected date", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-1",
      displayName: "Dr Aygun",
      type: "DOCTOR",
      specialtyName: "Pediatrics",
      phone: "+994500000000",
      agentAssignments: [],
      workplaces: [
        {
          id: "workplace-hidden",
          customer: {
            id: "clinic-hidden",
            name: "Other Clinic",
            code: null,
            objectType: "CLINIC",
            category: "B",
            address: null,
            city: "Baku",
            phone: null,
            latitude: null,
            longitude: null,
            agentAssignments: [],
          },
        },
        {
          id: "workplace-allowed",
          customer: {
            id: "clinic-1",
            name: "Central Clinic",
            code: "C-100",
            objectType: "CLINIC",
            category: "A",
            address: "Nizami 1",
            city: "Baku",
            phone: null,
            latitude: 40.4,
            longitude: 49.8,
            agentAssignments: [{ effectiveFrom: new Date("2026-08-20T00:00:00.000Z"), effectiveTo: null }],
          },
        },
      ],
    }] as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-25&targetTypeId=doctors"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.items).toEqual([expect.objectContaining({
      targetKey: "contact:doctor-1",
      subjectType: "CONTACT",
      customer: expect.objectContaining({ id: "clinic-1" }),
      contact: expect.objectContaining({ id: "doctor-1", displayName: "Dr Aygun" }),
      availability: { source: "WORKPLACE_ASSIGNMENT", validFrom: "2026-08-20", validThrough: null },
    })])
    const query = vi.mocked(prisma.mtmContact.findMany).mock.calls[0]?.[0] as any
    expect(query.where.AND[0].workplaces.some.AND).toEqual([
      { OR: [{ startedOn: null }, { startedOn: { lte: new Date("2026-08-25T00:00:00.000Z") } }] },
      { OR: [{ endedOn: null }, { endedOn: { gt: new Date("2026-08-25T00:00:00.000Z") } }] },
    ])
  })

  it("chooses one deterministic eligible workplace per doctor", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "doctor-1",
      displayName: "Dr Aygun",
      type: "DOCTOR",
      specialtyName: null,
      phone: null,
      agentAssignments: [],
      workplaces: [
        {
          id: "primary-workplace",
          customer: {
            id: "clinic-primary",
            name: "Primary Clinic",
            code: null,
            objectType: "CLINIC",
            category: "A",
            address: null,
            city: null,
            phone: null,
            latitude: null,
            longitude: null,
            agentAssignments: [{ effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: null }],
          },
        },
        {
          id: "secondary-workplace",
          customer: {
            id: "clinic-secondary",
            name: "Secondary Clinic",
            code: null,
            objectType: "CLINIC",
            category: "A",
            address: null,
            city: null,
            phone: null,
            latitude: null,
            longitude: null,
            agentAssignments: [{ effectiveFrom: new Date("2026-08-01T00:00:00.000Z"), effectiveTo: null }],
          },
        },
      ],
    }] as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-25&targetTypeId=doctors&limit=1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.items).toEqual([expect.objectContaining({
      targetKey: "contact:doctor-1",
      customer: expect.objectContaining({ id: "clinic-primary" }),
    })])
    expect(body.data.page).toEqual({ number: 1, limit: 1, hasMore: false })
  })

  it("denies a field agent who requests another employee before reading the target catalogue", async () => {
    const response = await GET(request("agentId=agent-2&date=2026-08-25"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_MOBILE_ROUTE_TARGET_SCOPE_DENIED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledTimes(1)
  })

  it("denies a field agent whose own route planning is disabled", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockImplementation(async (args: any) => {
      const id = args?.where?.id
      return typeof id === "string" ? agentRow(id, "AGENT", false) as never : null as never
    })

    const response = await GET(request("agentId=agent-1&date=2026-08-25"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_MOBILE_ROUTE_TARGET_SCOPE_DENIED" })
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })

  it("rejects malformed context before resolving the route actor", async () => {
    const response = await GET(request("agentId=agent-1&date=2026-02-30&limit=0"))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_MOBILE_ROUTE_TARGET_INPUT_INVALID" })
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmCustomer.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })

  it("keeps an empty scoped catalogue opaque", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([] as never)

    const response = await GET(request("agentId=agent-1&date=2026-08-25&targetTypeId=all-customers"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      items: [],
      emptyReason: "NO_EFFECTIVE_ASSIGNMENTS",
      // The shared vocabulary Visits and Customers answer with, so an empty
      // day reads the same on all three screens instead of three ways.
      eligibility: { reason: "assignment" },
    })
    expect(body.data).not.toHaveProperty("otherOwners")
  })

  it("allows a manager only for an employee in the resolved route scope", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      ...AGENT_AUTH,
      agentId: "manager-1",
      role: "MANAGER",
    } as never)
    vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["manager-1", "agent-2"] } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockImplementation(async (args: any) => {
      const id = args?.where?.id
      if (id === "manager-1") return agentRow("manager-1", "MANAGER") as never
      if (id === "agent-2") return agentRow("agent-2") as never
      return null as never
    })
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([] as never)

    const allowed = await GET(request("agentId=agent-2&date=2026-08-25"))
    expect(allowed.status).toBe(200)

    const denied = await GET(request("agentId=agent-3&date=2026-08-25"))
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: "MTM_MOBILE_ROUTE_TARGET_SCOPE_DENIED" })
  })
})
