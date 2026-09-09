import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

import { POST as CREATE } from "@/app/api/v1/mtm/organization-attribute-packages/route"
import { POST as ACTIVATE } from "@/app/api/v1/mtm/organization-attribute-packages/[id]/activate/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { organizationAttributeRowsHash } from "@/lib/mtm/organization-attributes"
import { prisma } from "@/lib/prisma"

const rows = [{
  organizationCode: "3799",
  medicalCategory: { code: "A", labels: { ru: "Категория A", az: "A kateqoriyası", en: "Category A" } },
  license: { status: "LICENSED" as const, labels: { ru: "Есть", az: "Var", en: "Licensed" } },
  polygon: { code: "BAKU-01", labels: { ru: "Баку 01", az: "Bakı 01", en: "Baku 01" } },
}]

function pkg(overrides: Record<string, unknown> = {}) {
  return {
    id: "package-1", organizationId: "org-1", version: 1, schemaVersion: 1,
    rowsHash: organizationAttributeRowsHash(rows), rowCount: 1,
    sourceSystem: "SwissMed master data", sourceReference: "SWM07-ATTR-1",
    sourceObservedAt: new Date("2026-08-09T12:00:00Z"), effectiveFrom: new Date("2026-08-09T00:00:00Z"),
    status: "DRAFT", approvalReference: null, createdByUserId: "admin-user",
    signedByUserId: null, signedAt: null, activatedAt: null, retiredAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  }
}

const facts = [{
  id: "fact-1", organizationId: "org-1", packageId: "package-1", customerId: "customer-1",
  organizationCode: "3799", medicalCategoryCode: "A", medicalCategoryLabels: rows[0].medicalCategory.labels,
  licenseStatus: "LICENSED", licenseLabels: rows[0].license.labels,
  polygonCode: "BAKU-01", polygonLabels: rows[0].polygon.labels, createdAt: new Date(),
}]

function createRequest(customRows: unknown = rows) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/organization-attribute-packages", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      version: 1, rows: customRows, sourceSystem: "SwissMed master data", sourceReference: "SWM07-ATTR-1",
      sourceObservedAt: "2026-08-09T12:00:00.000Z", effectiveFrom: "2026-08-09",
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
})

describe("SWM-07 organization attribute package API", () => {
  it("creates immutable facts only for current tenant Etalon IDs", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "customer-1", code: "3799" }] as never)
    vi.mocked(prisma.mtmOrganizationAttributePackage.create).mockResolvedValue(pkg() as never)
    vi.mocked(prisma.mtmOrganizationAttributeFact.createMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit" } as never)
    const response = await CREATE(createRequest())
    expect(response.status).toBe(201)
    expect(prisma.mtmOrganizationAttributePackage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", rowsHash: organizationAttributeRowsHash(rows) }) }))
    expect(prisma.mtmOrganizationAttributeFact.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ customerId: "customer-1", organizationCode: "3799" })] }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("rejects unknown Etalon IDs before any package write", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
    const response = await CREATE(createRequest())
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: "MTM_ORGANIZATION_ATTRIBUTE_UNKNOWN_CODES", unknownOrganizationCodes: ["3799"] })
    expect(prisma.mtmOrganizationAttributePackage.create).not.toHaveBeenCalled()
  })

  it("activates only the exact reviewed hash and retires the prior package", async () => {
    const draft = { ...pkg(), facts }
    const signedAt = new Date("2026-08-09T13:00:00Z")
    const active = pkg({ status: "ACTIVE", approvalReference: "SwissMed SWM-07 approval", signedByUserId: "admin-user", signedAt, activatedAt: signedAt })
    vi.mocked(prisma.mtmOrganizationAttributePackage.findFirst)
      .mockResolvedValueOnce(draft as never)
      .mockResolvedValueOnce({ id: "old-package", version: 0 } as never)
      .mockResolvedValueOnce(active as never)
    vi.mocked(prisma.mtmOrganizationAttributePackage.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
    vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit" } as never)
    const response = await ACTIVATE(new NextRequest("http://localhost:3000/api/v1/mtm/organization-attribute-packages/package-1/activate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRowsHash: draft.rowsHash, approvalReference: "SwissMed SWM-07 approval" }),
    }), { params: Promise.resolve({ id: "package-1" }) })
    expect(response.status).toBe(200)
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(prisma.mtmOrganizationAttributePackage.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVE", id: { not: "package-1" } }) }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledOnce()
  })

  it("fails closed on hash substitution", async () => {
    const draft = { ...pkg({ rowsHash: "0".repeat(64) }), facts }
    vi.mocked(prisma.mtmOrganizationAttributePackage.findFirst).mockResolvedValueOnce(draft as never)
    const response = await ACTIVATE(new NextRequest("http://localhost:3000/api/v1/mtm/organization-attribute-packages/package-1/activate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRowsHash: draft.rowsHash, approvalReference: "SwissMed SWM-07 approval" }),
    }), { params: Promise.resolve({ id: "package-1" }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_ORGANIZATION_ATTRIBUTE_SIGNATURE_INCOHERENT" })
    expect(prisma.mtmOrganizationAttributePackage.updateMany).not.toHaveBeenCalled()
  })
})
