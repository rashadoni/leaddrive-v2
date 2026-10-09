import type { MtmDashboardAgent } from "@/lib/mtm-types"
import { ROSTER_COLUMNS, rosterLabels, rosterValue, type RosterColumnId } from "@/lib/mtm/live-map-roster"

/**
 * The live map's list as a table of words, for the Excel file.
 *
 * The file is what the dispatcher sees: the rows left by his filters, in his
 * order. It is built in the browser, because the status, the freshness and
 * the distance to the picked point are worked out there from the moment the
 * page is looking at — a file made by the server from the database would
 * disagree with the screen it was downloaded from.
 *
 * One thing differs from the screen on purpose: «Сигнал». On screen it is an
 * age («5 мин»), which is false a minute after the file is saved; the file
 * carries the clock time of the last coordinate and what the map made of it.
 *
 * Pure: no React, no fetch. The words come from the caller's translations.
 */

export interface RosterExportWords {
  column: (column: RosterColumnId) => string
  status: (status: string) => string
  freshness: (freshness: MtmDashboardAgent["freshness"]) => string
  presence: (online: boolean) => string
  workday: (state: MtmDashboardAgent["workdayState"]) => string
  routeProgress: (done: number, total: number) => string
  speed: (kmh: number) => string
  distance: (meters: number) => string
  /** A moment as a clock time in the organization's time zone. */
  clock: (iso: string) => string
  /** The same, with the date when the moment is not today. */
  dateTime: (iso: string) => string
  visitOpened: (time: string) => string
  /** «стоит с {time}» — a moment, not a duration: a duration is false a minute after the file is saved. */
  standingSince: (time: string) => string
}

const EMPTY = "—"

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** One cell of the file, as text. */
export function rosterCellText(agent: MtmDashboardAgent, column: RosterColumnId, words: RosterExportWords): string {
  switch (column) {
    case "name":
      return agent.name
    case "status": {
      const status = rosterValue(agent, "status")
      const label = words.status(status)
      if (status === "CHECKED_IN" && agent.openVisitSince) return `${label} · ${words.visitOpened(words.dateTime(agent.openVisitSince))}`
      if (status === "STOPPED" && agent.stationarySince) return `${label} · ${words.standingSince(words.dateTime(agent.stationarySince))}`
      return label
    }
    case "signal":
      return agent.recordedAt
        ? `${words.dateTime(agent.recordedAt)} · ${words.freshness(agent.freshness)}`
        : words.freshness(agent.freshness)
    case "distance":
      return finite(agent.distanceMeters) ? words.distance(agent.distanceMeters) : EMPTY
    case "team":
      return agent.teamId ? agent.teamName?.trim() || EMPTY : EMPTY
    case "manager":
      return agent.managerId ? agent.managerName?.trim() || EMPTY : EMPTY
    case "tags":
      // All of them, where the screen has room for two. A label holds no
      // comma, so the cell reads as a list; ten of the longest make 258
      // characters, inside what the file accepts for a cell (agent-tags.ts).
      return rosterLabels(agent).join(", ") || EMPTY
    case "app":
      return words.presence(agent.isOnline)
    case "workday": {
      const running = agent.workdayState === "ACTIVE" || agent.workdayState === "PAUSED"
      const started = running && agent.workdayStartedAt
        ? (agent.workdayCarryover ? words.dateTime(agent.workdayStartedAt) : words.clock(agent.workdayStartedAt))
        : ""
      return `${words.workday(agent.workdayState)}${started ? ` · ${started}` : ""}`
    }
    case "route":
      return (agent.routeTotal ?? 0) > 0 ? words.routeProgress(agent.routeVisited ?? 0, agent.routeTotal ?? 0) : EMPTY
    case "speed":
      return finite(agent.speed) ? words.speed(Math.round(agent.speed)) : EMPTY
    case "battery":
      return finite(agent.battery) ? `${Math.round(agent.battery)}%` : EMPTY
  }
}

export interface RosterExportTable {
  headers: string[]
  rows: string[][]
}

/**
 * The file's table: every column the roster has something to show in — not
 * only the three a narrow list has room for — for the rows given, in the
 * order given.
 */
export function rosterExportTable(
  rows: readonly MtmDashboardAgent[],
  available: readonly RosterColumnId[],
  words: RosterExportWords,
): RosterExportTable {
  const columns = ROSTER_COLUMNS.filter((column) => available.includes(column))
  return {
    headers: columns.map((column) => words.column(column)),
    rows: rows.map((agent) => columns.map((column) => rosterCellText(agent, column, words))),
  }
}

/** `mtm-live-map-2026-10-09-1421`: the organization's date and clock, ASCII only. */
export function rosterExportFileName(today: string | null | undefined, now: Date, timeZone: string | null | undefined): string {
  const date = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : now.toISOString().slice(0, 10)
  let clock = ""
  try {
    clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timeZone || undefined })
      .format(now).replace(/[^0-9]/g, "")
  } catch {
    clock = now.toISOString().slice(11, 16).replace(":", "")
  }
  return `mtm-live-map-${date}-${clock}`
}
