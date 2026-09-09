import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { activeFieldAssignmentWindow, canManageFieldMasterData } from "@/lib/mtm/field-scope"
import {
  isAgentInRouteScope,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import {
  PharmacyPromotionEligibilityDefinitionSchema,
  evaluatePharmacyPromotionEligibility,
  pharmacyPromotionHash,
} from "@/lib/mtm/pharmacy-promotion"
import { jsonValue, pharmacyPromotionDate } from "@/lib/mtm/pharmacy-promotion-admin"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { PharmacyPromotionTargetCreateSchema } from "@/lib/mtm/pharmacy-promotion-validators"

function actorFor(client: typeof prisma, auth: { orgId: string; userId: string; role: string; agentId: string | null }) {
  return resolveMtmRouteActor(client, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

const targetInclude = {
  promotionVersion: {
    include: {
      promotion: { select: { id: true, code: true } },
      type: { select: { id: true, code: true, nameRu: true, nameAz: true, nameEn: true } },
    },
  },
  customer: { select: { id: true, code: true, name: true, objectType: true, status: true, locality: true, territoryCode: true } },
  contact: { select: { id: true, displayName: true, status: true } },
  assignedAgent: { select: { id: true, name: true, status: true, teamId: true, managerId: true } },
  assignedTeam: { select: { id: true, name: true } },
  managingManager: { select: { id: true, name: true } },
  executions: {
    where: {
      status: { in: ["RETURNED", "REJECTED"] },
      successorExecution: { is: null },
    },
    select: { id: true, status: true, actualQuantity: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 1,
  },
  _count: { select: { executions: true } },
} satisfies Prisma.MtmPharmacyPromotionTargetInclude

const MAX_PLAN_QUANTITY = new Prisma.Decimal("99999999999999.9999")

export const GET = withMtmRlsAuth("mtm", "read", async (req, auth) => {
  const actor = await actorFor(prisma, auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const params = new URL(req.url).searchParams
  const promotionVersionId = params.get("promotionVersionId")?.trim() || undefined
  const requestedAgentId = params.get("agentId")?.trim() || undefined
  if (requestedAgentId && !isAgentInRouteScope(actor, requestedAgentId)) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_PHARMACY_TARGET_SCOPE_DENIED" }, { status: 403 })
  }
  const scopedAgentIds = actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds]
  const visitAgentIds = requestedAgentId ? [requestedAgentId] : scopedAgentIds
  const agentScopeWhere: Prisma.MtmPharmacyPromotionTargetWhereInput[] = [
    ...(requestedAgentId ? [{ assignedAgentId: requestedAgentId }] : []),
    ...(scopedAgentIds === null ? [] : [{ assignedAgentId: { in: scopedAgentIds } }]),
  ]
  const targets = await prisma.mtmPharmacyPromotionTarget.findMany({
    where: {
      organizationId: auth.orgId,
      ...(promotionVersionId ? { promotionVersionId } : {}),
      ...(agentScopeWhere.length > 0 ? { AND: agentScopeWhere } : {}),
    },
    include: {
      ...targetInclude,
      customer: {
        select: {
          ...targetInclude.customer.select,
          visits: {
            where: {
              organizationId: auth.orgId,
              status: "CHECKED_OUT",
              deletedAt: null,
              checkOutAt: { not: null },
              ...(visitAgentIds === null
                ? {}
                : { agentId: { in: visitAgentIds } }),
            },
            orderBy: [{ checkOutAt: "desc" }, { id: "desc" }],
            take: 10,
            select: {
              id: true,
              agentId: true,
              status: true,
              checkInAt: true,
              checkOutAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1_000,
  })
  return NextResponse.json({
    success: true,
    data: {
      targets,
      capabilities: { canPlan: auth.principal === "web" && canManageFieldMasterData(actor) },
    },
  })
})

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  if (auth.principal !== "web") {
    return NextResponse.json({ error: "Target planning is available in the web workspace", code: "MTM_PHARMACY_TARGET_WEB_REQUIRED" }, { status: 403 })
  }
  const actor = await actorFor(prisma, auth)
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Planning permission required", code: "MTM_PHARMACY_TARGET_PLAN_DENIED" }, { status: 403 })
  }
  const parsed = PharmacyPromotionTargetCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message ?? "Invalid promotion target",
      code: "MTM_PHARMACY_TARGET_INVALID",
    }, { status: 400 })
  }
  const body = parsed.data
  if (!isAgentInRouteScope(actor, body.assignedAgentId)) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_PHARMACY_TARGET_SCOPE_DENIED" }, { status: 403 })
  }
  const requestHash = pharmacyPromotionHash(body)

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-target:${auth.orgId}:${body.operationId}`}, 0))`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-version:${auth.orgId}:${body.promotionVersionId}`}, 0))`
      const currentActor = await actorFor(tx as typeof prisma, auth)
      if (!currentActor || !canManageFieldMasterData(currentActor)) throw new Error("MTM_PHARMACY_TARGET_PLAN_DENIED")
      if (!isAgentInRouteScope(currentActor, body.assignedAgentId)) throw new Error("MTM_PHARMACY_TARGET_SCOPE_DENIED")

      const replay = await tx.mtmPharmacyPromotionOperation.findFirst({
        where: { organizationId: auth.orgId, idempotencyKey: body.operationId },
      })
      if (replay) {
        if (
          replay.requestHash !== requestHash
          || replay.kind !== "BULK_PLAN"
          || replay.actorUserId !== auth.userId
        ) {
          throw new Error("MTM_PHARMACY_TARGET_IDEMPOTENCY_CONFLICT")
        }
        const targetId = (replay.resultPayload as { targetId?: string } | null)?.targetId
        if (typeof targetId !== "string" || !targetId) throw new Error("MTM_PHARMACY_TARGET_REPLAY_INCOMPLETE")
        const target = await tx.mtmPharmacyPromotionTarget.findFirst({
          where: { id: targetId, organizationId: auth.orgId },
          include: targetInclude,
        })
        if (
          !target
          || target.promotionVersionId !== body.promotionVersionId
          || target.customerId !== body.customerId
          || target.assignedAgentId !== body.assignedAgentId
          || target.contactId !== (body.contactId ?? null)
          || target.unit !== body.unit
          || !target.planQuantity.equals(new Prisma.Decimal(body.planQuantity))
        ) throw new Error("MTM_PHARMACY_TARGET_REPLAY_INCOMPLETE")
        const event = await tx.mtmPharmacyPromotionEvent.findFirst({
          where: {
            organizationId: auth.orgId,
            sourceKey: `promotion-target:${target.id}:planned`,
            targetId: target.id,
          },
          select: { requestHash: true, operationId: true },
        })
        if (!event || event.requestHash !== requestHash || event.operationId !== replay.id) {
          throw new Error("MTM_PHARMACY_TARGET_REPLAY_INCOMPLETE")
        }
        return { target, idempotent: true }
      }

      const version = await tx.mtmPharmacyPromotionVersion.findFirst({
        where: {
          id: body.promotionVersionId,
          organizationId: auth.orgId,
          status: "PUBLISHED",
          promotion: { archivedAt: null },
        },
        include: { promotion: { select: { id: true, code: true } }, type: true },
      })
      if (!version) throw new Error("MTM_PHARMACY_VERSION_NOT_PUBLISHED")

      const today = pharmacyPromotionDate(currentDateKey(new Date(), version.timezone))
      if (today.getTime() > version.endsOn.getTime()) {
        throw new Error("MTM_PHARMACY_PROMOTION_PERIOD_ENDED")
      }
      const [customer, assignedAgent, assignment, contact] = await Promise.all([
        tx.mtmCustomer.findFirst({
          where: {
            id: body.customerId,
            organizationId: auth.orgId,
            deletedAt: null,
            objectType: "PHARMACY",
          },
          select: {
            id: true,
            code: true,
            name: true,
            address: true,
            objectType: true,
            status: true,
            managingManagerId: true,
            managingManager: { select: { id: true, name: true, organizationId: true } },
          },
        }),
        tx.mtmAgent.findFirst({
          where: { id: body.assignedAgentId, organizationId: auth.orgId, status: "ACTIVE" },
          include: {
            team: { select: { id: true, name: true, organizationId: true } },
            manager: { select: { id: true, name: true, organizationId: true } },
          },
        }),
        tx.mtmCustomerAgentAssignment.findFirst({
          where: {
            organizationId: auth.orgId,
            customerId: body.customerId,
            agentId: body.assignedAgentId,
            ...activeFieldAssignmentWindow(today),
          },
          select: { id: true, role: true, effectiveFrom: true, effectiveTo: true },
        }),
        body.contactId
          ? tx.mtmContact.findFirst({
              where: {
                id: body.contactId,
                organizationId: auth.orgId,
                deletedAt: null,
                status: "ACTIVE",
                workplaces: {
                  some: {
                    organizationId: auth.orgId,
                    customerId: body.customerId,
                    deletedAt: null,
                    OR: [{ startedOn: null }, { startedOn: { lte: today } }],
                    AND: [{ OR: [{ endedOn: null }, { endedOn: { gt: today } }] }],
                  },
                },
              },
              select: { id: true, displayName: true },
            })
          : Promise.resolve(null),
      ])
      if (!customer) throw new Error("MTM_PHARMACY_CUSTOMER_INVALID")
      if (!assignedAgent) throw new Error("MTM_PHARMACY_AGENT_INVALID")
      if (
        (assignedAgent.team && assignedAgent.team.organizationId !== auth.orgId)
        || (assignedAgent.manager && assignedAgent.manager.organizationId !== auth.orgId)
        || (customer.managingManager && customer.managingManager.organizationId !== auth.orgId)
      ) throw new Error("MTM_PHARMACY_HIERARCHY_INVALID")
      if (!assignment) throw new Error("MTM_PHARMACY_ASSIGNMENT_REQUIRED")
      if (body.contactId && !contact) throw new Error("MTM_PHARMACY_CONTACT_INVALID")
      const planQuantity = new Prisma.Decimal(body.planQuantity)
      if (
        !planQuantity.isFinite()
        || planQuantity.isNegative()
        || planQuantity.decimalPlaces() > 4
        || planQuantity.greaterThan(MAX_PLAN_QUANTITY)
      ) throw new Error("MTM_PHARMACY_PLAN_QUANTITY_INVALID")

      const eligibility = PharmacyPromotionEligibilityDefinitionSchema.safeParse(version.eligibilityDefinition)
      if (!eligibility.success || pharmacyPromotionHash(eligibility.success ? eligibility.data : version.eligibilityDefinition) !== version.eligibilityDefinitionHash) {
        throw new Error("MTM_PHARMACY_ELIGIBILITY_UNKNOWN")
      }
      const evaluated = evaluatePharmacyPromotionEligibility(eligibility.data, {
        customerObjectType: customer.objectType,
        customerActive: customer.status === "ACTIVE",
        visitCompleted: false,
        evidenceCount: 0,
      })
      const structurallyIneligible = evaluated.status === "INELIGIBLE"
        && evaluated.reasons.some((reason) => reason === "CUSTOMER_TYPE" || reason === "CUSTOMER_INACTIVE")
      const eligibilityStatus = evaluated.status === "ELIGIBLE"
        ? "ELIGIBLE"
        : structurallyIneligible ? "INELIGIBLE" : "PENDING"
      const now = new Date()
      const managingManager = assignedAgent.manager ?? customer.managingManager ?? null
      const operation = await tx.mtmPharmacyPromotionOperation.create({
        data: {
          organizationId: auth.orgId,
          kind: "BULK_PLAN",
          status: "PENDING",
          selectionScope: "EXPLICIT_IDS",
          explicitIds: [body.customerId],
          selectionHash: pharmacyPromotionHash([body.customerId]),
          idempotencyKey: body.operationId,
          requestHash,
          requestPayload: jsonValue(body),
          selectedCount: 1,
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          startedAt: now,
        },
      })
      const target = await tx.mtmPharmacyPromotionTarget.create({
        data: {
          organizationId: auth.orgId,
          promotionVersionId: version.id,
          customerId: customer.id,
          contactId: contact?.id ?? null,
          assignedAgentId: assignedAgent.id,
          assignedTeamId: assignedAgent.team?.id ?? null,
          managingManagerId: managingManager?.id ?? null,
          planQuantity,
          unit: body.unit,
          eligibilityStatus,
          eligibilitySnapshot: {
            schemaVersion: 1,
            definitionHash: version.eligibilityDefinitionHash,
            evaluatedAt: now.toISOString(),
            customer: { objectType: customer.objectType, active: customer.status === "ACTIVE" },
            assignment: {
              id: assignment.id,
              role: assignment.role,
              effectiveFrom: assignment.effectiveFrom.toISOString().slice(0, 10),
              effectiveTo: assignment.effectiveTo?.toISOString().slice(0, 10) ?? null,
            },
            status: eligibilityStatus,
            pendingOrFailedReasons: evaluated.status === "INELIGIBLE" ? evaluated.reasons : [],
          },
          customerCodeSnapshot: customer.code,
          customerNameSnapshot: customer.name,
          customerAddressSnapshot: customer.address,
          customerRegistrationSnapshot: customer.code,
          agentNameSnapshot: assignedAgent.name,
          teamNameSnapshot: assignedAgent.team?.name ?? null,
          managerNameSnapshot: managingManager?.name ?? null,
          sourceSystem: body.sourceSystem,
          sourceReference: body.sourceReference,
          sourceObservedAt: new Date(body.observedAt),
          createdByUserId: auth.userId,
        },
        include: targetInclude,
      })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          promotionId: version.promotion.id,
          promotionVersionId: version.id,
          targetId: target.id,
          operationId: operation.id,
          eventType: "PROMOTION_TARGET_PLANNED",
          toState: "PLANNED",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.userId,
          sourceKey: `promotion-target:${target.id}:planned`,
          requestHash,
          payload: {
            idempotencyKey: body.operationId,
            customerId: customer.id,
            assignedAgentId: assignedAgent.id,
            eligibilityStatus,
          },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "PHARMACY_PROMOTION_TARGET_PLAN",
          entity: "mtm_pharmacy_promotion_target",
          entityId: target.id,
          metadataKind: "pharmacy_promotion_plan",
          newData: {
            promotionVersionId: version.id,
            customerId: customer.id,
            assignedAgentId: assignedAgent.id,
            planQuantity: target.planQuantity.toString(),
            unit: target.unit,
            eligibilityStatus,
          },
        },
      })
      await tx.mtmPharmacyPromotionOperation.update({
        where: { organizationId_id: { organizationId: auth.orgId, id: operation.id } },
        data: {
          status: "COMPLETED",
          resultPayload: { targetId: target.id },
          succeededCount: 1,
          completedAt: new Date(),
          version: { increment: 1 },
        },
      })
      return { target, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, data: { target: result.target }, idempotent: result.idempotent }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTM_PHARMACY_TARGET_CREATE_FAILED"
    if (code === "MTM_PHARMACY_TARGET_PLAN_DENIED" || code === "MTM_PHARMACY_TARGET_SCOPE_DENIED") {
      return NextResponse.json({ error: "Planning permission denied", code }, { status: 403 })
    }
    const invalid = new Set([
      "MTM_PHARMACY_VERSION_NOT_PUBLISHED",
      "MTM_PHARMACY_PROMOTION_PERIOD_ENDED",
      "MTM_PHARMACY_CUSTOMER_INVALID",
      "MTM_PHARMACY_AGENT_INVALID",
      "MTM_PHARMACY_ASSIGNMENT_REQUIRED",
      "MTM_PHARMACY_CONTACT_INVALID",
      "MTM_PHARMACY_HIERARCHY_INVALID",
      "MTM_PHARMACY_PLAN_QUANTITY_INVALID",
      "MTM_PHARMACY_ELIGIBILITY_UNKNOWN",
    ])
    if (invalid.has(code)) return NextResponse.json({ error: "Promotion target is not eligible for planning", code }, { status: 409 })
    if (code === "MTM_PHARMACY_TARGET_IDEMPOTENCY_CONFLICT") {
      return NextResponse.json({ error: "Target idempotency conflict", code }, { status: 409 })
    }
    if (code === "MTM_PHARMACY_TARGET_REPLAY_INCOMPLETE") {
      return NextResponse.json({ error: "Stored target replay is incomplete", code }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Target already exists", code: "MTM_PHARMACY_TARGET_CONFLICT" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Target changed concurrently", code: "MTM_PHARMACY_TARGET_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion-targets POST]", error)
    return NextResponse.json({ error: "Failed to plan promotion target", code: "MTM_PHARMACY_TARGET_CREATE_FAILED" }, { status: 500 })
  }
})
