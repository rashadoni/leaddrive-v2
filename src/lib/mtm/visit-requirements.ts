import { Prisma } from "@prisma/client"
import { resolveMtmVisitPolicy } from "./visit-policies"

/**
 * Serialize every writer that can create a CHECKED_IN visit for one agent.
 * The transaction-scoped key is shared by direct web, web PWA sync, and native
 * mobile sync, so each writer rechecks the active-visit slot after the same
 * fence instead of racing three independent read-then-create paths.
 */
export async function lockMtmActiveVisitSlot(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: { organizationId: string; agentId: string },
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mtm-active-visit:${input.organizationId}:${input.agentId}`}))`
}

/**
 * Serializes check-in attempts for one route point without mutating that point.
 *
 * The former `updateMany({ status: "PENDING" })` fence was safe before route
 * points had `@updatedAt`, but it would now manufacture a sync delta on every
 * check-in attempt. The advisory lock preserves the same cross-endpoint race
 * protection while the caller re-reads the full authorization predicate.
 */
export async function lockAndVerifyMtmRoutePointForCheckIn(
  tx: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw" | "mtmRoutePoint">,
  input: {
    organizationId: string
    agentId: string
    routePointId: string
    routeId: string
    customerId: string
    contactId: string | null
  },
): Promise<boolean> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`mtm-route-point-check-in:${input.organizationId}:${input.routePointId}`}, 0)
    )
  `
  const where: Prisma.MtmRoutePointWhereInput = {
    id: input.routePointId,
    routeId: input.routeId,
    customerId: input.customerId,
    contactId: input.contactId,
    status: "PENDING",
    deletedAt: null,
    route: {
      organizationId: input.organizationId,
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      deletedAt: null,
      OR: [
        { agentId: input.agentId },
        { assignments: { some: { agentId: input.agentId, removedAt: null, role: { not: "OBSERVER" } } } },
      ],
    },
  }
  const candidate = await tx.mtmRoutePoint.findFirst({
    where,
    select: { id: true },
  })
  if (!candidate) return false

  // Keep the old UPDATE fence's row-lock guarantee. The first typed lookup
  // avoids locking an out-of-scope row; after the lock, the typed predicate is
  // evaluated again to catch a concurrent route/point mutation that won the
  // race before this lock was acquired.
  await tx.$queryRaw`
    SELECT 1
    FROM "mtm_route_points"
    WHERE "id" = ${input.routePointId}
      AND "organizationId" = ${input.organizationId}
    FOR UPDATE
  `
  const point = await tx.mtmRoutePoint.findFirst({
    where: {
      ...where,
    },
    select: { id: true },
  })
  return point !== null
}

export async function createVisitRequirementSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    visitId: string
    agentId: string
    customerId: string
    visitType?: string
    at?: Date
  },
) {
  const resolved = await resolveMtmVisitPolicy(tx, input)
  const snapshot = await tx.mtmVisitRequirementSnapshot.create({
    data: {
      organizationId: input.organizationId,
      visitId: input.visitId,
      sourcePolicyId: resolved.sourcePolicyId,
      resolvedAt: input.at ?? new Date(),
      requirements: {
        create: resolved.requirements.map((requirement) => ({
          organization: { connect: { id: input.organizationId } },
          actionKey: requirement.actionKey,
          mode: requirement.mode,
          minCount: requirement.minCount,
          conditions: requirement.conditions
            ? requirement.conditions as Prisma.InputJsonValue
            : Prisma.JsonNull,
          allowWaiver: requirement.allowWaiver,
        })),
      },
    },
    include: { requirements: { orderBy: { actionKey: "asc" } } },
  })
  return { resolved, snapshot }
}

export interface MissingVisitRequirement {
  actionKey: string
  requiredCount: number
  completedCount: number
  allowWaiver: boolean
  code: "MTM_VISIT_ACTION_REQUIRED"
}

export async function getVisitCompletionReadiness(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; visitId: string; expectedAgentId?: string },
) {
  const visit = await tx.mtmVisit.findFirst({
    where: {
      id: input.visitId,
      organizationId: input.organizationId,
      deletedAt: null,
      ...(input.expectedAgentId ? { agentId: input.expectedAgentId } : {}),
    },
    select: {
      id: true,
      agentId: true,
      status: true,
      checkInAt: true,
      checkOutAt: true,
      routeId: true,
      routePointId: true,
      requirementSnapshot: {
        select: {
          requirements: {
            where: { mode: "REQUIRED" },
            select: { id: true, actionKey: true, minCount: true, allowWaiver: true },
          },
        },
      },
      actionResults: {
        where: { status: { in: ["COMPLETED", "WAIVED"] } },
        select: { actionKey: true, status: true },
      },
      _count: { select: { photos: true } },
    },
  })
  if (!visit) return { found: false as const, visit: null, missing: [] as MissingVisitRequirement[] }

  const completed = new Map<string, number>()
  for (const result of visit.actionResults) {
    completed.set(result.actionKey, (completed.get(result.actionKey) ?? 0) + 1)
  }
  completed.set("PHOTO", Math.max(completed.get("PHOTO") ?? 0, visit._count.photos))

  const missing = (visit.requirementSnapshot?.requirements ?? []).flatMap((requirement) => {
    const completedCount = completed.get(requirement.actionKey) ?? 0
    return completedCount < requirement.minCount ? [{
      actionKey: requirement.actionKey,
      requiredCount: requirement.minCount,
      completedCount,
      allowWaiver: requirement.allowWaiver,
      code: "MTM_VISIT_ACTION_REQUIRED" as const,
    }] : []
  })
  return { found: true as const, visit, missing }
}

export async function completeMtmVisit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    visitId: string
    expectedAgentId?: string
    checkOutAt?: Date
    latitude?: number | null
    longitude?: number | null
  },
) {
  const readiness = await getVisitCompletionReadiness(tx, input)
  if (!readiness.found) return { status: "not_found" as const }
  if (readiness.visit.status === "CHECKED_OUT") {
    return { status: "completed" as const, visit: readiness.visit, idempotent: true }
  }
  if (readiness.visit.status !== "CHECKED_IN") {
    return { status: "invalid_status" as const, visitStatus: readiness.visit.status }
  }
  if (readiness.missing.length) {
    return { status: "missing_requirements" as const, missing: readiness.missing }
  }

  const checkOutAt = input.checkOutAt ?? new Date()
  const duration = Math.max(0, Math.round((checkOutAt.getTime() - readiness.visit.checkInAt.getTime()) / 60_000))
  let visit
  try {
    visit = await tx.mtmVisit.update({
      // Prisma's extended unique where makes the mutation itself conditional,
      // closing the gap between readiness and checkout if the visit is
      // concurrently reassigned or completed.
      where: {
        id: input.visitId,
        organizationId: input.organizationId,
        deletedAt: null,
        status: "CHECKED_IN",
        ...(input.expectedAgentId ? { agentId: input.expectedAgentId } : {}),
      },
      data: {
        status: "CHECKED_OUT",
        checkOutAt,
        checkOutLat: input.latitude ?? undefined,
        checkOutLng: input.longitude ?? undefined,
        duration,
      },
      select: { id: true, agentId: true, status: true, checkOutAt: true, duration: true, routeId: true, routePointId: true },
    })
  } catch (error) {
    if ((error as { code?: string })?.code === "P2025") return { status: "not_found" as const }
    throw error
  }

  if (visit.routePointId && visit.routeId) {
    await tx.mtmRoutePoint.updateMany({
      where: { id: visit.routePointId, routeId: visit.routeId, deletedAt: null },
      data: { status: "VISITED", visitedAt: checkOutAt, version: { increment: 1 } },
    })
    const [route, visitedPoints] = await Promise.all([
      tx.mtmRoute.findFirst({
        where: { id: visit.routeId, organizationId: input.organizationId, deletedAt: null },
        select: { id: true, totalPoints: true, status: true },
      }),
      tx.mtmRoutePoint.count({ where: { routeId: visit.routeId, status: "VISITED", deletedAt: null } }),
    ])
    if (route) {
      const complete = visitedPoints >= route.totalPoints
      await tx.mtmRoute.update({
        where: { id: route.id },
        data: {
          visitedPoints,
          status: complete ? "COMPLETED" : route.status === "PLANNED" ? "IN_PROGRESS" : route.status,
          startedAt: route.status === "PLANNED" ? checkOutAt : undefined,
          completedAt: complete ? checkOutAt : undefined,
        },
      })
    }
  }

  return { status: "completed" as const, visit, idempotent: false }
}
