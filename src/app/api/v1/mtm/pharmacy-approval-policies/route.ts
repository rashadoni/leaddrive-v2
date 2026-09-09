import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  PharmacyPromotionApprovalPolicyDefinitionSchema,
  pharmacyPromotionHash,
} from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionApprovalPolicyCreateSchema } from "@/lib/mtm/pharmacy-promotion-validators"
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
  return NextResponse.json({
    error: auth.principal === "mobile"
      ? "Pharmacy promotion configuration is available only to web administrators"
      : "MTM administrator access required",
    code: auth.principal === "mobile"
      ? "MTM_PHARMACY_CONFIG_WEB_ONLY"
      : "MTM_PHARMACY_CONFIG_ADMIN_REQUIRED",
  }, { status: 403 })
}

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  if (!await requireWebAdministrator(auth)) return accessDenied(auth)

  const policies = await prisma.mtmPharmacyApprovalPolicy.findMany({
    where: { organizationId: auth.orgId },
    orderBy: [{ code: "asc" }, { version: "desc" }],
  })
  return NextResponse.json({ success: true, data: { policies } })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  const actor = await requireWebAdministrator(auth)
  if (!actor) return accessDenied(auth)

  const parsed = parseBody(
    PharmacyPromotionApprovalPolicyCreateSchema,
    await req.json().catch(() => null),
  )
  if (!parsed.ok) return parsed.response

  const definition = PharmacyPromotionApprovalPolicyDefinitionSchema.safeParse(parsed.data.definition)
  if (!definition.success) {
    return NextResponse.json({
      error: "Approval policy definition is invalid",
      code: "MTM_PHARMACY_POLICY_DEFINITION_INVALID",
      details: definition.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    }, { status: 400 })
  }

  const definitionHash = pharmacyPromotionHash(definition.data)
  const observedAt = new Date(parsed.data.observedAt)
  const rejectReasonRequired = definition.data.reasonRequiredFor.includes("REJECTED")
  const returnReasonRequired = definition.data.reasonRequiredFor.includes("RETURNED")
  const requestHash = pharmacyPromotionHash({
    code: parsed.data.code,
    version: parsed.data.version,
    name: parsed.data.name,
    definition: definition.data,
    sourceSystem: parsed.data.sourceSystem,
    sourceReference: parsed.data.sourceReference ?? null,
    sourceObservedAt: observedAt.toISOString(),
  })

  try {
    const policy = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const currentActor = await requireCurrentPharmacyPromotionAdministrator(tx as typeof prisma, auth)
      const created = await tx.mtmPharmacyApprovalPolicy.create({
        data: {
          organizationId: auth.orgId,
          code: parsed.data.code,
          version: parsed.data.version,
          name: parsed.data.name,
          l1Roles: definition.data.l1Roles as Prisma.InputJsonValue,
          l2Roles: definition.data.l2Roles as Prisma.InputJsonValue,
          l1Scope: { kind: "CURRENT_ACTOR_SCOPE" },
          l2Scope: { kind: "CURRENT_ACTOR_SCOPE" },
          definition: definition.data as unknown as Prisma.InputJsonValue,
          allowSelfApproval: !definition.data.preventSelfApproval,
          requireDistinctReviewers: definition.data.requireDistinctReviewers,
          requireRejectReason: rejectReasonRequired,
          requireReturnReason: returnReasonRequired,
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
          approvalPolicyId: created.id,
          eventType: "APPROVAL_POLICY_DRAFT_CREATED",
          toState: "DRAFT",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          sourceKey: `approval-policy:${created.id}:draft-created`,
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
          action: "PHARMACY_APPROVAL_POLICY_DRAFT_CREATED",
          entity: "mtm_pharmacy_approval_policy",
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

    return NextResponse.json({ success: true, data: policy }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === PHARMACY_PROMOTION_ADMIN_REQUIRED) return accessDenied(auth)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "Approval policy code and version already exist",
        code: "MTM_PHARMACY_POLICY_VERSION_EXISTS",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-approval-policies POST]", error)
    return NextResponse.json({
      error: "Failed to create approval policy draft",
      code: "MTM_PHARMACY_POLICY_CREATE_FAILED",
    }, { status: 500 })
  }
})
