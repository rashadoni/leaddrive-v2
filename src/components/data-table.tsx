"use client"

import { useState, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronUp, ChevronDown, Search, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { InfoHint } from "@/components/info-hint"

interface Column<T> {
  key: string
  label: string
  hint?: string
  sortable?: boolean
  render?: (item: T, index?: number) => React.ReactNode
  className?: string
  // Added on top of className for the header cell only. A pinned column needs a
  // different background there — the body cell has to match the row, the header
  // cell has to match the header — while keeping the same sticky positioning.
  headClassName?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  searchPlaceholder?: string
  searchKey?: string
  onRowClick?: (item: T) => void
  rowClassName?: (item: T) => string
  pageSize?: number
  /** Tighter row padding for high-density lists (opt-in; other tables keep the roomy default). */
  dense?: boolean
  /** Reduces surrounding vertical chrome for workspace-style screens. */
  compact?: boolean
  /** Optional compact card renderer used below the desktop breakpoint. */
  mobileCardRender?: (item: T, index: number) => React.ReactNode
  /** Optional controlled search for pages that own a unified filter toolbar. */
  searchValue?: string
  onSearchChange?: (value: string) => void
  hideSearch?: boolean
  /** Hides the built-in result label when the owning workspace renders one. */
  hideResultCount?: boolean
  /** Contextual empty or no-results treatment supplied by the owning workspace. */
  emptyContent?: ReactNode
}

const PAGE_SIZE_OPTIONS = [20, 50, 100, 0] // 0 = all

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  searchPlaceholder = "Search...",
  searchKey = "name",
  onRowClick,
  rowClassName,
  pageSize: defaultPageSize = 20,
  dense = false,
  compact = false,
  mobileCardRender,
  searchValue,
  onSearchChange,
  hideSearch = false,
  hideResultCount = false,
  emptyContent,
}: DataTableProps<T>) {
  const headPad = dense ? "px-3 py-2.5" : "px-5 py-3.5"
  const cellPad = dense ? "px-3 py-2" : "px-5 py-3.5"
  const [internalSearch, setInternalSearch] = useState("")
  const search = searchValue ?? internalSearch
  const [sortCol, setSortCol] = useState("")
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const t = useTranslations("common")

  const filtered = data.filter((item) => {
    if (!search) return true
    const q = search.toLowerCase()
    // Search across all string values including nested objects (e.g. company.name)
    const values = [item[searchKey], ...Object.values(item)].flatMap((v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return Object.values(v as Record<string, unknown>).map((nv) => String(nv || ""))
      }
      return [String(v || "")]
    })
    return values.some((val) => val.toLowerCase().includes(q))
  })

  const sorted = [...filtered].sort((a, b) => {
    if (!sortCol) return 0
    const aVal = String(a[sortCol] || "")
    const bVal = String(b[sortCol] || "")
    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
    return sortAsc ? cmp : -cmp
  })

  const showAll = pageSize === 0
  const totalPages = showAll ? 1 : Math.ceil(sorted.length / pageSize)
  const paginated = showAll ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize)
  const globalOffset = showAll ? 0 : (page - 1) * pageSize

  function toggleSort(key: string) {
    if (sortCol === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(key)
      setSortAsc(true)
    }
  }

  function handlePageSizeChange(newSize: number) {
    setPageSize(newSize)
    setPage(1)
  }

  function handleSearchChange(value: string) {
    if (onSearchChange) onSearchChange(value)
    else setInternalSearch(value)
    setPage(1)
  }

  return (
    <div className={cn("space-y-4 pb-20", compact && "space-y-3 pb-6")}>
      {(!hideSearch || !hideResultCount) && <div className={cn("flex items-center gap-3", hideSearch && "justify-end")}>
        {!hideSearch && (
          <div className={cn("relative flex-1 max-w-sm", compact && "min-w-0")}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={searchPlaceholder || t("search")}
              placeholder={searchPlaceholder || t("search")}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
        {!hideResultCount && <span className={cn("text-sm text-muted-foreground", compact && "hidden sm:inline")}>{t("results", { count: filtered.length })}</span>}
      </div>}

      <div className={cn("overflow-x-auto rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700", compact && "rounded-md border-border shadow-none", mobileCardRender && "hidden md:block")}>
        <table className="w-full text-sm">
          <thead>
            <tr className={cn("border-b border-zinc-200 bg-muted/40 dark:border-zinc-700", compact && "border-border")}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  aria-sort={col.sortable && sortCol === col.key ? (sortAsc ? "ascending" : "descending") : undefined}
                  className={cn(
                    headPad,
                    "text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                    col.className,
                    col.headClassName
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="flex min-h-11 items-center gap-1 rounded-sm text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-6"
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      {col.hint && <InfoHint text={col.hint} size={12} />}
                      {sortCol === col.key && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      {col.label}
                      {col.hint && <InfoHint text={col.hint} size={12} />}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((item, i) => (
              <tr
                key={String(item.id || i)}
                className={cn(
                  // `group` so a pinned cell, which carries its own opaque
                  // background, can follow the row's hover instead of staying
                  // the one untinted cell in a highlighted row.
                  "group border-b border-zinc-200 transition-colors last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none dark:border-zinc-700",
                  compact && "border-border",
                  onRowClick && "cursor-pointer",
                  rowClassName?.(item)
                )}
                onClick={() => onRowClick?.(item)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (event) => {
                  // Let nested buttons, links and form controls own their keyboard
                  // activation. Without this guard, Enter on a row action also
                  // activates the row and navigates away from the action result.
                  if (event.target !== event.currentTarget) return
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onRowClick(item)
                  }
                } : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn(cellPad, dense && "align-middle", col.className)}>
                    {col.render ? col.render(item, globalOffset + i) : String(item[col.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center text-muted-foreground">
                  {emptyContent || t("noData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mobileCardRender && (
        <div className="space-y-2 md:hidden">
          {paginated.map((item, i) => (
            <div key={String(item.id || i)}>{mobileCardRender(item, globalOffset + i)}</div>
          ))}
          {paginated.length === 0 && (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {emptyContent || t("noData")}
            </div>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {(totalPages > 1 || !hideResultCount) && <span className="text-sm text-muted-foreground">
            {totalPages > 1 ? t("pageOf", { current: page, total: totalPages }) : t("results", { count: sorted.length })}
          </span>}
          <div className="flex max-w-full items-center gap-1 overflow-x-auto">
            {PAGE_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => handlePageSizeChange(size)}
                className={cn(
                  "min-h-11 min-w-11 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-9 sm:min-w-9",
                  pageSize === size
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {size === 0 ? t("all") : size}
              </button>
            ))}
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex gap-1">
            <Button aria-label={t("previousPage")} variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button aria-label={t("nextPage")} variant="outline" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
