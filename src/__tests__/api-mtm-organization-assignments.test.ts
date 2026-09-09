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

import { GET as listOrganizations } from "@/app/api/v1/mtm/organizations/route"
import { GET as organizationFacets } from "@/app/api/v1/mtm/organizations/facets/route"
import { GET as listOrganizationViews, POST as createOrganizationView } from "@/app/api/v1/mtm/organizations/views/route"
import { POST as previewAssignment } from "@/app/api/v1/mtm/organization-assignments/preview/route"
import { POST as executeAssignment } from "@/app/api/v1/mtm/organization-assignments/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const CUSTOMER = "customer-1"
const TARGET = "agent-2"
const CURRENT_ASSIGNMENT = "assignment-1"
const ADMIN_AUTH: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const AGENT_AUTH: AuthResult = { orgId: ORG, userId: "agent-user", role: "sales", email: "agent@example.com", name: "Agent" }

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  })
}

function eligibleOrganization(assignments: unknown[] = []) {
  return { id: CUSTOMER, name: "Central Clinic", status: "ACTIVE", agentAssignments: assignments }
}

const baseInput = {
  organizationIds: [CUSTOMER],
  mode: "ASSIGN" as const,
  targetAgentId: TARGET,
  effectiveFrom: "2026-07-22",
  reason: "Published territory ownership",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: TARGET, name: "Agent Two", status: "ACTIVE", role: "AGENT" } as any)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([eligibleOrganization()] as any)
  vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(1)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmOrganizationAssignmentOperation.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmOrganizationAssignmentOperation.create).mockResolvedValue({ id: "operation-1" } as any)
  vi.mocked(prisma.mtmOrganizationAssignmentOperation.update).mockResolvedValue({ id: "operation-1" } as any)
  vi.mocked(prisma.mtmCustomerAgentAssignment.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.mtmCustomerAgentAssignment.create).mockResolvedValue({ id: "assignment-new" } as any)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as any)
  vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
  vi.mocked(prisma.savedView.updateMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prisma.savedView.create).mockResolvedValue({
    id: "view-1",
    name: "Baku clinics",
    filters: { region: "Baku", columns: ["name", "geography"] },
    isDefault: true,
    isShared: false,
    userId: ADMIN_AUTH.userId,
  } as any)
})

describe("MTM organization explorer and bulk assignment", () => {
  it("builds server-side geography, ownership and unassigned filters", async () => {
    const response = await listOrganizations(new NextRequest(
      "http://localhost:3000/api/v1/mtm/organizations?region=Baku&administrativeDistrict=Nasimi&assignmentState=UNASSIGNED&sort=updatedAt&direction=desc&page=2&limit=25",
    ))
    expect(response.status).toBe(200)
    expect(prisma.mtmCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 25,
      take: 25,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      where: expect.objectContaining({
        region: { equals: "Baku", mode: "insensitive" },
        administrativeDistrict: { equals: "Nasimi", mode: "insensitive" },
        agentAssignments: { none: expect.any(Object) },
      }),
    }))
  })

  it("evaluates unassigned organizations on the validated route day", async () => {
    const response = await listOrganizations(new NextRequest(
      "http://localhost:3000/api/v1/mtm/organizations?search=Clinic&assignmentState=UNASSIGNED&asOf=2026-09-10",
    ))
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({
      organizationId: ORG,
      agentAssignments: {
        none: {
          deletedAt: null,
          effectiveFrom: { lte: new Date("2026-09-10T00:00:00.000Z") },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date("2026-09-10T00:00:00.000Z") } }],
        },
      },
    })
    expect((await response.json()).data.asOf).toBe("2026-09-10")
  })

  it("rejects invalid route days and agent access to the unassigned catalogue", async () => {
    const invalid = await listOrganizations(new NextRequest(
      "http://localhost:3000/api/v1/mtm/organizations?assignmentState=UNASSIGNED&asOf=2026-02-31",
    ))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: "MTM_ORGANIZATION_AS_OF_INVALID" })

    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)
    const forbidden = await listOrganizations(new NextRequest(
      "http://localhost:3000/api/v1/mtm/organizations?search=Clinic&assignmentState=UNASSIGNED&asOf=2026-09-10",
    ))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toMatchObject({ code: "MTM_ORGANIZATION_ASSIGNMENT_SEARCH_FORBIDDEN" })
  })

  it("filters only through the active effective signed attribute package", async () => {
    const response = await listOrganizations(new NextRequest(
      "http://localhost:3000/api/v1/mtm/organizations?medicalCategoryCode=A&licenseStatus=LICENSED&polygonCode=BAKU-01",
    ))
    expect(response.status).toBe(200)
    const call = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(call.where).toMatchObject({
      attributeFacts: {
        some: {
          medicalCategoryCode: "A",
          licenseStatus: "LICENSED",
          polygonCode: "BAKU-01",
          package: { status: "ACTIVE", effectiveFrom: { lte: expect.any(Date) } },
        },
      },
    })
    expect(call.include.attributeFacts.where.package).toMatchObject({ status: "ACTIVE" })
  })

  it("returns scoped filter dictionaries and separates managers from field agents", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "manager-1", name: "Manager One", role: "MANAGER" },
      { id: TARGET, name: "Agent Two", role: "AGENT" },
    ] as any)

    const response = await organizationFacets(new NextRequest("http://localhost:3000/api/v1/mtm/organizations/facets"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        managers: [{ id: "manager-1", role: "MANAGER" }],
        assignableAgents: [{ id: TARGET, role: "AGENT" }],
      },
    })
  })

  it("constrains dependent facets by every active filter except their own value", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockImplementation(async (args: any) => {
      const field = Object.keys(args.select ?? {})[0]
      return field ? [{ [field]: `${field}-value` }] : []
    })

    const response = await organizationFacets(new NextRequest(
      "http://localhost:3000/api/v1/mtm/organizations/facets?region=Baku&administrativeDistrict=Nasimi&category=A&polygonCode=BAKU-01&assignmentState=UNASSIGNED",
    ))
    expect(response.status).toBe(200)

    const calls: any[] = (vi.mocked(prisma.mtmCustomer.findMany).mock.calls as unknown[][])
      .map((call) => call[0])
    const administrativeDistrictFacet = calls.find((args: any) => args.select?.administrativeDistrict)
    expect(administrativeDistrictFacet.where).toMatchObject({
      category: "A",
      region: { equals: "Baku", mode: "insensitive" },
      administrativeDistrict: { not: null },
      attributeFacts: {
        some: {
          polygonCode: "BAKU-01",
          package: { status: "ACTIVE", effectiveFrom: { lte: expect.any(Date) } },
        },
      },
      agentAssignments: { none: expect.any(Object) },
    })

    const regionFacet = calls.find((args: any) => args.select?.region)
    expect(regionFacet.where).toMatchObject({
      region: { not: null },
      administrativeDistrict: { equals: "Nasimi", mode: "insensitive" },
    })
  })

  it("stores columns inside a tenant/user scoped saved organization view", async () => {
    const response = await createOrganizationView(jsonRequest("/api/v1/mtm/organizations/views", {
      name: "Baku clinics",
      filters: { region: "Baku" },
      columns: ["name", "geography"],
      isDefault: true,
    }))
    expect(response.status).toBe(201)
    expect(prisma.savedView.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        userId: ADMIN_AUTH.userId,
        entityType: "mtm_organizations",
        filters: { region: "Baku", columns: ["name", "geography"] },
      }),
    }))

    vi.mocked(prisma.savedView.findMany).mockResolvedValueOnce([{
      id: "view-1", name: "Baku clinics", filters: { region: "Baku", columns: ["name"] },
      isDefault: true, isShared: false, userId: ADMIN_AUTH.userId,
    }] as any)
    const listResponse = await listOrganizationViews(new NextRequest("http://localhost:3000/api/v1/mtm/organizations/views"))
    expect(listResponse.status).toBe(200)
    expect((await listResponse.json()).data.views).toHaveLength(1)
  })

  it("previews and executes an idempotent effective-dated assignment", async () => {
    const previewResponse = await previewAssignment(jsonRequest("/api/v1/mtm/organization-assignments/preview", baseInput))
    expect(previewResponse.status).toBe(200)
    const preview = (await previewResponse.json()).data
    expect(preview).toMatchObject({ summary: { selected: 1, assignable: 1, excluded: 0 }, rows: [{ organizationId: CUSTOMER, assignable: true }] })

    const response = await executeAssignment(jsonRequest("/api/v1/mtm/organization-assignments", {
      ...baseInput,
      previewToken: preview.previewToken,
      idempotencyKey: "organization-assignment-20260722-001",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { summary: { changed: 1 } } })
    expect(prisma.mtmCustomerAgentAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: CUSTOMER, agentId: TARGET, source: "BULK_ASSIGNMENT" }),
      select: { id: true },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ORGANIZATION_BULK_ASSIGN" }) })
  })

  it("ends current ownership when the reviewed mode is UNASSIGN", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([eligibleOrganization([{
      id: CURRENT_ASSIGNMENT,
      agentId: "agent-1",
      role: "PRIMARY",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
    }])] as any)
    const input = { organizationIds: [CUSTOMER], mode: "UNASSIGN" as const, effectiveFrom: "2026-07-22", reason: "Return to free base" }
    const preview = (await (await previewAssignment(jsonRequest("/preview", input))).json()).data
    const response = await executeAssignment(jsonRequest("/execute", {
      ...input,
      previewToken: preview.previewToken,
      idempotencyKey: "organization-unassign-20260722-001",
    }))
    expect(response.status).toBe(200)
    expect(prisma.mtmCustomerAgentAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: CURRENT_ASSIGNMENT }),
      data: { effectiveTo: new Date("2026-07-22T00:00:00.000Z"), reason: "Return to free base" },
    }))
    expect(prisma.mtmCustomerAgentAssignment.create).not.toHaveBeenCalled()
  })

  it("excludes active visit/route conflicts and denies agents", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ customerId: CUSTOMER }] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{ customerId: CUSTOMER }] as any)
    const preview = await previewAssignment(jsonRequest("/preview", baseInput))
    const payload = await preview.json()
    expect(payload.data.rows[0].issues).toEqual(["OPEN_VISIT_CONFLICT", "ROUTE_PLAN_CONFLICT"])

    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as any)
    const forbidden = await previewAssignment(jsonRequest("/preview", baseInput))
    expect(forbidden.status).toBe(403)
  })
})
