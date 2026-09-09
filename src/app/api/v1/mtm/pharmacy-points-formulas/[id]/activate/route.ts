import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  PharmacyPromotionFormulaDefinitionSchema,
  pharmacyPromotionHash,
} from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionSignSchema } from "@/lib/mtm/pharmacy-promotion-validators"
import { parseBody } from "@/lib/mtm-validators"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  requireCurrentPharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"

type RouteContext = { params: Promise<{ id: string }> }

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
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Pharmacy promotion configuration is available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_PHARMACY_CONFIG_WEB_ONLY"
      : "MTM_PHARMACY_CONFIG_ADMIN_REQUIRED",
  }, { status: 403 })
}

function formulaSignatureIsCoherent(formula: {
  status: string
  definition: unknown
  definitionHash: string
  approvalReference: string | null
  signedByUserId: string | null
  signedAt: Date | null
  activatedAt: Date | null
}): boolean {
  const definition = PharmacyPromotionFormulaDefinitionSchema.safeParse(formula.definition)
  if (!definition.success) return false
  return formula.status === "ACTIVE"
    && formula.definitionHash === pharmacyPromotionHash(definition.data)
    && Boolean(
      formula.approvalReference?.trim()
      && formula.signedByUserId
      && formula.signedAt
      && formula.activatedAt,
    )
}

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, { params }) => {
  const actor = await requireWebAdministrator(auth)
  if (!actor) return accessDenied(auth)

  const parsed = parseBody(
    PharmacyPromotionSignSchema,
    await req.json().catch(() => null),
  )
  if (!parsed.ok) return parsed.response
  const expectedDefinitionHash = parsed.data.expectedDefinitionHash.toLowerCase()
  const { id } = await params
  const requestHash = pharmacyPromotionHash({
    formulaId: id,
    expectedDefinitionHash,
    approvalReference: parsed.data.approvalReference,
  })

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-formula-activation:${auth.orgId}`}, 0))`
      const currentActor = await requireCurrentPharmacyPromotionAdministrator(tx as typeof prisma, auth)

      const current = await tx.mtmPharmacyPointsFormula.findFirst({
        where: { id, organizationId: auth.orgId },
      })
      if (!current) return { kind: "NOT_FOUND" as const }

      const definition = PharmacyPromotionFormulaDefinitionSchema.safeParse(current.definition)
      if (!definition.success || current.definitionHash !== pharmacyPromotionHash(definition.data)) {
        return { kind: "DEFINITION_INVALID" as const }
      }
      if (current.definitionHash.toLowerCase() !== expectedDefinitionHash) {
        return { kind: "HASH_CONFLICT" as const, actualDefinitionHash: current.definitionHash }
      }

      if (current.status === "ACTIVE") {
        if (!formulaSignatureIsCoherent(current)) return { kind: "SIGNATURE_INCOHERENT" as const }
        if (current.approvalReference !== parsed.data.approvalReference) {
          return { kind: "SIGNATURE_CONFLICT" as const }
        }
        return { kind: "OK" as const, formula: current, idempotent: true }
      }
      if (current.status !== "DRAFT") return { kind: "STATE_CONFLICT" as const, status: current.status }
      if (current.signedByUserId || current.signedAt || current.activatedAt || current.approvalReference) {
        return { kind: "SIGNATURE_INCOHERENT" as const }
      }

      const signedAt = new Date()
      const previousActive = (await tx.mtmPharmacyPointsFormula.findMany({
        where: {
          organizationId: auth.orgId,
          code: current.code,
          status: "ACTIVE",
          id: { not: current.id },
        },
        select: { id: true },
        take: 1,
      }))[0]
      if (previousActive) {
        const publishedVersion = await tx.mtmPharmacyPromotionVersion.findFirst({
          where: {
            organizationId: auth.orgId,
            formulaId: previousActive.id,
            status: "PUBLISHED",
          },
          select: { id: true },
        })
        const openExecution = publishedVersion ? null : await tx.mtmPharmacyPromotionExecution.findFirst({
          where: {
            organizationId: auth.orgId,
            formulaId: previousActive.id,
            status: { notIn: ["APPROVED", "REJECTED", "REVERSED"] },
          },
          select: { id: true },
        })
        if (publishedVersion || openExecution) {
          return {
            kind: "IN_USE" as const,
            activeFormulaId: previousActive.id,
            reason: publishedVersion ? "PUBLISHED_PROMOTION_VERSION" as const : "OPEN_EXECUTION" as const,
          }
        }
      }
      const retired = await tx.mtmPharmacyPointsFormula.updateMany({
        where: {
          organizationId: auth.orgId,
          code: current.code,
          status: "ACTIVE",
          id: { not: current.id },
        },
        data: { status: "RETIRED", retiredAt: signedAt },
      })
      if (previousActive && retired.count !== 1) throw new Error("MTM_PHARMACY_FORMULA_CAS_CONFLICT")
      const changed = await tx.mtmPharmacyPointsFormula.updateMany({
        where: {
          id: current.id,
          organizationId: auth.orgId,
          status: "DRAFT",
          definitionHash: expectedDefinitionHash,
          signedByUserId: null,
          signedAt: null,
          activatedAt: null,
        },
        data: {
          status: "ACTIVE",
          approvalReference: parsed.data.approvalReference,
          signedByUserId: auth.userId,
          signedAt,
          activatedAt: signedAt,
          retiredAt: null,
        },
      })
      if (changed.count !== 1) throw new Error("MTM_PHARMACY_FORMULA_CAS_CONFLICT")

      const activated = await tx.mtmPharmacyPointsFormula.findFirst({
        where: { id: current.id, organizationId: auth.orgId },
      })
      if (!activated || !formulaSignatureIsCoherent(activated)) {
        throw new Error("MTM_PHARMACY_FORMULA_SIGNATURE_WRITE_INCOHERENT")
      }

      if (previousActive) {
        await tx.mtmPharmacyPromotionEvent.create({
          data: {
            organizationId: auth.orgId,
            formulaId: previousActive.id,
            eventType: "POINTS_FORMULA_RETIRED",
            fromState: "ACTIVE",
            toState: "RETIRED",
            actorAgentId: currentActor.agentId,
            actorUserId: auth.userId,
            sourceKey: `points-formula:${previousActive.id}:retired-by:${activated.id}`,
            requestHash,
            payload: { activatedFormulaId: activated.id, code: activated.code },
          },
        })
      }
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          formulaId: activated.id,
          eventType: "POINTS_FORMULA_ACTIVATED",
          fromState: "DRAFT",
          toState: "ACTIVE",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          sourceKey: `points-formula:${activated.id}:activated`,
          requestHash,
          payload: {
            definitionHash: activated.definitionHash,
            approvalReference: activated.approvalReference,
            signedAt: activated.signedAt!.toISOString(),
            retiredFormulaId: previousActive?.id ?? null,
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "PHARMACY_POINTS_FORMULA_ACTIVATED",
          entity: "mtm_pharmacy_points_formula",
          entityId: current.id,
          metadataKind: "pharmacy_promotion_configuration",
          oldData: {
            status: current.status,
            definitionHash: current.definitionHash,
          },
          newData: {
            status: activated.status,
            definitionHash: activated.definitionHash,
            approvalReference: activated.approvalReference,
            signedByUserId: activated.signedByUserId,
            signedAt: activated.signedAt!.toISOString(),
            activatedAt: activated.activatedAt!.toISOString(),
            retiredFormulaId: previousActive?.id ?? null,
            sourceSystem: activated.sourceSystem,
            sourceReference: activated.sourceReference,
            sourceObservedAt: activated.sourceObservedAt.toISOString(),
          },
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? req.headers.get("x-real-ip"),
          userAgent: req.headers.get("user-agent"),
        },
      })
      return { kind: "OK" as const, formula: activated, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "Formula not found", code: "MTM_PHARMACY_FORMULA_NOT_FOUND" }, { status: 404 })
    }
    if (result.kind === "DEFINITION_INVALID" || result.kind === "SIGNATURE_INCOHERENT") {
      return NextResponse.json({
        error: "Stored formula signature is not coherent",
        code: "MTM_PHARMACY_FORMULA_SIGNATURE_INCOHERENT",
      }, { status: 409 })
    }
    if (result.kind === "HASH_CONFLICT") {
      return NextResponse.json({
        error: "Formula definition changed since it was reviewed",
        code: "MTM_PHARMACY_FORMULA_HASH_CONFLICT",
        actualDefinitionHash: result.actualDefinitionHash,
      }, { status: 409 })
    }
    if (result.kind === "SIGNATURE_CONFLICT") {
      return NextResponse.json({
        error: "Formula is already active under a different approval reference",
        code: "MTM_PHARMACY_FORMULA_SIGNATURE_CONFLICT",
      }, { status: 409 })
    }
    if (result.kind === "STATE_CONFLICT") {
      return NextResponse.json({
        error: "Only draft formulas can be activated",
        code: "MTM_PHARMACY_FORMULA_STATE_CONFLICT",
        status: result.status,
      }, { status: 409 })
    }
    if (result.kind === "IN_USE") {
      return NextResponse.json({
        error: "The current active formula is pinned by a published promotion or open execution",
        code: "MTM_PHARMACY_FORMULA_IN_USE",
        activeFormulaId: result.activeFormulaId,
        reason: result.reason,
      }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: result.formula, idempotent: result.idempotent })
  } catch (error) {
    if (error instanceof Error && error.message === PHARMACY_PROMOTION_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Error && error.message === "MTM_PHARMACY_FORMULA_CAS_CONFLICT") {
      return NextResponse.json({
        error: "Formula changed concurrently; reload before activating",
        code: "MTM_PHARMACY_FORMULA_CAS_CONFLICT",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json({
        error: "Formula activation conflicted with another change",
        code: "MTM_PHARMACY_FORMULA_CAS_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-points-formulas activate]", error)
    return NextResponse.json({
      error: "Failed to activate formula",
      code: "MTM_PHARMACY_FORMULA_ACTIVATION_FAILED",
    }, { status: 500 })
  }
})
