import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  OrganizationAttributePackageActivateSchema,
  OrganizationAttributeRowsSchema,
  organizationAttributePackageSignatureIsCoherent,
  organizationAttributeRowsHash,
} from "@/lib/mtm/organization-attributes"
import {
  ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED,
  requireCurrentOrganizationAttributeAdministrator,
  resolveOrganizationAttributeAdministrator,
} from "@/lib/mtm/organization-attribute-admin"

type RouteContext = { params: Promise<{ id: string }> }

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

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  if (!await resolveOrganizationAttributeAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(OrganizationAttributePackageActivateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const expectedRowsHash = parsed.data.expectedRowsHash.toLowerCase()
  const { id } = await params

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-organization-attribute-activation:${auth.orgId}`}, 0))`
      const actor = await requireCurrentOrganizationAttributeAdministrator(tx as typeof prisma, auth)
      const current = await tx.mtmOrganizationAttributePackage.findFirst({
        where: { id, organizationId: auth.orgId },
        include: { facts: { orderBy: { organizationCode: "asc" } } },
      })
      if (!current) return { kind: "NOT_FOUND" as const }

      const rows = OrganizationAttributeRowsSchema.safeParse(current.facts.map((fact) => ({
        organizationCode: fact.organizationCode,
        ...(fact.medicalCategoryCode && fact.medicalCategoryLabels ? { medicalCategory: {
          code: fact.medicalCategoryCode,
          labels: fact.medicalCategoryLabels,
        } } : {}),
        ...(fact.licenseStatus && fact.licenseLabels ? { license: {
          status: fact.licenseStatus,
          labels: fact.licenseLabels,
        } } : {}),
        ...(fact.polygonCode && fact.polygonLabels ? { polygon: {
          code: fact.polygonCode,
          labels: fact.polygonLabels,
        } } : {}),
      })))
      if (!rows.success || current.rowCount !== current.facts.length
        || current.rowsHash !== organizationAttributeRowsHash(rows.data)) {
        return { kind: "DEFINITION_INVALID" as const }
      }
      if (current.rowsHash.toLowerCase() !== expectedRowsHash) {
        return { kind: "HASH_CONFLICT" as const, actualRowsHash: current.rowsHash }
      }
      if (current.status === "ACTIVE") {
        if (!organizationAttributePackageSignatureIsCoherent(current)) return { kind: "SIGNATURE_INCOHERENT" as const }
        if (current.approvalReference !== parsed.data.approvalReference) return { kind: "SIGNATURE_CONFLICT" as const }
        return { kind: "OK" as const, pkg: current, idempotent: true }
      }
      if (current.status !== "DRAFT") return { kind: "STATE_CONFLICT" as const, status: current.status }
      if (!organizationAttributePackageSignatureIsCoherent(current)) return { kind: "SIGNATURE_INCOHERENT" as const }

      const signedAt = new Date()
      const previousActive = await tx.mtmOrganizationAttributePackage.findFirst({
        where: { organizationId: auth.orgId, status: "ACTIVE", id: { not: current.id } },
        select: { id: true, version: true },
      })
      const retired = await tx.mtmOrganizationAttributePackage.updateMany({
        where: { organizationId: auth.orgId, status: "ACTIVE", id: { not: current.id } },
        data: { status: "RETIRED", retiredAt: signedAt },
      })
      if (previousActive && retired.count !== 1) throw new Error("MTM_ORGANIZATION_ATTRIBUTE_CAS_CONFLICT")

      const changed = await tx.mtmOrganizationAttributePackage.updateMany({
        where: {
          id: current.id,
          organizationId: auth.orgId,
          status: "DRAFT",
          rowsHash: expectedRowsHash,
          approvalReference: null,
          signedByUserId: null,
          signedAt: null,
          activatedAt: null,
          retiredAt: null,
        },
        data: {
          status: "ACTIVE",
          approvalReference: parsed.data.approvalReference,
          signedByUserId: auth.userId,
          signedAt,
          activatedAt: signedAt,
        },
      })
      if (changed.count !== 1) throw new Error("MTM_ORGANIZATION_ATTRIBUTE_CAS_CONFLICT")

      const activated = await tx.mtmOrganizationAttributePackage.findFirst({
        where: { id: current.id, organizationId: auth.orgId },
      })
      if (!activated || !organizationAttributePackageSignatureIsCoherent(activated)) {
        throw new Error("MTM_ORGANIZATION_ATTRIBUTE_SIGNATURE_WRITE_INCOHERENT")
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "ORGANIZATION_ATTRIBUTE_PACKAGE_ACTIVATED",
          entity: "mtm_organization_attribute_package",
          entityId: activated.id,
          metadataKind: "organization_attribute_configuration",
          oldData: { status: current.status, rowsHash: current.rowsHash },
          newData: {
            status: activated.status,
            version: activated.version,
            rowsHash: activated.rowsHash,
            rowCount: activated.rowCount,
            approvalReference: activated.approvalReference,
            signedByUserId: activated.signedByUserId,
            signedAt: activated.signedAt!.toISOString(),
            retiredPackageId: previousActive?.id ?? null,
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return { kind: "OK" as const, pkg: activated, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") return NextResponse.json({ error: "Package not found", code: "MTM_ORGANIZATION_ATTRIBUTE_NOT_FOUND" }, { status: 404 })
    if (result.kind === "DEFINITION_INVALID" || result.kind === "SIGNATURE_INCOHERENT") {
      return NextResponse.json({ error: "Stored package signature is not coherent", code: "MTM_ORGANIZATION_ATTRIBUTE_SIGNATURE_INCOHERENT" }, { status: 409 })
    }
    if (result.kind === "HASH_CONFLICT") {
      return NextResponse.json({ error: "Package rows changed since review", code: "MTM_ORGANIZATION_ATTRIBUTE_HASH_CONFLICT", actualRowsHash: result.actualRowsHash }, { status: 409 })
    }
    if (result.kind === "SIGNATURE_CONFLICT") return NextResponse.json({ error: "Package is active under a different approval reference", code: "MTM_ORGANIZATION_ATTRIBUTE_SIGNATURE_CONFLICT" }, { status: 409 })
    if (result.kind === "STATE_CONFLICT") return NextResponse.json({ error: "Only draft packages can be activated", code: "MTM_ORGANIZATION_ATTRIBUTE_STATE_CONFLICT", status: result.status }, { status: 409 })
    return NextResponse.json({ success: true, data: result.pkg, idempotent: result.idempotent })
  } catch (error) {
    if (error instanceof Error && error.message === ORGANIZATION_ATTRIBUTE_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Error && error.message === "MTM_ORGANIZATION_ATTRIBUTE_CAS_CONFLICT") {
      return NextResponse.json({ error: "Package changed concurrently; reload before activation", code: "MTM_ORGANIZATION_ATTRIBUTE_CAS_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({ error: "Package activation conflicted with another change", code: "MTM_ORGANIZATION_ATTRIBUTE_CAS_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/organization-attribute-packages activate]", error)
    return NextResponse.json({ error: "Failed to activate organization attribute package", code: "MTM_ORGANIZATION_ATTRIBUTE_ACTIVATION_FAILED" }, { status: 500 })
  }
})
