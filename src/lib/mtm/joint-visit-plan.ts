import { z } from "zod"
import type { Prisma, PrismaClient } from "@prisma/client"
import { addDateKeyDays, currentDateKey, isDateKey, localDateKeyToUtc } from "@/lib/mtm/mobile-week"
import { jointSessionCovers, jointSessionDayEnd, writeJointObserver } from "@/lib/mtm/joint-visit"
import { validateMtmMobileRouteTargetEligibility, validateMtmRouteTargets } from "@/lib/mtm/route-targets"

/**
 * Planned joint visit (owner, 2026-10-30): «агент составляет себе маршрут по
 * дням, менеджер должен иметь право выбирать, к какому клиенту сделает визит
 * вместе с агентом, и у агента будет уведомление, куда менеджер собирается…
 * Помимо этого у менеджера должен быть выбор клиента, к которому он хочет
 * экстра сделать визит с определённым агентом — тогда он попадает в маршрут
 * лист совместный визит менеджера с агентом».
 *
 * Before this, «Иду на визит с агентом» opened a session that named no client:
 * the agent was told «your manager is with you today» and saw nothing in his
 * route, and the manager's screen had nothing to show until the agent checked
 * in somewhere — only «Закончить».
 *
 * 1. The manager picks an agent of his team and a day, and ticks stops of the
 *    agent's route for that day (`ROUTE`), or adds a client of the agent's
 *    that is not in it (`EXTRA`): that client is added to the route first, so
 *    every plan points at a stop the agent sees on his route.
 * 2. The agent is told at once which clients and which day; on his route those
 *    stops carry «Совместный визит · <manager>».
 * 3. At the stop the agent still answers «Этот визит — вместе с
 *    руководителем?» (owner, 2026-10-20: the agent says which visits were
 *    joint — the manager may not have come). A «yes» that a plan of that day
 *    backs makes the visit joint like a «yes» an open session backs, and the
 *    manager rates it the same way (src/lib/mtm/joint-visit.ts).
 */

/** How far ahead a joint visit can be planned: the agent's two working weeks. */
export const JOINT_VISIT_PLAN_HORIZON_DAYS = 14
const MAX_STOPS_PER_SAVE = 30
const MAX_EXTRAS_PER_SAVE = 10

export const JointVisitPlanInputSchema = z.object({
  agentId: z.string().trim().min(1).max(128),
  date: z.string().refine(isDateKey, "YYYY-MM-DD"),
  routePointIds: z.array(z.string().trim().min(1).max(128)).max(MAX_STOPS_PER_SAVE).default([]),
  extras: z.array(z.object({
    customerId: z.string().trim().min(1).max(128),
    contactId: z.string().trim().min(1).max(128).nullable().optional(),
  }).strict()).max(MAX_EXTRAS_PER_SAVE).default([]),
}).strict().refine((input) => input.routePointIds.length + input.extras.length > 0, { message: "Choose at least one client" })

export type JointVisitPlanInput = z.infer<typeof JointVisitPlanInputSchema>

export class JointVisitPlanError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:
      | "MTM_JOINT_PLAN_DAY_INVALID"
      | "MTM_JOINT_PLAN_STOP_UNAVAILABLE"
      | "MTM_JOINT_PLAN_CLIENT_UNAVAILABLE"
      | "MTM_JOINT_PLAN_ROUTE_CLOSED"
      | "MTM_JOINT_PLAN_ROUTE_CHANGED"
      | "MTM_JOINT_PLAN_NOT_FOUND"
      | "MTM_JOINT_PLAN_ALREADY_VISITED",
    message: string,
  ) {
    super(message)
    this.name = "JointVisitPlanError"
  }
}

type Db = PrismaClient | Prisma.TransactionClient

/** A route day is stored as midnight UTC of its date (`@db.Date`). */
export function routeDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

export function routeDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Today in the organization, and the last day a plan may be made for. */
export function jointPlanWindow(now: Date, timezone: string): { today: string; last: string } {
  const today = currentDateKey(now, timezone)
  return { today, last: addDateKeyDays(today, JOINT_VISIT_PLAN_HORIZON_DAYS) }
}

/** A route that is over takes no new stop, and a stop on it no new plan. */
const CLOSED_ROUTE_STATUSES = new Set(["COMPLETED", "INCOMPLETE", "CANCELLED"])
// The route the agent works that day: a published or running one before his
// own unpublished draft, the newest first among equals.
const ROUTE_PRIORITY = ["IN_PROGRESS", "PLANNED", "DRAFT", "COMPLETED", "INCOMPLETE"] as const

const dayRouteSelect = {
  id: true,
  status: true,
  version: true,
  createdAt: true,
  points: {
    where: { deletedAt: null },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    select: {
      id: true,
      customerId: true,
      contactId: true,
      orderIndex: true,
      status: true,
      plannedTime: true,
      customer: { select: { id: true, name: true, address: true } },
      contact: { select: { id: true, displayName: true, specialtyName: true } },
    },
  },
} satisfies Prisma.MtmRouteSelect

type DayRoute = Prisma.MtmRouteGetPayload<{ select: typeof dayRouteSelect }>

/** The agent's route on that day, the one a joint visit is planned on; null when he has none. */
export async function agentDayRoute(
  db: Db,
  input: { organizationId: string; agentId: string; date: string },
): Promise<DayRoute | null> {
  const routes: DayRoute[] = await db.mtmRoute.findMany({
    where: {
      organizationId: input.organizationId,
      // Read as his app reads it (sync pull): his own route, or one he was put on.
      OR: [
        { agentId: input.agentId },
        { assignments: { some: { agentId: input.agentId, removedAt: null } } },
      ],
      date: routeDay(input.date),
      deletedAt: null,
      status: { not: "CANCELLED" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: dayRouteSelect,
  })
  for (const status of ROUTE_PRIORITY) {
    const route = routes.find((row) => row.status === status)
    if (route) return route
  }
  return null
}

/** Plans not cancelled whose stop is still on the route, keyed by route stop. */
async function livePlansByStop(
  db: Db,
  input: { organizationId: string; routePointIds: string[] },
): Promise<Map<string, Array<{ id: string; managerAgentId: string; manager: { id: string; name: string } }>>> {
  const byStop = new Map<string, Array<{ id: string; managerAgentId: string; manager: { id: string; name: string } }>>()
  if (input.routePointIds.length === 0) return byStop
  const rows: Array<{ id: string; routePointId: string | null; managerAgentId: string; manager: { id: string; name: string } }> =
    await db.mtmJointVisitPlan.findMany({
      where: { organizationId: input.organizationId, routePointId: { in: input.routePointIds }, cancelledAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, routePointId: true, managerAgentId: true, manager: { select: { id: true, name: true } } },
    })
  for (const row of rows) {
    if (!row.routePointId) continue
    byStop.set(row.routePointId, [...(byStop.get(row.routePointId) ?? []), row])
  }
  return byStop
}

/**
 * What the manager's planner shows for one agent and day: the agent's route
 * and, on each stop, whether it can still be joined and who already joins it.
 */
export async function jointPlanDay(
  db: Db,
  input: { organizationId: string; managerAgentId: string; agentId: string; date: string },
) {
  const route = await agentDayRoute(db, input)
  const plans = await livePlansByStop(db, { organizationId: input.organizationId, routePointIds: route?.points.map((point) => point.id) ?? [] })
  return {
    date: input.date,
    route: route
      ? {
          id: route.id,
          status: route.status,
          // A finished day takes no new client.
          open: !CLOSED_ROUTE_STATUSES.has(route.status),
          stops: route.points.map((point) => {
            const joined = plans.get(point.id) ?? []
            const mine = joined.find((plan) => plan.managerAgentId === input.managerAgentId)
            return {
              id: point.id,
              status: point.status,
              plannedTime: point.plannedTime?.toISOString() ?? null,
              customer: point.customer,
              contact: point.contact,
              myPlanId: mine?.id ?? null,
              otherManagers: joined.filter((plan) => plan.managerAgentId !== input.managerAgentId).map((plan) => plan.manager),
              canJoin: !CLOSED_ROUTE_STATUSES.has(route.status) && point.status === "PENDING" && !mine,
            }
          }),
        }
      : null,
  }
}

type CreatedPlan = { id: string; routePointId: string; customerName: string; contactName: string | null; source: "ROUTE" | "EXTRA" }

/**
 * Plan the manager's joint visits with one agent on one day: the chosen stops
 * of the agent's route, and the extra clients, which are added to that route
 * first (a new draft of the agent's when he has no route that day yet).
 *
 * Runs in one transaction. Who the agent is and whether the manager may plan
 * with him is the caller's to check (`accompaniableAgent`). A stop planned
 * already by this manager is left as it is; the answer lists only new plans.
 */
export async function createJointVisitPlans(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    managerAgentId: string
    managerUserId: string | null
    agentId: string
    date: string
    routePointIds: string[]
    extras: Array<{ customerId: string; contactId?: string | null }>
    now: Date
    timezone: string
  },
): Promise<{ routeId: string; created: CreatedPlan[] }> {
  const window = jointPlanWindow(input.now, input.timezone)
  if (input.date < window.today || input.date > window.last) {
    throw new JointVisitPlanError(400, "MTM_JOINT_PLAN_DAY_INVALID", "A joint visit is planned for today or the next two weeks")
  }

  let route = await agentDayRoute(tx, input)
  const wanted = new Map<string, "ROUTE" | "EXTRA">()

  for (const pointId of new Set(input.routePointIds)) {
    const point = route?.points.find((row) => row.id === pointId)
    if (!route || !point || CLOSED_ROUTE_STATUSES.has(route.status) || point.status !== "PENDING") {
      throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_STOP_UNAVAILABLE", "This stop is no longer on the agent's route")
    }
    wanted.set(point.id, "ROUTE")
  }

  const extras = uniqueExtras(input.extras)
  if (extras.length > 0) {
    if (route && CLOSED_ROUTE_STATUSES.has(route.status)) {
      throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_ROUTE_CLOSED", "The agent's route for this day is over")
    }
    // The same rule the agent's own planner keeps: a client of his, active,
    // and a doctor at the organization named with him.
    const day = routeDay(input.date)
    const [exists, eligible] = await Promise.all([
      validateMtmRouteTargets(tx, { organizationId: input.organizationId, routeDate: day, points: extras }),
      validateMtmMobileRouteTargetEligibility(tx, { organizationId: input.organizationId, primaryAgentId: input.agentId, routeDate: day, points: extras }),
    ])
    if (!exists.ok || !eligible.ok) {
      throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_CLIENT_UNAVAILABLE", "This client is not one the agent may visit that day")
    }

    if (!route) {
      // He has not planned this day yet: the manager's own pick starts it as a
      // published route — she is the one who would approve it, and a draft
      // keeps him from starting the visit (live check 2026-10-30). He adds the
      // rest of the day to it the way he changes any published route.
      const created = await tx.mtmRoute.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          date: day,
          status: "PLANNED",
          publishedAt: input.now,
          publishedBy: input.managerUserId,
          totalPoints: 0,
          assignments: {
            create: { organizationId: input.organizationId, agentId: input.agentId, role: "PRIMARY", assignedBy: input.managerUserId },
          },
        },
        select: { id: true },
      })
      route = (await tx.mtmRoute.findUnique({ where: { id: created.id }, select: dayRouteSelect }))!
    }

    const openRoute = route
    let nextIndex = openRoute.points.reduce((max, point) => Math.max(max, point.orderIndex), -1) + 1
    let added = 0
    for (const extra of extras) {
      // Already on his route: that stop is the one joined.
      const existing = openRoute.points.find((point) => point.customerId === extra.customerId && (point.contactId ?? null) === extra.contactId)
      if (existing) {
        if (existing.status !== "PENDING") {
          throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_STOP_UNAVAILABLE", "The agent has already been to this client that day")
        }
        if (!wanted.has(existing.id)) wanted.set(existing.id, "ROUTE")
        continue
      }
      const point = await tx.mtmRoutePoint.create({
        data: {
          organizationId: input.organizationId,
          routeId: openRoute.id,
          customerId: extra.customerId,
          contactId: extra.contactId,
          orderIndex: nextIndex++,
        },
        select: { id: true },
      })
      wanted.set(point.id, "EXTRA")
      added += 1
    }
    if (added > 0) await bumpRoute(tx, { organizationId: input.organizationId, route: openRoute })
  }

  const stopIds = [...wanted.keys()]
  const points: Array<{
    id: string
    customerId: string
    contactId: string | null
    customer: { name: string }
    contact: { displayName: string | null } | null
  }> = await tx.mtmRoutePoint.findMany({
    where: { id: { in: stopIds }, organizationId: input.organizationId, deletedAt: null },
    select: { id: true, customerId: true, contactId: true, customer: { select: { name: true } }, contact: { select: { displayName: true } } },
  })
  const planned = await tx.mtmJointVisitPlan.findMany({
    where: { organizationId: input.organizationId, managerAgentId: input.managerAgentId, routePointId: { in: stopIds }, cancelledAt: null },
    select: { routePointId: true },
  })
  const already = new Set(planned.map((row: { routePointId: string | null }) => row.routePointId))

  const created: CreatedPlan[] = []
  for (const stopId of stopIds) {
    if (already.has(stopId)) continue
    const point = points.find((row) => row.id === stopId)
    if (!point) continue
    const source = wanted.get(stopId)!
    const plan = await tx.mtmJointVisitPlan.create({
      data: {
        organizationId: input.organizationId,
        managerAgentId: input.managerAgentId,
        agentId: input.agentId,
        date: routeDay(input.date),
        routePointId: point.id,
        customerId: point.customerId,
        contactId: point.contactId,
        source,
      },
      select: { id: true },
    })
    created.push({ id: plan.id, routePointId: point.id, customerName: point.customer.name, contactName: point.contact?.displayName ?? null, source })
  }
  return { routeId: route!.id, created }
}

function uniqueExtras(extras: Array<{ customerId: string; contactId?: string | null }>) {
  const seen = new Set<string>()
  const result: Array<{ customerId: string; contactId: string | null }> = []
  for (const extra of extras) {
    const key = `${extra.customerId}:${extra.contactId ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ customerId: extra.customerId, contactId: extra.contactId ?? null })
  }
  return result
}

/**
 * A stop added or removed: the route's count and version move, and so does the
 * published version of a published route — that is what sends the change to
 * the agent's phone. Another write in between is a conflict, not a merge.
 */
async function bumpRoute(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; route: { id: string; status: string; version: number } },
) {
  const totalPoints = await tx.mtmRoutePoint.count({ where: { routeId: input.route.id, deletedAt: null } })
  const updated = await tx.mtmRoute.updateMany({
    where: { id: input.route.id, organizationId: input.organizationId, version: input.route.version, deletedAt: null },
    data: {
      totalPoints,
      version: { increment: 1 },
      ...(input.route.status === "DRAFT" ? {} : { publishedVersion: input.route.version + 1 }),
    },
  })
  if (updated.count !== 1) {
    throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_ROUTE_CHANGED", "The agent's route changed at the same moment; try again")
  }
}

/**
 * The manager takes back a planned joint visit. An extra client he had added
 * leaves the agent's route with it while the agent has not been there; a stop
 * the agent planned himself stays. A visit already made is not undone.
 */
export async function cancelJointVisitPlan(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; managerAgentId: string; planId: string; now: Date },
): Promise<{ id: string; agentId: string; date: Date; customerName: string; contactName: string | null }> {
  const plan = await tx.mtmJointVisitPlan.findFirst({
    where: { id: input.planId, organizationId: input.organizationId, managerAgentId: input.managerAgentId, cancelledAt: null },
    select: {
      id: true,
      agentId: true,
      date: true,
      source: true,
      visitId: true,
      routePointId: true,
      customer: { select: { name: true } },
      contact: { select: { displayName: true } },
      routePoint: {
        select: {
          id: true,
          status: true,
          deletedAt: true,
          route: { select: { id: true, status: true, version: true } },
          _count: { select: { visits: { where: { deletedAt: null } } } },
        },
      },
    },
  })
  if (!plan) throw new JointVisitPlanError(404, "MTM_JOINT_PLAN_NOT_FOUND", "This joint visit is not planned")
  if (plan.visitId) throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_ALREADY_VISITED", "This joint visit has already taken place")

  const updated = await tx.mtmJointVisitPlan.updateMany({
    where: { id: plan.id, organizationId: input.organizationId, cancelledAt: null, visitId: null },
    data: { cancelledAt: input.now },
  })
  if (updated.count !== 1) throw new JointVisitPlanError(409, "MTM_JOINT_PLAN_ALREADY_VISITED", "This joint visit changed at the same moment")

  const point = plan.routePoint
  if (
    plan.source === "EXTRA" &&
    point &&
    !point.deletedAt &&
    point.status === "PENDING" &&
    point._count.visits === 0 &&
    !CLOSED_ROUTE_STATUSES.has(point.route.status)
  ) {
    // Another manager may have joined the same extra stop meanwhile: then it stays.
    const others = await tx.mtmJointVisitPlan.count({
      where: { organizationId: input.organizationId, routePointId: point.id, cancelledAt: null },
    })
    if (others === 0) {
      await tx.mtmRoutePoint.update({ where: { id: point.id }, data: { deletedAt: input.now, version: { increment: 1 } } })
      await bumpRoute(tx, { organizationId: input.organizationId, route: point.route })
      // A route left with no stop and never started was only there for this
      // visit: it goes too, rather than hang in his day as an empty route.
      const left = await tx.mtmRoutePoint.count({ where: { routeId: point.route.id, deletedAt: null } })
      if (left === 0 && (point.route.status === "DRAFT" || point.route.status === "PLANNED")) {
        await tx.mtmRoute.updateMany({
          where: { id: point.route.id, organizationId: input.organizationId, status: point.route.status, startedAt: null, deletedAt: null },
          data: { deletedAt: input.now, version: { increment: 1 } },
        })
      }
    }
  }
  return {
    id: plan.id,
    agentId: plan.agentId,
    date: plan.date,
    customerName: plan.customer.name,
    contactName: plan.contact?.displayName ?? null,
  }
}

const planListSelect = {
  id: true,
  date: true,
  source: true,
  visitId: true,
  agent: { select: { id: true, name: true } },
  manager: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, address: true } },
  contact: { select: { id: true, displayName: true, specialtyName: true } },
  routePoint: {
    select: {
      id: true,
      status: true,
      plannedTime: true,
      orderIndex: true,
      deletedAt: true,
      visits: {
        where: { deletedAt: null },
        orderBy: { checkInAt: "desc" },
        take: 1,
        select: { id: true, status: true, checkInAt: true, checkOutAt: true },
      },
    },
  },
} satisfies Prisma.MtmJointVisitPlanSelect

type PlanRow = Prisma.MtmJointVisitPlanGetPayload<{ select: typeof planListSelect }>

function planJson(plan: PlanRow) {
  const point = plan.routePoint
  const visit = point?.visits[0] ?? null
  return {
    id: plan.id,
    date: routeDayKey(plan.date),
    source: plan.source,
    agent: plan.agent,
    manager: plan.manager,
    customer: plan.customer,
    contact: plan.contact,
    routePointId: point && !point.deletedAt ? point.id : null,
    plannedTime: point?.plannedTime?.toISOString() ?? null,
    // REMOVED: the stop left the agent's route (he or the office took it out).
    stopStatus: !point || point.deletedAt ? "REMOVED" : point.status,
    visit: visit
      ? {
          id: visit.id,
          status: visit.status,
          checkInAt: visit.checkInAt.toISOString(),
          checkOutAt: visit.checkOutAt?.toISOString() ?? null,
          // The agent answered «yes, together» on this one.
          joint: plan.visitId === visit.id,
        }
      : null,
  }
}

/** The manager's planned joint visits from `from` on, in day and route order. */
export async function managerJointPlans(
  db: Db,
  input: { organizationId: string; managerAgentId: string; from: string; to: string },
) {
  const rows: PlanRow[] = await db.mtmJointVisitPlan.findMany({
    where: {
      organizationId: input.organizationId,
      managerAgentId: input.managerAgentId,
      cancelledAt: null,
      date: { gte: routeDay(input.from), lte: routeDay(input.to) },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: planListSelect,
  })
  return sortPlans(rows).map(planJson)
}

/**
 * Where the managers go with this agent, today and ahead — what his route
 * marks as «Совместный визит» and what the check-in question names. Ratings
 * are never part of it.
 */
export async function agentJointPlans(
  db: Db,
  input: { organizationId: string; agentId: string; from: string; to: string },
) {
  const rows: PlanRow[] = await db.mtmJointVisitPlan.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      cancelledAt: null,
      date: { gte: routeDay(input.from), lte: routeDay(input.to) },
      manager: { status: "ACTIVE" },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: planListSelect,
  })
  return sortPlans(rows)
    .filter((plan) => plan.routePoint && !plan.routePoint.deletedAt)
    .map((plan) => ({
      id: plan.id,
      date: routeDayKey(plan.date),
      routePointId: plan.routePoint!.id,
      customerId: plan.customer.id,
      contactId: plan.contact?.id ?? null,
      customerName: plan.customer.name,
      contactName: plan.contact?.displayName ?? null,
      manager: plan.manager,
    }))
}

function sortPlans(rows: PlanRow[]): PlanRow[] {
  return [...rows].sort((a, b) =>
    a.date.getTime() - b.date.getTime()
    || a.agent.name.localeCompare(b.agent.name)
    || (a.routePoint?.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.routePoint?.orderIndex ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * The agent's «yes, together with this manager» at a check-in that no open
 * session covers: a plan of that manager for this agent on the check-in's own
 * day, at this stop — or at this client, for a visit started outside the
 * route. Writes nothing; null when no plan backs it.
 */
export async function jointPlanForCheckIn(
  db: Db,
  input: {
    organizationId: string
    agentId: string
    managerAgentId: string
    checkInAt: Date
    timezone: string
    routePointId: string | null
    customerId: string
    contactId: string | null
  },
): Promise<{ id: string } | null> {
  const day = currentDateKey(input.checkInAt, input.timezone)
  const plans: Array<{ id: string; routePointId: string | null; customerId: string; contactId: string | null }> = await db.mtmJointVisitPlan.findMany({
    where: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      managerAgentId: input.managerAgentId,
      date: routeDay(day),
      cancelledAt: null,
      visitId: null,
      manager: { status: "ACTIVE" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, routePointId: true, customerId: true, contactId: true },
  })
  return (
    (input.routePointId ? plans.find((plan) => plan.routePointId === input.routePointId) : undefined)
    ?? plans.find((plan) => plan.customerId === input.customerId && (plan.contactId ?? null) === (input.contactId ?? null))
    ?? plans.find((plan) => plan.customerId === input.customerId)
    ?? null
  )
}

/**
 * The session that stands for a planned day together, for the visit's
 * participant row to point at — so a planned joint visit is rated, listed and
 * hidden from the agent by exactly the rules of the session-backed one. It is
 * created closed, covering the whole organization-local day, so it is never
 * the manager's «open» session and never blocks one.
 */
export async function plannedDaySession(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; managerAgentId: string; agentId: string; checkInAt: Date; timezone: string },
): Promise<{ id: string }> {
  const dayStart = localDateKeyToUtc(currentDateKey(input.checkInAt, input.timezone), input.timezone)
  const dayEnd = jointSessionDayEnd(dayStart, input.timezone)
  const existing: Array<{ id: string; startedAt: Date; endedAt: Date | null }> = await tx.mtmJointFieldSession.findMany({
    where: {
      organizationId: input.organizationId,
      managerAgentId: input.managerAgentId,
      agentId: input.agentId,
      startedAt: dayStart,
      endedAt: dayEnd,
    },
    take: 1,
    select: { id: true, startedAt: true, endedAt: true },
  })
  if (existing[0] && jointSessionCovers(existing[0], input.checkInAt, input.timezone)) return existing[0]
  return tx.mtmJointFieldSession.create({
    data: {
      organizationId: input.organizationId,
      managerAgentId: input.managerAgentId,
      agentId: input.agentId,
      startedAt: dayStart,
      endedAt: dayEnd,
    },
    select: { id: true },
  })
}

/**
 * After the agent's «yes, together with this manager» at check-in: a plan of
 * that day at this stop records the visit, and backs the «yes» when no open
 * session did (`sessionAccepted`). Says whether the visit is joint now.
 */
export async function attachPlannedJointManager(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    visitId: string
    agentId: string
    managerAgentId: string
    checkInAt: Date
    timezone: string
    routePointId: string | null
    customerId: string
    contactId: string | null
    sessionAccepted: boolean
  },
): Promise<boolean> {
  if (input.managerAgentId === input.agentId) return input.sessionAccepted
  const plan = await jointPlanForCheckIn(tx, input)
  if (!plan) return input.sessionAccepted
  if (!input.sessionAccepted) {
    const session = await plannedDaySession(tx, input)
    await writeJointObserver(tx, { ...input, sessionId: session.id })
  }
  await tx.mtmJointVisitPlan.updateMany({
    where: { id: plan.id, organizationId: input.organizationId, visitId: null },
    data: { visitId: input.visitId },
  })
  return true
}
