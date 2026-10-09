"use client"

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref, type RefObject } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Download, Filter, Loader2, Maximize2, Minimize2, PanelRightClose, Printer, SlidersHorizontal, X } from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { FIELD_STATUS_LABEL_KEYS, type MtmDashboardAgent } from "@/lib/mtm-types"
import { rosterExportTable } from "@/lib/mtm/live-map-roster-export"
import { printRosterHtml, rosterPrintHtml } from "@/lib/mtm/live-map-roster-print"
import { liveMapDuration } from "@/lib/mtm/live-map-state-since"
import {
  activeRosterFilterColumns,
  availableRosterColumns,
  groupRoster,
  ROSTER_GROUPINGS,
  ROSTER_LOCKED_COLUMNS,
  ROSTER_NARROW_COLUMNS,
  ROSTER_NARROW_COLUMNS_WITH_POINT,
  ROSTER_NO_MANAGER,
  ROSTER_NO_TEAM,
  rosterFilterOptions,
  rosterFilterTicked,
  rosterSignalAge,
  rosterTickState,
  rosterValue,
  tickRosterFilterValue,
  withRosterFilter,
  type RosterColumnFilter,
  type RosterColumnId,
  type RosterFilters,
  type RosterGroupBy,
  type RosterView,
} from "@/lib/mtm/live-map-roster"
import {
  LiveMapRosterColumnMenu,
  ROSTER_ACTION_TEXT,
  type RosterColumnMenuOption,
  type RosterMenuPlacement,
  type RosterSortKind,
} from "@/components/mtm/live-map-roster-column-menu"

/** The dot of a status — the same colour on the row, in the filter list and on the chip above the map. */
export const ROSTER_STATUS_DOT_CLASS: Record<string, string> = {
  CHECKED_IN: "bg-green-500",
  ON_ROAD: "bg-blue-500",
  STOPPED: "bg-amber-500",
  ROUTE_FINISHED: "bg-emerald-700",
  LATE: "bg-red-500",
  OFFLINE: "bg-muted-foreground/50",
}

const STATUS_LABEL_KEYS: Record<string, string> = FIELD_STATUS_LABEL_KEYS

const SORT_KIND: Record<RosterColumnId, RosterSortKind> = {
  name: "text", status: "order", signal: "time", distance: "number", team: "text", manager: "text", app: "order", workday: "order", route: "number", speed: "number", battery: "number",
}

/**
 * Column widths of the wide table. Text columns share what is left; the short
 * ones are fixed so a number never gets the room a name needs.
 */
const WIDE_TRACK: Record<RosterColumnId, string> = {
  name: "minmax(0,1.6fr)",
  status: "minmax(0,1.2fr)",
  signal: "5rem",
  distance: "7.5rem",
  team: "minmax(0,1.1fr)",
  manager: "minmax(0,1.1fr)",
  app: "minmax(0,0.9fr)",
  workday: "minmax(0,1.2fr)",
  route: "5.5rem",
  speed: "6.25rem",
  battery: "5.75rem",
}
const TICK_TRACK = "2.25rem"
/**
 * Beside the map and on a phone: the tick, the name, the status word, the age
 * of the signal. Name and status share the room by ratio — a fixed status
 * column took its full width first and left a phone five letters of a name.
 */
const NARROW_TRACKS = `${TICK_TRACK} minmax(0,1.4fr) minmax(0,1fr) 5rem`
/** With a point picked the last column is the distance, sorted by default: its heading carries an arrow as well. */
const NARROW_TRACKS_WITH_POINT = `${TICK_TRACK} minmax(0,1.4fr) minmax(0,1fr) 6.5rem`

/**
 * The wide table starts where its default columns have room to be read
 * (`@2xl` = a list 672 px wide): «Таблица» on a large screen, or a tablet with
 * the list under the map. Narrower than that the same rows are the plain list.
 */
const ROW_GRID = "grid items-center [grid-template-columns:var(--roster-narrow)] @2xl:[grid-template-columns:var(--roster-wide)]"
const TICK_BOX = "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded hover:bg-muted [@media(pointer:coarse)]:h-11"
const TICK_INPUT = "h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
const TOOL_BUTTON = "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs font-medium hover:bg-muted dark:border-zinc-700 [@media(pointer:coarse)]:min-h-11"
const MENU_ROW = "flex min-h-9 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-muted/60 [@media(pointer:coarse)]:min-h-11"
/** A row scrolled into view stops under the heading that follows the screen, not behind it. */
const UNDER_HEADING = "scroll-mt-[var(--roster-head,11rem)]"

export interface LiveMapRosterProps {
  /** Everybody the server returned: the value lists of the filters are counted over them. */
  agents: MtmDashboardAgent[]
  /** The same people after the search, the filters and the sort — what the list shows and the map may draw. */
  rows: MtmDashboardAgent[]
  /** The name search. The page owns it: the server narrows the roster by it, so `agents` already is the answer. */
  searchSlot: ReactNode
  filters: RosterFilters
  onFiltersChange: (filters: RosterFilters) => void
  view: RosterView
  onViewChange: (view: RosterView) => void
  onHide: () => void
  /** Put away on a wide screen, where the map takes its place. Under the map on a phone it stays. */
  hiddenOnWide?: boolean
  hiddenAgentIds: ReadonlySet<string>
  onToggleAgentOnMap: (agentId: string) => void
  /** Put these employees on the map, or take them off, in one go. */
  onSetAgentsOnMap: (agentIds: string[], onMap: boolean) => void
  selectedAgentId: string | null
  onSelect: (agentId: string) => void
  /** Set on what opens under the selected row: scrolling it into view shows the row and the day together. */
  selectedDetailRef?: Ref<HTMLDivElement>
  /** What opens under the selected row: the day, the buttons. */
  renderDetail: (agent: MtmDashboardAgent) => ReactNode
  /** The clock the freshness is judged by (anchored to the server's answer). */
  nowMs: number
  workforceEnabled: boolean
  formatClock: (value: string | null | undefined) => string
  /** «22:14», or with the date when it was on an earlier day. */
  formatVisitOpened: (value: string) => string
  /** Whether a moment was on an earlier day than today, in the organization's time zone. */
  isEarlierDay: (value: string) => boolean
  /** «450 m», «7,8 km» — for the distance to the point picked on the map. */
  formatDistance?: (meters: number) => string
  /**
   * The name of the Excel file, without the extension (ASCII). Given — the
   * list offers «Excel»: the rows it shows, in its order, with every column
   * it has. Absent — no button.
   */
  exportFileName?: () => string
  /** The heading of the printed sheet; without it there is no «Печать». */
  printTitle?: () => string
}

/** The list stands beside the map from the `lg` breakpoint; narrower than that it is under it. */
const BESIDE_MAP_QUERY = "(min-width: 1024px)"
/** From here «Таблица» really widens the list — the page's grid and the button use the same width. */
const ROOM_FOR_TABLE_QUERY = "(min-width: 85rem)"
function mediaStore(query: string) {
  const supported = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  return {
    subscribe(onChange: () => void): () => void {
      if (!supported()) return () => {}
      const media = window.matchMedia(query)
      media.addEventListener("change", onChange)
      return () => media.removeEventListener("change", onChange)
    },
    read: () => supported() && window.matchMedia(query).matches,
  }
}
const BESIDE_MAP = mediaStore(BESIDE_MAP_QUERY)
const ROOM_FOR_TABLE = mediaStore(ROOM_FOR_TABLE_QUERY)

/**
 * A filter or a search can leave three rows where there were a hundred. The
 * page stays scrolled where it was, the heading goes on following the screen
 * — and the few rows that are left end up behind it: the list looks empty
 * (seen on production, 2026-10-09). When the heading is away from its place
 * and the end of the list is already on the screen, the top of the list is
 * brought back into view. Somebody reading row sixty of a hundred is not
 * moved: the end of his list is far below.
 */
function bringListBackFromBehindItsHeading(aside: HTMLElement | null, heading: HTMLElement | null): void {
  if (!aside || !heading) return
  const list = aside.getBoundingClientRect()
  const followingTheScreen = heading.getBoundingClientRect().top - list.top > 1
  if (followingTheScreen && list.bottom < window.innerHeight) aside.scrollIntoView?.({ block: "start" })
}

/**
 * The employee list beside the live map as a compact table with a filter in
 * every column heading (owner, 2026-10-09: «список должен быть компактным,
 * завтра будут например 100 пользователей. Нужны фильтры прямо в списке, как
 * в Excel», and of the fleet tracker shown to him as the model: «бери всё,
 * чего у нас нет»).
 *
 * One line per person — tick for the map, name, what he is doing, how old his
 * signal is — where a card used to take three. Beside the map there is room
 * for those columns only; given more width («Таблица», or a tablet) the same
 * rows add team, workday, route, speed and battery, chosen in «Вид». Columns
 * that are not drawn are still filtered and sorted from «Фильтры». The page
 * scrolls as one (owner rule, 2026-09-14): the list grows with the roster and
 * its heading follows the screen instead of the list sitting in a frame of
 * its own.
 */
export function LiveMapRoster({
  agents, rows, searchSlot, filters, onFiltersChange, view, onViewChange, onHide, hiddenOnWide = false,
  hiddenAgentIds, onToggleAgentOnMap, onSetAgentsOnMap, selectedAgentId, onSelect, selectedDetailRef,
  renderDetail, nowMs, workforceEnabled, formatClock, formatVisitOpened, isEarlierDay,
  formatDistance = (meters) => `${Math.round(meters)} m`, exportFileName, printTitle,
}: LiveMapRosterProps) {
  const tMap = useTranslations("mtmMap")
  const locale = useLocale()
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLDivElement | null>(null)

  // The heading's real height, for rows that are scrolled into view under it.
  useEffect(() => {
    const aside = asideRef.current
    const heading = headingRef.current
    if (!aside || !heading || typeof ResizeObserver === "undefined") return
    // Only a heading that follows the screen covers rows. Where it stays in
    // its place — a short screen, or the filters open in the list — a row
    // brought into view needs no room left for it.
    const followsTheScreen = () => getComputedStyle(heading).position === "sticky"
    const measure = () => aside.style.setProperty("--roster-head", followsTheScreen() ? `${Math.ceil(heading.getBoundingClientRect().height)}px` : "0px")
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(heading)
    return () => observer.disconnect()
  }, [])

  // When the list has got shorter, its few rows may be left behind its
  // heading. Not while a menu floats beside the list and holds it steady
  // (below): then nothing moves until the menu is closed.
  const shownRows = rows.length
  const previousRowsRef = useRef(shownRows)
  const steadyRef = useRef(false)
  useEffect(() => {
    const shorter = shownRows < previousRowsRef.current
    previousRowsRef.current = shownRows
    if (shorter && !steadyRef.current) bringListBackFromBehindItsHeading(asideRef.current, headingRef.current)
  }, [shownRows])

  // While a menu floats beside the list, the list keeps the height it had
  // when the menu opened. A filter that leaves three rows of a hundred makes
  // the page shorter, the page settles higher — and the menu, which stands
  // beside the list's heading, jumps from under the cursor: on production,
  // the day the panel shipped, the second press landed on another value. The
  // height is let go when the menu closes, and the list is then brought back
  // from behind its heading if that is where it ended up.
  // The height is held on the table itself, not on the frame around it: the
  // heading follows the screen only inside the table, and a table that shrank
  // inside a frame that did not would let its heading go all the same. And
  // the browser is told not to hold on to a row of it: Chrome keeps a visible
  // row where it was on the screen («scroll anchoring»), and a row that
  // survives the filter moves to the top of the list — the page followed it
  // there, fifteen hundred pixels up, taking the menu along.
  const tableRef = useRef<HTMLDivElement | null>(null)
  const [steadyHeight, setSteadyHeight] = useState<number | null>(null)
  const holdSteady = (open: boolean) => setSteadyHeight(open ? tableRef.current?.offsetHeight || null : null)
  useLayoutEffect(() => {
    const wasSteady = steadyRef.current
    steadyRef.current = steadyHeight != null
    if (wasSteady && steadyHeight == null) bringListBackFromBehindItsHeading(asideRef.current, headingRef.current)
  }, [steadyHeight])

  const available = useMemo(() => availableRosterColumns(agents, { workforceEnabled }), [agents, workforceEnabled])
  // The distance exists only while a point is picked on the map, and then it
  // is what is being asked: it is shown without being chosen, and beside the
  // map it takes the place of the signal's age.
  const hasPoint = available.includes("distance")
  const wideColumns = available.filter((column) => ROSTER_LOCKED_COLUMNS.includes(column) || column === "distance" || view.columns.includes(column))
  const narrowColumns = hasPoint ? ROSTER_NARROW_COLUMNS_WITH_POINT : ROSTER_NARROW_COLUMNS
  const drawnColumns = available.filter((column) => narrowColumns.includes(column) || wideColumns.includes(column))
  // A layout remembered from another organization may name a column this roster does not have.
  const groupBy: RosterGroupBy = view.groupBy === "none" || available.includes(view.groupBy) ? view.groupBy : "none"
  const trackStyle = {
    "--roster-narrow": hasPoint ? NARROW_TRACKS_WITH_POINT : NARROW_TRACKS,
    "--roster-wide": [TICK_TRACK, ...wideColumns.map((column) => WIDE_TRACK[column])].join(" "),
  } as CSSProperties
  /** A column lives in the narrow list, in the wide table, or in both. */
  const columnClass = (column: RosterColumnId) => {
    const narrow = narrowColumns.includes(column)
    const wide = wideColumns.includes(column)
    return narrow && wide ? "" : narrow ? "@2xl:hidden" : "hidden @2xl:block"
  }

  // Names of people and teams, kept for the visit: the name search narrows
  // `agents`, and a filter set on somebody who is no longer in the answer
  // still has to be called by name.
  const knownLabels = useRef({ names: new Map<string, string>(), teams: new Map<string, string>(), managers: new Map<string, string>() })
  for (const agent of agents) {
    knownLabels.current.names.set(agent.agentId, agent.name)
    if (agent.teamId && agent.teamName) knownLabels.current.teams.set(agent.teamId, agent.teamName)
    if (agent.managerId && agent.managerName) knownLabels.current.managers.set(agent.managerId, agent.managerName)
  }
  const valueLabel = (column: RosterColumnId, value: string): string => {
    switch (column) {
      case "name": return knownLabels.current.names.get(value) ?? tMap("roster.filter.unknownValue")
      case "status": return tMap(`fieldStatus.${STATUS_LABEL_KEYS[value] ?? STATUS_LABEL_KEYS.OFFLINE}`)
      case "signal": return tMap(`freshness.${value.toLowerCase()}`)
      case "team": return value === ROSTER_NO_TEAM ? tMap("roster.noTeam") : knownLabels.current.teams.get(value) ?? tMap("roster.filter.unknownValue")
      case "manager": return value === ROSTER_NO_MANAGER ? tMap("roster.noManager") : knownLabels.current.managers.get(value) ?? tMap("roster.filter.unknownValue")
      case "app": return tMap(`presence.${value.toLowerCase()}`)
      case "workday": return tMap(`roster.workday.${value}`)
      case "route": return tMap(`roster.route.${value}`)
      case "speed": return tMap(`roster.speed.${value}`)
      case "battery": return tMap(`roster.battery.${value}`)
      case "distance": return tMap(`roster.distance.${value}`)
    }
  }
  const columnLabel = (column: RosterColumnId) => tMap(`roster.columns.${column}`)

  const options = useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true })
    const byColumn = {} as Record<RosterColumnId, RosterColumnMenuOption[]>
    for (const column of available) {
      const list = rosterFilterOptions(agents, filters, column).map((option) => ({
        ...option,
        label: valueLabel(column, option.value),
        dotClass: column === "status" ? ROSTER_STATUS_DOT_CLASS[option.value] : undefined,
      }))
      // Names, teams and managers have no order of their own: alphabetical, «no team», «no manager» last.
      if (column === "name" || column === "team" || column === "manager") {
        const nobody = column === "manager" ? ROSTER_NO_MANAGER : ROSTER_NO_TEAM
        list.sort((a, b) => (a.value === nobody ? 1 : 0) - (b.value === nobody ? 1 : 0)
          // Namesakes keep one order from refresh to refresh.
          || collator.compare(a.label, b.label) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
      }
      byColumn[column] = list
    }
    return byColumn
    // `valueLabel` reads the messages and the labels gathered from `agents`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, filters, available, locale, tMap])

  const groups = useMemo(() => groupRoster(rows, groupBy, locale, agents), [rows, groupBy, locale, agents])
  const rowIds = useMemo(() => rows.map((agent) => agent.agentId), [rows])
  const tick = rosterTickState(rowIds, hiddenAgentIds)
  const filteredColumns = activeRosterFilterColumns(filters)

  const setFilter = (column: RosterColumnId, filter: RosterColumnFilter | undefined) => onFiltersChange(withRosterFilter(filters, column, filter))
  /** A filter in words — «В пути, Стоит» — with its column's name in front for a chip. */
  const filterValuesText = (column: RosterColumnId): string => {
    const filter = filters[column]
    if (!filter) return ""
    const shown = filter.values.slice(0, 2).map((value) => valueLabel(column, value)).join(", ")
    return filter.values.length > 2 ? `${shown}, ${tMap("roster.filter.more", { count: filter.values.length - 2 })}` : shown
  }
  // Beside the map the list is narrow, and a menu dropped over it hides the
  // rows it filters: there the menus open to the left, over the map, next to
  // the list's heading. «Фильтры» does so in the wide table as well — it is
  // wide enough to cover half of it. A column's menu in the wide table drops
  // under its own heading, as a spreadsheet's does. Under the map (a phone)
  // «Фильтры» opens in the list itself, above the rows: nothing is covered
  // and nothing scrolls inside.
  const besideMap = useSyncExternalStore(BESIDE_MAP.subscribe, BESIDE_MAP.read, () => false)
  const roomForTable = useSyncExternalStore(ROOM_FOR_TABLE.subscribe, ROOM_FOR_TABLE.read, () => false)
  const tableShown = view.width === "wide" && roomForTable
  const menuPlacement: RosterMenuPlacement = besideMap && !tableShown && !hiddenOnWide
    ? { side: "left", anchor: headingRef }
    : { side: "bottom", anchor: null }
  const filtersFloat = besideMap && !hiddenOnWide
  // The list put away on a wide screen takes its open filters with it: they
  // must not open by themselves over the map when the list comes back.
  const listPutAway = besideMap && hiddenOnWide
  const [wasPutAway, setWasPutAway] = useState(listPutAway)
  if (wasPutAway !== listPutAway) {
    setWasPutAway(listPutAway)
    if (listPutAway) {
      setFiltersOpen(false)
      setSteadyHeight(null)
    }
  }
  /** «Фильтры» open in the list itself (under the map), not floating beside it. */
  const filtersInList = filtersOpen && !filtersFloat
  const filtersButtonRef = useRef<HTMLButtonElement | null>(null)
  const closedByDoneRef = useRef(false)
  // The panel opens inside the heading, and a heading that holds it stops
  // following the screen (it can be taller than the screen). Pressed from a
  // list scrolled to row forty, «Фильтры» would open two thousand pixels
  // above — the bar just pressed gone, nothing in its place. So the top of
  // the list is brought into view with it. «Готово» stands at the foot of a
  // panel up to two screens tall: with the panel gone the page would stay
  // scrolled past a short list, so it brings the list back as well and hands
  // the focus to «Фильтры». The button itself, pressed again, moves nothing.
  useLayoutEffect(() => {
    if (filtersInList) {
      asideRef.current?.scrollIntoView?.({ block: "start" })
      return
    }
    if (!closedByDoneRef.current) return
    closedByDoneRef.current = false
    asideRef.current?.scrollIntoView?.({ block: "start" })
    filtersButtonRef.current?.focus({ preventScroll: true })
  }, [filtersInList])
  const filterSummary = (column: RosterColumnId) => tMap("roster.filter.chip", { column: columnLabel(column), values: filterValuesText(column) })
  const menuProps = (column: RosterColumnId) => ({
    column,
    label: columnLabel(column),
    options: options[column] ?? [],
    filter: filters[column],
    onFilterChange: (filter: RosterColumnFilter | undefined) => setFilter(column, filter),
    sortDirection: view.sort.column === column ? view.sort.direction : null,
    sortKind: SORT_KIND[column],
    onSort: (direction: "asc" | "desc") => onViewChange({ ...view, sort: { column, direction } }),
    showCounts: column !== "name",
    placement: menuPlacement,
    onOpenChange: holdSteady,
  })
  const filtersButton = (
    <button
      ref={filtersButtonRef}
      type="button"
      data-testid="live-map-roster-filters-button"
      aria-expanded={filtersOpen}
      onClick={filtersFloat ? undefined : () => setFiltersOpen((open) => !open)}
      className={cn(TOOL_BUTTON, (filteredColumns.length > 0 || filtersOpen) && "border-primary/50 bg-primary/5")}
    >
      <Filter className={cn("h-3.5 w-3.5", filteredColumns.length > 0 && "fill-current")} aria-hidden="true" />{tMap("roster.filters")}
      {filteredColumns.length > 0 ? <span className="tabular-nums">· {filteredColumns.length}</span> : null}
    </button>
  )
  /** The panel of «Фильтры»: the same in the floating menu and in the list itself. */
  const filtersPanel = (gridClass: string, bodyClass: string) => (
    <>
      {/* As tall with «Сбросить фильтры» in it as without: a value pressed must
          not move the values under the cursor. */}
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700 [@media(pointer:coarse)]:min-h-[3.75rem]">
        <span className="text-sm font-semibold">{tMap("roster.filters")}</span>
        <span role="status" className="text-xs tabular-nums text-muted-foreground" data-testid="live-map-roster-filters-count">
          {tMap("roster.shownCount", { shown: rows.length, total: agents.length })}
        </span>
        {filteredColumns.length > 0 ? (
          <button type="button" onClick={() => onFiltersChange({})} data-testid="live-map-roster-filters-menu-reset" className="ml-auto inline-flex min-h-8 items-center rounded-md border border-zinc-200 px-2 text-xs font-semibold hover:bg-muted dark:border-zinc-700 [@media(pointer:coarse)]:min-h-11">
            {tMap("roster.filter.resetAll")}
          </button>
        ) : null}
      </div>
      <p className="shrink-0 px-3 pt-2 text-[11px] text-muted-foreground">{tMap("roster.filter.hint")}</p>
      <div className={cn("grid gap-x-5 px-3 pb-3", gridClass, bodyClass)}>
        {available.filter((column) => column !== "name").map((column) => (
          <div key={column} role="group" aria-label={columnLabel(column)} className="min-w-0 pt-2.5" data-testid={`live-map-roster-filters-group-${column}`}>
            <div className={cn("text-[11px] font-semibold uppercase tracking-wide", filters[column] ? ROSTER_ACTION_TEXT : "text-muted-foreground")} data-testid={`live-map-roster-filters-title-${column}`}>{columnLabel(column)}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(options[column] ?? []).map((option) => {
                const on = rosterFilterTicked(filters[column], option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(column, tickRosterFilterValue(filters[column], option.value))}
                    data-testid={`live-map-roster-filters-value-${column}-${option.value}`}
                    className={cn(
                      "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors [@media(pointer:coarse)]:min-h-11",
                      on ? "border-primary bg-primary/10 font-semibold text-foreground" : "border-zinc-300 hover:bg-muted dark:border-zinc-600",
                      option.count === 0 && !on && "text-muted-foreground",
                    )}
                  >
                    {on
                      ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      : option.dotClass ? <span className={cn("h-2 w-2 shrink-0 rounded-full", option.dotClass)} aria-hidden="true" /> : null}
                    <span className="min-w-0 truncate">{option.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{option.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
  const toggleGroup = (groupId: string, memberIds: string[], shownCollapsed: boolean) => {
    // Folding away the group the selected employee is in lets go of him: his
    // day cannot stay open inside a closed group.
    if (!shownCollapsed && selectedAgentId != null && memberIds.includes(selectedAgentId)) onSelect(selectedAgentId)
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (shownCollapsed) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // The file is the list as it stands: the rows left by the filters, group by
  // group in the order on screen, with every column the roster has — not only
  // the three a narrow list draws. The server only turns the words into a
  // workbook (see the export route for why it is built here).
  /** The list as a table of words — one table for the file and for the printed sheet, so the two cannot differ. */
  const exportTable = () => rosterExportTable(groups.flatMap((group) => group.agents), available, {
    column: columnLabel,
    status: (status) => valueLabel("status", status),
    freshness: (freshness) => tMap(`freshness.${freshness.toLowerCase()}`),
    presence: (online) => tMap(`presence.${online ? "online" : "offline"}`),
    workday: (state) => tMap(`roster.workday.${state}`),
    routeProgress: (done, total) => tMap("routeStop.progress", { done, total }),
    speed: (kmh) => tMap("roster.kmh", { value: kmh }),
    distance: formatDistance,
    clock: (iso) => formatClock(iso),
    dateTime: formatVisitOpened,
    visitOpened: (time) => tMap("visitOpenedAt", { time }),
    standingSince: (time) => tMap("roster.standingSince", { time }),
  })
  const printList = () => {
    if (!printTitle) return
    printRosterHtml(rosterPrintHtml({
      lang: locale,
      title: printTitle(),
      subtitle: tMap("roster.shownCount", { shown: rows.length, total: agents.length }),
      table: exportTable(),
    }))
  }
  const downloadExcel = async () => {
    if (!exportFileName || exporting === "busy") return
    setExporting("busy")
    try {
      const table = exportTable()
      const response = await fetch("/api/v1/mtm/locations/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName: tMap("agents").slice(0, 31), fileName: exportFileName(), ...table }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = `${exportFileName()}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setExporting("idle")
    } catch {
      setExporting("failed")
    }
  }

  const cell = (agent: MtmDashboardAgent, column: RosterColumnId): ReactNode => {
    switch (column) {
      case "name": {
        const hiddenOnMap = hiddenAgentIds.has(agent.agentId)
        const presence = `${tMap("appPresence")}: ${tMap(`presence.${agent.isOnline ? "online" : "offline"}`)}`
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            {/* The application: a filled dot in the network, a ring out of it — a shape, not only a colour. */}
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", agent.isOnline ? "bg-green-500" : "border border-zinc-400 dark:border-zinc-500")}
              title={presence}
              aria-hidden="true"
            />
            {/* The row is the hit area; the button gives it a name and a keyboard. */}
            <button
              type="button"
              aria-pressed={selectedAgentId === agent.agentId}
              aria-label={tMap("selectEmployee", { name: agent.name })}
              title={hiddenOnMap ? `${agent.name} — ${tMap("layers.hiddenBadge")}` : agent.name}
              className={cn("min-w-0 truncate rounded text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", UNDER_HEADING, hiddenOnMap && "text-muted-foreground")}
            >
              {agent.name}
            </button>
            <span className="sr-only">{presence}</span>
          </span>
        )
      }
      case "status": {
        const status = rosterValue(agent, "status")
        const openedAt = status === "CHECKED_IN" && agent.openVisitSince ? agent.openVisitSince : null
        const since = openedAt ? formatVisitOpened(openedAt) : ""
        // A visit left open since an earlier day is the anomaly a dispatcher
        // has to see on the row itself, even where the time does not fit.
        const stale = openedAt != null && isEarlierDay(openedAt)
        const label = valueLabel("status", status)
        // «Стоит · 40 мин»: how long, not since when — the question a
        // dispatcher asks of somebody standing («давно он там?»).
        const standing = status === "STOPPED" ? liveMapDuration(agent.stationarySince, nowMs) : null
        const standingText = standing ? tMap(`since.duration.${standing.unit}`, { ...standing }) : ""
        const title = since
          ? `${label} — ${tMap("visitOpenedAt", { time: since })}`
          : standing && agent.stationarySince
            ? tMap("since.STANDING", { time: formatVisitOpened(agent.stationarySince) })
            : label
        return (
          <span className="flex min-w-0 items-center gap-1.5" data-testid={`live-map-agent-status-${agent.agentId}`} title={title}>
            <span className={cn("h-2 w-2 shrink-0 rounded-full", ROSTER_STATUS_DOT_CLASS[status])} aria-hidden="true" />
            <span className="min-w-0 truncate">{label}{since ? <span className="hidden text-muted-foreground @2xl:inline"> · {since}</span> : null}{standingText ? <span className="hidden text-muted-foreground @2xl:inline" data-testid={`live-map-agent-standing-${agent.agentId}`}> · {standingText}</span> : null}</span>
            {stale ? (
              <span className="shrink-0 @2xl:hidden" data-testid={`live-map-agent-visit-stale-${agent.agentId}`}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <span className="sr-only">{tMap("visitOpenedAt", { time: since })}</span>
              </span>
            ) : null}
          </span>
        )
      }
      case "signal": {
        const age = rosterSignalAge(agent.recordedAt, nowMs)
        const tone = agent.freshness === "ONLINE"
          ? "font-medium text-blue-700 dark:text-blue-400"
          : agent.freshness === "DELAYED" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"
        const freshness = tMap(`freshness.${agent.freshness.toLowerCase()}`)
        return (
          <span className={cn("block truncate tabular-nums", tone)} title={agent.recordedAt ? `${tMap("gpsFreshness")}: ${freshness} · ${formatClock(agent.recordedAt)}` : `${tMap("gpsFreshness")}: ${freshness}`}>
            {age.unit === "none" ? "—" : age.unit === "now" ? tMap("roster.age.now") : tMap(`roster.age.${age.unit}`, { count: age.count })}
            <span className="sr-only"> · {freshness}</span>
          </span>
        )
      }
      case "team": return <span className="block truncate" title={agent.teamName ?? undefined}>{agent.teamId ? agent.teamName || "—" : "—"}</span>
      case "manager": return <span className="block truncate" title={agent.managerName ?? undefined}>{agent.managerId ? agent.managerName || "—" : "—"}</span>
      case "app": return <span className={cn("block truncate", agent.isOnline ? "text-green-700 dark:text-green-400" : "text-muted-foreground")}>{tMap(`presence.${agent.isOnline ? "online" : "offline"}`)}</span>
      case "workday": {
        const running = agent.workdayState === "ACTIVE" || agent.workdayState === "PAUSED"
        const tone = agent.workdayState === "ACTIVE" ? "text-emerald-700 dark:text-emerald-400" : agent.workdayState === "PAUSED" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
        // A shift carried over from an earlier day says its date: «22:14» alone would read as today.
        const started = running && agent.workdayStartedAt
          ? (agent.workdayCarryover ? formatVisitOpened(agent.workdayStartedAt) : formatClock(agent.workdayStartedAt))
          : ""
        return (
          <span className={cn("block truncate", tone)} title={`${tMap(`workday.${agent.workdayState.toLowerCase()}`)}${started ? ` · ${started}` : ""}`}>
            {tMap(`roster.workday.${agent.workdayState}`)}{started ? ` · ${started}` : ""}
          </span>
        )
      }
      case "route":
        return (agent.routeTotal ?? 0) > 0
          ? <span className="block truncate tabular-nums" data-testid={`live-map-agent-progress-${agent.agentId}`}>{tMap("routeStop.progress", { done: agent.routeVisited ?? 0, total: agent.routeTotal ?? 0 })}</span>
          : <span className="text-muted-foreground">—</span>
      case "speed":
        return typeof agent.speed === "number" && Number.isFinite(agent.speed)
          ? <span className="block truncate tabular-nums">{tMap("roster.kmh", { value: Math.round(agent.speed) })}</span>
          : <span className="text-muted-foreground">—</span>
      case "battery":
        return typeof agent.battery === "number" && Number.isFinite(agent.battery)
          ? <span className={cn("block truncate tabular-nums", agent.battery < 20 && "font-medium text-red-600 dark:text-red-400")}>{Math.round(agent.battery)}%</span>
          : <span className="text-muted-foreground">—</span>
      case "distance": {
        if (typeof agent.distanceMeters !== "number" || !Number.isFinite(agent.distanceMeters)) {
          return <span className="text-muted-foreground" title={tMap("roster.distance.UNKNOWN")}>—</span>
        }
        // Beside the map the distance stands where the signal's age stood, so it
        // carries the signal's truth: measured from a delayed coordinate, it
        // looks delayed and says from when.
        const freshness = tMap(`freshness.${agent.freshness.toLowerCase()}`)
        return (
          <span
            className={cn("block truncate tabular-nums font-medium", agent.freshness === "DELAYED" && "text-amber-700 dark:text-amber-300")}
            title={agent.recordedAt ? `${tMap("gpsFreshness")}: ${freshness} · ${formatClock(agent.recordedAt)}` : `${tMap("gpsFreshness")}: ${freshness}`}
            data-testid={`live-map-agent-distance-${agent.agentId}`}
          >
            {formatDistance(agent.distanceMeters)}
            <span className="sr-only"> · {freshness}</span>
          </span>
        )
      }
    }
  }

  return (
    <aside
      ref={asideRef}
      data-testid="live-map-roster"
      data-width={view.width}
      style={trackStyle}
      className={cn("@container order-2 min-w-0 scroll-mt-3 rounded-lg border border-zinc-200 bg-card text-[13px] sm:scroll-mt-4 lg:scroll-mt-8 dark:border-zinc-700", hiddenOnWide && "lg:hidden")}
    >
      <div ref={tableRef} role="table" aria-label={tMap("agents")} data-testid="live-map-roster-table" style={steadyHeight ? { minHeight: steadyHeight, overflowAnchor: "none" } : undefined}>
      {/* The heading follows the screen while the page scrolls: with a hundred
          rows below, the search and the filters are still where they were. The
          negative offsets are the page's own padding (`p-3 sm:p-4 lg:p-8` on
          <main>): a sticky block rests at the padding's inner edge, and rows
          would show through the band above it. Not on a screen too short to
          spare the room. */}
      <div ref={headingRef} role="none" data-testid="live-map-roster-heading" className={cn(
          "-top-3 z-20 rounded-t-lg border-b border-zinc-200 bg-card sm:-top-4 lg:-top-8 dark:border-zinc-700",
          // With the filters open in it the heading can be taller than the screen: then it stays in its place.
          !filtersInList && "[@media(min-height:600px)]:sticky",
        )}>
        <div role="caption">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">{tMap("agents")}</h4>
          <span role="status" className="text-xs tabular-nums text-muted-foreground" data-testid="live-map-roster-count">
            {tMap("roster.shownCount", { shown: rows.length, total: agents.length })}
          </span>
          {/* The list's own tools keep to the right edge together. */}
          <div className="ml-auto flex items-center gap-1.5">
            {/* The list as a file: what is shown, in this order. A word on it, not an arrow alone. */}
            {exportFileName ? (
              <button
                type="button"
                onClick={() => { void downloadExcel() }}
                disabled={exporting === "busy" || rows.length === 0}
                title={tMap("roster.export.hint")}
                aria-label={tMap("roster.export.hint")}
                data-testid="live-map-roster-export"
                className={cn(TOOL_BUTTON, "disabled:opacity-50")}
              >
                {exporting === "busy"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                {tMap("roster.export.button")}
              </button>
            ) : null}
            {/* The same rows on paper, for the morning briefing. */}
            {printTitle ? (
              <button
                type="button"
                onClick={printList}
                disabled={rows.length === 0}
                title={tMap("roster.print.hint")}
                aria-label={tMap("roster.print.hint")}
                data-testid="live-map-roster-print"
                className={cn(TOOL_BUTTON, "disabled:opacity-50")}
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />{tMap("roster.print.button")}
              </button>
            ) : null}
            {/* Only where the list stands beside the map, and the screen is wide
                enough for a table next to a usable map, is there a width to choose. */}
            <button
              type="button"
              onClick={() => onViewChange({ ...view, width: view.width === "wide" ? "narrow" : "wide" })}
              data-testid="live-map-roster-width"
              className={cn(TOOL_BUTTON, "ml-auto hidden min-[85rem]:inline-flex")}
            >
              {view.width === "wide"
                ? <><Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />{tMap("roster.narrow")}</>
                : <><Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />{tMap("roster.wide")}</>}
            </button>
          </div>
        </div>
        {exporting === "failed" ? (
          <div role="status" className="px-3 pt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="live-map-roster-export-failed">{tMap("roster.export.failed")}</div>
        ) : null}
        <div className="flex items-center gap-1.5 px-3 pt-2">
          <div className="min-w-0 flex-1">{searchSlot}</div>
          {/* Every filter in one place and at one level: each column a row of
              values to press — pressed means «show these». Also the columns
              this width has no room to draw. */}
          {filtersFloat ? (
            <Popover open={filtersOpen} onOpenChange={(open) => { holdSteady(open); setFiltersOpen(open) }}>
              <PopoverTrigger asChild>{filtersButton}</PopoverTrigger>
              {/* After the trigger, not before it: the trigger names itself the
                  anchor when it mounts, and the last one to speak is the one
                  the panel stands beside. */}
              <PopoverAnchor virtualRef={headingRef as RefObject<HTMLElement>} />
              <PopoverContent
                side="left"
                align="start"
                sideOffset={8}
                collisionPadding={8}
                aria-label={tMap("roster.filters")}
                // Never wider than the room there is to the left of the list:
                // in «Таблица» with the menu folded the list starts early.
                className="flex max-h-[var(--radix-popover-content-available-height)] w-[34rem] max-w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width))] flex-col p-0"
                data-testid="live-map-roster-filters-menu"
              >
                {filtersPanel("grid-cols-2", "min-h-0 flex-1 overflow-y-auto")}
              </PopoverContent>
            </Popover>
          ) : filtersButton}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" data-testid="live-map-roster-view" className={TOOL_BUTTON}>
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />{tMap("roster.view")}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" collisionPadding={8} aria-label={tMap("roster.view")} className="max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-0" data-testid="live-map-roster-view-menu">
              <fieldset className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                <legend className="px-1 text-[11px] font-semibold uppercase text-muted-foreground">{tMap("roster.groupBy")}</legend>
                {ROSTER_GROUPINGS.filter((option) => option === "none" || available.includes(option)).map((option) => (
                  <label key={option} className={MENU_ROW}>
                    <input
                      type="radio"
                      name="live-map-roster-group"
                      checked={groupBy === option}
                      onChange={() => onViewChange({ ...view, groupBy: option })}
                      data-testid={`live-map-roster-group-${option}`}
                      className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                    />
                    {tMap(`roster.grouping.${option}`)}
                  </label>
                ))}
              </fieldset>
              {/* The order of the list — by any column, also the ones this width
                  has no room to draw a heading for. */}
              <fieldset className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                <legend className="px-1 text-[11px] font-semibold uppercase text-muted-foreground">{tMap("roster.sortBy")}</legend>
                <select
                  value={view.sort.column}
                  onChange={(event) => onViewChange({ ...view, sort: { column: event.target.value as RosterColumnId, direction: view.sort.direction } })}
                  aria-label={tMap("roster.sortBy")}
                  data-testid="live-map-roster-sort-column"
                  className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-background px-2 text-sm dark:border-zinc-700 [@media(pointer:coarse)]:h-11"
                >
                  {(available.includes(view.sort.column) ? available : [view.sort.column, ...available]).map((column) => (
                    <option key={column} value={column}>{columnLabel(column)}</option>
                  ))}
                </select>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {(["asc", "desc"] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      aria-pressed={view.sort.direction === direction}
                      onClick={() => onViewChange({ ...view, sort: { column: view.sort.column, direction } })}
                      data-testid={`live-map-roster-sort-${direction}`}
                      className={cn(
                        "inline-flex min-h-9 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-11",
                        view.sort.direction === direction ? "border-primary bg-primary/10" : "border-zinc-200 hover:bg-muted dark:border-zinc-700",
                      )}
                    >
                      {tMap(`roster.sort.${SORT_KIND[view.sort.column]}.${direction}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                <legend className="px-1 text-[11px] font-semibold uppercase text-muted-foreground">{tMap("roster.columnsTitle")}</legend>
                <p className="px-1 pb-1 text-[11px] text-muted-foreground">{tMap("roster.columnsHint")}</p>
                <div className="grid grid-cols-2 gap-x-2">
                {available.filter((column) => column !== "distance").map((column) => (
                  <label key={column} className={MENU_ROW}>
                    <input
                      type="checkbox"
                      checked={wideColumns.includes(column)}
                      disabled={ROSTER_LOCKED_COLUMNS.includes(column)}
                      onChange={() => onViewChange({
                        ...view,
                        columns: view.columns.includes(column) ? view.columns.filter((entry) => entry !== column) : [...view.columns, column],
                      })}
                      data-testid={`live-map-roster-column-toggle-${column}`}
                      className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))] disabled:cursor-default disabled:opacity-60"
                    />
                    <span className="min-w-0 truncate">{columnLabel(column)}</span>
                  </label>
                ))}
                </div>
              </fieldset>
              {/* Putting the list away gives the map its width — only where they stand side by side. */}
              <div className="hidden p-2 lg:block">
                <button type="button" onClick={onHide} data-testid="live-map-roster-hide" className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 text-xs font-semibold hover:bg-muted dark:border-zinc-700">
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />{tMap("roster.hide")}
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {/* Under the map «Фильтры» opens here, in the list: the rows move down
            instead of being covered, and the page scrolls as one — no frame
            with a scrollbar of its own. */}
        {filtersInList ? (
          <div role="region" aria-label={tMap("roster.filters")} className="mx-3 mt-2 rounded-lg border border-zinc-200 bg-muted/30 dark:border-zinc-700" data-testid="live-map-roster-filters-menu">
            {filtersPanel("grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4", "")}
            <div className="border-t border-zinc-200 p-2 dark:border-zinc-700">
              <button type="button" onClick={() => { closedByDoneRef.current = true; setFiltersOpen(false) }} data-testid="live-map-roster-filters-done" className="inline-flex min-h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 [@media(pointer:coarse)]:min-h-11">
                {tMap("roster.filter.done", { shown: rows.length, total: agents.length })}
              </button>
            </div>
          </div>
        ) : null}
        {/* Who is on the map: all of the list, nobody, or the ones ticked below. */}
        <div className="flex flex-wrap items-center gap-x-3 px-3 pt-1 text-[11px]" data-testid="live-map-on-map-bar">
          <span className="text-muted-foreground">{tMap("layers.onMapCount", { shown: tick.onMap, total: tick.total })}</span>
          <button type="button" data-testid="live-map-on-map-all" onClick={() => onSetAgentsOnMap(rowIds, true)} className={cn("inline-flex min-h-8 items-center font-semibold underline-offset-2 hover:underline", ROSTER_ACTION_TEXT)}>
            {tMap("layers.selectAll")}
          </button>
          <button type="button" data-testid="live-map-on-map-none" onClick={() => onSetAgentsOnMap(rowIds, false)} className={cn("inline-flex min-h-8 items-center font-semibold underline-offset-2 hover:underline", ROSTER_ACTION_TEXT)}>
            {tMap("layers.selectNone")}
          </button>
          <span className="ml-auto text-muted-foreground">{tMap("selectForDetails")}</span>
        </div>
        {filteredColumns.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 px-3 pb-1" data-testid="live-map-roster-filters">
            {filteredColumns.map((column) => (
              <span key={column} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/5 py-0.5 pl-2 pr-0.5 text-[11px] font-medium" data-testid={`live-map-roster-filter-chip-${column}`}>
                <span className="min-w-0 truncate">{filterSummary(column)}</span>
                <button type="button" onClick={() => setFilter(column, undefined)} aria-label={tMap("roster.filter.remove", { column: columnLabel(column) })} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-primary/15 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9">
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            <button type="button" onClick={() => onFiltersChange({})} data-testid="live-map-roster-filters-reset" className={cn("inline-flex min-h-7 items-center px-1 text-[11px] font-semibold underline-offset-2 hover:underline", ROSTER_ACTION_TEXT)}>
              {tMap("roster.filter.resetAll")}
            </button>
          </div>
        ) : null}
        </div>
        <div role="row" className={cn(ROW_GRID, "border-t border-zinc-200 bg-muted/40 dark:border-zinc-700")}>
          <div role="columnheader" className="flex justify-center">
            <label className={TICK_BOX} title={tMap("roster.masterTick")}>
              <input
                type="checkbox"
                checked={tick.state === "all"}
                ref={(element) => { if (element) element.indeterminate = tick.state === "some" }}
                disabled={rowIds.length === 0}
                onChange={() => onSetAgentsOnMap(rowIds, tick.state !== "all")}
                aria-label={tMap("roster.masterTick")}
                data-testid="live-map-roster-master-tick"
                className={TICK_INPUT}
              />
            </label>
          </div>
          {drawnColumns.map((column) => (
            <div
              key={column}
              role="columnheader"
              aria-sort={view.sort.column === column ? (view.sort.direction === "asc" ? "ascending" : "descending") : "none"}
              className={cn("min-w-0", columnClass(column))}
            >
              <LiveMapRosterColumnMenu {...menuProps(column)} />
            </div>
          ))}
        </div>
      </div>

      <div role="rowgroup" data-testid="mtm-map-agent-list">
        {rows.length === 0 ? (
          <div role="row"><div role="cell" className="px-3 py-8 text-center text-xs text-muted-foreground">
            <div>{tMap("noAgentsMatch")}</div>
            {filteredColumns.length > 0 ? (
              <button type="button" onClick={() => onFiltersChange({})} data-testid="live-map-roster-empty-reset" className="mt-2 inline-flex min-h-9 items-center rounded-md border border-zinc-300 px-3 font-semibold text-foreground hover:bg-muted dark:border-zinc-600">
                {tMap("roster.filter.resetAll")}
              </button>
            ) : null}
          </div></div>
        ) : groups.map((group) => {
          const groupId = `${groupBy}:${group.key}`
          const grouped = groupBy !== "none"
          const memberIds = group.agents.map((agent) => agent.agentId)
          // A group never hides the person a click on the map has just selected.
          const collapsed = grouped && collapsedGroups.has(groupId) && !(selectedAgentId != null && memberIds.includes(selectedAgentId))
          const groupTick = grouped ? rosterTickState(memberIds, hiddenAgentIds) : null
          const label = grouped ? valueLabel(groupBy as RosterColumnId, group.key) : ""
          return (
            <Fragment key={groupId}>
              {grouped && groupTick ? (
                <div role="row" data-testid={`live-map-roster-group-row-${group.key}`} className="border-b border-zinc-200 bg-muted/60 text-xs font-semibold dark:border-zinc-700">
                  <div role="cell" className="flex items-center">
                  <label className={cn(TICK_BOX, "shrink-0")} title={tMap("roster.groupTick", { name: label })}>
                    <input
                      type="checkbox"
                      checked={groupTick.state === "all"}
                      ref={(element) => { if (element) element.indeterminate = groupTick.state === "some" }}
                      onChange={() => onSetAgentsOnMap(memberIds, groupTick.state !== "all")}
                      aria-label={tMap("roster.groupTick", { name: label })}
                      className={cn(TICK_INPUT, UNDER_HEADING)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    aria-label={tMap(collapsed ? "roster.expandGroup" : "roster.collapseGroup", { name: label })}
                    onClick={() => toggleGroup(groupId, memberIds, collapsed)}
                    className={cn("flex min-h-9 min-w-0 flex-1 items-center gap-1.5 pr-3 text-left [@media(pointer:coarse)]:min-h-11", UNDER_HEADING)}
                  >
                    {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    {groupBy === "status" ? <span className={cn("h-2 w-2 shrink-0 rounded-full", ROSTER_STATUS_DOT_CLASS[group.key])} aria-hidden="true" /> : null}
                    <span className="min-w-0 truncate">{label}</span>
                    <span className="ml-auto shrink-0 font-normal tabular-nums text-muted-foreground">{groupTick.onMap} / {groupTick.total}</span>
                  </button>
                  </div>
                </div>
              ) : null}
              {collapsed ? null : group.agents.map((agent) => {
                const isSelected = selectedAgentId === agent.agentId
                return (
                  <Fragment key={agent.agentId}>
                    <div
                      role="row"
                      data-testid={`live-map-agent-card-${agent.agentId}`}
                      data-selected={isSelected ? "true" : "false"}
                      onClick={() => onSelect(agent.agentId)}
                      className={cn(
                        ROW_GRID,
                        "min-h-9 cursor-pointer border-b border-zinc-100 transition-colors hover:bg-muted/50 dark:border-zinc-800 [@media(pointer:coarse)]:min-h-11",
                        // Rows far off the screen are not laid out until they come near (a row is 36 px + its line, 44 px on touch).
                        !isSelected && "[contain-intrinsic-size:auto_37px] [content-visibility:auto] [@media(pointer:coarse)]:[contain-intrinsic-size:auto_45px]",
                        isSelected && "border-blue-200 bg-blue-50/80 hover:bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/30 dark:hover:bg-blue-950/30",
                      )}
                    >
                      <div role="cell" className="flex justify-center">
                        {/* «Галочкой выбирать»: tick the employees to see on the map at
                            the same time (owner, 2026-10-09). The tick is not a click on the row. */}
                        <label className={TICK_BOX} title={tMap("layers.agentOnMap", { name: agent.name })} onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={!hiddenAgentIds.has(agent.agentId)}
                            onChange={() => onToggleAgentOnMap(agent.agentId)}
                            aria-label={tMap("layers.agentOnMap", { name: agent.name })}
                            data-testid={`live-map-agent-on-map-${agent.agentId}`}
                            className={cn(TICK_INPUT, UNDER_HEADING)}
                          />
                        </label>
                      </div>
                      {drawnColumns.map((column) => (
                        <div key={column} role="cell" data-column={column} className={cn("min-w-0 px-1", columnClass(column))}>
                          {cell(agent, column)}
                        </div>
                      ))}
                    </div>
                    {isSelected ? (
                      // Brought into view together with the row above it: the
                      // margin is the heading plus that one row.
                      <div ref={selectedDetailRef} role="row" data-testid="live-map-roster-detail-row" className="scroll-mb-2 scroll-mt-[calc(var(--roster-head,11rem)+3rem)] border-b border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
                        <div role="cell" className="p-2">{renderDetail(agent)}</div>
                      </div>
                    ) : null}
                  </Fragment>
                )
              })}
            </Fragment>
          )
        })}
      </div>
      </div>
    </aside>
  )
}
