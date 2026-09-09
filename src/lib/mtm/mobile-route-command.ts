import { Prisma } from "@prisma/client"
import type { MobileAuthResult } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { getMtmSettings, type MtmSettingsShape } from "@/lib/mtm-settings"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import {
  acquireMtmRouteScheduleLocks,
  buildMtmRouteDedupeKey,
  detectMtmRouteInternalScheduleConflicts,
  detectMtmRoutePlanningSignals,
} from "@/lib/mtm/route-planning"
import {
  canCreateMtmRouteFor,
  canEditMtmRouteDraft,
  canPublishMtmRoute,
  resolveMtmRouteActor,
} from "@/lib/mtm/route-permissions"
import {
  mtmRouteTargetKey,
  validateMtmMobileRouteTargetEligibility,
  validateMtmRouteTargets,
} from "@/lib/mtm/route-targets"
import {
  expiresMtmMobileRouteCommandReceiptAt,
  hashMtmMobileRouteCommand,
  isMtmMobileRouteCommandReceiptScopeMatch,
  type MtmMobileRouteCommandReceiptScope,
} from "@/lib/mtm/mobile-route-command-receipt"
import type { MtmMobileRouteCommandInput } from "@/lib/mtm-validators"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-outbox"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { isValidTimezone } from "@/lib/timezone"

const MOBILE_ROUTE_COMMAND_TRANSACTION_TIMEOUT_MS = 10_000

type MobileRouteCommandResponse = Record<string, unknown>

export interface MtmMobileRouteCommandExecution {
  responseStatus: number
  result: MobileRouteCommandResponse
  /** True only when a prior terminal receipt was replayed without a write. */
  replayed: boolean
  /** Best-effort audit data. It is intentionally absent for a replay. */
  audit?: {
    action: "ROUTE_CREATE" | "ROUTE_UPDATE" | "ROUTE_PUBLISH" | "ROUTE_START"
    routeId: string
    agentId: string
    oldData?: Record<string, unknown>
    newData: Record<string, unknown>
  }
}

export interface ExecuteMtmMobileRouteCommandInput {
  auth: Pick<MobileAuthResult, "agentId" | "userId" | "orgId" | "role">
  deviceId: string
  command: MtmMobileRouteCommandInput
  /** Injected only by focused tests; production always uses the server clock. */
  now?: Date
}

type TerminalCommandOutcome = {
  outcome: "APPLIED" | "CONFLICT"
  responseStatus: 200 | 201 | 409
  result: MobileRouteCommandResponse
  audit?: MtmMobileRouteCommandExecution["audit"]
}

type NonterminalCommandOutcome = {
  responseStatus: 403 | 404
  result: MobileRouteCommandResponse
}

type CommandApplicationOutcome = TerminalCommandOutcome | NonterminalCommandOutcome

function forbidden(): NonterminalCommandOutcome {
  return {
    responseStatus: 403,
    result: { success: false, error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" },
  }
}

function targetAssignmentRequired(): NonterminalCommandOutcome {
  return {
    responseStatus: 403,
    result: {
      success: false,
      error: "Route target is unavailable for this employee on this date",
      code: "MTM_ROUTE_TARGET_ASSIGNMENT_REQUIRED",
    },
  }
}

function routeNotFound(): NonterminalCommandOutcome {
  return {
    responseStatus: 404,
    result: { success: false, error: "Not found", code: "MTM_ROUTE_NOT_FOUND" },
  }
}

function conflict(
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
): TerminalCommandOutcome {
  return {
    outcome: "CONFLICT",
    responseStatus: 409,
    result: { success: false, error, code, ...extra },
  }
}

function applied(
  responseStatus: 200 | 201,
  data: Record<string, unknown>,
  audit: NonNullable<MtmMobileRouteCommandExecution["audit"]>,
): TerminalCommandOutcome {
  return {
    outcome: "APPLIED",
    responseStatus,
    result: { success: true, data },
    audit,
  }
}

function targetRouteIdFor(command: MtmMobileRouteCommandInput): string | null {
  return command.command === "CREATE_DRAFT" ? null : command.routeId
}

function receiptScope(input: ExecuteMtmMobileRouteCommandInput): MtmMobileRouteCommandReceiptScope {
  const targetRouteId = targetRouteIdFor(input.command)
  return {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    deviceId: input.deviceId,
    operationId: input.command.operationId,
    command: input.command.command,
    targetRouteId,
    requestHash: hashMtmMobileRouteCommand({
      command: input.command.command,
      targetRouteId,
      payload: input.command.payload,
    }),
    payload: input.command.payload,
  }
}

function asStoredResponse(result: unknown): MobileRouteCommandResponse {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    // A corrupt receipt must never turn into a fresh mutation. This is an
    // operational failure for the caller, not a reason to ignore the row.
    throw new Error("MOBILE_ROUTE_COMMAND_RECEIPT_RESULT_INVALID")
  }
  return result as MobileRouteCommandResponse
}

function replayOrMismatch(
  receipt: {
    organizationId: string
    agentId: string
    deviceId: string
    operationId: string
    command: string
    targetRouteId: string | null
    requestHash: string
    responseStatus: number
    result: unknown
    expiresAt: Date
  },
  requested: MtmMobileRouteCommandReceiptScope,
  now: Date,
): MtmMobileRouteCommandExecution {
  if (!isMtmMobileRouteCommandReceiptScopeMatch(receipt, requested)) {
    return {
      responseStatus: 409,
      result: {
        success: false,
        error: "This operation ID belongs to a different route command.",
        code: "MOBILE_ROUTE_COMMAND_IDEMPOTENCY_MISMATCH",
      },
      replayed: false,
    }
  }
  if (receipt.expiresAt <= now) {
    return {
      responseStatus: 409,
      result: {
        success: false,
        error: "This route command receipt has expired. Create a new operation ID before retrying.",
        code: "MOBILE_ROUTE_COMMAND_RECEIPT_EXPIRED",
      },
      replayed: false,
    }
  }
  return {
    responseStatus: receipt.responseStatus,
    result: asStoredResponse(receipt.result),
    replayed: true,
  }
}

function routeDateKey(routeDate: Date): string {
  return routeDate.toISOString().slice(0, 10)
}

function routeHorizonConflict(
  routeDate: Date,
  settings: MtmSettingsShape,
  now: Date,
): TerminalCommandOutcome | null {
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const today = currentDateKey(now, timezone)
  const until = addDateKeyDays(today, 7)
  const date = routeDateKey(routeDate)
  if (date >= today && date < until) return null
  return conflict(
    "MOBILE_ROUTE_COMMAND_DATE_OUTSIDE_HORIZON",
    "Route Field may plan only within the current seven local calendar days.",
  )
}

function isSelfManagedRoute(
  route: { agentId: string; assignments: Array<{ agentId: string }> },
  agentId: string,
): boolean {
  return route.agentId === agentId && route.assignments.every((assignment) => assignment.agentId === agentId)
}

/**
 * A CRM manager may assign a shared route to a field participant. That
 * participant can already read the route and check in at its non-observer
 * stops, so route start must use the same operational scope. This is
 * deliberately narrower than `isSelfManagedRoute`: only START may use an
 * assignment; drafting and publishing remain primary-owner actions.
 */
function canExecuteAssignedRoute(
  route: { agentId: string; assignments: Array<{ agentId: string; role: string }> },
  agentId: string,
): boolean {
  return route.agentId === agentId || route.assignments.some(
    (assignment) => assignment.agentId === agentId && assignment.role !== "OBSERVER",
  )
}

async function verifyWorkCalendar(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    agentId: string
    routeDate: Date
    settings: MtmSettingsShape
  },
): Promise<TerminalCommandOutcome | NonterminalCommandOutcome | null> {
  const agent = await tx.mtmAgent.findFirst({
    where: { organizationId: input.organizationId, id: input.agentId, status: "ACTIVE" },
    select: { id: true, teamId: true },
  })
  if (!agent) return forbidden()
  if (!input.settings.enforceWorkCalendarForRoutes) return null

  const overrides = await tx.mtmWorkCalendarDay.findMany({
    where: {
      organizationId: input.organizationId,
      date: input.routeDate,
      deletedAt: null,
      OR: [
        { teamId: null, agentId: null },
        ...(agent.teamId ? [{ teamId: agent.teamId, agentId: null }] : []),
        { teamId: null, agentId: input.agentId },
      ],
    },
    select: {
      id: true,
      date: true,
      kind: true,
      name: true,
      teamId: true,
      agentId: true,
      movedToDate: true,
      routePlanningAllowed: true,
    },
  })
  const calendarDay = resolveWorkCalendarDay({
    date: routeDateKey(input.routeDate),
    overrides: overrides as WorkCalendarOverride[],
    teamId: agent.teamId,
    agentId: input.agentId,
  })
  return calendarDay.routePlanningAllowed
    ? null
    : conflict(
        "MTM_ROUTE_NON_WORKING_DAY",
        "Route planning is not allowed on this calendar day",
      )
}

async function verifyRouteTargets(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    agentId: string
    routeDate: Date
    points: Array<{ customerId: string; contactId?: string | null }>
    newPoints?: Array<{ customerId: string; contactId?: string | null }>
  },
): Promise<TerminalCommandOutcome | NonterminalCommandOutcome | null> {
  const [targetValidation, mobileTargetEligibility] = await Promise.all([
    validateMtmRouteTargets(tx, {
      organizationId: input.organizationId,
      routeDate: input.routeDate,
      points: input.points,
    }),
    validateMtmMobileRouteTargetEligibility(tx, {
      organizationId: input.organizationId,
      primaryAgentId: input.agentId,
      routeDate: input.routeDate,
      points: input.newPoints ?? input.points,
    }),
  ])
  if (!targetValidation.ok) {
    // IDs are intentionally omitted from the durable result: the client can
    // refresh its scoped catalogue without storing rejected target history.
    return conflict(
      "MTM_ROUTE_REFERENCE_INVALID",
      "Route references are outside the organization or inactive",
    )
  }
  return mobileTargetEligibility.ok ? null : targetAssignmentRequired()
}

async function applyCreateDraft(
  tx: Prisma.TransactionClient,
  input: {
    auth: ExecuteMtmMobileRouteCommandInput["auth"]
    command: Extract<MtmMobileRouteCommandInput, { command: "CREATE_DRAFT" }>
    settings: MtmSettingsShape
    now: Date
  },
): Promise<CommandApplicationOutcome> {
  const routeDate = new Date(input.command.payload.date)
  const horizon = routeHorizonConflict(routeDate, input.settings, input.now)
  if (horizon) return horizon
  const calendar = await verifyWorkCalendar(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    routeDate,
    settings: input.settings,
  })
  if (calendar) return calendar
  const targets = await verifyRouteTargets(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    routeDate,
    points: input.command.payload.points,
  })
  if (targets) return targets

  const assignments = [{ agentId: input.auth.agentId, role: "PRIMARY" as const }]
  const dedupeKey = buildMtmRouteDedupeKey({
    date: routeDate,
    primaryAgentId: input.auth.agentId,
    assignments,
    points: input.command.payload.points,
  })
  // The old direct endpoint stays protocol-v1-compatible. The new command
  // path serializes its own draft creation so two retried Route Field commands
  // cannot both pass a non-unique legacy dedupe preflight.
  await acquireMtmRouteScheduleLocks(tx, {
    organizationId: input.auth.orgId,
    date: routeDate,
    agentIds: [input.auth.agentId],
  })
  const duplicate = await tx.mtmRoute.findFirst({
    where: { organizationId: input.auth.orgId, dedupeKey, deletedAt: null },
    select: { id: true },
  })
  if (duplicate) return conflict("ROUTE_DUPLICATE", "An identical route already exists")

  const route = await tx.mtmRoute.create({
    data: {
      organizationId: input.auth.orgId,
      agentId: input.auth.agentId,
      date: routeDate,
      status: "DRAFT",
      dedupeKey,
      totalPoints: input.command.payload.points.length,
      assignments: {
        create: [{
          organizationId: input.auth.orgId,
          agentId: input.auth.agentId,
          role: "PRIMARY",
          assignedBy: input.auth.userId || null,
        }],
      },
      points: input.command.payload.points.length > 0 ? {
        create: input.command.payload.points.map((point, index) => ({
          organizationId: input.auth.orgId,
          customerId: point.customerId,
          contactId: point.contactId ?? null,
          orderIndex: index,
          plannedTime: point.plannedTime ? new Date(point.plannedTime) : null,
        })),
      } : undefined,
    },
    select: { id: true, status: true, version: true, publishedVersion: true, publishedAt: true },
  })
  return applied(201, {
    id: route.id,
    status: route.status,
    version: route.version,
    publishedVersion: route.publishedVersion,
    publishedAt: route.publishedAt?.toISOString() ?? null,
  }, {
    action: "ROUTE_CREATE",
    routeId: route.id,
    agentId: input.auth.agentId,
    newData: {
      date: routeDateKey(routeDate),
      status: route.status,
      version: route.version,
      totalPoints: input.command.payload.points.length,
      command: "CREATE_DRAFT",
    },
  })
}

async function applyUpdateDraft(
  tx: Prisma.TransactionClient,
  input: {
    auth: ExecuteMtmMobileRouteCommandInput["auth"]
    command: Extract<MtmMobileRouteCommandInput, { command: "UPDATE_DRAFT" }>
    settings: MtmSettingsShape
    now: Date
    actor: NonNullable<Awaited<ReturnType<typeof resolveMtmRouteActor>>>
  },
): Promise<CommandApplicationOutcome> {
  const route = await tx.mtmRoute.findFirst({
    where: { id: input.command.routeId, organizationId: input.auth.orgId, deletedAt: null },
    include: {
      assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
      points: {
        where: { deletedAt: null },
        select: { id: true, customerId: true, contactId: true, plannedTime: true, orderIndex: true, status: true },
        orderBy: { orderIndex: "asc" },
      },
    },
  })
  if (!route) return routeNotFound()
  if (!isSelfManagedRoute(route, input.auth.agentId)) return forbidden()
  if (route.status !== "DRAFT") {
    return conflict("ROUTE_PUBLISHED_IMMUTABLE", "Published routes are immutable. Submit a route change request.", {
      currentVersion: route.version,
    })
  }
  if (!canEditMtmRouteDraft(input.actor, {
    primaryAgentId: route.agentId,
    assignedAgentIds: route.assignments.map((assignment) => assignment.agentId),
    status: "DRAFT",
  })) return forbidden()
  if (input.command.payload.expectedVersion !== route.version) {
    return conflict(
      "ROUTE_VERSION_CONFLICT",
      "This route was changed by another user. Reload it before saving.",
      { currentVersion: route.version, status: route.status },
    )
  }
  const horizon = routeHorizonConflict(route.date, input.settings, input.now)
  if (horizon) return horizon
  const calendar = await verifyWorkCalendar(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    routeDate: route.date,
    settings: input.settings,
  })
  if (calendar) return calendar

  const existingTargetKeys = new Set(route.points.map(mtmRouteTargetKey))
  const targets = await verifyRouteTargets(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    routeDate: route.date,
    points: input.command.payload.points,
    newPoints: input.command.payload.points.filter((point) => !existingTargetKeys.has(mtmRouteTargetKey(point))),
  })
  if (targets) return targets

  const assignments = [{ agentId: input.auth.agentId, role: "PRIMARY" as const }]
  const dedupeKey = buildMtmRouteDedupeKey({
    date: route.date,
    primaryAgentId: input.auth.agentId,
    assignments,
    points: input.command.payload.points,
  })
  await acquireMtmRouteScheduleLocks(tx, {
    organizationId: input.auth.orgId,
    date: route.date,
    agentIds: [input.auth.agentId],
  })
  const duplicate = await tx.mtmRoute.findFirst({
    where: {
      organizationId: input.auth.orgId,
      dedupeKey,
      deletedAt: null,
      id: { not: route.id },
    },
    select: { id: true },
  })
  if (duplicate) return conflict("ROUTE_DUPLICATE", "An identical route already exists")

  const updated = await tx.mtmRoute.updateMany({
    where: {
      id: route.id,
      organizationId: input.auth.orgId,
      status: "DRAFT",
      version: input.command.payload.expectedVersion,
      deletedAt: null,
    },
    data: {
      dedupeKey,
      totalPoints: input.command.payload.points.length,
      version: { increment: 1 },
    },
  })
  if (updated.count !== 1) {
    const current = await tx.mtmRoute.findFirst({
      where: { id: route.id, organizationId: input.auth.orgId, deletedAt: null },
      select: { version: true, status: true },
    })
    return conflict(
      "ROUTE_VERSION_CONFLICT",
      "This route was changed by another user. Reload it before saving.",
      { currentVersion: current?.version, status: current?.status },
    )
  }
  await tx.mtmRoutePoint.updateMany({
    where: { routeId: route.id, organizationId: input.auth.orgId, deletedAt: null },
    data: { deletedAt: input.now, version: { increment: 1 } },
  })
  if (input.command.payload.points.length > 0) {
    await tx.mtmRoutePoint.createMany({
      data: input.command.payload.points.map((point, index) => ({
        organizationId: input.auth.orgId,
        routeId: route.id,
        customerId: point.customerId,
        contactId: point.contactId ?? null,
        orderIndex: index,
        plannedTime: point.plannedTime ? new Date(point.plannedTime) : null,
      })),
    })
  }
  const version = input.command.payload.expectedVersion + 1
  return applied(200, {
    id: route.id,
    status: "DRAFT",
    version,
    publishedVersion: route.publishedVersion,
    publishedAt: route.publishedAt?.toISOString() ?? null,
  }, {
    action: "ROUTE_UPDATE",
    routeId: route.id,
    agentId: input.auth.agentId,
    oldData: { status: route.status, version: route.version, totalPoints: route.totalPoints },
    newData: {
      status: "DRAFT",
      version,
      totalPoints: input.command.payload.points.length,
      command: "UPDATE_DRAFT",
    },
  })
}

async function applyPublish(
  tx: Prisma.TransactionClient,
  input: {
    auth: ExecuteMtmMobileRouteCommandInput["auth"]
    command: Extract<MtmMobileRouteCommandInput, { command: "PUBLISH" }>
    settings: MtmSettingsShape
    now: Date
    actor: NonNullable<Awaited<ReturnType<typeof resolveMtmRouteActor>>>
  },
): Promise<CommandApplicationOutcome> {
  // Read, lock the route's self schedule, then re-read. A legacy direct
  // updater can still race this additive endpoint, so expectedVersion remains
  // the final authority even after the command-path lock.
  const initial = await tx.mtmRoute.findFirst({
    where: { id: input.command.routeId, organizationId: input.auth.orgId, deletedAt: null },
    select: { id: true, date: true, agentId: true },
  })
  if (!initial) return routeNotFound()
  await acquireMtmRouteScheduleLocks(tx, {
    organizationId: input.auth.orgId,
    date: initial.date,
    agentIds: [input.auth.agentId],
  })
  const route = await tx.mtmRoute.findFirst({
    where: { id: input.command.routeId, organizationId: input.auth.orgId, deletedAt: null },
    include: {
      assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
      points: {
        where: { deletedAt: null },
        select: { customerId: true, contactId: true, plannedTime: true, deletedAt: true },
      },
    },
  })
  if (!route) return routeNotFound()
  if (!isSelfManagedRoute(route, input.auth.agentId)) return forbidden()
  if (route.status === "PLANNED") {
    // A completed PUBLISH normally finds its original receipt. A different
    // operation against an already-published route is a terminal conflict.
    return conflict("ROUTE_TRANSITION_INVALID", "Only draft routes may be published")
  }
  if (route.status !== "DRAFT") {
    return conflict("ROUTE_TRANSITION_INVALID", "Only draft routes may be published")
  }
  if (!canPublishMtmRoute(input.actor, {
    primaryAgentId: route.agentId,
    assignedAgentIds: route.assignments.map((assignment) => assignment.agentId),
    status: "DRAFT",
  }, input.settings.routeSelfPublish)) return forbidden()
  if (input.command.payload.expectedVersion !== route.version) {
    return conflict(
      "ROUTE_VERSION_CONFLICT",
      "This route was changed by another user. Reload it before publishing.",
      { currentVersion: route.version, status: route.status },
    )
  }
  if (route.points.length === 0) return conflict("ROUTE_EMPTY", "A route must contain at least one stop")
  const horizon = routeHorizonConflict(route.date, input.settings, input.now)
  if (horizon) return horizon
  const calendar = await verifyWorkCalendar(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    routeDate: route.date,
    settings: input.settings,
  })
  if (calendar) return calendar

  const internalConflicts = detectMtmRouteInternalScheduleConflicts(route.points)
  if (internalConflicts.length > 0) {
    return conflict("ROUTE_POINT_TIME_CONFLICT", "Two route stops cannot use the same meeting time")
  }
  const existingRoutes = await tx.mtmRoute.findMany({
    where: {
      organizationId: input.auth.orgId,
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
  if (planningSignals.conflicts.length > 0) {
    return conflict("ROUTE_CONFLICT", "Route conflicts require manager approval")
  }

  const publishedVersion = route.version + 1
  const updated = await tx.mtmRoute.updateMany({
    where: {
      id: route.id,
      organizationId: input.auth.orgId,
      status: "DRAFT",
      version: input.command.payload.expectedVersion,
      deletedAt: null,
    },
    data: {
      status: "PLANNED",
      version: { increment: 1 },
      publishedVersion,
      publishedAt: input.now,
      publishedBy: input.auth.userId || null,
    },
  })
  if (updated.count !== 1) {
    const current = await tx.mtmRoute.findFirst({
      where: { id: route.id, organizationId: input.auth.orgId, deletedAt: null },
      select: { version: true, publishedVersion: true, status: true },
    })
    return conflict(
      "ROUTE_VERSION_CONFLICT",
      "This route was changed by another user. Reload it before publishing.",
      {
        currentVersion: current?.version,
        publishedVersion: current?.publishedVersion,
        status: current?.status,
      },
    )
  }
  // The outbox and receipt are in this same transaction. A retry cannot
  // produce a second notification because it finds the receipt before this
  // business branch, and the outbox still has its own business dedupe key.
  await enqueueMtmRouteNotification(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
    dedupeKey: `route:${route.id}:published:${publishedVersion}:${input.auth.agentId}`,
    title: "Route published",
    body: `Route for ${routeDateKey(route.date)} is ready.`,
    type: "task",
    metadata: { routeId: route.id, publishedVersion, event: "route_published" },
  })
  return applied(200, {
    id: route.id,
    status: "PLANNED",
    version: publishedVersion,
    publishedVersion,
    publishedAt: input.now.toISOString(),
  }, {
    action: "ROUTE_PUBLISH",
    routeId: route.id,
    agentId: input.auth.agentId,
    oldData: { status: route.status, version: route.version },
    newData: {
      status: "PLANNED",
      version: publishedVersion,
      publishedVersion,
      coordination: planningSignals.coordination,
      command: "PUBLISH",
    },
  })
}

/**
 * Start a published route only after the agent has started their field day.
 *
 * Route start used to be independent from the workday. That made a route look
 * executable before its GPS/session evidence existed. The Route Field client
 * now presents day start as the first action, and this server gate remains the
 * authority for stale or malicious clients. The shared workday lock makes the
 * check linearizable with START/FINISH transitions from every transport.
 */
async function applyStart(
  tx: Prisma.TransactionClient,
  input: {
    auth: ExecuteMtmMobileRouteCommandInput["auth"]
    command: Extract<MtmMobileRouteCommandInput, { command: "START" }>
    settings: MtmSettingsShape
    now: Date
  },
): Promise<CommandApplicationOutcome> {
  const route = await tx.mtmRoute.findFirst({
    where: { id: input.command.routeId, organizationId: input.auth.orgId, deletedAt: null },
    include: {
      assignments: { where: { removedAt: null }, select: { agentId: true, role: true } },
    },
  })
  if (!route) return routeNotFound()
  if (!canExecuteAssignedRoute(route, input.auth.agentId)) return forbidden()
  if (route.totalPoints <= 0) return conflict("ROUTE_EMPTY", "A route must contain at least one stop")

  const timezone = isValidTimezone(input.settings.timezone) ? input.settings.timezone : "UTC"
  if (routeDateKey(route.date) !== currentDateKey(input.now, timezone)) {
    return conflict(
      "MOBILE_ROUTE_START_DATE_INVALID",
      "Only the route scheduled for the current local day may be started.",
      { status: route.status },
    )
  }
  if (route.status !== "PLANNED") {
    return conflict(
      "ROUTE_TRANSITION_INVALID",
      "Only planned routes may be started.",
      { currentVersion: route.version, status: route.status },
    )
  }
  if (input.command.payload.expectedVersion !== route.version) {
    return conflict(
      "ROUTE_VERSION_CONFLICT",
      "This route was changed by another user. Reload it before starting.",
      { currentVersion: route.version, status: route.status },
    )
  }

  // Do this after all route-only validation and immediately before the route
  // mutation. A route command replay returns before applyStart, so a prior
  // receipt remains idempotent even after the workday later ends.
  await lockMtmWorkdayTransitions(tx, {
    organizationId: input.auth.orgId,
    agentId: input.auth.agentId,
  })
  const activeWorkday = await tx.mtmAgentWorkday.findFirst({
    where: {
      organizationId: input.auth.orgId,
      agentId: input.auth.agentId,
      status: "STARTED",
    },
    select: { id: true },
  })
  if (!activeWorkday) {
    return conflict(
      "MTM_ROUTE_WORKDAY_REQUIRED",
      "Start your workday before starting the route.",
    )
  }

  const updated = await tx.mtmRoute.updateMany({
    where: {
      id: route.id,
      organizationId: input.auth.orgId,
      status: "PLANNED",
      version: input.command.payload.expectedVersion,
      deletedAt: null,
    },
    data: {
      status: "IN_PROGRESS",
      startedAt: input.now,
      version: { increment: 1 },
    },
  })
  if (updated.count !== 1) {
    const current = await tx.mtmRoute.findFirst({
      where: { id: route.id, organizationId: input.auth.orgId, deletedAt: null },
      select: { version: true, status: true },
    })
    return conflict(
      "ROUTE_VERSION_CONFLICT",
      "This route was changed by another user. Reload it before starting.",
      { currentVersion: current?.version, status: current?.status },
    )
  }

  const version = route.version + 1
  return applied(200, {
    id: route.id,
    status: "IN_PROGRESS",
    version,
    publishedVersion: route.publishedVersion,
    startedAt: input.now.toISOString(),
  }, {
    action: "ROUTE_START",
    routeId: route.id,
    agentId: input.auth.agentId,
    oldData: { status: route.status, version: route.version, startedAt: route.startedAt?.toISOString() ?? null },
    newData: {
      status: "IN_PROGRESS",
      version,
      startedAt: input.now.toISOString(),
      command: "START",
    },
  })
}

async function applyRouteCommand(
  tx: Prisma.TransactionClient,
  input: {
    auth: ExecuteMtmMobileRouteCommandInput["auth"]
    command: MtmMobileRouteCommandInput
    settings: MtmSettingsShape
    now: Date
    actor: NonNullable<Awaited<ReturnType<typeof resolveMtmRouteActor>>>
  },
): Promise<CommandApplicationOutcome> {
  if (input.command.command === "CREATE_DRAFT") {
    if (!canCreateMtmRouteFor(input.actor, input.auth.agentId)) return forbidden()
    return applyCreateDraft(tx, { ...input, command: input.command })
  }
  if (input.command.command === "UPDATE_DRAFT") {
    return applyUpdateDraft(tx, { ...input, command: input.command })
  }
  if (input.command.command === "PUBLISH") {
    return applyPublish(tx, { ...input, command: input.command })
  }
  return applyStart(tx, { ...input, command: input.command })
}

/**
 * Canonical state machine for the additive mobile-only route-command endpoint.
 * It intentionally does not call a Next route handler and never falls back to
 * the legacy direct endpoint. Each accepted terminal command has one receipt
 * transaction, while capability/permission failures and infrastructure errors
 * remain unpinned and therefore cannot masquerade as successful writes.
 */
export async function executeMtmMobileRouteCommand(
  input: ExecuteMtmMobileRouteCommandInput,
): Promise<MtmMobileRouteCommandExecution> {
  const now = input.now ?? new Date()
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: input.auth.orgId,
    userId: input.auth.userId,
    webRole: input.auth.role,
    agentId: input.auth.agentId,
  })
  // Route Field's standalone APK does not expose team planning. Do this fresh
  // before looking up a receipt so a demoted/revoked agent cannot use replay as
  // a side channel, even though a receipt never performs another mutation.
  if (!actor || actor.role !== "AGENT" || actor.agentId !== input.auth.agentId) {
    return { ...forbidden(), replayed: false }
  }
  const settings = await getMtmSettings(input.auth.orgId)
  const scope = receiptScope(input)

  try {
    return await prisma.$transaction(async (tx) => {
      // Lock by tenant+operation before testing the receipt. The unique index
      // remains the final database fence; this avoids making same-operation
      // retries compete through a rollback/P2002 path under normal load.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-mobile-route-command:${scope.organizationId}:${scope.operationId}`}, 0))`
      const existing = await tx.mtmMobileRouteCommandReceipt.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: scope.organizationId,
            operationId: scope.operationId,
          },
        },
        select: {
          organizationId: true,
          agentId: true,
          deviceId: true,
          operationId: true,
          command: true,
          targetRouteId: true,
          requestHash: true,
          responseStatus: true,
          result: true,
          expiresAt: true,
        },
      })
      if (existing) return replayOrMismatch(existing, scope, now)

      const outcome = await applyRouteCommand(tx, {
        auth: input.auth,
        command: input.command,
        settings,
        now,
        actor,
      })
      if ("outcome" in outcome === false) return { ...outcome, replayed: false }

      await tx.mtmMobileRouteCommandReceipt.create({
        data: {
          organizationId: scope.organizationId,
          agentId: scope.agentId,
          deviceId: scope.deviceId,
          operationId: scope.operationId,
          command: scope.command,
          targetRouteId: scope.targetRouteId,
          requestHash: scope.requestHash,
          outcome: outcome.outcome,
          responseStatus: outcome.responseStatus,
          result: outcome.result as Prisma.InputJsonValue,
          completedAt: now,
          expiresAt: expiresMtmMobileRouteCommandReceiptAt(now),
        },
      })
      return {
        responseStatus: outcome.responseStatus,
        result: outcome.result,
        replayed: false,
        ...(outcome.audit ? { audit: outcome.audit } : {}),
      }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: MOBILE_ROUTE_COMMAND_TRANSACTION_TIMEOUT_MS,
    })
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    // A rare race with a pre-existing deployment, manual repair, or a backend
    // that ignored the advisory lock can still hit the unique receipt fence.
    // Read it under the current tenant frame before deciding whether it is a
    // true replay; never retry the business mutation outside its transaction.
    const existing = await prisma.mtmMobileRouteCommandReceipt.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: scope.organizationId,
          operationId: scope.operationId,
        },
      },
      select: {
        organizationId: true,
        agentId: true,
        deviceId: true,
        operationId: true,
        command: true,
        targetRouteId: true,
        requestHash: true,
        responseStatus: true,
        result: true,
        expiresAt: true,
      },
    }).catch(() => null)
    if (existing) return replayOrMismatch(existing, scope, now)
    // Do not mislabel an unrelated uniqueness failure as a successful replay
    // or a route duplicate. The caller gets a retryable infrastructure error
    // and no receipt has been committed, which is the only safe outcome.
    throw error
  }
}
