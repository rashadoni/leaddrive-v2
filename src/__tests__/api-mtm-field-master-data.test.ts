import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

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

import { GET as getContacts, POST as createContact } from "@/app/api/v1/mtm/contacts/route"
import { GET as getContactFacets } from "@/app/api/v1/mtm/contacts/facets/route"
import { GET as getContactViews, POST as createContactView } from "@/app/api/v1/mtm/contacts/views/route"
import { DELETE as deleteContactView } from "@/app/api/v1/mtm/contacts/views/[id]/route"
import { PUT as upsertWorkplace } from "@/app/api/v1/mtm/contacts/[id]/workplaces/route"
import { GET as getOrganizations, POST as createOrganization } from "@/app/api/v1/mtm/organizations/route"
import { PUT as assignFieldEntity } from "@/app/api/v1/mtm/field-assignments/route"
import { PUT as upsertPotential } from "@/app/api/v1/mtm/field-potentials/route"
import { PUT as legacyUpdateCustomer } from "@/app/api/v1/mtm/customers/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { coveragePolicyHash } from "@/lib/mtm/coverage-policy"

const ORG = "org-1"
const ADMIN_AUTH: AuthResult = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}
const AGENT_AUTH: AuthResult = {
  orgId: ORG,
  userId: "agent-user",
  role: "sales",
  email: "agent@example.com",
  name: "Agent",
}

const COVERAGE_DEFINITION = {
  schemaVersion: 1,
  timezone: "Asia/Baku",
  rounding: { mode: "HALF_UP", scale: 2 },
  groups: [{
    key: "doctors",
    order: 1,
    subjectType: "DOCTOR",
    labels: { ru: "Врачи", az: "Həkimlər", en: "Doctors" },
    population: { source: "CONTACT", filter: { type: "DOCTOR", status: "ACTIVE" } },
    metrics: {
      requiredCoverage: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "requiredCoverage" } },
      actualMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "actualMoi" } },
      target: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "target" } },
      actualCoverage: { source: "FIELD_POTENTIAL", unit: "VALUE", rule: { field: "coverageValue" } },
      uncoveredMoi: { source: "EXTERNAL_SOURCE", unit: "VALUE", rule: { field: "uncoveredMoi" } },
    },
  }],
  reconciliation: { kpiFormulaVersion: "SWM15-v1", tolerance: "0.0001" },
}

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1]

function request(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init)
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContact.count).mockResolvedValue(0)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmContactAgentAssignment.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmContactWorkplace.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as any)
})

describe("MTM contacts and organizations", () => {
  it("creates a separate contact and derives its display name", async () => {
    vi.mocked(prisma.mtmContact.create).mockResolvedValue({
      id: "contact-1",
      organizationId: ORG,
      firstName: "Farid",
      lastName: "Mammadov",
      displayName: "Mammadov Farid",
      type: "DOCTOR",
    } as any)

    const response = await createContact(jsonRequest("/api/v1/mtm/contacts", "POST", {
      firstName: "Farid",
      lastName: "Mammadov",
      type: "DOCTOR",
      specialtyCode: "PE",
    }))
    expect(response.status).toBe(201)
    expect(prisma.mtmContact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        displayName: "Mammadov Farid",
        specialtyCode: "PE",
      }),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalled()
  })

  it("scopes an agent contact list instead of returning every tenant contact", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)

    const response = await getContacts(request("/api/v1/mtm/contacts"))
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(args.where.AND[0]).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: ["agent-1"] } } } },
        { workplaces: { some: { customer: { OR: expect.any(Array) } } } },
      ],
    })
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, role: "AGENT", id: { in: ["agent-1"] } },
      select: { id: true, name: true, role: true, status: true },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    })
    const payload = (await response.json()).data
    expect(payload.capabilities).toMatchObject({
      canManage: false,
      canTransfer: false,
      actorAgentId: "agent-1",
      actorRole: "AGENT",
    })
    expect(payload.transferSyncScopeKey).toMatch(/^[a-f0-9]{64}$/)
  })

  it("lets a manager filter contacts by a scoped current owner", async () => {
    const ownerId = "cm000000000000000000101"
    const response = await getContacts(request(`/api/v1/mtm/contacts?ownerAgentId=${ownerId}`))
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(args.where.AND).toContainEqual({
      agentAssignments: {
        some: expect.objectContaining({ agentId: ownerId, role: "PRIMARY" }),
      },
    })
  })

  it("separates assigned and unassigned contacts without changing master records", async () => {
    const response = await getContacts(request("/api/v1/mtm/contacts?assignmentState=UNASSIGNED"))
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(args.where.AND).toContainEqual({
      agentAssignments: {
        none: expect.objectContaining({
          effectiveFrom: { lte: new Date("2026-07-15T00:00:00.000Z") },
        }),
      },
    })
  })

  it("searches active workplaces and applies professional and geography filters", async () => {
    const response = await getContacts(request(
      "/api/v1/mtm/contacts?search=Clinic&profile=Hospital&qualificationCategory=Senior"
      + "&region=Baku&administrativeDistrict=Nasimi&locality=Central&cityDistrict=North"
      + "&organizationKind=Adult%20hospital&objectType=CLINIC",
    ))
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({
      profile: "Hospital",
      qualificationCategory: "Senior",
    })
    expect(args.where.AND).toContainEqual({
      workplaces: {
        some: {
          deletedAt: null,
          endedOn: null,
          customer: {
            region: "Baku",
            administrativeDistrict: "Nasimi",
            locality: "Central",
            cityDistrict: "North",
            organizationKind: "Adult hospital",
            objectType: "CLINIC",
          },
        },
      },
    })
    expect(args.where.AND[0].OR).toContainEqual({
      workplaces: {
        some: expect.objectContaining({
          deletedAt: null,
          endedOn: null,
          customer: { OR: expect.arrayContaining([{ name: { contains: "Clinic", mode: "insensitive" } }]) },
        }),
      },
    })
    expect(args.include.visits).toMatchObject({
      where: { organizationId: ORG, deletedAt: null, status: "CHECKED_OUT" },
      take: 1,
    })
    expect(args.include.routePoints).toMatchObject({
      where: {
        deletedAt: null,
        status: "PENDING",
        route: {
          organizationId: ORG,
          deletedAt: null,
          status: { in: ["PLANNED", "IN_PROGRESS"] },
          date: { gte: new Date("2026-07-15T00:00:00.000Z") },
        },
      },
      take: 1,
    })
  })

  it("projects doctor coverage only from a signed policy and complete frozen month", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
      id: "contact-coverage-1",
      type: "DOCTOR",
      agentAssignments: [{ role: "PRIMARY", agentId: "agent-1", agent: { id: "agent-1", name: "Aysel" } }],
      workplaces: [],
      visits: [],
      routePoints: [],
    }] as any)
    vi.mocked(prisma.mtmContact.count).mockResolvedValue(1)
    vi.mocked(prisma.mtmCoverageSnapshot.findMany).mockResolvedValue([{
      id: "snapshot-1",
      policyId: "policy-1",
      policyVersion: 1,
      timezone: "Asia/Baku",
      populationHash: "a".repeat(64),
      sourceCutoffAt: new Date("2026-07-31T20:00:00.000Z"),
      sourceFreshnessAt: new Date("2026-07-31T19:00:00.000Z"),
      frozenAt: new Date("2026-08-01T08:00:00.000Z"),
      totals: {
        groups: [{ key: "doctors", label: "Врачи", order: 1, subjectType: "DOCTOR", populationCount: 1, requiredCoverage: "10.0000", actualMoi: "5.0000", target: "10.0000", actualCoverage: "7.0000", uncoveredMoi: "3.0000" }],
        overall: { populationCount: 1, requiredCoverage: "10.0000", actualMoi: "5.0000", target: "10.0000", actualCoverage: "7.0000", uncoveredMoi: "3.0000" },
      },
      completeness: { schemaVersion: 1, complete: true, expectedRows: 1, persistedRows: 1, missingSources: [], warnings: [] },
      agentId: "agent-1",
    }] as any)
    vi.mocked(prisma.mtmCoveragePolicy.findMany).mockResolvedValue([{
      id: "policy-1",
      code: "BASE_COVERAGE",
      version: 1,
      nameRu: "Покрытие базы",
      nameAz: "Baza əhatəsi",
      nameEn: "Base coverage",
      definition: COVERAGE_DEFINITION,
      definitionHash: coveragePolicyHash(COVERAGE_DEFINITION),
      approvalReference: "SwissMed SWM15-2026-08",
      sourceSystem: "SwissMed specification",
      sourceReference: "SWM15",
      sourceObservedAt: new Date("2026-08-01T00:00:00.000Z"),
      status: "ACTIVE",
      signedByUserId: "admin-1",
      signedAt: new Date("2026-08-01T08:00:00.000Z"),
      activatedAt: new Date("2026-08-01T08:00:00.000Z"),
      retiredAt: null,
    }] as any)
    vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mockResolvedValue([{
      snapshotId: "snapshot-1",
      subjectId: "contact-coverage-1",
      groupKey: "doctors",
      groupLabel: "Врачи",
      requiredCoverage: "10.0000",
      actualMoi: "5.0000",
      target: "10.0000",
      actualCoverage: "7.0000",
      uncoveredMoi: "3.0000",
      explanation: { summary: { ru: "Разрыв 3", az: "Fərq 3", en: "Gap 3" } },
    }] as any)

    const response = await getContacts(request("/api/v1/mtm/contacts?coveragePeriod=2026-07"))
    expect(response.status).toBe(200)
    const payload = (await response.json()).data
    expect(payload.coveragePeriod).toEqual({ key: "2026-07", start: "2026-07-01", end: "2026-07-31" })
    expect(payload.contacts[0].coverage).toMatchObject({
      available: true,
      state: "GAP",
      requiredCoverage: "10.0000",
      actualCoverage: "7.0000",
      uncoveredMoi: "3.0000",
      policy: { version: 1, approvalReference: "SwissMed SWM15-2026-08" },
    })
    expect(prisma.mtmCoverageSnapshotRow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ snapshotId: { in: ["snapshot-1"] }, subjectType: "DOCTOR" }),
    }))
  })

  it("returns only contact facet values visible through the actor scope", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)
    vi.mocked(prisma.mtmContact.findMany)
      .mockResolvedValueOnce([{ specialtyCode: "PE" }] as any)
      .mockResolvedValueOnce([{ profile: "Hospital" }] as any)
      .mockResolvedValueOnce([{ qualificationCategory: "Senior" }] as any)
    vi.mocked(prisma.mtmCustomer.findMany)
      .mockResolvedValueOnce([{ region: "Baku" }] as any)
      .mockResolvedValueOnce([{ administrativeDistrict: "Nasimi" }] as any)
      .mockResolvedValueOnce([{ locality: "Central" }] as any)
      .mockResolvedValueOnce([{ cityDistrict: "North" }] as any)
      .mockResolvedValueOnce([{ organizationKind: "Adult hospital" }] as any)
      .mockResolvedValueOnce([{ objectType: "CLINIC" }] as any)

    const response = await getContactFacets(request("/api/v1/mtm/contacts/facets"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        specialtyCodes: ["PE"],
        profiles: ["Hospital"],
        qualificationCategories: ["Senior"],
        regions: ["Baku"],
        administrativeDistricts: ["Nasimi"],
        localities: ["Central"],
        cityDistricts: ["North"],
        organizationKinds: ["Adult hospital"],
        objectTypes: ["CLINIC"],
      },
    })

    const contactArgs = vi.mocked(prisma.mtmContact.findMany).mock.calls[0][0] as any
    expect(contactArgs.where.AND[0]).toMatchObject({
      OR: [
        { agentAssignments: { some: { agentId: { in: ["agent-1"] } } } },
        { workplaces: { some: { customer: { OR: expect.any(Array) } } } },
      ],
    })
    const customerArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(customerArgs.where.contactWorkplaces.some.contact.AND[0]).toMatchObject({
      OR: expect.any(Array),
    })
  })

  it("keeps contact saved views tenant-, user-, and entity-scoped", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([{
      id: "view-1",
      name: "Pediatricians",
      filters: { specialtyCode: "PE" },
      isDefault: true,
      isShared: false,
      userId: "admin-user",
    }] as any)

    const response = await getContactViews(request("/api/v1/mtm/contacts/views"))
    expect(response.status).toBe(200)
    expect(prisma.savedView.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        entityType: "mtm_contacts",
        OR: [{ userId: "admin-user" }, { isShared: true }],
      },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, filters: true, isDefault: true, isShared: true, userId: true },
    })
    expect((await response.json()).data.views[0]).toMatchObject({ id: "view-1", canDelete: true })
  })

  it("creates one default contact view without clearing defaults for other entities", async () => {
    vi.mocked(prisma.savedView.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.savedView.create).mockResolvedValue({
      id: "view-2",
      name: "Baku clinics",
      filters: { region: "Baku", columns: ["contact", "workplace"] },
      isDefault: true,
      isShared: false,
      userId: "admin-user",
    } as any)

    const response = await createContactView(jsonRequest("/api/v1/mtm/contacts/views", "POST", {
      name: "Baku clinics",
      filters: { region: "Baku", status: "ACTIVE", limit: 50 },
      columns: ["contact", "workplace"],
      isDefault: true,
    }))
    expect(response.status).toBe(201)
    expect(prisma.savedView.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        userId: "admin-user",
        entityType: "mtm_contacts",
        isDefault: true,
      },
      data: { isDefault: false },
    })
    expect(prisma.savedView.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        userId: "admin-user",
        entityType: "mtm_contacts",
        name: "Baku clinics",
        isDefault: true,
        filters: expect.objectContaining({
          region: "Baku",
          columns: ["contact", "workplace"],
        }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalled()
  })

  it("deletes only the current user's contact view", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue({ id: "view-3", name: "Mine" } as any)
    vi.mocked(prisma.savedView.deleteMany).mockResolvedValue({ count: 1 } as any)

    const response = await deleteContactView(
      request("/api/v1/mtm/contacts/views/view-3", { method: "DELETE" }),
      { params: Promise.resolve({ id: "view-3" }) },
    )
    expect(response.status).toBe(200)
    expect(prisma.savedView.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "view-3",
        organizationId: ORG,
        entityType: "mtm_contacts",
        userId: "admin-user",
      },
    })
  })

  it("blocks direct contact and legacy organization mutation by an agent", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)

    const contactResponse = await createContact(jsonRequest("/api/v1/mtm/contacts", "POST", {
      firstName: "Farid",
      lastName: "Mammadov",
    }))
    expect(contactResponse.status).toBe(403)
    expect(await contactResponse.json()).toMatchObject({ code: "MTM_CONTACT_APPROVAL_REQUIRED" })

    const customerResponse = await legacyUpdateCustomer(
      jsonRequest("/api/v1/mtm/customers/customer-1", "PUT", { name: "Changed" }),
      { params: Promise.resolve({ id: "customer-1" }) },
    )
    expect(customerResponse.status).toBe(403)
    expect(prisma.mtmCustomer.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a doctor passed through the organization endpoint", async () => {
    const response = await createOrganization(jsonRequest("/api/v1/mtm/organizations", "POST", {
      name: "Dr Farid",
      objectType: "DOCTOR",
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_REQUIRED" })
  })

  it("returns only the latest completed tenant-scoped visit in each organization row", async () => {
    const response = await getOrganizations(request("/api/v1/mtm/organizations?limit=500"))
    expect(response.status).toBe(200)

    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(args.take).toBe(200)
    expect(args.include.visits).toEqual({
      where: {
        organizationId: ORG,
        deletedAt: null,
        status: "CHECKED_OUT",
      },
      orderBy: [{ checkInAt: "desc" }, { id: "desc" }],
      take: 1,
      select: {
        id: true,
        checkInAt: true,
        agent: { select: { id: true, name: true } },
      },
    })
    expect(args.include.routePoints).toMatchObject({
      where: {
        deletedAt: null,
        status: "PENDING",
        route: {
          organizationId: ORG,
          deletedAt: null,
          status: { in: ["PLANNED", "IN_PROGRESS"] },
          date: { gte: new Date("2026-07-15T00:00:00.000Z") },
        },
      },
      orderBy: [{ route: { date: "asc" } }, { orderIndex: "asc" }],
      take: 1,
    })
  })

  it("makes My organizations an exact effective assignment scope for the current actor", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "manager-1", role: "MANAGER" } as any)

    const response = await getOrganizations(request("/api/v1/mtm/organizations?scope=MINE"))
    expect(response.status).toBe(200)

    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(args.where.AND).toContainEqual({
      agentAssignments: {
        some: {
          agentId: "manager-1",
          deletedAt: null,
          effectiveFrom: { lte: new Date("2026-07-15T00:00:00.000Z") },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: new Date("2026-07-15T00:00:00.000Z") } },
          ],
        },
      },
    })
    expect(args.include.routePoints.where.route.OR).toEqual([
      { agentId: { in: ["manager-1"] } },
      { assignments: { some: { agentId: { in: ["manager-1"] }, removedAt: null } } },
    ])
    expect((await response.json()).data).toMatchObject({
      effectiveScope: "MINE",
      capabilities: { actorAgentId: "manager-1", actorRole: "MANAGER" },
    })
  })

  it("defaults an agent organization list to My organizations", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)

    const response = await getOrganizations(request("/api/v1/mtm/organizations"))
    expect(response.status).toBe(200)
    expect((await response.json()).data.effectiveScope).toBe("MINE")

    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(args.where.AND).toContainEqual({
      agentAssignments: {
        some: expect.objectContaining({ agentId: "agent-1" }),
      },
    })
  })

  it("sets a single primary workplace transactionally", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: "contact-1", displayName: "Dr Farid" } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", name: "Clinic" } as any)
    vi.mocked(prisma.mtmContactWorkplace.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmContactWorkplace.create).mockResolvedValue({
      id: "workplace-1",
      contactId: "contact-1",
      customerId: "customer-1",
      isPrimary: true,
    } as any)

    const response = await upsertWorkplace(
      jsonRequest("/api/v1/mtm/contacts/contact-1/workplaces", "PUT", {
        customerId: "customer-1",
        isPrimary: true,
        startedOn: "2026-07-15",
      }),
      { params: Promise.resolve({ id: "contact-1" }) },
    )
    expect(response.status).toBe(201)
    expect(prisma.mtmContactWorkplace.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ contactId: "contact-1", isPrimary: true, endedOn: null }),
      data: { isPrimary: false, updatedBy: "admin-user" },
    })
  })
})

describe("MTM effective field assignments", () => {
  it("creates an organization assignment with an effective date", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Agent" } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", name: "Clinic" } as any)
    vi.mocked(prisma.mtmCustomerAgentAssignment.create).mockResolvedValue({
      id: "assignment-1",
      customerId: "customer-1",
      agentId: "agent-1",
      role: "PRIMARY",
      effectiveFrom: new Date("2026-07-16T00:00:00.000Z"),
    } as any)

    const response = await assignFieldEntity(jsonRequest("/api/v1/mtm/field-assignments", "PUT", {
      subjectType: "ORGANIZATION",
      subjectId: "customer-1",
      agentId: "agent-1",
      role: "PRIMARY",
      effectiveFrom: "2026-07-16",
    }))
    expect(response.status).toBe(200)
    expect(prisma.mtmCustomerAgentAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        customerId: "customer-1",
        agentId: "agent-1",
        effectiveFrom: new Date("2026-07-16T00:00:00.000Z"),
      }),
    })
  })

  it("compare-and-sets an unassigned organization without transferring ownership", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Agent" } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", name: "Clinic" } as any)
    vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst)
      .mockResolvedValueOnce({ id: "assignment-raced" } as any)

    const response = await assignFieldEntity(jsonRequest("/api/v1/mtm/field-assignments", "PUT", {
      subjectType: "ORGANIZATION",
      subjectId: "customer-1",
      agentId: "agent-1",
      role: "PRIMARY",
      effectiveFrom: "2026-09-10",
      requireUnassigned: true,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_ASSIGNMENT_NOT_UNASSIGNED" })
    expect(prisma.mtmCustomerAgentAssignment.update).not.toHaveBeenCalled()
    expect(prisma.mtmCustomerAgentAssignment.create).not.toHaveBeenCalled()
    expect(prisma.mtmCustomerAgentAssignment.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: ORG,
        customerId: "customer-1",
        effectiveFrom: { lte: new Date("2026-09-10T00:00:00.000Z") },
      }),
      select: { id: true },
    })
  })

  it("ends the previous primary exactly at the new assignment boundary", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-2", name: "New Agent" } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", name: "Clinic" } as any)
    vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "assignment-old",
        customerId: "customer-1",
        agentId: "agent-1",
        role: "PRIMARY",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        reason: null,
      } as any)
    vi.mocked(prisma.mtmCustomerAgentAssignment.update).mockResolvedValue({ id: "assignment-old" } as any)
    vi.mocked(prisma.mtmCustomerAgentAssignment.create).mockResolvedValue({ id: "assignment-new" } as any)

    const response = await assignFieldEntity(jsonRequest("/api/v1/mtm/field-assignments", "PUT", {
      subjectType: "ORGANIZATION",
      subjectId: "customer-1",
      agentId: "agent-2",
      role: "PRIMARY",
      effectiveFrom: "2026-08-01",
    }))
    expect(response.status).toBe(200)
    expect(prisma.mtmCustomerAgentAssignment.update).toHaveBeenCalledWith({
      where: { id: "assignment-old" },
      data: { effectiveTo: new Date("2026-08-01T00:00:00.000Z"), reason: null },
    })
  })

  it("rejects a finite assignment period that overlaps existing history", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", name: "Agent" } as any)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "customer-1", name: "Clinic" } as any)
    vi.mocked(prisma.mtmCustomerAgentAssignment.findFirst).mockResolvedValueOnce({
      id: "assignment-existing",
      customerId: "customer-1",
      agentId: "agent-1",
      role: "SECONDARY",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-09-01T00:00:00.000Z"),
    } as any)

    const response = await assignFieldEntity(jsonRequest("/api/v1/mtm/field-assignments", "PUT", {
      subjectType: "ORGANIZATION",
      subjectId: "customer-1",
      agentId: "agent-1",
      role: "SECONDARY",
      effectiveFrom: "2026-08-15",
      effectiveTo: "2026-09-15",
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_ASSIGNMENT_PERIOD_OVERLAP" })
    expect(prisma.mtmCustomerAgentAssignment.create).not.toHaveBeenCalled()
  })

  it("rejects a zero-length assignment period", async () => {
    const response = await assignFieldEntity(jsonRequest("/api/v1/mtm/field-assignments", "PUT", {
      subjectType: "ORGANIZATION",
      subjectId: "customer-1",
      agentId: "agent-1",
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-01",
    }))
    expect(response.status).toBe(400)
    expect(prisma.mtmCustomerAgentAssignment.create).not.toHaveBeenCalled()
  })
})

describe("MTM brand/product potential references", () => {
  it("stores only external catalog references and scoped potential facts", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: "contact-1" } as any)
    vi.mocked(prisma.mtmFieldPotential.create).mockResolvedValue({
      id: "potential-1",
      organizationId: ORG,
      contactId: "contact-1",
      brandExternalId: "brand-acc",
      productExternalId: null,
      potentialValue: "20",
      coverageValue: "5",
    } as any)

    const response = await upsertPotential(jsonRequest("/api/v1/mtm/field-potentials", "PUT", {
      subjectType: "CONTACT",
      subjectId: "contact-1",
      brandExternalId: "brand-acc",
      potentialValue: 20,
      coverageValue: 5,
    }))
    expect(response.status).toBe(201)
    expect(prisma.mtmFieldPotential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        customerId: null,
        contactId: "contact-1",
        brandExternalId: "brand-acc",
      }),
    })
  })

  it("rejects a potential without an external brand or product reference", async () => {
    const response = await upsertPotential(jsonRequest("/api/v1/mtm/field-potentials", "PUT", {
      subjectType: "CONTACT",
      subjectId: "contact-1",
      potentialValue: 20,
    }))
    expect(response.status).toBe(400)
    expect(prisma.mtmFieldPotential.create).not.toHaveBeenCalled()
  })
})
