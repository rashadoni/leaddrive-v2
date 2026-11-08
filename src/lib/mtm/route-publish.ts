import type { Prisma } from "@prisma/client"
import {
  acquireMtmRouteScheduleLocks,
  detectMtmRouteInternalScheduleConflicts,
  detectMtmRoutePlanningSignals,
  type MtmRouteConflict,
  type MtmRoutePlanningSignals,
} from "@/lib/mtm/route-planning"
import { canPublishMtmRoute, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  appendMtmRouteChangeEvidenceOutcome,
  attachMtmRouteChangeEvidence,
  createMtmRouteChangeEvidence,
} from "@/lib/mtm/route-change-evidence"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"

/**
 * Опубликовать черновик маршрута — одна функция на экран
 * (`POST /api/v1/mtm/routes/[id]/publish`) и на голос («опубликуй маршрут
 * Эльвиры на завтра», этап 2б, владелец 2026-11-08).
 *
 * Всё внутри одной транзакции вызывающего: прочитать маршрут, проверить
 * права начальника, версию, пустоту и совпадающие времена остановок, взять
 * блокировки расписания агентов на этот день, перечитать чужие маршруты под
 * блокировкой (единственная честная проверка конфликтов — браузерная её не
 * заменяет), записать переход DRAFT → PLANNED с проверкой версии и поставить
 * агентам уведомление «маршрут готов». Журнал MTM пишет вызывающий — после
 * коммита экран, в той же транзакции голос.
 */

export type MtmRoutePublishErrorCode =
  | "NOT_FOUND"
  | "MTM_ROUTE_SCOPE_DENIED"
  | "ROUTE_TRANSITION_INVALID"
  | "ROUTE_EMPTY"
  | "ROUTE_VERSION_CONFLICT"
  | "ROUTE_POINT_TIME_CONFLICT"
  | "ROUTE_CONFLICT"

export class MtmRoutePublishError extends Error {
  constructor(
    readonly code: MtmRoutePublishErrorCode,
    readonly status: 403 | 404 | 409,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code)
    this.name = "MtmRoutePublishError"
  }
}

const ROUTE_PUBLISH_INCLUDE = {
  assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
  points: { where: { deletedAt: null }, select: { customerId: true, contactId: true, plannedTime: true, deletedAt: true } },
} satisfies Prisma.MtmRouteInclude

/** Маршрут таким, каким его читает публикация, — тип из самого запроса. */
type RouteForPublish = Prisma.MtmRouteGetPayload<{ include: typeof ROUTE_PUBLISH_INCLUDE }>

export type MtmRoutePublishOutcome =
  /** Маршрут уже опубликован: повтор, а не новая публикация. */
  | Readonly<{ kind: "already"; route: RouteForPublish }>
  | Readonly<{
    kind: "published"
    route: RouteForPublish
    publishedVersion: number
    publishedAt: Date
    planningSignals: MtmRoutePlanningSignals
    managerOverride: boolean
  }>

export async function publishMtmRouteInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string
    userId: string | null
    actor: MtmRouteActor
    routeId: string
    expectedVersion: number
    overrideReason?: string | null
    now?: Date
  },
): Promise<MtmRoutePublishOutcome> {
  const { organizationId, actor } = params
  const now = params.now ?? new Date()

  const route: RouteForPublish | null = await tx.mtmRoute.findFirst({
    where: { id: params.routeId, organizationId, deletedAt: null },
    include: ROUTE_PUBLISH_INCLUDE,
  })
  if (!route) throw new MtmRoutePublishError("NOT_FOUND", 404)

  if (!canPublishMtmRoute(actor, {
    primaryAgentId: route.agentId,
    assignedAgentIds: route.assignments.map((assignment) => assignment.agentId),
    status: "DRAFT",
  })) throw new MtmRoutePublishError("MTM_ROUTE_SCOPE_DENIED", 403)
  if (route.status === "PLANNED") return { kind: "already", route }
  if (route.status !== "DRAFT") throw new MtmRoutePublishError("ROUTE_TRANSITION_INVALID", 409)
  if (route.points.length === 0) throw new MtmRoutePublishError("ROUTE_EMPTY", 409)
  if (params.expectedVersion !== route.version) {
    throw new MtmRoutePublishError("ROUTE_VERSION_CONFLICT", 409, {
      currentVersion: route.version,
      updatedAt: route.updatedAt,
    })
  }

  const internalConflicts = detectMtmRouteInternalScheduleConflicts(route.points)
  if (internalConflicts.length > 0) {
    throw new MtmRoutePublishError("ROUTE_POINT_TIME_CONFLICT", 409, { conflicts: internalConflicts })
  }

  const publishedVersion = route.version + 1
  const assignedAgentIds = [...new Set([
    route.agentId,
    ...route.assignments.map((assignment) => assignment.agentId),
  ])].sort()

  await acquireMtmRouteScheduleLocks(tx, { organizationId, date: route.date, agentIds: assignedAgentIds })

  // Re-read the competing schedules only after the agent/date locks are
  // held. This is the authoritative check; browser preflight cannot close
  // the race between two simultaneous publish requests.
  const existingRoutes = await tx.mtmRoute.findMany({
    where: {
      organizationId,
      id: { not: route.id },
      date: route.date,
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      agentId: true,
      assignments: { select: { agentId: true, removedAt: true } },
      points: { select: { customerId: true, contactId: true, plannedTime: true, deletedAt: true } },
    },
  })
  const planningSignals = detectMtmRoutePlanningSignals({
    primaryAgentId: route.agentId,
    assignments: route.assignments,
    points: route.points,
  }, existingRoutes)
  const { conflicts } = planningSignals

  const approvedOverride = conflicts.length > 0
    ? await tx.mtmRouteChangeRequest.findFirst({
      where: { organizationId, routeId: route.id, changeType: "CONFLICT_OVERRIDE", status: "APPROVED" },
      orderBy: { reviewedAt: "desc" },
    })
    : null
  const overridePayload = approvedOverride?.payload
  const overrideMatches = Boolean(
    overridePayload
    && typeof overridePayload === "object"
    && !Array.isArray(overridePayload)
    && "dedupeKey" in overridePayload
    && overridePayload.dedupeKey === route.dedupeKey,
  )
  const managerOverride = Boolean(conflicts.length > 0 && params.overrideReason && actor.role !== "AGENT")
  if (conflicts.length > 0 && !overrideMatches && !managerOverride) {
    throw new MtmRoutePublishError("ROUTE_CONFLICT", 409, { conflicts: conflicts as MtmRouteConflict[] })
  }

  if (managerOverride) {
    const overrideEvidence = createMtmRouteChangeEvidence({ capturedAt: now, changeType: "CONFLICT_OVERRIDE", route })
    const freshOverridePayload = attachMtmRouteChangeEvidence({ dedupeKey: route.dedupeKey, conflicts }, overrideEvidence)
    const completedOverridePayload = appendMtmRouteChangeEvidenceOutcome({
      payload: freshOverridePayload,
      decision: "APPROVED",
      status: "APPROVED",
      recordedAt: now,
      route: { ...route, status: "PLANNED", version: publishedVersion, publishedVersion },
      routePoint: null,
    }) ?? freshOverridePayload
    await tx.mtmRouteChangeRequest.create({
      data: {
        organizationId,
        routeId: route.id,
        requestedByAgentId: actor.agentId ?? route.agentId,
        changeType: "CONFLICT_OVERRIDE",
        status: "APPROVED",
        reason: params.overrideReason!,
        payload: completedOverridePayload as unknown as Prisma.InputJsonValue,
        reviewedBy: params.userId || null,
        decisionComment: params.overrideReason!,
        reviewedAt: now,
      },
    })
  }

  const updated = await tx.mtmRoute.updateMany({
    where: { id: route.id, organizationId, status: "DRAFT", version: params.expectedVersion, deletedAt: null },
    data: {
      status: "PLANNED",
      version: { increment: 1 },
      publishedVersion,
      publishedAt: now,
      publishedBy: params.userId || null,
    },
  })
  if (updated.count !== 1) throw new MtmRoutePublishError("ROUTE_VERSION_CONFLICT", 409)

  for (const agentId of assignedAgentIds) {
    await enqueueMtmRouteNotification(tx, {
      organizationId,
      agentId,
      dedupeKey: `route:${route.id}:published:${publishedVersion}:${agentId}`,
      title: "Route published",
      body: `Route for ${route.date.toISOString().slice(0, 10)} is ready.`,
      type: "task",
      metadata: { routeId: route.id, publishedVersion, event: "route_published" },
    })
  }

  return { kind: "published", route, publishedVersion, publishedAt: now, planningSignals, managerOverride }
}
