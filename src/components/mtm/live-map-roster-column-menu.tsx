"use client"

import { useMemo, useState, type RefObject } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ChevronDown, Filter, Search } from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  foldRosterText,
  rosterFilterTicked,
  tickRosterFilterValue,
  type RosterColumnFilter,
  type RosterColumnId,
} from "@/lib/mtm/live-map-roster"

export interface RosterColumnMenuOption {
  value: string
  label: string
  count: number
  /** The status dot the rows use for this value, so the list reads like the table. */
  dotClass?: string
}

/** What «ascending» means for the column, in words: A to Z, newest first, smallest first. */
export type RosterSortKind = "text" | "order" | "time" | "number"

export interface RosterColumnMenuProps {
  column: RosterColumnId
  label: string
  options: RosterColumnMenuOption[]
  filter: RosterColumnFilter | undefined
  onFilterChange: (filter: RosterColumnFilter | undefined) => void
  /** Set when the list is sorted by this column. */
  sortDirection: "asc" | "desc" | null
  sortKind: RosterSortKind
  onSort: (direction: "asc" | "desc") => void
  /** A list of names has one row each: the count would be a column of ones. */
  showCounts?: boolean
}

/** The search over the tick list appears once the list is longer than a glance. */
const SEARCH_FROM_OPTIONS = 9

/** Small words that act: the brand orange is 3.6:1 on white at this size, this shade is 5.2:1. */
export const ROSTER_ACTION_TEXT = "text-orange-700 dark:text-primary"

/**
 * Where a menu of the list opens. Beside the map the list is four hundred
 * pixels wide, and a menu dropped under its own heading covered the very rows
 * it was filtering — nobody could see what a tick did. There it opens to the
 * left of the list, over the map, as the tracking product named as the model
 * does; under the map (a phone) and in the wide table it opens downwards.
 */
export interface RosterMenuPlacement {
  side: "left" | "bottom"
  /** What the menu stands beside when it opens to the left: the list's heading. */
  anchor: RefObject<HTMLElement | null> | null
}

/**
 * The tick list of one column's values with how many rows each gives. A tick
 * means «show these»; nothing ticked is no filter. Every value the column can
 * have is listed, also the ones nobody has right now. A change applies at
 * once — the list and the map beside the menu are the preview.
 */
export function RosterColumnValueList({
  column, options, filter, onFilterChange, showCounts = true,
}: Pick<RosterColumnMenuProps, "column" | "options" | "filter" | "onFilterChange" | "showCounts">) {
  const tMap = useTranslations("mtmMap")
  const [query, setQuery] = useState("")
  const visible = useMemo(() => {
    const folded = foldRosterText(query)
    return folded ? options.filter((option) => foldRosterText(option.label).includes(folded)) : options
  }, [options, query])

  return (
    <>
      {options.length >= SEARCH_FROM_OPTIONS ? (
        <label className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-700">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tMap("roster.filter.search")}
            aria-label={tMap("roster.filter.search")}
            data-testid={`roster-filter-search-${column}`}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      ) : null}
      {/* The one part that may scroll inside the menu: a list of two hundred names. */}
      <ul className="max-h-64 min-h-9 flex-1 overflow-y-auto py-1" data-testid={`roster-filter-values-${column}`}>
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{tMap("roster.filter.nothingFound")}</li>
        ) : visible.map((option) => {
          const ticked = rosterFilterTicked(filter, option.value)
          return (
            <li key={option.value}>
              <label className={cn("flex min-h-9 cursor-pointer items-center gap-2 px-3 text-sm hover:bg-muted/60 [@media(pointer:coarse)]:min-h-11", ticked && "bg-primary/5 font-medium")}>
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={() => onFilterChange(tickRosterFilterValue(filter, option.value))}
                  data-testid={`roster-filter-value-${column}-${option.value}`}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                />
                {option.dotClass ? <span className={cn("h-2 w-2 shrink-0 rounded-full", option.dotClass)} aria-hidden="true" /> : null}
                <span className={cn("min-w-0 flex-1 truncate", option.count === 0 && !ticked && "text-muted-foreground")}>{option.label}</span>
                {showCounts ? <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{option.count}</span> : null}
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * What a column's menu holds: sort one way or the other, and the tick list
 * of the column's values.
 */
export function RosterColumnMenuPanel({
  column, options, filter, onFilterChange, sortDirection, sortKind, onSort, showCounts = true,
}: RosterColumnMenuProps) {
  const tMap = useTranslations("mtmMap")
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`roster-column-menu-${column}`}>
      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-zinc-200 p-2 dark:border-zinc-700">
        {(["asc", "desc"] as const).map((direction) => {
          const Icon = direction === "asc" ? ArrowUp : ArrowDown
          const current = sortDirection === direction
          return (
            <button
              key={direction}
              type="button"
              aria-pressed={current}
              data-testid={`roster-sort-${column}-${direction}`}
              onClick={() => onSort(direction)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-left text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-11",
                current ? "border-primary bg-primary/10" : "border-zinc-200 hover:bg-muted dark:border-zinc-700",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {tMap(`roster.sort.${sortKind}.${direction}`)}
            </button>
          )
        })}
      </div>
      <p className="shrink-0 px-3 pt-2 text-[11px] text-muted-foreground">{tMap("roster.filter.hint")}</p>
      <RosterColumnValueList column={column} options={options} filter={filter} onFilterChange={onFilterChange} showCounts={showCounts} />
      {filter ? (
        <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => onFilterChange(undefined)}
            data-testid={`roster-filter-reset-${column}`}
            className="inline-flex min-h-9 w-full items-center justify-center rounded-md border border-zinc-200 text-xs font-semibold hover:bg-muted dark:border-zinc-700 [@media(pointer:coarse)]:min-h-11"
          >
            {tMap("roster.filter.reset")}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A column heading that is also its menu — the spreadsheet's filter arrow
 * (owner, 2026-10-09: «нужны фильтры прямо в списке, как в Excel»).
 */
export function LiveMapRosterColumnMenu(props: RosterColumnMenuProps & { className?: string; placement: RosterMenuPlacement }) {
  const { column, label, filter, sortDirection, className, placement } = props
  const tMap = useTranslations("mtmMap")
  const SortIcon = sortDirection === "desc" ? ArrowDown : ArrowUp
  const beside = placement.side === "left" && placement.anchor != null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`roster-column-${column}`}
          data-filtered={filter ? "true" : "false"}
          aria-label={tMap("roster.filter.open", { column: label })}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-[11px] font-semibold uppercase tracking-wide transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [@media(pointer:coarse)]:h-11",
            filter ? ROSTER_ACTION_TEXT : "text-muted-foreground",
            className,
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          {sortDirection ? <SortIcon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          {filter
            ? <Filter className="h-3 w-3 shrink-0 fill-current" aria-hidden="true" />
            : <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      {/* After the trigger, not before it: the trigger names itself the anchor
          when it mounts, and the last one to speak is the one the menu stands
          beside. Put first, this line left the menu in the corner of the screen. */}
      {beside && placement.anchor ? <PopoverAnchor virtualRef={placement.anchor as RefObject<HTMLElement>} /> : null}
      {/* Never taller than the room the screen has left: under a heading that
          follows the scroll, a menu cut off by the screen cannot be scrolled to. */}
      <PopoverContent
        side={beside ? "left" : "bottom"}
        align="start"
        sideOffset={beside ? 8 : 4}
        collisionPadding={8}
        aria-label={label}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[calc(100vw-2rem)] flex-col p-0"
      >
        <RosterColumnMenuPanel {...props} />
      </PopoverContent>
    </Popover>
  )
}
