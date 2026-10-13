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
  // First on purpose: the agent who sent it may be standing at the customer's door.
  "customerLocationRequests",
  "attendanceRequests",
  "attendanceInstallations",
  "contactCreateRequests",
  "customerCreateRequests",
  "routeChangeRequests",
  "routesAwaitingPublish",
  "olderAlerts",
  "photosPendingReview",
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
  /**
   * Whose rows these are, the busiest first — at most
   * {@link MTM_ATTENTION_PEOPLE_SHOWN} names. The reader may open the list the
   * row leads to, where the same names stand.
   */
  people: string[]
  /** How many different agents the rows belong to. */
  peopleCount: number
  /** Alerts only: how many of each type, the most frequent first. */
  types: Array<{ type: string; count: number }>
  /**
   * «Клиент здесь» only: the moment the oldest request was sent. The other
   * rows wait in days; this one is counted in minutes, so the row names the hour.
   */
  since?: string
}

/** Names a row spells out; beyond it the row says «and N more». */
export const MTM_ATTENTION_PEOPLE_SHOWN = 2
/** Alert types a row spells out. */
export const MTM_ATTENTION_TYPES_SHOWN = 3

export interface MtmPanelNextWorkday {
  /** The next working day after today, as a date key. */
  date: string
  /** Field agents who work that day. */
  agents: number
  /** How many of them have no published route for it. */
  withoutRoute: number
  /** The first of them, in the order given: the planner opens on this agent and this day. */
  agentId: string | null
  /** Names of those without a route, at most {@link MTM_ATTENTION_PEOPLE_SHOWN}. */
  people: string[]
}

export interface MtmPanelWeekDay {
  date: string
  isWorkingDay: boolean
}

export interface MtmPanelAttention {
  timezone: string
  today: string
  generatedAt: string
  /** Whether the organization works today, by its calendar. */
  todayIsWorkingDay: boolean
  /** Monday to Sunday of the current week, for the team's week strip. */
  week: MtmPanelWeekDay[]
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

/**
 * Same rows as GET /api/v1/mtm/customer-location-requests: «Клиент здесь»,
 * an agent's request to move a customer's pin, not yet decided.
 */
export function openCustomerLocationRequestWhere(organizationId: string, agentIds: AttentionAgentFilter) {
  return { organizationId, status: "SUBMITTED" as const, ...requestedBy(agentIds) }
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
 * Photos nobody has reviewed yet, in the scope of GET /api/v1/mtm/photos
 * (`mtmPhotoFieldScopeWhere`): taken by an agent in scope, or on a visit of one.
 */
export function pendingPhotoWhere(organizationId: string, agentIds: AttentionAgentFilter) {
  return {
    organizationId,
    status: "PENDING" as const,
    ...(agentIds === null ? {} : {
      OR: [
        { agentId: { in: [...agentIds] } },
        { visit: { is: { agentId: { in: [...agentIds] } } } },
      ],
    }),
  }
}

/** Monday of the week `dateKey` falls in. */
export function weekStartKey(dateKey: string): string {
  const weekday = (new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() + 6) % 7
  return addDateKeyDays(dateKey, -weekday)
}

/** Monday to Sunday of today's week, each with the organization's verdict on it. */
export function weekWorkingDays(todayKey: string, overrides: readonly WorkCalendarOverride[]): MtmPanelWeekDay[] {
  const monday = weekStartKey(todayKey)
  return Array.from({ length: 7 }, (_unused, offset) => {
    const date = addDateKeyDays(monday, offset)
    return { date, isWorkingDay: resolveWorkCalendarDay({ date, overrides }).isWorkingDay }
  })
}

/**
 * Totals of rows grouped by the agent they belong to: how many, the calendar
 * extreme the row names, and whose they are (the busiest first, ties by id so
 * a refresh does not reshuffle the names).
 */
export function summarizeByAgent(
  groups: ReadonlyArray<{ agentId: string; count: number; date: Date | null }>,
  pick: "earliest" | "latest",
): { count: number; date: Date | null; agentIds: string[] } {
  let count = 0
  let date: Date | null = null
  for (const group of groups) {
    count += group.count
    if (group.date && (!date || (pick === "earliest" ? group.date < date : group.date > date))) date = group.date
  }
  const agentIds = [...groups]
    .filter((group) => group.count > 0)
    .sort((left, right) => right.count - left.count || left.agentId.localeCompare(right.agentId))
    .map((group) => group.agentId)
  return { count, date, agentIds }
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
  agents: ReadonlyArray<{ id: string; name?: string | null }>
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
    people: without.slice(0, MTM_ATTENTION_PEOPLE_SHOWN).flatMap((agent) => (agent.name ? [agent.name] : [])),
  }
}

/** Rows with nothing waiting are not rows: the block lists only what needs a decision. */
export function buildAttentionItems(
  counts: ReadonlyArray<{
    kind: MtmPanelAttentionKind
    count: number
    date: string | null
    /** Agent ids the rows belong to, the busiest first. */
    agentIds?: readonly string[]
    types?: ReadonlyArray<{ type: string; count: number }>
    since?: Date | null
  }>,
  agentNames: ReadonlyMap<string, string> = new Map(),
): MtmPanelAttentionItem[] {
  const order = new Map(MTM_PANEL_ATTENTION_KINDS.map((kind, index) => [kind, index]))
  return counts
    .filter((item) => item.count > 0)
    .map((item) => {
      const agentIds = item.agentIds ?? []
      return {
        kind: item.kind,
        count: item.count,
        date: item.date,
        people: agentIds.slice(0, MTM_ATTENTION_PEOPLE_SHOWN).flatMap((id) => {
          const name = agentNames.get(id)
          return name ? [name] : []
        }),
        peopleCount: agentIds.length,
        types: [...(item.types ?? [])]
          .filter((entry) => entry.count > 0)
          .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
          .slice(0, MTM_ATTENTION_TYPES_SHOWN),
        ...(item.since ? { since: item.since.toISOString() } : {}),
      }
    })
    .sort((left, right) => (order.get(left.kind) ?? 0) - (order.get(right.kind) ?? 0))
}

/**
 * Where a row leads. Every address is the existing list of exactly those
 * rows: a generic tab would be the duplicate navigation the audit of
 * 2026-09-21 removed from this screen.
 */
export function attentionItemHref(item: Pick<MtmPanelAttentionItem, "kind" | "date">): string {
  switch (item.kind) {
    case "attendanceInstallations":
      return "/mtm/attendance/installations"
    case "attendanceRequests":
      return "/mtm/attendance/requests"
    case "contactCreateRequests":
      return "/mtm/contacts"
    case "customerLocationRequests":
    case "customerCreateRequests":
    case "routeChangeRequests":
      return "/mtm/routes?view=approvals"
    case "routesAwaitingPublish":
      return "/mtm/routes"
    case "olderAlerts":
      // /mtm/alerts opens on today; without the day these alerts stay hidden.
      return item.date ? `/mtm/alerts?date=${encodeURIComponent(item.date)}` : "/mtm/alerts"
    case "photosPendingReview":
      // The gallery opens on this week and on every status; an unreviewed
      // photo of last week would not be there.
      return "/mtm/photos?status=PENDING&period=all"
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
