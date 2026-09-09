/**
 * KPI Arena — per-agent "completed work items" list. For ONE agent in ONE group
 * for ONE period, returns the underlying done/closed rows (deals / tickets /
 * tasks / projects / MTM tasks) that make up their KPI — rendered as a list in
 * the drill-down drawer so a manager sees WHY the % is what it is.
 *
 * Each group's predicate MIRRORS its aggregator's "done-in-window" rule so the
 * list lines up with the count the bubble already shows:
 *   sales    → WON deals in the current quarter (matches sales.ts quota window)
 *   tickets  → tickets resolved since periodStart
 *   tasks    → Task + ProjectTask with completedAt since periodStart (canonical
 *              "done" signal; status column is legacy/mixed)
 *   projects → projects status=completed with actualEndDate since periodStart
 *   mtm      → VISITED route points (MtmRoutePoint) on the agent's routes since
 *              periodStart. For field agents the meaningful unit is points-of-
 *              route, not tasks (per user) — and this aligns with the route-work
 *              the `routeCompletion` metric scores. Scoped via the route relation
 *              (the point row has no agentId/orgId). Heading = "route points".
 *
 * Split into pure `build*Items` mappers (unit-tested, no Prisma/Decimal) + a
 * `computeAgentItems` DB fetch. Org-scoped on every query (tenant isolation).
 */
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { quarterBoundaries } from "@/lib/quota-engine"
import type { AgentItem, AgentItemsResult } from "./agent-items-types"
import { type LeaderboardGroup, type LeaderboardPeriod, periodStart } from "./types"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

/** Cap the list so a hyper-active agent's drawer stays bounded; +1 over the take
 *  lets us detect "more exist". The bubble's metric still shows the true total. */
const ITEM_LIMIT = 100

// i18n heading key per group. NB: `items.mtm` lists VISITED ROUTE POINTS (the
// stops on the agent's routes), not tasks — keep its copy route-point-worded.
const LABEL_KEY: Record<LeaderboardGroup, string> = {
  sales: "items.sales",
  mtm: "items.mtm",
  tickets: "items.tickets",
  projects: "items.projects",
  tasks: "items.tasks",
}

type SalesDealItemRow = { id: string; name: string; valueAmount: unknown; currency: string; updatedAt: Date }
type TicketItemRow = { id: string; subject: string; resolvedAt: Date | null }
type ProjectItemRow = { id: string; name: string; actualEndDate: Date | null; endDate: Date | null }
type MtmRoutePointItemRow = {
  id: string
  orderIndex: number
  visitedAt: Date | null
  route: { date: Date }
  customer: { name: string } | null
}

// ── pure builders (testable; take plain rows — no Prisma rows, no Decimal) ──

export function buildSalesItems(
  rows: { id: string; name: string; valueAmount: number; currency: string; date: Date }[],
): AgentItem[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    value: r.valueAmount,
    valueFormat: "currency" as const,
    currency: r.currency,
    date: r.date.toISOString(),
  }))
}

export function buildTicketItems(rows: { id: string; subject: string; resolvedAt: Date }[]): AgentItem[] {
  return rows.map((r) => ({ id: r.id, title: r.subject, date: r.resolvedAt.toISOString() }))
}

/** Shared by tasks + projects: a titled deliverable with a done-date and an
 *  optional deadline → flag whether it landed on time. */
export function buildDeadlineItems(rows: { id: string; title: string; doneAt: Date; due: Date | null }[]): AgentItem[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    date: r.doneAt.toISOString(),
    onTime: r.due ? r.doneAt <= r.due : null,
  }))
}

/** MTM route points: a visited stop titled by its customer/store, dated by when
 *  it was visited (id/title/date shape — same as the other simple builders). */
export function buildMtmItems(rows: { id: string; title: string; doneAt: Date }[]): AgentItem[] {
  return rows.map((r) => ({ id: r.id, title: r.title, date: r.doneAt.toISOString() }))
}

// ── DB fetch ──

export async function computeAgentItems(
  orgId: string,
  group: LeaderboardGroup,
  agentId: string,
  period: LeaderboardPeriod,
  now: Date = new Date(),
): Promise<AgentItemsResult> {
  const rows = await fetchItems(orgId, group, agentId, period, now)
  return {
    group,
    period,
    agentId,
    items: rows.slice(0, ITEM_LIMIT),
    total: Math.min(rows.length, ITEM_LIMIT),
    capped: rows.length > ITEM_LIMIT,
    labelKey: LABEL_KEY[group],
  }
}

/**
 * Roster gate (Codex-flagged RBAC fix): is `agentId` actually ON this group's
 * board? `canViewGroup` only gates the GROUP, so without this a same-org viewer
 * could pull items for an agent the board itself HIDES (e.g. a deactivated rep's
 * WON deals, a non-support user's tickets). Each branch mirrors the aggregator's
 * eligibility predicate; org-scoped so cross-tenant ids return false.
 * KEEP IN SYNC with the aggregators' rosters (sales.ts/tickets.ts/mtm.ts/…).
 */
export async function isAgentOnRoster(
  orgId: string,
  group: LeaderboardGroup,
  agentId: string,
  now: Date = new Date(),
): Promise<boolean> {
  switch (group) {
    case "sales": {
      // sales.ts roster = users with an ACTIVE quota in the current quarter.
      const year = now.getFullYear()
      const quarter = Math.floor(now.getMonth() / 3) + 1
      const q = await prisma.salesQuota.findFirst({
        where: { organizationId: orgId, userId: agentId, year, quarter, user: { isActive: true } },
        select: { id: true },
      })
      return q != null
    }
    case "tickets": {
      // tickets.ts roster = active support users.
      const u = await prisma.user.findFirst({
        where: { id: agentId, organizationId: orgId, role: "support", isActive: true },
        select: { id: true },
      })
      return u != null
    }
    case "tasks": {
      // tasks.ts roster = active users (blocks deactivated; a no-task active user
      // simply gets an empty list, no leak).
      const u = await prisma.user.findFirst({
        where: { id: agentId, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      return u != null
    }
    case "projects": {
      // projects.ts roster = managers of at least one project (any status).
      const p = await prisma.project.findFirst({
        where: { organizationId: orgId, managerId: agentId },
        select: { id: true },
      })
      return p != null
    }
    case "mtm": {
      // mtm.ts roster = ACTIVE MtmAgent.
      const a = await prisma.mtmAgent.findFirst({
        where: { id: agentId, organizationId: orgId, status: "ACTIVE" },
        select: { id: true },
      })
      return a != null
    }
  }
}

async function fetchItems(
  orgId: string,
  group: LeaderboardGroup,
  agentId: string,
  period: LeaderboardPeriod,
  now: Date,
): Promise<AgentItem[]> {
  switch (group) {
    case "sales": {
      const { start, end } = quarterBoundaries(now.getFullYear(), Math.floor(now.getMonth() / 3) + 1)
      const { wonStages } = await orgStageVocabulary(orgId)
      const deals = await prisma.deal.findMany({
        where: { organizationId: orgId, stage: { in: wonStages }, assignedTo: agentId, updatedAt: { gte: start, lte: end } },
        select: { id: true, name: true, valueAmount: true, currency: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: ITEM_LIMIT + 1,
      }) as SalesDealItemRow[]
      return buildSalesItems(
        deals.map((d) => ({
          id: d.id,
          name: d.name,
          valueAmount: decimalToNumber(d.valueAmount),
          currency: d.currency,
          date: d.updatedAt,
        })),
      )
    }
    case "tickets": {
      const start = periodStart(period, now)
      const rows = await prisma.ticket.findMany({
        where: { organizationId: orgId, assignedTo: agentId, resolvedAt: start ? { gte: start } : { not: null } },
        select: { id: true, subject: true, resolvedAt: true },
        orderBy: { resolvedAt: "desc" },
        take: ITEM_LIMIT + 1,
      }) as TicketItemRow[]
      return buildTicketItems(
        rows.flatMap((r) => (r.resolvedAt ? [{ id: r.id, subject: r.subject, resolvedAt: r.resolvedAt }] : [])),
      )
    }
    case "projects": {
      const start = periodStart(period, now)
      const rows = await prisma.project.findMany({
        where: {
          organizationId: orgId,
          managerId: agentId,
          status: "completed",
          actualEndDate: start ? { gte: start } : { not: null },
        },
        select: { id: true, name: true, actualEndDate: true, endDate: true },
        orderBy: { actualEndDate: "desc" },
        take: ITEM_LIMIT + 1,
      }) as ProjectItemRow[]
      return buildDeadlineItems(
        rows.flatMap((r) =>
          r.actualEndDate ? [{ id: r.id, title: r.name, doneAt: r.actualEndDate, due: r.endDate }] : [],
        ),
      )
    }
    case "tasks": {
      const start = periodStart(period, now)
      const dateFilter = start ? { gte: start } : { not: null }
      const [tasks, projectTasks] = await Promise.all([
        prisma.task.findMany({
          where: { organizationId: orgId, assignedTo: agentId, deletedAt: null, completedAt: dateFilter },
          select: { id: true, title: true, completedAt: true, dueDate: true },
          orderBy: { completedAt: "desc" },
          take: ITEM_LIMIT + 1,
        }),
        prisma.projectTask.findMany({
          where: { organizationId: orgId, assignedTo: agentId, completedAt: dateFilter },
          select: { id: true, title: true, completedAt: true, dueDate: true },
          orderBy: { completedAt: "desc" },
          take: ITEM_LIMIT + 1,
        }),
      ])
      const merged = [...tasks, ...projectTasks]
        .flatMap((r) => (r.completedAt ? [{ id: r.id, title: r.title, doneAt: r.completedAt, due: r.dueDate }] : []))
        .sort((a, b) => b.doneAt.getTime() - a.doneAt.getTime())
      return buildDeadlineItems(merged)
    }
    case "mtm": {
      const start = periodStart(period, now)
      // Route POINTS (the visited stops on the agent's routes) — for field agents
      // the meaningful work unit is points-of-route, not tasks (per user). A
      // MtmRoutePoint carries no agentId/orgId, so scope via its `route` relation
      // (which has both); mirror the routeCompletion metric's window (route
      // createdAt >= start). Title = the customer/store at that stop.
      const rows = await prisma.mtmRoutePoint.findMany({
        where: {
          status: "VISITED",
          deletedAt: null,
          route: {
            organizationId: orgId,
            agentId,
            deletedAt: null,
            ...(start ? { createdAt: { gte: start } } : {}),
          },
        },
        select: {
          id: true,
          orderIndex: true,
          visitedAt: true,
          route: { select: { date: true } },
          customer: { select: { name: true } },
        },
        orderBy: { visitedAt: "desc" },
        take: ITEM_LIMIT + 1,
      }) as MtmRoutePointItemRow[]
      return buildMtmItems(
        rows.map((r) => ({
          id: r.id,
          title: r.customer?.name ?? `#${r.orderIndex + 1}`,
          doneAt: r.visitedAt ?? r.route.date,
        })),
      )
    }
  }
}
