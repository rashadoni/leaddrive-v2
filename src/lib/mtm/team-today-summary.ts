/**
 * One line of facts for the Panel's team view, and the order of the rows
 * under it.
 *
 * Audit 2026-09-21 of the /mtm Panel on prod: 17 agents × 6 columns = 102
 * cells, three of which meant anything — and the one finding that mattered
 * («Смена открыта с 2 сент. 01:22 (19 дней) — агент не закрыл») sat in the
 * last column in the same font as fourteen «Не начат». The manager had to
 * read the whole table to learn that nobody was in the field.
 *
 * Everything here is arithmetic over the rows the server already sends
 * (`/api/v1/mtm/week/team`). The endpoint returns no aggregates and no
 * "online" flag, so the counts are derived from fields a reader can trace
 * back to a row. Deliberately NOT computed on the client:
 *
 * - GPS freshness. The team payload has no threshold (onlineSeconds lives in
 *   the per-agent week), so "in the field" is the workday state or an open
 *   visit, never "GPS younger than N minutes".
 * - Shift age. `days`/`hours` on a left-open shift come from the server so the
 *   number in the summary equals the number on the agent's row.
 *
 * Pure: no clock, no locale, no text. The component only formats.
 */
import type { MtmManagerWorkdayState } from "@/lib/mtm/workday-open-anomaly"

/** Structural mirror of the component's `TeamTodayRow`; a call site must not need a cast. */
export interface TeamTodayRowInput {
  agentId: string
  name: string
  teamName: string | null
  lastGpsAt: string | null
  route: { visited: number; total: number } | null
  visits: ReadonlyArray<{ status: string; checkInAt: string | null; checkOutAt: string | null }>
  /** Server count of today's visits in every status, cancelled ones included. */
  visitCount: number
  openAlerts: number
  workday: MtmManagerWorkdayState | null
}

export type TeamRowFlag = "shift-left-open" | "in-field-no-plan" | "in-field-no-gps" | "open-alerts"
export type TeamRowBucket = "problem" | "active" | "idle"

export interface ClassifiedTeamRow<Row extends TeamTodayRowInput = TeamTodayRowInput> {
  row: Row
  bucket: TeamRowBucket
  flags: TeamRowFlag[]
  inField: boolean
  /** check-in of the newest visit when it is still open (no check-out). */
  openVisitSince: string | null
  /** Highest flag weight; 0 without flags. */
  severity: number
}

export interface TeamTodaySummaryOptions {
  workdayEnabled: boolean
  partial: boolean
  visitsTruncated: boolean
}

export interface TeamTodaySummary<Row extends TeamTodayRowInput = TeamTodayRowInput> {
  total: number
  inField: number
  /** What "in the field" was measured by: the workday state, or (without workforce-hrm) an open visit. */
  inFieldBasis: "workday" | "visit"
  openShifts: { count: number; oldest: { days: number; hours: number } | null }
  planned: number
  withoutPlan: number
  problems: ClassifiedTeamRow<Row>[]
  active: ClassifiedTeamRow<Row>[]
  idle: ClassifiedTeamRow<Row>[]
  partial: boolean
  visitsTruncated: boolean
}

// A shift nobody closed outranks a plan nobody has: the first is a fact the
// manager must act on today, the second may still be the morning.
const FLAG_SEVERITY: Record<TeamRowFlag, number> = {
  "shift-left-open": 4,
  "in-field-no-plan": 3,
  "in-field-no-gps": 2,
  "open-alerts": 1,
}

const ACTIVE_WORKDAY_RANK: Record<string, number> = { working: 0, paused: 1, finished: 2 }

/** The one status every other screen (/visits/active, the week) calls "open". */
const OPEN_VISIT_STATUS = "CHECKED_IN"

/**
 * The newest visit, when it is still checked in. The server sends the six
 * newest visits in chronological order; an earlier visit left open behind a
 * later closed one is a stale record, not the agent's whereabouts now.
 *
 * The status is checked, not only `checkOutAt`: a manager cancelling a visit
 * after the check-in writes `status: CANCELLED` and leaves `checkOutAt` null
 * (PUT /api/v1/mtm/visits/[id]), and that agent is not in the field.
 */
function findOpenVisit(visits: TeamTodayRowInput["visits"]): { found: boolean; since: string | null } {
  const newest = visits.length > 0 ? visits[visits.length - 1] : null
  if (!newest || newest.checkOutAt !== null || newest.status !== OPEN_VISIT_STATUS) return { found: false, since: null }
  return { found: true, since: newest.checkInAt }
}

/**
 * The scope a team payload answers for. The component keeps it next to the
 * payload so a summary fetched for «all teams» is never read under a team
 * filter chosen a moment later (and left there when the new request fails).
 */
export function teamTodayScopeKey(scope: { regionId: string; teamId: string }): string {
  return `${scope.regionId}|${scope.teamId}`
}

/** The payload when it answers for `scopeKey`; null when it belongs to an earlier filter. */
export function teamTodayForScope<Payload extends { scopeKey: string }>(payload: Payload | null, scopeKey: string): Payload | null {
  return payload && payload.scopeKey === scopeKey ? payload : null
}

export function classifyTeamRow<Row extends TeamTodayRowInput>(row: Row, workdayEnabled: boolean): ClassifiedTeamRow<Row> {
  // Without workforce-hrm the server sends `workday: null`; gating here as
  // well keeps a stale or mocked row from inventing a shift the tenant does
  // not track.
  const workday = workdayEnabled ? row.workday : null
  const openVisit = findOpenVisit(row.visits)
  // "paused" and "left-open" are not "in the field": the first is a break,
  // the second is a shift nobody closed, possibly weeks ago.
  const inField = workday?.kind === "working" || openVisit.found

  const flags: TeamRowFlag[] = []
  if (workday?.kind === "left-open") flags.push("shift-left-open")
  if (inField && row.route === null) flags.push("in-field-no-plan")
  if (inField && row.lastGpsAt === null) flags.push("in-field-no-gps")
  if (row.openAlerts > 0) flags.push("open-alerts")
  const severity = flags.reduce((max, flag) => Math.max(max, FLAG_SEVERITY[flag]), 0)

  // Visited stops count as activity; a plan alone does not — a published
  // route with nothing visited at 09:00 is the normal morning, not a state.
  const showedActivity = inField
    || (workday?.kind === "paused" || workday?.kind === "finished")
    || row.visitCount > 0
    || row.lastGpsAt !== null
    || (row.route !== null && row.route.visited > 0)

  return {
    row,
    bucket: flags.length > 0 ? "problem" : showedActivity ? "active" : "idle",
    flags,
    inField,
    openVisitSince: openVisit.since,
    severity,
  }
}

function leftOpenHours(row: TeamTodayRowInput): number {
  return row.workday?.kind === "left-open" ? row.workday.hours : -1
}

export function summarizeTeamToday<Row extends TeamTodayRowInput>(
  rows: readonly Row[],
  options: TeamTodaySummaryOptions,
): TeamTodaySummary<Row> {
  const { workdayEnabled } = options
  const classified = rows.map((row, index) => ({ entry: classifyTeamRow(row, workdayEnabled), index }))

  let inField = 0
  let planned = 0
  let openShiftCount = 0
  let oldest: { days: number; hours: number } | null = null
  for (const { entry } of classified) {
    if (entry.inField) inField += 1
    if (entry.row.route !== null) planned += 1
    const workday = workdayEnabled ? entry.row.workday : null
    if (workday?.kind === "left-open") {
      openShiftCount += 1
      if (!oldest || workday.hours > oldest.hours) oldest = { days: workday.days, hours: workday.hours }
    }
  }

  // Every comparator ends on the server index so equal keys keep the
  // server's order: a re-render must not shuffle rows under the reader.
  const byName = (a: TeamTodayRowInput, b: TeamTodayRowInput) => a.name.localeCompare(b.name)
  const problems = classified
    .filter(({ entry }) => entry.bucket === "problem")
    .sort((a, b) => {
      if (a.entry.severity !== b.entry.severity) return b.entry.severity - a.entry.severity
      if (a.entry.flags.includes("shift-left-open") && b.entry.flags.includes("shift-left-open")) {
        const hours = leftOpenHours(b.entry.row) - leftOpenHours(a.entry.row)
        if (hours !== 0) return hours
      }
      if (a.entry.row.openAlerts !== b.entry.row.openAlerts) return b.entry.row.openAlerts - a.entry.row.openAlerts
      return byName(a.entry.row, b.entry.row) || a.index - b.index
    })
  const active = classified
    .filter(({ entry }) => entry.bucket === "active")
    .sort((a, b) => {
      const rankOf = (entry: ClassifiedTeamRow<Row>) => {
        const kind = workdayEnabled ? entry.row.workday?.kind : undefined
        return kind !== undefined && kind in ACTIVE_WORKDAY_RANK ? ACTIVE_WORKDAY_RANK[kind] : 3
      }
      const rank = rankOf(a.entry) - rankOf(b.entry)
      if (rank !== 0) return rank
      return byName(a.entry.row, b.entry.row) || a.index - b.index
    })
  const idle = classified
    .filter(({ entry }) => entry.bucket === "idle")
    .sort((a, b) => byName(a.entry.row, b.entry.row) || a.index - b.index)

  return {
    total: rows.length,
    inField,
    inFieldBasis: workdayEnabled ? "workday" : "visit",
    openShifts: { count: openShiftCount, oldest },
    planned,
    withoutPlan: rows.length - planned,
    problems: problems.map(({ entry }) => entry),
    active: active.map(({ entry }) => entry),
    idle: idle.map(({ entry }) => entry),
    partial: options.partial,
    visitsTruncated: options.visitsTruncated,
  }
}

/**
 * Owner 2026-09-22 on the Panel: «here it should be the other way round —
 * who is going where, who is where». The first thing a row says is the
 * agent's whereabouts, in this order: at a customer now; on the way to the
 * next planned stop; the day already closed; the last customer seen. Null
 * when the data says nothing about it.
 */
export type TeamRowWhereabouts =
  | { kind: "at-customer"; customerName: string | null; since: string }
  | { kind: "heading"; customerName: string | null; plannedAt: string | null }
  | { kind: "day-done"; at: string | null; visited: number | null; total: number | null }
  | { kind: "last-visit"; customerName: string | null; until: string }

export function teamRowWhereabouts(row: {
  visits: ReadonlyArray<{ customerName: string | null; status: string; checkInAt: string | null; checkOutAt: string | null }>
  nextStop?: { customerName: string | null; plannedAt: string | null } | null
  workday?: { kind: string; at?: string | null } | null
  route?: { visited: number; total: number } | null
}): TeamRowWhereabouts | null {
  const last = row.visits.length ? row.visits[row.visits.length - 1] : null
  if (last && last.status === "CHECKED_IN" && last.checkInAt) {
    return { kind: "at-customer", customerName: last.customerName, since: last.checkInAt }
  }
  const dayDone = row.workday?.kind === "finished"
  if (!dayDone && row.nextStop) {
    return { kind: "heading", customerName: row.nextStop.customerName, plannedAt: row.nextStop.plannedAt }
  }
  if (dayDone) {
    return { kind: "day-done", at: row.workday?.at ?? null, visited: row.route?.visited ?? null, total: row.route?.total ?? null }
  }
  if (last && last.checkOutAt) return { kind: "last-visit", customerName: last.customerName, until: last.checkOutAt }
  return null
}
