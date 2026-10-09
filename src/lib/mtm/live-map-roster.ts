/**
 * The employee list beside the live map, as a table.
 *
 * Owner, 2026-10-09, looking at three tall cards with cut-off names: «список
 * должен быть компактным, завтра будут например 100 пользователей. Нужны
 * фильтры прямо в списке, как в Excel». The list was a column of cards with
 * one status chip row above the map as its only filter; a hundred people made
 * a page seven screens long with no way to ask «who is offline in this team».
 *
 * This file is the list's logic and nothing else: what each column holds, how
 * a column's filter decides, how rows are ordered and grouped. The component
 * that draws it and the page that feeds the map both read the same functions,
 * so the map never shows somebody the list has filtered away.
 *
 * Pure data and pure functions — imported by the page in the browser.
 */
import type { MtmDashboardAgent } from "@/lib/mtm-types"

export const ROSTER_COLUMNS = ["name", "status", "signal", "team", "app", "workday", "route", "speed", "battery"] as const
export type RosterColumnId = typeof ROSTER_COLUMNS[number]

/** What fits beside the map. A narrow list always has these, whatever the wide table shows. */
export const ROSTER_NARROW_COLUMNS: readonly RosterColumnId[] = ["name", "status", "signal"]
/** The wide table, until somebody chooses otherwise. */
export const ROSTER_DEFAULT_COLUMNS: readonly RosterColumnId[] = ["name", "status", "signal", "team", "workday", "route", "battery"]
/**
 * Columns nobody can switch off. The name is the row. The status is what the
 * chips above the map count: a row that does not say it leaves a person counted
 * under «Опаздывает» with no word of it beside his name (owner, 2026-10-08).
 */
export const ROSTER_LOCKED_COLUMNS: readonly RosterColumnId[] = ["name", "status"]

export const ROSTER_STATUS_ORDER = ["CHECKED_IN", "ON_ROAD", "STOPPED", "LATE", "ROUTE_FINISHED", "OFFLINE"] as const
export const ROSTER_SIGNAL_ORDER = ["ONLINE", "DELAYED", "STALE", "NO_LOCATION"] as const
export const ROSTER_APP_ORDER = ["ONLINE", "OFFLINE"] as const
export const ROSTER_WORKDAY_ORDER = ["ACTIVE", "PAUSED", "NOT_STARTED", "CLOSED"] as const
export const ROSTER_ROUTE_ORDER = ["IN_PROGRESS", "NOT_STARTED", "DONE", "NONE"] as const
export const ROSTER_SPEED_ORDER = ["MOVING", "STILL", "UNKNOWN"] as const
export const ROSTER_BATTERY_ORDER = ["LOW", "MID", "HIGH", "UNKNOWN"] as const
/** The value of the team column for somebody who is in no team. */
export const ROSTER_NO_TEAM = "__none__"

const FIXED_ORDER: Partial<Record<RosterColumnId, readonly string[]>> = {
  status: ROSTER_STATUS_ORDER,
  signal: ROSTER_SIGNAL_ORDER,
  app: ROSTER_APP_ORDER,
  workday: ROSTER_WORKDAY_ORDER,
  route: ROSTER_ROUTE_ORDER,
  speed: ROSTER_SPEED_ORDER,
  battery: ROSTER_BATTERY_ORDER,
}

/** Below this the phone is «standing»: GPS noise reads as one or two km/h. */
const MOVING_ABOVE_KMH = 2

/**
 * The value a column's filter and grouping work on. Numbers are put into the
 * few classes a dispatcher asks about («battery low»), not into ranges to type.
 */
export function rosterValue(agent: MtmDashboardAgent, column: RosterColumnId): string {
  switch (column) {
    case "name": return agent.agentId
    case "status": return (ROSTER_STATUS_ORDER as readonly string[]).includes(agent.fieldStatus) ? agent.fieldStatus : "OFFLINE"
    case "signal": return agent.freshness
    case "team": return agent.teamId || ROSTER_NO_TEAM
    case "app": return agent.isOnline ? "ONLINE" : "OFFLINE"
    case "workday": return agent.workdayState
    case "route": {
      const total = agent.routeTotal ?? 0
      const visited = agent.routeVisited ?? 0
      if (total <= 0) return "NONE"
      if (visited <= 0) return "NOT_STARTED"
      return visited >= total ? "DONE" : "IN_PROGRESS"
    }
    case "speed":
      if (typeof agent.speed !== "number" || !Number.isFinite(agent.speed)) return "UNKNOWN"
      return agent.speed > MOVING_ABOVE_KMH ? "MOVING" : "STILL"
    case "battery":
      if (typeof agent.battery !== "number" || !Number.isFinite(agent.battery)) return "UNKNOWN"
      return agent.battery < 20 ? "LOW" : agent.battery < 50 ? "MID" : "HIGH"
  }
}

/**
 * One column's filter, the way a spreadsheet's tick list means it.
 *
 * Two modes, because «everybody except the offline» and «only these two» are
 * different questions on a list that changes every thirty seconds: somebody
 * who joins the roster later belongs to the first and not to the second. A
 * list of allowed values alone could not tell them apart.
 */
export interface RosterColumnFilter {
  mode: "only" | "except"
  values: readonly string[]
}
export type RosterFilters = Partial<Record<RosterColumnId, RosterColumnFilter>>

export function rosterFilterAllows(filter: RosterColumnFilter | undefined, value: string): boolean {
  if (!filter) return true
  const listed = filter.values.includes(value)
  return filter.mode === "only" ? listed : !listed
}

/** A filter that lets everything through is no filter. */
function normalizedFilter(filter: RosterColumnFilter): RosterColumnFilter | undefined {
  const values = [...new Set(filter.values)]
  if (filter.mode === "except" && values.length === 0) return undefined
  return { mode: filter.mode, values }
}

/** A tick put on or taken off one value. */
export function toggleRosterFilterValue(filter: RosterColumnFilter | undefined, value: string): RosterColumnFilter | undefined {
  if (!filter) return { mode: "except", values: [value] }
  const listed = filter.values.includes(value)
  const values = listed ? filter.values.filter((entry) => entry !== value) : [...filter.values, value]
  return normalizedFilter({ mode: filter.mode, values })
}

/** «Only this one» — the one press that isolates a value. */
export function onlyRosterFilterValue(value: string): RosterColumnFilter {
  return { mode: "only", values: [value] }
}

/** Every tick taken off: nothing is allowed until something is ticked. */
export const ROSTER_FILTER_NOTHING: RosterColumnFilter = { mode: "only", values: [] }

export function withRosterFilter(filters: RosterFilters, column: RosterColumnId, filter: RosterColumnFilter | undefined): RosterFilters {
  const next: RosterFilters = { ...filters }
  if (filter) next[column] = filter
  else delete next[column]
  return next
}

export function activeRosterFilterColumns(filters: RosterFilters): RosterColumnId[] {
  return ROSTER_COLUMNS.filter((column) => filters[column] != null)
}

/**
 * The status chips above the map are the «Статус» column's filter under
 * another hand: a chip leaves that one status, the same chip again — or «Все»
 * (`null`) — takes the filter off.
 */
export function pickRosterStatus(filters: RosterFilters, status: string | null): RosterFilters {
  const current = filters.status
  const alone = current?.mode === "only" && current.values.length === 1 ? current.values[0] : null
  return withRosterFilter(filters, "status", status == null || alone === status ? undefined : onlyRosterFilterValue(status))
}

/** A chip is lit while a status filter is on and lets its status through; with no filter only «Все» is. */
export function rosterStatusChipOn(filters: RosterFilters, status: string): boolean {
  return filters.status != null && rosterFilterAllows(filters.status, status)
}

/**
 * Letters as the search inside a tick list reads them: «ilqar» finds «İlqar»,
 * «sukur» finds «Şükür». (The name search above the list is the server's.)
 */
export function foldRosterText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/ı/g, "i").trim()
}

/**
 * The rows the list shows — and the only employees the map may draw. `skip`
 * leaves one column's own filter out, for counting that column's values.
 */
export function applyRosterFilters(
  agents: readonly MtmDashboardAgent[],
  filters: RosterFilters,
  skip?: RosterColumnId,
): MtmDashboardAgent[] {
  const columns = activeRosterFilterColumns(filters).filter((column) => column !== skip)
  if (columns.length === 0) return [...agents]
  // A filter that names two hundred people is looked up, not scanned, per row.
  const listed = new Map(columns.map((column) => [column, new Set(filters[column]?.values ?? [])]))
  return agents.filter((agent) => columns.every((column) => {
    const has = listed.get(column)?.has(rosterValue(agent, column)) ?? false
    return filters[column]?.mode === "only" ? has : !has
  }))
}

export interface RosterFilterOption {
  value: string
  /** Rows that have this value once every OTHER filter is applied. */
  count: number
}

/**
 * The tick list of one column: its values with how many rows each would give.
 * Counted against the other columns' filters, as a spreadsheet does, so the
 * list never offers a value that the rest of the filters have already emptied
 * — except a value that is ticked right now, which stays so it can be unticked.
 */
export function rosterFilterOptions(
  agents: readonly MtmDashboardAgent[],
  filters: RosterFilters,
  column: RosterColumnId,
): RosterFilterOption[] {
  const counts = new Map<string, number>()
  for (const agent of applyRosterFilters(agents, filters, column)) {
    const value = rosterValue(agent, column)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const own = filters[column]
  if (own) for (const value of own.values) if (!counts.has(value)) counts.set(value, 0)
  const fixed = FIXED_ORDER[column]
  const values = fixed
    ? fixed.filter((value) => counts.has(value))
    : [...counts.keys()]
  return values.map((value) => ({ value, count: counts.get(value) ?? 0 }))
}

export interface RosterSort {
  column: RosterColumnId
  direction: "asc" | "desc"
}
export const ROSTER_DEFAULT_SORT: RosterSort = { column: "name", direction: "asc" }

function orderIndex(order: readonly string[], value: string): number {
  const index = order.indexOf(value)
  return index === -1 ? order.length : index
}

/** What a column sorts by; `null` is «nothing to compare» and always goes last. */
function sortKey(agent: MtmDashboardAgent, column: RosterColumnId): number | string | null {
  switch (column) {
    case "name": return agent.name ?? ""
    case "status": return orderIndex(ROSTER_STATUS_ORDER, rosterValue(agent, "status"))
    case "signal": {
      // Newest first is «ascending»: the column shows an age, and the youngest age is the smallest.
      const recordedAt = agent.recordedAt ? Date.parse(agent.recordedAt) : Number.NaN
      return Number.isFinite(recordedAt) ? -recordedAt : null
    }
    case "team": return agent.teamId ? (agent.teamName ?? "") : null
    case "app": return orderIndex(ROSTER_APP_ORDER, rosterValue(agent, "app"))
    case "workday": return orderIndex(ROSTER_WORKDAY_ORDER, agent.workdayState)
    case "route": {
      const total = agent.routeTotal ?? 0
      return total > 0 ? (agent.routeVisited ?? 0) / total : null
    }
    case "speed": return typeof agent.speed === "number" && Number.isFinite(agent.speed) ? agent.speed : null
    case "battery": return typeof agent.battery === "number" && Number.isFinite(agent.battery) ? agent.battery : null
  }
}

export function sortRoster(agents: readonly MtmDashboardAgent[], sort: RosterSort, locale: string): MtmDashboardAgent[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true })
  const sign = sort.direction === "desc" ? -1 : 1
  const byName = (a: MtmDashboardAgent, b: MtmDashboardAgent) =>
    collator.compare(a.name ?? "", b.name ?? "") || a.agentId.localeCompare(b.agentId)
  return [...agents].sort((a, b) => {
    const left = sortKey(a, sort.column)
    const right = sortKey(b, sort.column)
    // Somebody with no battery reading is last whichever way the column is sorted.
    if (left == null || right == null) {
      if (left == null && right == null) return byName(a, b)
      return left == null ? 1 : -1
    }
    const compared = typeof left === "string" || typeof right === "string"
      ? collator.compare(String(left), String(right))
      : left - right
    return compared !== 0 ? compared * sign : byName(a, b)
  })
}

export const ROSTER_GROUPINGS = ["none", "team", "status", "workday"] as const
export type RosterGroupBy = typeof ROSTER_GROUPINGS[number]

export interface RosterGroup {
  /** The grouped column's value; "" when the list is not grouped. */
  key: string
  agents: MtmDashboardAgent[]
}

/** Rows keep the order they came in; groups come in the column's own order. */
export function groupRoster(agents: readonly MtmDashboardAgent[], groupBy: RosterGroupBy, locale: string): RosterGroup[] {
  if (groupBy === "none") return [{ key: "", agents: [...agents] }]
  const groups = new Map<string, MtmDashboardAgent[]>()
  for (const agent of agents) {
    const key = rosterValue(agent, groupBy)
    const members = groups.get(key)
    if (members) members.push(agent)
    else groups.set(key, [agent])
  }
  const fixed = FIXED_ORDER[groupBy]
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true })
  const keys = [...groups.keys()].sort((a, b) => {
    if (fixed) return orderIndex(fixed, a) - orderIndex(fixed, b)
    // Teams by name; «no team» closes the list.
    if (a === ROSTER_NO_TEAM || b === ROSTER_NO_TEAM) return a === b ? 0 : a === ROSTER_NO_TEAM ? 1 : -1
    return collator.compare(groups.get(a)?.[0]?.teamName ?? "", groups.get(b)?.[0]?.teamName ?? "")
  })
  return keys.map((key) => ({ key, agents: groups.get(key) ?? [] }))
}

export type RosterTickState = "all" | "some" | "none"

/** The tick above a set of rows: are they all on the map, some of them, or none. */
export function rosterTickState(agentIds: readonly string[], hiddenAgentIds: ReadonlySet<string>): { state: RosterTickState; onMap: number; total: number } {
  const onMap = agentIds.reduce((count, id) => count + (hiddenAgentIds.has(id) ? 0 : 1), 0)
  return { state: agentIds.length > 0 && onMap === agentIds.length ? "all" : onMap === 0 ? "none" : "some", onMap, total: agentIds.length }
}

export type RosterSignalAge =
  | { unit: "none" }
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days"; count: number }

/** How long ago the coordinate was recorded, in the one unit that reads at a glance. */
export function rosterSignalAge(recordedAt: string | null | undefined, nowMs: number): RosterSignalAge {
  const recordedAtMs = recordedAt ? Date.parse(recordedAt) : Number.NaN
  if (!Number.isFinite(recordedAtMs) || !Number.isFinite(nowMs)) return { unit: "none" }
  const seconds = Math.max(0, Math.floor((nowMs - recordedAtMs) / 1_000))
  if (seconds < 60) return { unit: "now" }
  if (seconds < 3_600) return { unit: "minutes", count: Math.floor(seconds / 60) }
  if (seconds < 48 * 3_600) return { unit: "hours", count: Math.floor(seconds / 3_600) }
  return { unit: "days", count: Math.floor(seconds / 86_400) }
}

/** Columns that have something to show for this roster. */
export function availableRosterColumns(
  agents: readonly MtmDashboardAgent[],
  options: { workforceEnabled: boolean },
): RosterColumnId[] {
  const hasTeams = agents.some((agent) => Boolean(agent.teamId))
  return ROSTER_COLUMNS.filter((column) =>
    (column !== "team" || hasTeams) && (column !== "workday" || options.workforceEnabled))
}

/**
 * How the list is laid out — remembered in the browser between visits.
 *
 * Filters are deliberately NOT part of it. A filter forgotten since yesterday
 * on a live roster answers «where is my agent» with «nowhere»; the order, the
 * grouping and the columns are harmless to come back to.
 */
export interface RosterView {
  width: "narrow" | "wide"
  sort: RosterSort
  groupBy: RosterGroupBy
  columns: RosterColumnId[]
}

export const ROSTER_VIEW_STORAGE_KEY = "leaddrive.mtm.live-map.roster-view.v1"

export const ROSTER_DEFAULT_VIEW: RosterView = {
  width: "narrow",
  sort: ROSTER_DEFAULT_SORT,
  groupBy: "none",
  columns: [...ROSTER_DEFAULT_COLUMNS],
}

/** Whatever was stored — by an older build, by hand — comes back as a valid view. */
export function parseRosterView(raw: unknown): RosterView {
  let input: unknown = raw
  if (typeof raw === "string") {
    try { input = JSON.parse(raw) } catch { input = null }
  }
  const record = input != null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const sortInput = record.sort != null && typeof record.sort === "object" ? record.sort as Record<string, unknown> : {}
  const isColumn = (value: unknown): value is RosterColumnId => (ROSTER_COLUMNS as readonly unknown[]).includes(value)
  const stored = Array.isArray(record.columns) ? record.columns.filter(isColumn) : []
  const columns = stored.length > 0
    ? ROSTER_COLUMNS.filter((column) => ROSTER_LOCKED_COLUMNS.includes(column) || stored.includes(column))
    : [...ROSTER_DEFAULT_COLUMNS]
  return {
    width: record.width === "wide" ? "wide" : "narrow",
    sort: isColumn(sortInput.column)
      ? { column: sortInput.column, direction: sortInput.direction === "desc" ? "desc" : "asc" }
      : ROSTER_DEFAULT_SORT,
    groupBy: (ROSTER_GROUPINGS as readonly unknown[]).includes(record.groupBy) ? record.groupBy as RosterGroupBy : "none",
    columns,
  }
}
