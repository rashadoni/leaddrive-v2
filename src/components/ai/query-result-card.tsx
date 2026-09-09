"use client"

/**
 * Smart AI Search — result table rendered inside the Da Vinci chat panel.
 *
 * Read-only: rows link to their detail page (navigation only), there are NO
 * write controls (no edit/delete/checkbox) — that keeps this cleanly separate
 * from the action-approval flow (ActionCard) in ai-assistant-panel.tsx.
 *
 * The typed payload is produced by the read-tool executor (src/lib/ai/read-tool-executor.ts).
 * Types are mirrored locally so this client component never imports the
 * zod/anthropic-bound backend module.
 */
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { FileText, Briefcase, CheckSquare, LifeBuoy, User, ArrowUpRight, Search, type LucideIcon } from "lucide-react"

export type CellType = "text" | "number" | "currency" | "date" | "datetime" | "status" | "badge"

export interface QueryColumn {
  key: string
  labelKey: string
  label: string
  type: CellType
}

export interface QueryRow {
  id: string
  href?: string
  cells: Record<string, string | number | null>
}

export interface QueryResult {
  entityType: string
  columns: QueryColumn[]
  rows: QueryRow[]
  total: number
  returned: number
  truncated?: boolean
  listHref?: string
}

export interface SearchUiText {
  results: string // "{count} results"
  showingOf: string // "Showing {shown} of {total}"
  openFullList: string
  noResults: string
  queryFailed: string
  columns: Record<string, string>
}

const ENTITY_ICONS: Record<string, LucideIcon> = {
  invoice: FileText,
  deal: Briefcase,
  task: CheckSquare,
  ticket: LifeBuoy,
  contact: User,
}

type BadgeVariant = "success" | "warning" | "destructive" | "info" | "secondary" | "default"

function badgeVariant(value: string): BadgeVariant {
  const v = value.toLowerCase()
  if (["paid", "resolved", "closed", "done", "completed", "active"].includes(v)) return "success"
  if (["overdue", "cancelled", "refunded", "failed", "critical", "high"].includes(v)) return "destructive"
  if (["vip", "partner", "medium"].includes(v)) return "warning"
  if (["sent", "viewed", "open", "in_progress", "waiting", "review", "testing", "partially_paid"].includes(v))
    return "info"
  if (["draft", "new", "pending", "backlog", "todo", "inactive", "low", "regular", "prospect"].includes(v))
    return "secondary"
  return "default"
}

function formatCell(col: QueryColumn, row: QueryRow, locale: string): ReactNode {
  const value = row.cells[col.key]
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>
  }
  switch (col.type) {
    case "currency": {
      const currency = typeof row.cells.currency === "string" ? row.cells.currency : undefined
      return formatCurrency(Number(value), currency)
    }
    case "date":
      return formatDate(String(value), locale, { year: "numeric", month: "short", day: "numeric" }) || "—"
    case "datetime":
      return formatDateTime(String(value), locale) || "—"
    case "number":
      return Number(value).toLocaleString(locale)
    case "status":
    case "badge":
      return (
        <Badge variant={badgeVariant(String(value))} className="text-[10px] px-1.5 py-0 font-medium">
          {String(value)}
        </Badge>
      )
    default:
      return String(value)
  }
}

export function QueryResultCard({
  result,
  search,
  locale,
  onNavigate,
}: {
  result: QueryResult
  search: SearchUiText
  locale: string
  onNavigate: (href: string) => void
}) {
  const Icon = ENTITY_ICONS[result.entityType] ?? Search
  const countLabel = search.results.replace("{count}", String(result.total))

  // Empty state — no table chrome, just the icon + message.
  if (result.rows.length === 0) {
    return (
      <div className="rounded-2xl rounded-bl-md border border-[hsl(var(--ai-from))]/15 bg-[hsl(var(--ai-from))]/5 px-3 py-4 text-center">
        <Icon className="mx-auto h-5 w-5 text-muted-foreground/60" />
        <p className="mt-1.5 text-xs text-muted-foreground">{search.noResults}</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl rounded-bl-md border border-[hsl(var(--ai-from))]/15 bg-[hsl(var(--ai-from))]/5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--ai-from))]/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Icon className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" />
          <span className="capitalize">{result.entityType}</span>
        </div>
        <span className="text-[10px] font-medium text-muted-foreground">{countLabel}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="border-b border-[hsl(var(--ai-from))]/10">
              {result.columns.map((col) => (
                <th
                  key={col.key}
                  className="px-2.5 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  <span className="block truncate">{search.columns[col.labelKey] || col.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const clickable = Boolean(row.href)
              return (
                <tr
                  key={row.id}
                  role={clickable ? "link" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onNavigate(row.href!) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onNavigate(row.href!)
                          }
                        }
                      : undefined
                  }
                  className={`border-b border-[hsl(var(--ai-from))]/5 last:border-0 ${
                    clickable ? "cursor-pointer hover:bg-[hsl(var(--ai-from))]/10" : ""
                  }`}
                >
                  {result.columns.map((col) => (
                    <td key={col.key} className="px-2.5 py-1.5 align-middle">
                      <span className="block truncate" title={String(row.cells[col.key] ?? "")}>
                        {formatCell(col, row, locale)}
                      </span>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer — only when the full count exceeds the returned rows */}
      {result.truncated && (
        <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--ai-from))]/10 px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {search.showingOf.replace("{shown}", String(result.returned)).replace("{total}", String(result.total))}
          </span>
          {result.listHref && (
            <button
              onClick={() => onNavigate(result.listHref!)}
              className="flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--ai-from))] hover:underline"
            >
              {search.openFullList}
              <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
