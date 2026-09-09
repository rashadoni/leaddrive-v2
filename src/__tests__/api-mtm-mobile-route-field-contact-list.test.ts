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

import { GET as getRouteFieldContacts } from "@/app/api/v2/mtm/mobile/route-field/contacts/route"
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

function contact(id = "contact-1", displayName = "Dr. Farid") {
  return {
    id,
    displayName,
    specialtyName: "Cardiology",
    type: "DOCTOR",
    category: "A",
    email: "must-never-serialize@example.test",
    phone: "+994 50 must-never-serialize",
    mobilePhone: "+994 51 must-never-serialize",
    homePhone: "+994 12 must-never-serialize",
    externalCode: "must-never-serialize-code",
    fieldPotentials: [{ potentialValue: "100" }],
    agentAssignments: [{ agentId: "other-agent" }],
    workplaces: [{
      isPrimary: true,
      phone: "+994 12 111 11 11",
      department: "must-never-serialize department",
      customer: {
        name: "North Clinic",
        address: "must-never-serialize address",
        latitude: 40.4,
        longitude: 49.8,
      },
    }],
  }
}

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/route-field/contacts${query}`, {
    headers: { Authorization: "Bearer valid-token" },
  })
}

function list(query = "") {
  return getRouteFieldContacts(request(query))
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
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([contact()] as never)
})

describe("GET /api/v2/mtm/mobile/route-field/contacts", () => {
  it("uses a fixed active-contact projection, scoped workplace, bounded keyset page and never serializes PII", async () => {
    const response = await list("?search=Farid&limit=999&ownerAgentId=other-agent&include=everything")

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    const args = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>
      select: Record<string, unknown>
      take: number
    }
    expect(args.where).toMatchObject({ organizationId: ORG, deletedAt: null, status: "ACTIVE" })
    const filters = args.where.AND as Array<Record<string, unknown>>
    expect(filters[0]).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: [AGENT] }, deletedAt: null } } },
        { workplaces: { some: { deletedAt: null, endedOn: null } } },
      ],
    })
    expect(args.take).toBe(51)
    const serializedWhere = JSON.stringify(args.where)
    for (const forbiddenSearchField of ["mobilePhone", "homePhone", "email", "externalCode", "ownerAgentId", "include"]) {
      expect(serializedWhere).not.toContain(forbiddenSearchField)
    }
    expect(args.select.email).toBeUndefined()
    expect(args.select.phone).toBeUndefined()
    expect(args.select.agentAssignments).toBeUndefined()
    expect(args.select.fieldPotentials).toBeUndefined()
    expect(args.select.workplaces).toMatchObject({
      where: { deletedAt: null, endedOn: null, customer: { deletedAt: null } },
      take: 1,
    })
    const workplaceSelect = args.select.workplaces as { where: { customer: { AND?: unknown } } }
    expect(workplaceSelect.where.customer.AND).toEqual(expect.any(Array))
    expect(prisma.mtmContact.count).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled()

    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: {
        limit: 50,
        nextPage: null,
        contacts: [{
          id: "contact-1",
          name: "Dr. Farid",
          workplace: { name: "North Clinic", phone: "+994 12 111 11 11" },
        }],
      },
    })
    const serialized = JSON.stringify(payload)
    for (const forbidden of [
      "must-never-serialize@example.test",
      "+994 50 must-never-serialize",
      "+994 51 must-never-serialize",
      "+994 12 must-never-serialize",
      "must-never-serialize-code",
      "must-never-serialize department",
      "must-never-serialize address",
      "latitude",
      "longitude",
      "agentAssignments",
      "fieldPotentials",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("rejects a disabled Route Field tenant and missing ROUTE_EXECUTE before querying contacts", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({
      tenantCapabilities: { routeField: false, workforceHrm: false },
    }) as never)

    const disabled = await list()

    expect(disabled.status).toBe(403)
    expect(await disabled.json()).toMatchObject({ code: "TENANT_CAPABILITY_DISABLED" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "READ_ONLY" }) as never)
    const denied = await list()

    expect(denied.status).toBe(403)
    expect(denied.headers.get("Cache-Control")).toBe("no-store")
    expect(await denied.json()).toMatchObject({ code: "MTM_MOBILE_PERMISSION_REQUIRED", permission: "ROUTE_EXECUTE" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })

  it("fails closed for a manager or an inconsistent resolved agent", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ role: "MANAGER" }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "MANAGER", canPlanOwnRoutes: true } as never)

    const manager = await list()

    expect(manager.status).toBe(403)
    expect(await manager.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "resolved-agent-2", role: "AGENT", canPlanOwnRoutes: true } as never)
    const mismatch = await list()

    expect(mismatch.status).toBe(403)
    expect(await mismatch.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })

  it("uses an opaque keyset page without duplicates and rejects a page from another agent", async () => {
    const first = contact("contact-a", "Dr. Alpha")
    const second = contact("contact-b", "Dr. Bravo")
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([first, second] as never)

    const firstResponse = await list("?limit=1&search=doctor")
    const firstPayload = await firstResponse.json()
    expect(firstResponse.status).toBe(200)
    expect(firstPayload.data.contacts.map((item: { id: string }) => item.id)).toEqual(["contact-a"])
    expect(firstPayload.data.nextPage).toMatch(/^v1:/)

    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([second] as never)
    const secondResponse = await list(`?limit=1&search=doctor&page=${encodeURIComponent(firstPayload.data.nextPage)}`)
    const secondPayload = await secondResponse.json()
    expect(secondResponse.status).toBe(200)
    expect(secondPayload.data.contacts.map((item: { id: string }) => item.id)).toEqual(["contact-b"])
    expect(secondPayload.data.nextPage).toBeNull()
    const secondArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[1][0] as { where: unknown }
    expect(JSON.stringify(secondArgs.where)).toContain('"displayName":{"gt":"Dr. Alpha"}')

    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth({ agentId: "agent-2" }) as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2", role: "AGENT", canPlanOwnRoutes: true } as never)
    const callsBeforeForeignPage = vi.mocked(prisma.mtmContact.findMany).mock.calls.length
    const foreignPage = await list(`?limit=1&search=doctor&page=${encodeURIComponent(firstPayload.data.nextPage)}`)
    expect(foreignPage.status).toBe(400)
    expect(await foreignPage.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_CONTACT_PAGE_INVALID" })
    expect(prisma.mtmContact.findMany).toHaveBeenCalledTimes(callsBeforeForeignPage)
  })

  it("rejects malformed page and overlong search before the list query", async () => {
    const malformed = await list("?page=not-a-cursor")
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_CONTACT_PAGE_INVALID" })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobileAuth() as never)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "AGENT", canPlanOwnRoutes: true } as never)
    const tooLong = await list(`?search=${"x".repeat(121)}`)
    expect(tooLong.status).toBe(400)
    expect(await tooLong.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_CONTACT_SEARCH_TOO_LONG" })
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })
})
