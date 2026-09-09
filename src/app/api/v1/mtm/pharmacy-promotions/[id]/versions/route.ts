import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  jsonValue,
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  pharmacyPromotionDate,
  pharmacyPromotionVersionDefinition,
  pharmacyPromotionVersionHash,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import {
  PharmacyPromotionEligibilityDefinitionSchema,
  pharmacyPromotionHash,
} from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionVersionCreateSchema } from "@/lib/mtm/pharmacy-promotion-validators"

type RouteContext = { params: Promise<{ id: string }> }

function forbidden() {
  return NextResponse.json({ error: "Web administrator access required", code: "MTM_PHARMACY_ADMIN_REQUIRED" }, { status: 403 })
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

const versionInclude = {
  type: true,
  formula: true,
  approvalPolicy: true,
  _count: { select: { targets: true } },
} satisfies Prisma.MtmPharmacyPromotionVersionInclude

export const GET = withMtmRlsAuth<RouteContext>("mtm", "read", async (_req, auth, context) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()
  const { id } = await context.params
  const promotion = await prisma.mtmPharmacyPromotion.findFirst({
    where: { id, organizationId: auth.orgId, archivedAt: null },
    select: { id: true, code: true },
  })
  if (!promotion) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const versions = await prisma.mtmPharmacyPromotionVersion.findMany({
    where: { organizationId: auth.orgId, promotionId: id },
    include: versionInclude,
    orderBy: { revision: "desc" },
  })
  return NextResponse.json({ success: true, data: { promotion, versions } })
})

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) return forbidden()
  const { id: promotionId } = await context.params
  const parsed = PharmacyPromotionVersionCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid campaign version",
      code: "MTM_PHARMACY_VERSION_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  if (body.revision > 2_147_483_647) {
    return NextResponse.json({
      error: "Campaign revision exceeds the supported range",
      code: "MTM_PHARMACY_VERSION_INVALID",
    }, { status: 400 })
  }
  const eligibility = PharmacyPromotionEligibilityDefinitionSchema.safeParse(body.eligibilityDefinition)
  if (!eligibility.success) {
    return NextResponse.json({
      error: eligibility.error.issues[0]?.message ?? "Invalid eligibility definition",
      code: "MTM_PHARMACY_ELIGIBILITY_INVALID",
    }, { status: 400 })
  }
  if (!validTimezone(body.timezone)) {
    return NextResponse.json({ error: "Invalid IANA timezone", code: "MTM_PHARMACY_TIMEZONE_INVALID" }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-promotion:${auth.orgId}:${promotionId}`}, 0))`
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)
      const [promotion, type, formula, approvalPolicy] = await Promise.all([
        tx.mtmPharmacyPromotion.findFirst({
          where: { id: promotionId, organizationId: auth.orgId, archivedAt: null },
          select: { id: true, code: true },
        }),
        tx.mtmPharmacyPromotionType.findFirst({
          where: { id: body.typeId, organizationId: auth.orgId },
          select: { id: true, code: true, status: true },
        }),
        tx.mtmPharmacyPointsFormula.findFirst({
          where: { id: body.formulaId, organizationId: auth.orgId },
          select: { id: true, version: true, definitionHash: true, status: true },
        }),
        tx.mtmPharmacyApprovalPolicy.findFirst({
          where: { id: body.approvalPolicyId, organizationId: auth.orgId },
          select: { id: true, version: true, definitionHash: true, status: true },
        }),
      ])
      if (!promotion) return { notFound: true as const }
      if (!type) throw new Error("MTM_PHARMACY_TYPE_NOT_FOUND")
      if (!formula) throw new Error("MTM_PHARMACY_FORMULA_NOT_FOUND")
      if (!approvalPolicy) throw new Error("MTM_PHARMACY_POLICY_NOT_FOUND")

      const eligibilityDefinitionHash = pharmacyPromotionHash(eligibility.data)
      const startsOn = pharmacyPromotionDate(body.startsOn)
      const endsOn = pharmacyPromotionDate(body.endsOn)
      const sourceObservedAt = new Date(body.observedAt)
      const definitionInput = {
        promotionId,
        revision: body.revision,
        type: { id: type.id, code: type.code },
        nameRu: body.nameRu,
        nameAz: body.nameAz,
        nameEn: body.nameEn,
        descriptionRu: body.descriptionRu ?? null,
        descriptionAz: body.descriptionAz ?? null,
        descriptionEn: body.descriptionEn ?? null,
        startsOn,
        endsOn,
        timezone: body.timezone,
        formula,
        approvalPolicy,
        eligibilityDefinition: eligibility.data,
        eligibilityDefinitionHash,
        sourceSystem: body.sourceSystem,
        sourceReference: body.sourceReference,
        sourceObservedAt,
      }
      const definition = pharmacyPromotionVersionDefinition(definitionInput)
      const definitionHash = pharmacyPromotionVersionHash(definitionInput)
      const version = await tx.mtmPharmacyPromotionVersion.create({
        data: {
          organizationId: auth.orgId,
          promotionId,
          revision: body.revision,
          typeId: type.id,
          nameRu: body.nameRu,
          nameAz: body.nameAz,
          nameEn: body.nameEn,
          descriptionRu: body.descriptionRu ?? null,
          descriptionAz: body.descriptionAz ?? null,
          descriptionEn: body.descriptionEn ?? null,
          startsOn,
          endsOn,
          timezone: body.timezone,
          formulaId: formula.id,
          approvalPolicyId: approvalPolicy.id,
          eligibilityDefinition: jsonValue(eligibility.data),
          eligibilityDefinitionHash,
          definitionHash,
          eligibilityApprovalReference: body.eligibilityApprovalReference ?? null,
          sourceSystem: body.sourceSystem,
          sourceReference: body.sourceReference,
          sourceObservedAt,
          createdByUserId: auth.userId,
        },
        include: versionInclude,
      })
      const requestHash = pharmacyPromotionHash({ promotionId, body })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionId,
          promotionVersionId: version.id,
          eventType: "PROMOTION_VERSION_CREATED",
          toState: "DRAFT",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey: `promotion-version:${version.id}:created`,
          requestHash,
          payload: { revision: version.revision, definitionHash, definition: jsonValue(definition) },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_VERSION_CREATE",
          entity: "mtm_pharmacy_promotion_version",
          entityId: version.id,
          metadataKind: "pharmacy_promotion_configuration",
          newData: { promotionId, revision: version.revision, definitionHash, status: version.status },
        },
      })
      return { version, definition }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if ("notFound" in result) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_VERSION_CREATE_FAILED"
    if (code === PHARMACY_PROMOTION_ADMIN_REQUIRED) return forbidden()
    if (new Set(["MTM_PHARMACY_TYPE_NOT_FOUND", "MTM_PHARMACY_FORMULA_NOT_FOUND", "MTM_PHARMACY_POLICY_NOT_FOUND"]).has(code)) {
      return NextResponse.json({ error: "Referenced configuration was not found", code }, { status: 400 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Campaign revision already exists", code: "MTM_PHARMACY_VERSION_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Campaign version changed concurrently", code: "MTM_PHARMACY_VERSION_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotions versions POST]", error)
    return NextResponse.json({ error: "Failed to create campaign version", code: "MTM_PHARMACY_VERSION_CREATE_FAILED" }, { status: 500 })
  }
})
