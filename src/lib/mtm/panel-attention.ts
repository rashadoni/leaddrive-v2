/**
 * «Ждёт решения» on the MTM Panel: what a manager has to act on, whatever the
 * time of day.
 *
 * Owner 2026-10-11, looking at /mtm on a Sunday evening: one line («на визите
 * 0 из 3»), one folded row and three filters — «разве это должно быть на
 * главном?». The Panel answered a single question, «who is at a customer this
 * minute», so it was blank outside working hours, and everything that was
 * waiting for the manager lived on other pages: an agent's request for a new
 * client had been unanswered for three days on /mtm/contacts, six alerts of
 * three days ago were on no screen at all (the team row counts today's only,
 * and /mtm/alerts opens on today and lists apart only those older than a
 * week), and nobody had a route for the next working day.
 *
 * Nothing here is a new fact: every item is the count of a list that already
 * exists, with the address of that list. The scope clauses below are the ones
 * those lists use, and `api-mtm-week-attention.test.ts` runs both handlers
 * over the same rows so a number here cannot disagree with the queue it opens.
 *
 * Shifts are deliberately absent: work time is Workforce, which the owner
 * withdrew from the CRM on 2026-10-10.
 */
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"

/** The statuses every approval queue treats as «still waiting for a reviewer». */
export const MTM_OPEN_APPROVAL_STATUSES = ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] as const

export const MTM_PANEL_ATTENTION_KINDS = [
  "contactCreateRequests",
  "customerCreateRequests",
  "routeChangeRequests",
  "routesAwaitingPublish",
  "olderAlerts",
] as const

export type MtmPanelAttentionKind = (typeof MTM_PANEL_ATTENTION_KINDS)[number]

export interface MtmPanelAttentionItem {
  kind: MtmPanelAttentionKind
  count: number
  /**
   * The calendar day (tenant-local date key) the row names: since when the
   * oldest request waits, the nearest day of an unpublished route, the day of
   * the newest unresolved alert. Null when the rows carry no usable date.
   */
  date: string | null
}

export interface MtmPanelNextWorkday {
  /** The next working day after today, as a date key. */
  date: string
  /** Field agents who work that day. */
  agents: number
  /** How many of them have no published route for it. */
  withoutRoute: number
  /** The first of them, in the order given: the planner opens on this agent and this day. */
  agentId: string | null
}

export interface MtmPanelAttention {
  timezone: string
  today: string
  generatedAt: string
  items: MtmPanelAttentionItem[]
  nextWorkday: MtmPanelNextWorkday | null
}

/** How far ahead the next working day is looked for: two weeks covers any holiday run. */
export const MTM_NEXT_WORKDAY_LOOKAHEAD_DAYS = 14

/**
 * The agents a request or an alert may belong to: `null` is the whole
 * organization (an MTM administrator with no region/team filter).
 */
export type AttentionAgentFilter = readonly string[] | null

function requestedBy(agentIds: AttentionAgentFilter): { requestedByAgentId?: { in: string[] } } {
  return agentIds === null ? {} : { requestedByAgentId: { in: [...agentIds] } }
}

/** Same rows as GET /api/v1/mtm/contact-create-requests. */
export function openContactCreateRequestWhere(organizationId: string, agentIds: AttentionAgentFilter) {
  return { organizationId, status: { in: [...MTM_OPEN_APPROVAL_STATUSES] }, ...requestedBy(agentIds) }
}

/** Same rows as GET /api/v1/mtm/customer-create-requests (the reviewer's list). */
export function openCustomerCreateRequestWhere(organizationId: string, agentIds: AttentionAgentFilter) {
  return { organizationId, status: { in: [...MTM_OPEN_APPROVAL_STATUSES] }, ...requestedBy(agentIds) }
}

/** Same rows as GET /api/v1/mtm/route-change-requests: asked by an agent in scope, or about their route. */
export function openRouteChangeRequestWhere(organizationId: string, agentIds: AttentionAgentFilter) {
  return {
    organizationId,
    status: { in: [...MTM_OPEN_APPROVAL_STATUSES] },
    ...(agentIds === null ? {} : {
      OR: [
        { requestedByAgentId: { in: [...agentIds] } },
        { route: { agentId: { in: [...agentIds] } } },
      ],
    }),
  }
}

/**
 * A draft someone is waiting on (`routesAwaitingPublish`): it has stops and
 * its day has not passed. Route dates are stored as UTC date keys.
 */
export function routeAwaitingPublishWhere(organizationId: string, agentIds: AttentionAgentFilter, todayKey: string) {
  return {
    organizationId,
    status: "DRAFT" as const,
    deletedAt: null,
    date: { gte: new Date(`${todayKey}T00:00:00.000Z`) },
    points: { some: { deletedAt: null } },
    ...(agentIds === null ? {} : { agentId: { in: [...agentIds] } }),
  }
}

/**
 * Unresolved alerts raised before today. Today's are already on the agent's
 * row; these are the ones no screen shows by itself.
 */
export function olderOpenAlertWhere(organizationId: string, agentIds: AttentionAgentFilter, todayStart: Date) {
  return {
    organizationId,
    isResolved: false,
    createdAt: { lt: todayStart },
    ...(agentIds === null ? {} : { agentId: { in: [...agentIds] } }),
  }
}

/**
 * The first working day after `todayKey` for the organization as a whole.
 * Team and agent overrides are applied per agent by `agentsWorkingOn`.
 */
export function nextWorkingDateKey(todayKey: string, overrides: readonly WorkCalendarOverride[]): string | null {
  for (let offset = 1; offset <= MTM_NEXT_WORKDAY_LOOKAHEAD_DAYS; offset += 1) {
    const date = addDateKeyDays(todayKey, offset)
    if (resolveWorkCalendarDay({ date, overrides }).isWorkingDay) return date
  }
  return null
}

/** The agents for whom `date` is a working day (a personal day off is not a missing route). */
export function agentsWorkingOn<Agent extends { id: string; teamId: string | null }>(
  agents: readonly Agent[],
  date: string,
  overrides: readonly WorkCalendarOverride[],
): Agent[] {
  return agents.filter((agent) => resolveWorkCalendarDay({ date, overrides, teamId: agent.teamId, agentId: agent.id }).isWorkingDay)
}

export function buildNextWorkday(input: {
  date: string | null
  /** Field agents working that day. */
  agents: ReadonlyArray<{ id: string }>
  /** Agent ids holding a published route for that day. */
  agentIdsWithRoute: ReadonlySet<string>
}): MtmPanelNextWorkday | null {
  if (!input.date || input.agents.length === 0) return null
  const without = input.agents.filter((agent) => !input.agentIdsWithRoute.has(agent.id))
  return {
    date: input.date,
    agents: input.agents.length,
    withoutRoute: without.length,
    agentId: without[0]?.id ?? null,
  }
}

/** Rows with nothing waiting are not rows: the block lists only what needs a decision. */
export function buildAttentionItems(
  counts: ReadonlyArray<{ kind: MtmPanelAttentionKind; count: number; date: string | null }>,
): MtmPanelAttentionItem[] {
  const order = new Map(MTM_PANEL_ATTENTION_KINDS.map((kind, index) => [kind, index]))
  return counts
    .filter((item) => item.count > 0)
    .map((item) => ({ kind: item.kind, count: item.count, date: item.date }))
    .sort((left, right) => (order.get(left.kind) ?? 0) - (order.get(right.kind) ?? 0))
}

/**
 * Where a row leads. Every address is the existing list of exactly those
 * rows: a generic tab would be the duplicate navigation the audit of
 * 2026-09-21 removed from this screen.
 */
export function attentionItemHref(item: MtmPanelAttentionItem): string {
  switch (item.kind) {
    case "contactCreateRequests":
      return "/mtm/contacts"
    case "customerCreateRequests":
    case "routeChangeRequests":
      return "/mtm/routes?view=approvals"
    case "routesAwaitingPublish":
      return "/mtm/routes"
    case "olderAlerts":
      // /mtm/alerts opens on today; without the day these alerts stay hidden.
      return item.date ? `/mtm/alerts?date=${encodeURIComponent(item.date)}` : "/mtm/alerts"
  }
}

/**
 * The route builder on that day, for the first agent without a route. The
 * team's week grid opens on the current week, so on a Friday it would not
 * show the Monday this row is about; the builder takes the date itself and
 * lets the manager pick another agent there.
 */
export function nextWorkdayHref(next: MtmPanelNextWorkday): string {
  if (!next.agentId) return "/mtm/routes"
  const params = new URLSearchParams({ planAgentId: next.agentId, planDate: next.date })
  return `/mtm/routes?${params.toString()}`
}
