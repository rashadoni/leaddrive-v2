import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { CoveragePolicyCreateSchema, coveragePolicyHash } from "@/lib/mtm/coverage-policy"
import {
  COVERAGE_POLICY_ADMIN_REQUIRED,
  coveragePolicyDate,
  requireCurrentCoveragePolicyAdministrator,
  resolveCoveragePolicyAdministrator,
} from "@/lib/mtm/coverage-policy-admin"

function accessDenied(auth: MtmRlsAuth) {
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Coverage policy configuration is available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_COVERAGE_POLICY_WEB_ONLY"
      : "MTM_COVERAGE_POLICY_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const GET = withRouteFieldRlsAuth("read", async (_req, auth) => {
  if (!await resolveCoveragePolicyAdministrator(prisma, auth)) return accessDenied(auth)
  const policies = await prisma.mtmCoveragePolicy.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ code: "asc" }, { version: "desc" }],
  })
  return NextResponse.json({ success: true, data: { policies } })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (!await resolveCoveragePolicyAdministrator(prisma, auth)) return accessDenied(auth)
  const parsed = parseBody(CoveragePolicyCreateSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const definitionHash = coveragePolicyHash(parsed.data.definition)
  const sourceObservedAt = new Date(parsed.data.sourceObservedAt)
  const requestMetadata = {
    code: parsed.data.code,
    version: parsed.data.version,
    definitionHash,
    sourceSystem: parsed.data.sourceSystem,
    sourceReference: parsed.data.sourceReference ?? null,
    sourceObservedAt: sourceObservedAt.toISOString(),
    effectiveFrom: parsed.data.effectiveFrom,
    effectiveTo: parsed.data.effectiveTo ?? null,
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const currentActor = await requireCurrentCoveragePolicyAdministrator(tx as typeof prisma, auth)
      const policy = await tx.mtmCoveragePolicy.create({
        data: {
          organizationId: auth.orgId,
          code: parsed.data.code,
          version: parsed.data.version,
          nameRu: parsed.data.nameRu,
          nameAz: parsed.data.nameAz,
          nameEn: parsed.data.nameEn,
          schemaVersion: parsed.data.definition.schemaVersion,
          definition: parsed.data.definition as unknown as Prisma.InputJsonValue,
          definitionHash,
          sourceSystem: parsed.data.sourceSystem,
          sourceReference: parsed.data.sourceReference,
          sourceObservedAt,
          effectiveFrom: coveragePolicyDate(parsed.data.effectiveFrom),
          effectiveTo: parsed.data.effectiveTo ? coveragePolicyDate(parsed.data.effectiveTo) : null,
          status: "DRAFT",
          createdByUserId: auth.userId,
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "COVERAGE_POLICY_DRAFT_CREATED",
          entity: "mtm_coverage_policy",
          entityId: policy.id,
          metadataKind: "coverage_policy_configuration",
          newData: requestMetadata,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return policy
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ success: true, data: created }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === COVERAGE_POLICY_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "Coverage policy code and version already exist",
        code: "MTM_COVERAGE_POLICY_VERSION_EXISTS",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({
        error: "Coverage policy creation conflicted with another change",
        code: "MTM_COVERAGE_POLICY_CAS_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/coverage-policies POST]", error)
    return NextResponse.json({
      error: "Failed to create coverage policy draft",
      code: "MTM_COVERAGE_POLICY_CREATE_FAILED",
    }, { status: 500 })
  }
})
