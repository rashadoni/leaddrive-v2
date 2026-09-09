import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  PHARMACY_PROMOTION_ADMIN_REQUIRED,
  pharmacyPromotionVersionDefinition,
  pharmacyPromotionVersionHash,
  requireCurrentPharmacyPromotionAdministrator,
  resolvePharmacyPromotionAdministrator,
} from "@/lib/mtm/pharmacy-promotion-admin"
import {
  PHARMACY_PROMOTION_BLOCKERS,
  PharmacyPromotionApprovalPolicyDefinitionSchema,
  PharmacyPromotionEligibilityDefinitionSchema,
  PharmacyPromotionFormulaDefinitionSchema,
  pharmacyPromotionHash,
  validateSignedDefinition,
} from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionVersionPublishSchema } from "@/lib/mtm/pharmacy-promotion-validators"

type RouteContext = { params: Promise<{ id: string; versionId: string }> }

const publishInclude = {
  promotion: { select: { id: true, code: true, archivedAt: true } },
  type: true,
  formula: true,
  approvalPolicy: true,
} satisfies Prisma.MtmPharmacyPromotionVersionInclude

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (!await resolvePharmacyPromotionAdministrator(prisma, auth)) {
    return NextResponse.json({ error: "Web administrator access required", code: "MTM_PHARMACY_ADMIN_REQUIRED" }, { status: 403 })
  }
  const { id: promotionId, versionId } = await context.params
  const parsed = PharmacyPromotionVersionPublishSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid publication signature",
      code: "MTM_PHARMACY_VERSION_PUBLISH_INVALID",
    }, { status: 400 })
  }
  const body = {
    ...parsed.data,
    expectedDefinitionHash: parsed.data.expectedDefinitionHash.toLowerCase(),
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-promotion:${auth.orgId}:${promotionId}`}, 0))`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-version:${auth.orgId}:${versionId}`}, 0))`
      // Configuration activation uses the same org-wide locks. Holding them
      // while validating and publishing prevents a signed formula or policy
      // from being retired between the readiness check and the version CAS.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-formula-activation:${auth.orgId}`}, 0))`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-policy-activation:${auth.orgId}`}, 0))`
      const actor = await requireCurrentPharmacyPromotionAdministrator(tx, auth)
      const version = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: { id: versionId, organizationId: auth.orgId, promotionId },
        include: publishInclude,
      })
      if (!version) return { notFound: true as const }
      const requestHash = pharmacyPromotionHash({ promotionId, versionId, ...body })
      if (version.promotion.archivedAt && version.status === "DRAFT") {
        throw new Error("MTM_PHARMACY_PROMOTION_ARCHIVED")
      }
      if (version.status === "PUBLISHED") {
        if (
          version.definitionHash !== body.expectedDefinitionHash
          || version.approvalReference !== body.approvalReference
          || version.eligibilityApprovalReference !== body.eligibilityApprovalReference
        ) throw new Error("MTM_PHARMACY_VERSION_PUBLISH_CONFLICT")
        const publicationEvent = await tx.mtmPharmacyPromotionEvent.findFirst({
          where: {
            organizationId: auth.orgId,
            promotionId,
            promotionVersionId: versionId,
            sourceKey: `promotion-version:${versionId}:published`,
          },
          select: { requestHash: true },
        })
        if (!publicationEvent) throw new Error("MTM_PHARMACY_VERSION_PUBLISH_AUDIT_MISSING")
        if (publicationEvent.requestHash !== requestHash) {
          throw new Error("MTM_PHARMACY_VERSION_PUBLISH_REPLAY_CONFLICT")
        }
        return { version, definition: null, idempotent: true }
      }
      if (version.status !== "DRAFT") throw new Error("MTM_PHARMACY_VERSION_STATE_CONFLICT")
      if (version.type.status !== "ACTIVE") throw new Error("MTM_PHARMACY_TYPE_NOT_ACTIVE")

      const formula = validateSignedDefinition({
        status: version.formula.status,
        definition: version.formula.definition,
        definitionHash: version.formula.definitionHash,
        signedAt: version.formula.signedAt,
        approvalReference: version.formula.approvalReference,
        version: String(version.formula.version),
      }, PharmacyPromotionFormulaDefinitionSchema, PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED)
      if (!formula.ok) throw new Error(formula.blocker)

      const policy = validateSignedDefinition({
        status: version.approvalPolicy.status,
        definition: version.approvalPolicy.definition,
        definitionHash: version.approvalPolicy.definitionHash,
        signedAt: version.approvalPolicy.signedAt,
        approvalReference: version.approvalPolicy.approvalReference,
        version: String(version.approvalPolicy.version),
      }, PharmacyPromotionApprovalPolicyDefinitionSchema, PHARMACY_PROMOTION_BLOCKERS.POLICY_NOT_SIGNED)
      if (!policy.ok) throw new Error(policy.blocker)

      const eligibility = PharmacyPromotionEligibilityDefinitionSchema.safeParse(version.eligibilityDefinition)
      if (
        !eligibility.success
        || pharmacyPromotionHash(eligibility.success ? eligibility.data : version.eligibilityDefinition) !== version.eligibilityDefinitionHash
      ) throw new Error(PHARMACY_PROMOTION_BLOCKERS.ELIGIBILITY_NOT_CONFIRMED)

      const definitionInput = {
        promotionId,
        revision: version.revision,
        type: { id: version.type.id, code: version.type.code },
        nameRu: version.nameRu,
        nameAz: version.nameAz,
        nameEn: version.nameEn,
        descriptionRu: version.descriptionRu,
        descriptionAz: version.descriptionAz,
        descriptionEn: version.descriptionEn,
        startsOn: version.startsOn,
        endsOn: version.endsOn,
        timezone: version.timezone,
        formula: {
          id: version.formula.id,
          version: version.formula.version,
          definitionHash: version.formula.definitionHash,
        },
        approvalPolicy: {
          id: version.approvalPolicy.id,
          version: version.approvalPolicy.version,
          definitionHash: version.approvalPolicy.definitionHash,
        },
        eligibilityDefinition: eligibility.data,
        eligibilityDefinitionHash: version.eligibilityDefinitionHash,
        sourceSystem: version.sourceSystem,
        sourceReference: version.sourceReference,
        sourceObservedAt: version.sourceObservedAt,
      }
      const definition = pharmacyPromotionVersionDefinition(definitionInput)
      const computedHash = pharmacyPromotionVersionHash(definitionInput)
      if (computedHash !== version.definitionHash || computedHash !== body.expectedDefinitionHash) {
        throw new Error("MTM_PHARMACY_VERSION_DEFINITION_CHANGED")
      }
      const currentPublished = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: {
          organizationId: auth.orgId,
          promotionId,
          status: "PUBLISHED",
          id: { not: versionId },
        },
        select: { id: true, revision: true },
      })
      if (currentPublished) throw new Error("MTM_PHARMACY_VERSION_ALREADY_PUBLISHED")

      const now = new Date()
      const updated = await tx.mtmPharmacyPromotionVersion.updateMany({
        where: {
          id: versionId,
          organizationId: auth.orgId,
          promotionId,
          status: "DRAFT",
          definitionHash: body.expectedDefinitionHash,
        },
        data: {
          status: "PUBLISHED",
          approvalReference: body.approvalReference,
          eligibilityApprovalReference: body.eligibilityApprovalReference,
          eligibilityApprovedByUserId: auth.userId,
          eligibilityApprovedAt: now,
          publishedByUserId: auth.userId,
          publishedAt: now,
        },
      })
      if (updated.count !== 1) throw new Error("MTM_PHARMACY_VERSION_PUBLISH_CONFLICT")
      const published = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: { id: versionId, organizationId: auth.orgId, promotionId },
        include: publishInclude,
      })
      if (
        !published
        || published.status !== "PUBLISHED"
        || published.definitionHash !== body.expectedDefinitionHash
        || published.approvalReference !== body.approvalReference
        || published.eligibilityApprovalReference !== body.eligibilityApprovalReference
        || !published.publishedAt
        || !published.eligibilityApprovedAt
      ) throw new Error("MTM_PHARMACY_VERSION_PUBLISH_CONFLICT")
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionId,
          promotionVersionId: versionId,
          eventType: "PROMOTION_VERSION_PUBLISHED",
          fromState: "DRAFT",
          toState: "PUBLISHED",
          actorAgentId: actor.agentId,
          actorUserId: auth.userId,
          sourceKey: `promotion-version:${versionId}:published`,
          requestHash,
          payload: {
            definitionHash: computedHash,
            approvalReference: body.approvalReference,
            eligibilityApprovalReference: body.eligibilityApprovalReference,
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "PHARMACY_PROMOTION_VERSION_PUBLISH",
          entity: "mtm_pharmacy_promotion_version",
          entityId: versionId,
          metadataKind: "pharmacy_promotion_configuration",
          oldData: { status: "DRAFT", definitionHash: version.definitionHash },
          newData: { status: "PUBLISHED", definitionHash: computedHash, publishedAt: now.toISOString() },
        },
      })
      return { version: published, definition, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if ("notFound" in result) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { version: result.version, definition: result.definition }, idempotent: result.idempotent })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_VERSION_PUBLISH_FAILED"
    if (code === PHARMACY_PROMOTION_ADMIN_REQUIRED) {
      return NextResponse.json({ error: "Web administrator access required", code }, { status: 403 })
    }
    const conflicts = new Set([
      "MTM_PHARMACY_VERSION_PUBLISH_CONFLICT",
      "MTM_PHARMACY_VERSION_STATE_CONFLICT",
      "MTM_PHARMACY_TYPE_NOT_ACTIVE",
      "MTM_PHARMACY_FORMULA_NOT_SIGNED",
      "MTM_PHARMACY_APPROVAL_POLICY_NOT_SIGNED",
      "MTM_PHARMACY_ELIGIBILITY_UNKNOWN",
      "MTM_PHARMACY_VERSION_DEFINITION_CHANGED",
      "MTM_PHARMACY_VERSION_ALREADY_PUBLISHED",
      "MTM_PHARMACY_PROMOTION_ARCHIVED",
      "MTM_PHARMACY_VERSION_PUBLISH_AUDIT_MISSING",
      "MTM_PHARMACY_VERSION_PUBLISH_REPLAY_CONFLICT",
    ])
    if (conflicts.has(code)) return NextResponse.json({ error: "Campaign version is not publishable", code }, { status: 409 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Another campaign version is already published", code: "MTM_PHARMACY_VERSION_ALREADY_PUBLISHED" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Campaign version changed concurrently", code: "MTM_PHARMACY_VERSION_PUBLISH_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotions publish]", error)
    return NextResponse.json({ error: "Failed to publish campaign version", code: "MTM_PHARMACY_VERSION_PUBLISH_FAILED" }, { status: 500 })
  }
})
