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
import { calculateDistance } from "@/lib/geo-utils"
import { isLiveMapPositionVisible, type MtmDashboardAgent } from "@/lib/mtm-types"

export const ROSTER_COLUMNS = ["name", "status", "signal", "distance", "team", "manager", "tags", "app", "workday", "route", "speed", "battery"] as const
export type RosterColumnId = typeof ROSTER_COLUMNS[number]

/** What fits beside the map. A narrow list always has these, whatever the wide table shows. */
export const ROSTER_NARROW_COLUMNS: readonly RosterColumnId[] = ["name", "status", "signal"]
/**
 * …and while a point is picked on the map — «who is nearest to this address» —
 * the distance to it takes the place of the signal's age: it is the question
 * being asked.
 */
export const ROSTER_NARROW_COLUMNS_WITH_POINT: readonly RosterColumnId[] = ["name", "status", "distance"]
/** The wide table, until somebody chooses otherwise. */
// «Руководитель» is not among them: the wide table was sized without it, and
// on a laptop it cut the status word and the names. It is one tick away in
// «Вид», and its filter and grouping work without the column being drawn.
// «Метки» neither, for the same reason: they are filtered from «Фильтры» and
// searched by the box above the list whether or not the column is drawn.
export const ROSTER_DEFAULT_COLUMNS: readonly RosterColumnId[] = ["name", "status", "signal", "distance", "team", "workday", "route", "battery"]
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
export const ROSTER_DISTANCE_ORDER = ["NEAR", "CLOSE", "FAR", "VERY_FAR", "UNKNOWN"] as const
/** The value of the team column for somebody who is in no team. */
export const ROSTER_NO_TEAM = "__none__"
/** …and of «Руководитель» for somebody whose card names nobody. */
export const ROSTER_NO_MANAGER = "__none__"
/**
 * …and of «Метки» for somebody with no label. Nobody can type it as a label:
 * a label has no underscore in it (src/lib/mtm/agent-tags.ts).
 */
export const ROSTER_NO_TAGS = "__none__"

const FIXED_ORDER: Partial<Record<RosterColumnId, readonly string[]>> = {
  status: ROSTER_STATUS_ORDER,
  signal: ROSTER_SIGNAL_ORDER,
  app: ROSTER_APP_ORDER,
  workday: ROSTER_WORKDAY_ORDER,
  route: ROSTER_ROUTE_ORDER,
  speed: ROSTER_SPEED_ORDER,
  battery: ROSTER_BATTERY_ORDER,
  distance: ROSTER_DISTANCE_ORDER,
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
    case "manager": return agent.managerId || ROSTER_NO_MANAGER
    // The cell as one word, for whoever asks for one. The filter does not: a
    // person carries several labels, and it reads each of them (rosterValues).
    case "tags": return rosterLabels(agent).join(", ") || ROSTER_NO_TAGS
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
    case "distance": {
      const meters = agent.distanceMeters
      if (typeof meters !== "number" || !Number.isFinite(meters)) return "UNKNOWN"
      return meters < 1_000 ? "NEAR" : meters < 5_000 ? "CLOSE" : meters < 20_000 ? "FAR" : "VERY_FAR"
    }
  }
}

/**
 * The labels on an employee's card, in the order his manager wrote them. An
 * answer from before labels existed has none, and that reads as «no labels».
 */
export function rosterLabels(agent: MtmDashboardAgent): string[] {
  if (!Array.isArray(agent.tags)) return []
  return [...new Set(agent.tags.filter((label) => typeof label === "string" && label.length > 0))]
}

/**
 * Every value a row has in a column. One — except «Метки»: each label is a
 * value of its own, and a person without any has the one value «no labels».
 */
export function rosterValues(agent: MtmDashboardAgent, column: RosterColumnId): string[] {
  if (column !== "tags") return [rosterValue(agent, column)]
  const labels = rosterLabels(agent)
  return labels.length > 0 ? labels : [ROSTER_NO_TAGS]
}

/**
 * One column's filter: the values to show.
 *
 * A tick means «show these»; nothing ticked means no filter — the list is
 * whole. The first version copied a spreadsheet to the letter (everything
 * ticked, untick what you do not want), and the owner called it unusable
 * (2026-10-09: «фильтр кажется не юзабилити… сравни с ТМС примером»): to see
 * only the late ones a dispatcher unticked five lines or hunted for a small
 * «только». The tracking product he named as the model does it the other way
 * round, in its list and in its tables alike, and so does this.
 */
export interface RosterColumnFilter {
  mode: "only"
  values: readonly string[]
}
export type RosterFilters = Partial<Record<RosterColumnId, RosterColumnFilter>>

/** Does the column's filter let this value through? No filter lets everything through. */
export function rosterFilterAllows(filter: RosterColumnFilter | undefined, value: string): boolean {
  return !filter || filter.values.length === 0 || filter.values.includes(value)
}

/** Is this value ticked in the column's list? */
export function rosterFilterTicked(filter: RosterColumnFilter | undefined, value: string): boolean {
  return Boolean(filter?.values.includes(value))
}

/** A tick put on or taken off one value. The last tick taken off is the filter taken off. */
export function tickRosterFilterValue(filter: RosterColumnFilter | undefined, value: string): RosterColumnFilter | undefined {
  const ticked = filter?.values ?? []
  const values = ticked.includes(value) ? ticked.filter((entry) => entry !== value) : [...ticked, value]
  return values.length > 0 ? { mode: "only", values } : undefined
}

/** One value alone — what a status chip above the map asks for. */
export function onlyRosterFilterValue(value: string): RosterColumnFilter {
  return { mode: "only", values: [value] }
}

export function withRosterFilter(filters: RosterFilters, column: RosterColumnId, filter: RosterColumnFilter | undefined): RosterFilters {
  const next: RosterFilters = { ...filters }
  // A filter with nothing ticked is no filter.
  if (filter && filter.values.length > 0) next[column] = filter
  else delete next[column]
  return next
}

export function activeRosterFilterColumns(filters: RosterFilters): RosterColumnId[] {
  return ROSTER_COLUMNS.filter((column) => (filters[column]?.values.length ?? 0) > 0)
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

/** A chip is lit while its status is ticked; with no filter only «Все» is. */
export function rosterStatusChipOn(filters: RosterFilters, status: string): boolean {
  return rosterFilterTicked(filters.status, status)
}

/**
 * Letters as the search inside a tick list reads them: «ilqar» finds «İlqar»,
 * «sukur» finds «Şükür». (The search above the list is the server's: it reads
 * a name as the database does, and a label this same way.)
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
  // One ticked value is enough: with «стажёр» ticked, a person labelled
  // «стажёр» and «ночная смена» is shown — a tick says «show these», and he
  // is one of them. (Every other column has one value per row.)
  return agents.filter((agent) => columns.every((column) => {
    const ticked = listed.get(column)
    return ticked != null && rosterValues(agent, column).some((value) => ticked.has(value))
  }))
}

export interface RosterFilterOption {
  value: string
  /** Rows that have this value once every OTHER filter is applied. */
  count: number
}

/**
 * The tick list of one column: its values with how many rows each would give,
 * counted against the other columns' filters.
 *
 * A column with a vocabulary of its own — the statuses, the freshness of the
 * signal, the battery's three levels — lists all of it, always, in its own
 * order: at nine in the evening nobody is «в пути», and a list that showed
 * only what is there now offered a dispatcher a single line to choose from.
 * A value nobody has says 0; it can still be ticked — the list is alive, and
 * in a minute somebody will. Teams and managers are a vocabulary too — the
 * roster's own: every one of them is listed whatever the other filters leave,
 * so a filter on status never empties the list of managers. Labels are the
 * roster's vocabulary in the same way, and a person counts once under each
 * label he carries; «без меток» closes their list and is always there to
 * press. Names alone list who is there under the other filters (a hundred
 * people, of whom three are late), plus whoever is ticked, so a tick can
 * always be taken off.
 */
export function rosterFilterOptions(
  agents: readonly MtmDashboardAgent[],
  filters: RosterFilters,
  column: RosterColumnId,
): RosterFilterOption[] {
  const counts = new Map<string, number>()
  for (const agent of applyRosterFilters(agents, filters, column)) {
    for (const value of rosterValues(agent, column)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const own = filters[column]
  if (own) for (const value of own.values) if (!counts.has(value)) counts.set(value, 0)
  const fixed = FIXED_ORDER[column]
  if (fixed) {
    // Anything outside the vocabulary that is nevertheless there is not dropped.
    const values = [...fixed, ...[...counts.keys()].filter((value) => !fixed.includes(value))]
    return values.map((value) => ({ value, count: counts.get(value) ?? 0 }))
  }
  if (column === "team" || column === "manager" || column === "tags") {
    for (const agent of agents) {
      for (const value of rosterValues(agent, column)) if (!counts.has(value)) counts.set(value, 0)
    }
  }
  const values = column === "tags"
    ? [...[...counts.keys()].filter((value) => value !== ROSTER_NO_TAGS), ROSTER_NO_TAGS]
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
    case "manager": return agent.managerId ? (agent.managerName ?? "") : null
    // As the cell reads, left to right; a card without labels has nothing to compare.
    case "tags": return rosterLabels(agent).join(", ") || null
    case "app": return orderIndex(ROSTER_APP_ORDER, rosterValue(agent, "app"))
    case "workday": return orderIndex(ROSTER_WORKDAY_ORDER, agent.workdayState)
    case "route": {
      const total = agent.routeTotal ?? 0
      return total > 0 ? (agent.routeVisited ?? 0) / total : null
    }
    case "speed": return typeof agent.speed === "number" && Number.isFinite(agent.speed) ? agent.speed : null
    case "battery": return typeof agent.battery === "number" && Number.isFinite(agent.battery) ? agent.battery : null
    case "distance": return typeof agent.distanceMeters === "number" && Number.isFinite(agent.distanceMeters) ? agent.distanceMeters : null
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

export const ROSTER_GROUPINGS = ["none", "team", "manager", "status", "workday"] as const
export type RosterGroupBy = typeof ROSTER_GROUPINGS[number]

export interface RosterGroup {
  /** The grouped column's value; "" when the list is not grouped. */
  key: string
  agents: MtmDashboardAgent[]
}

/**
 * Rows keep the order they came in; groups come in the column's own order.
 *
 * By manager, a person who is somebody's manager heads his own group instead
 * of sinking into «без руководителя» (or into his own boss's group) away from
 * his people: «Иванов» then reads Ivanov and, under him, those who report to
 * him. Who is a manager is read from `everybody` — the whole roster, not the
 * rows a filter left — or he would jump groups whenever a filter hid his people.
 */
export function groupRoster(
  agents: readonly MtmDashboardAgent[],
  groupBy: RosterGroupBy,
  locale: string,
  everybody: readonly MtmDashboardAgent[] = agents,
): RosterGroup[] {
  if (groupBy === "none") return [{ key: "", agents: [...agents] }]
  const leaders = groupBy === "manager"
    ? new Set(everybody.flatMap((agent) => (agent.managerId ? [agent.managerId] : [])))
    : null
  const groups = new Map<string, MtmDashboardAgent[]>()
  for (const agent of agents) {
    const leads = Boolean(leaders?.has(agent.agentId))
    const key = leads ? agent.agentId : rosterValue(agent, groupBy)
    const members = groups.get(key)
    // The one the group is named after stands first in it.
    if (members) { if (leads) members.unshift(agent); else members.push(agent) }
    else groups.set(key, [agent])
  }
  const fixed = FIXED_ORDER[groupBy]
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true })
  const keys = [...groups.keys()].sort((a, b) => {
    if (fixed) return orderIndex(fixed, a) - orderIndex(fixed, b)
    // Teams and managers by name; «no team», «no manager» close the list.
    if (a === ROSTER_NO_TEAM || b === ROSTER_NO_TEAM) return a === b ? 0 : a === ROSTER_NO_TEAM ? 1 : -1
    const name = (key: string) => {
      const first = groups.get(key)?.[0]
      if (groupBy !== "manager") return first?.teamName ?? ""
      // The head of the group is the manager himself; otherwise his name is on his people's rows.
      return (first?.agentId === key ? first.name : first?.managerName) ?? ""
    }
    // Two managers of one name stay in one order from refresh to refresh.
    return collator.compare(name(a), name(b)) || (a < b ? -1 : a > b ? 1 : 0)
  })
  return keys.map((key) => ({ key, agents: groups.get(key) ?? [] }))
}

/**
 * Metres from an employee to the point picked on the map — «who is nearest to
 * this address». Asked of where people are now: a position that is no longer
 * live gives `null`, or somebody who left that street yesterday would head the
 * list of the nearest.
 */
export function rosterDistanceToPoint(
  agent: MtmDashboardAgent,
  point: { latitude: number; longitude: number },
): number | null {
  const { latitude, longitude } = agent
  if (!isLiveMapPositionVisible(agent.freshness)) return null
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || typeof longitude !== "number" || !Number.isFinite(longitude)) return null
  return calculateDistance(latitude, longitude, point.latitude, point.longitude)
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
  // A column of dashes is not a column: «Руководитель» is shown once somebody has one.
  const hasManagers = agents.some((agent) => Boolean(agent.managerId))
  // …and «Метки» once somebody carries one.
  const hasLabels = agents.some((agent) => rosterLabels(agent).length > 0)
  // The distance exists only while a point is picked on the map.
  const hasPoint = agents.some((agent) => agent.distanceMeters !== undefined)
  return ROSTER_COLUMNS.filter((column) =>
    (column !== "team" || hasTeams) && (column !== "manager" || hasManagers) && (column !== "tags" || hasLabels)
    && (column !== "workday" || options.workforceEnabled) && (column !== "distance" || hasPoint))
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

/**
 * The columns the list had when views were first remembered (2026-10-09).
 * (A tab still running a build from before `seen` rewrites the view without
 * it; the worst that does is bring a newly arrived default column back once.)
 */
const ROSTER_COLUMNS_FIRST_SET: readonly RosterColumnId[] = ["name", "status", "signal", "distance", "team", "app", "workday", "route", "speed", "battery"]

/** The view as it is remembered: with the columns this build knows, so a later one can tell what is new. */
export function serializeRosterView(view: RosterView): string {
  return JSON.stringify({ ...view, seen: ROSTER_COLUMNS })
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
  // A column that did not exist when the view was saved was never switched
  // off by anybody: it comes in as it would for a new person. What the saving
  // build knew is written beside the view; a view saved before that was kept
  // knew the first set.
  const seen = Array.isArray(record.seen) ? record.seen.filter(isColumn) : ROSTER_COLUMNS_FIRST_SET
  const arrived = ROSTER_DEFAULT_COLUMNS.filter((column) => !seen.includes(column))
  const columns = stored.length > 0
    ? ROSTER_COLUMNS.filter((column) => ROSTER_LOCKED_COLUMNS.includes(column) || stored.includes(column) || arrived.includes(column))
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
