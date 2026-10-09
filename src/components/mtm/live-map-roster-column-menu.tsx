"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, ChevronDown, Filter, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  foldRosterText,
  onlyRosterFilterValue,
  rosterFilterAllows,
  ROSTER_FILTER_NOTHING,
  toggleRosterFilterValue,
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
 * What a column's menu holds: sort one way or the other, and a tick list of
 * the column's values with how many rows each gives. Everything is ticked
 * until something is taken off; «только» leaves one value in a single press,
 * because «show me only the late ones» should not take five unticks. A change
 * applies at once — the list and the map behind the menu are the preview.
 *
 * Used from a column heading and, for the columns a narrow list has no room
 * to draw, from «Фильтры» above it.
 */
export function RosterColumnMenuPanel({
  column, options, filter, onFilterChange, sortDirection, sortKind, onSort, showCounts = true,
}: RosterColumnMenuProps) {
  const tMap = useTranslations("mtmMap")
  const [query, setQuery] = useState("")
  const visible = useMemo(() => {
    const folded = foldRosterText(query)
    return folded ? options.filter((option) => foldRosterText(option.label).includes(folded)) : options
  }, [options, query])
  const ticked = options.filter((option) => rosterFilterAllows(filter, option.value)).length
  const allTicked = !filter

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
      <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2 border-b border-zinc-200 px-3 text-sm font-medium hover:bg-muted/60 dark:border-zinc-700 [@media(pointer:coarse)]:min-h-11">
        <input
          type="checkbox"
          checked={allTicked}
          ref={(element) => { if (element) element.indeterminate = !allTicked && ticked > 0 }}
          onChange={() => onFilterChange(allTicked ? ROSTER_FILTER_NOTHING : undefined)}
          data-testid={`roster-filter-all-${column}`}
          className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
        />
        {tMap("roster.filter.selectAll")}
      </label>
      {/* The one part that may scroll inside the menu: a list of two hundred names. */}
      <ul className="max-h-64 min-h-16 flex-1 overflow-y-auto py-1" data-testid={`roster-filter-values-${column}`}>
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{tMap("roster.filter.nothingFound")}</li>
        ) : visible.map((option) => (
          <li key={option.value} className="flex items-center gap-1 pr-2 hover:bg-muted/60">
            <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 pl-3 text-sm [@media(pointer:coarse)]:min-h-11">
              <input
                type="checkbox"
                checked={rosterFilterAllows(filter, option.value)}
                onChange={() => onFilterChange(toggleRosterFilterValue(filter, option.value))}
                data-testid={`roster-filter-value-${column}-${option.value}`}
                className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
              />
              {option.dotClass ? <span className={cn("h-2 w-2 shrink-0 rounded-full", option.dotClass)} aria-hidden="true" /> : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {showCounts ? <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{option.count}</span> : null}
            </label>
            <button
              type="button"
              onClick={() => onFilterChange(onlyRosterFilterValue(option.value))}
              data-testid={`roster-filter-only-${column}-${option.value}`}
              aria-label={`${option.label}: ${tMap("roster.filter.only")}`}
              className={cn("inline-flex min-h-8 shrink-0 items-center rounded px-1.5 text-[11px] font-semibold hover:underline [@media(pointer:coarse)]:min-h-11", ROSTER_ACTION_TEXT)}
            >
              {tMap("roster.filter.only")}
            </button>
          </li>
        ))}
      </ul>
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
export function LiveMapRosterColumnMenu(props: RosterColumnMenuProps & { className?: string }) {
  const { column, label, filter, sortDirection, className } = props
  const tMap = useTranslations("mtmMap")
  const SortIcon = sortDirection === "desc" ? ArrowDown : ArrowUp

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
      {/* Never taller than the room the screen has left: under a heading that
          follows the scroll, a menu cut off by the screen cannot be scrolled to. */}
      <PopoverContent align="start" collisionPadding={8} aria-label={label} className="flex max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[calc(100vw-2rem)] flex-col p-0">
        <RosterColumnMenuPanel {...props} />
      </PopoverContent>
    </Popover>
  )
}
