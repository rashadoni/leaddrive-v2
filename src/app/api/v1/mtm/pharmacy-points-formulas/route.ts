import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  PharmacyPromotionFormulaDefinitionSchema,
  pharmacyPromotionHash,
} from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionFormulaCreateSchema } from "@/lib/mtm/pharmacy-promotion-validators"
import { parseBody } from "@/lib/mtm-validators"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  requireCurrentPharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"

async function requireWebAdministrator(auth: MtmRlsAuth) {
  if (auth.principal !== "web") return null
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  return actor?.role === "ADMIN" ? actor : null
}

function accessDenied(auth: MtmRlsAuth) {
  return auth.principal === "mobile"
    ? NextResponse.json({
        error: "Pharmacy promotion configuration is available only to web administrators",
        code: "MTM_PHARMACY_CONFIG_WEB_ONLY",
      }, { status: 403 })
    : NextResponse.json({
        error: "MTM administrator access required",
        code: "MTM_PHARMACY_CONFIG_ADMIN_REQUIRED",
      }, { status: 403 })
}

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  if (!await requireWebAdministrator(auth)) return accessDenied(auth)

  const formulas = await prisma.mtmPharmacyPointsFormula.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ code: "asc" }, { version: "desc" }],
  })
  return NextResponse.json({ success: true, data: { formulas } })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  const actor = await requireWebAdministrator(auth)
  if (!actor) return accessDenied(auth)

  const parsed = parseBody(
    PharmacyPromotionFormulaCreateSchema,
    await req.json().catch(() => null),
  )
  if (!parsed.ok) return parsed.response

  const definition = PharmacyPromotionFormulaDefinitionSchema.safeParse(parsed.data.definition)
  if (!definition.success) {
    return NextResponse.json({
      error: "Formula definition is invalid",
      code: "MTM_PHARMACY_FORMULA_DEFINITION_INVALID",
      details: definition.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    }, { status: 400 })
  }

  const definitionHash = pharmacyPromotionHash(definition.data)
  const observedAt = new Date(parsed.data.observedAt)
  const requestHash = pharmacyPromotionHash({
    code: parsed.data.code,
    version: parsed.data.version,
    nameRu: parsed.data.nameRu,
    nameAz: parsed.data.nameAz,
    nameEn: parsed.data.nameEn,
    definition: definition.data,
    sourceSystem: parsed.data.sourceSystem,
    sourceReference: parsed.data.sourceReference ?? null,
    sourceObservedAt: observedAt.toISOString(),
  })

  try {
    const formula = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const currentActor = await requireCurrentPharmacyPromotionAdministrator(tx as typeof prisma, auth)
      const created = await tx.mtmPharmacyPointsFormula.create({
        data: {
          organizationId: auth.orgId,
          code: parsed.data.code,
          version: parsed.data.version,
          nameRu: parsed.data.nameRu,
          nameAz: parsed.data.nameAz,
          nameEn: parsed.data.nameEn,
          schemaVersion: definition.data.schemaVersion,
          definition: definition.data as unknown as Prisma.InputJsonValue,
          definitionHash,
          sourceSystem: parsed.data.sourceSystem,
          sourceReference: parsed.data.sourceReference,
          sourceObservedAt: observedAt,
          status: "DRAFT",
          createdByUserId: auth.userId,
        },
      })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          formulaId: created.id,
          eventType: "POINTS_FORMULA_DRAFT_CREATED",
          toState: "DRAFT",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          sourceKey: `points-formula:${created.id}:draft-created`,
          requestHash,
          payload: {
            code: created.code,
            version: created.version,
            definitionHash,
            sourceSystem: created.sourceSystem,
            sourceReference: created.sourceReference,
            sourceObservedAt: created.sourceObservedAt.toISOString(),
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "PHARMACY_POINTS_FORMULA_DRAFT_CREATED",
          entity: "mtm_pharmacy_points_formula",
          entityId: created.id,
          metadataKind: "pharmacy_promotion_configuration",
          newData: {
            code: created.code,
            version: created.version,
            definitionHash,
            sourceSystem: created.sourceSystem,
            sourceReference: created.sourceReference,
            sourceObservedAt: created.sourceObservedAt.toISOString(),
          },
        },
      })
      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ success: true, data: formula }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === PHARMACY_PROMOTION_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "Formula code and version already exist",
        code: "MTM_PHARMACY_FORMULA_VERSION_EXISTS",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-points-formulas POST]", error)
    return NextResponse.json({
      error: "Failed to create formula draft",
      code: "MTM_PHARMACY_FORMULA_CREATE_FAILED",
    }, { status: 500 })
  }
})
