import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  OrganizationAttributePackageCreateSchema,
  organizationAttributeDate,
  organizationAttributeRowsHash,
} from "@/lib/mtm/organization-attributes"
import {
  ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED,
  requireCurrentOrganizationAttributeAdministrator,
  resolveOrganizationAttributeAdministrator,
} from "@/lib/mtm/organization-attribute-admin"

function accessDenied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Organization attribute packages are available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_ORGANIZATION_ATTRIBUTE_WEB_ONLY"
      : "MTM_ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  if (!await resolveOrganizationAttributeAdministrator(prisma, auth)) return accessDenied(auth)
  const packages = await prisma.mtmOrganizationAttributePackage.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ version: "desc" }],
    include: { facts: { orderBy: { organizationCode: "asc" }, take: 200 } },
  })
  return NextResponse.json({ success: true, data: { packages, capabilities: { canConfigure: true } } })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (!await resolveOrganizationAttributeAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(OrganizationAttributePackageCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const rowsHash = organizationAttributeRowsHash(parsed.data.rows)
  const organizationCodes = parsed.data.rows.map((row) => row.organizationCode)
  const customers = await prisma.mtmCustomer.findMany({
    where: {
      organizationId: auth.orgId,
      deletedAt: null,
      objectType: { not: "DOCTOR" },
      code: { in: organizationCodes },
    },
    select: { id: true, code: true },
  })
  const customersByCode = new Map(customers.map((customer) => [customer.code, customer.id]))
  const unknownOrganizationCodes = organizationCodes.filter((code) => !customersByCode.has(code))
  if (unknownOrganizationCodes.length > 0) {
    return NextResponse.json({
      error: "Every package row must resolve to a current tenant Etalon ID",
      code: "MTM_ORGANIZATION_ATTRIBUTE_UNKNOWN_CODES",
      unknownOrganizationCodes: unknownOrganizationCodes.slice(0, 100),
      unknownCount: unknownOrganizationCodes.length,
    }, { status: 422 })
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const actor = await requireCurrentOrganizationAttributeAdministrator(tx as typeof prisma, auth)
      const pkg = await tx.mtmOrganizationAttributePackage.create({
        data: {
          organizationId: auth.orgId,
          version: parsed.data.version,
          schemaVersion: 1,
          rowsHash,
          rowCount: parsed.data.rows.length,
          sourceSystem: parsed.data.sourceSystem,
          sourceReference: parsed.data.sourceReference,
          sourceObservedAt: new Date(parsed.data.sourceObservedAt),
          effectiveFrom: organizationAttributeDate(parsed.data.effectiveFrom),
          status: "DRAFT",
          createdByUserId: auth.userId,
        },
      })
      await tx.mtmOrganizationAttributeFact.createMany({
        data: parsed.data.rows.map((row) => ({
          organizationId: auth.orgId,
          packageId: pkg.id,
          customerId: customersByCode.get(row.organizationCode)!,
          organizationCode: row.organizationCode,
          medicalCategoryCode: row.medicalCategory?.code ?? null,
          medicalCategoryLabels: row.medicalCategory?.labels as Prisma.InputJsonValue | undefined,
          licenseStatus: row.license?.status ?? null,
          licenseLabels: row.license?.labels as Prisma.InputJsonValue | undefined,
          polygonCode: row.polygon?.code ?? null,
          polygonLabels: row.polygon?.labels as Prisma.InputJsonValue | undefined,
        })),
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "ORGANIZATION_ATTRIBUTE_PACKAGE_DRAFT_CREATED",
          entity: "mtm_organization_attribute_package",
          entityId: pkg.id,
          metadataKind: "organization_attribute_configuration",
          newData: {
            version: pkg.version,
            rowsHash: pkg.rowsHash,
            rowCount: pkg.rowCount,
            sourceSystem: pkg.sourceSystem,
            sourceReference: pkg.sourceReference,
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return pkg
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "This package version already exists", code: "MTM_ORGANIZATION_ATTRIBUTE_VERSION_EXISTS" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Package creation conflicted with another change", code: "MTM_ORGANIZATION_ATTRIBUTE_CAS_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/organization-attribute-packages POST]", error)
    return NextResponse.json({ error: "Failed to create organization attribute package", code: "MTM_ORGANIZATION_ATTRIBUTE_CREATE_FAILED" }, { status: 500 })
  }
})
