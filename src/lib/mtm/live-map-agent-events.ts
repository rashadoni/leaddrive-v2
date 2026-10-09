import type { MtmLiveFeedAlertMessage } from "@/lib/mtm/live-feed-alerts"

/**
 * The selected employee's own events of today, for the live map's card.
 *
 * The feed under the map is the whole team's and is cut to fifteen rows, so
 * picking one person's rows out of it would look right on a demo and lose
 * events on a real team. This reads the two per-employee sources that already
 * exist — the activity journal and the day's alert groups — and merges them.
 *
 * Only what the employee did himself is listed (a visit begun or finished,
 * the shift begun, paused, resumed, closed, the route begun or finished, a
 * request to change the route) plus the alerts about him. What the office
 * did to his card or his route is the journal's business, not his day.
 *
 * Pure: no React, no fetch.
 */

/** The journal actions that are the employee's own. */
export const LIVE_MAP_AGENT_EVENT_ACTIONS = [
  "CHECK_IN",
  "CHECK_IN_FORCED",
  "CHECK_OUT",
  "ROUTE_START",
  "ROUTE_COMPLETE",
  "WORKDAY_START",
  "WORKDAY_PAUSE",
  "WORKDAY_RESUME",
  "WORKDAY_FINISH",
  "ROUTE_REMOVAL_REQUEST",
  "ROUTE_ADDITION_REQUEST",
] as const

const OWN_ACTIONS: ReadonlySet<string> = new Set(LIVE_MAP_AGENT_EVENT_ACTIONS)

/** A row of GET /api/v1/mtm/activity, as far as the card reads it. */
export interface LiveMapActivityRow {
  id: string
  action: string
  createdAt: string
  agentId?: string | null
  newData?: unknown
  subject?: { customerName?: string | null; visitId?: string | null; routeId?: string | null } | null
}

/** A group of GET /api/v1/mtm/alerts?view=groups, as far as the card reads it. */
export interface LiveMapAlertGroupRow {
  key: string
  agentId: string
  alertType: string
  message: MtmLiveFeedAlertMessage
  count: number
  firstAt: string
  lastAt: string
  historyHref?: string | null
}

export type LiveMapAgentEvent =
  | {
      kind: "action"
      id: string
      at: string
      action: string
      customerName: string | null
      visitId: string | null
      routeId: string | null
    }
  | {
      kind: "alert"
      id: string
      at: string
      alertType: string
      message: MtmLiveFeedAlertMessage
      count: number
      firstAt: string
      lastAt: string
      historyHref: string | null
    }

function instant(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * When the event happened. A shift event recorded offline is written to the
 * journal when the phone syncs, and carries the moment the employee pressed
 * the button inside the row: 09:00, not the 11:30 the server heard of it.
 */
function actionTime(row: LiveMapActivityRow): string | null {
  if (row.action.startsWith("WORKDAY_")) {
    const data = row.newData && typeof row.newData === "object" && !Array.isArray(row.newData)
      ? row.newData as Record<string, unknown>
      : null
    const claimed = instant(data?.claimedAt)
    if (claimed !== null) return new Date(claimed).toISOString()
  }
  const created = instant(row.createdAt)
  return created === null ? null : new Date(created).toISOString()
}

export function liveMapAgentEvents(input: {
  agentId: string
  activity: readonly LiveMapActivityRow[]
  alerts: readonly LiveMapAlertGroupRow[]
  /**
   * The shift start the roster row already shows, when it began today. A
   * tenant without the workforce module gets no shift rows from the journal,
   * and the card must not say «на смене» above a day with no beginning.
   */
  workdayStartedAt?: string | null
}): LiveMapAgentEvent[] {
  const events: LiveMapAgentEvent[] = []
  let hasShiftStart = false

  for (const row of input.activity) {
    // The journal answers for the employee asked about; a stray row is not his event.
    if (row.agentId != null && row.agentId !== input.agentId) continue
    if (!OWN_ACTIONS.has(row.action)) continue
    const at = actionTime(row)
    if (!at) continue
    if (row.action === "WORKDAY_START") hasShiftStart = true
    events.push({
      kind: "action",
      id: `action-${row.id}`,
      at,
      action: row.action,
      customerName: row.subject?.customerName?.trim() || null,
      visitId: row.subject?.visitId ?? null,
      routeId: row.subject?.routeId ?? null,
    })
  }

  const shiftStart = instant(input.workdayStartedAt)
  if (!hasShiftStart && shiftStart !== null) {
    events.push({
      kind: "action",
      id: "action-shift-start",
      at: new Date(shiftStart).toISOString(),
      action: "WORKDAY_START",
      customerName: null,
      visitId: null,
      routeId: null,
    })
  }

  for (const group of input.alerts) {
    if (group.agentId !== input.agentId) continue
    const last = instant(group.lastAt)
    if (last === null) continue
    events.push({
      kind: "alert",
      id: `alert-${group.key}`,
      at: new Date(last).toISOString(),
      alertType: group.alertType,
      message: group.message,
      count: Math.max(1, Math.floor(group.count) || 1),
      firstAt: group.firstAt,
      lastAt: group.lastAt,
      historyHref: group.historyHref?.trim() || null,
    })
  }

  // Newest first; two events of the same second keep a stable order by id.
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The record an event opens: the visit, then the route, then the GPS history around an alert. */
export function liveMapAgentEventHref(event: LiveMapAgentEvent): string | null {
  if (event.kind === "alert") return event.historyHref
  if (event.visitId) return `/mtm/visits?visitId=${encodeURIComponent(event.visitId)}`
  if (event.routeId) return `/mtm/routes?routeId=${encodeURIComponent(event.routeId)}`
  return null
}

/**
 * The facts of a roster row that change when the employee does something. The
 * card asks for his events again when this changes — not on every refresh of
 * the map: the journal read is the heavier request, and nothing new is in it
 * while he is driving.
 */
export function liveMapAgentEventsRefreshKey(agent: {
  fieldStatus: string
  workdayState: string
  openVisitSince?: string | null
  routeVisited?: number
  routeTotal?: number
}): string {
  return [agent.fieldStatus, agent.workdayState, agent.openVisitSince ?? "", agent.routeVisited ?? 0, agent.routeTotal ?? 0].join("|")
}
