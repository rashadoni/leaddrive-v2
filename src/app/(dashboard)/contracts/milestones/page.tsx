"use client"

/**
 * CLM Slice 5d — Org-wide Contract Milestones page.
 *
 * /contracts/milestones
 *
 * Read-only org-wide view of ALL milestones across all contracts. Per-contract
 * create / edit / delete stays on the contract detail (/contracts/[id]).
 *
 * Columns: label, contract (link), owner, due date, status badge, overdue indicator.
 * Filters: status, overdue toggle, upcoming-N-days.
 */
import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  CheckSquare,
  AlertTriangle,
  Loader2,
  RefreshCw,
  FileText,
  User,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface MilestoneRow {
  id: string
  contractId: string
  contractNumber: string
  contractTitle: string
  label: string
  description: string | null
  dueAt: string
  completedAt: string | null
  status: string
  isOverdue: boolean
  ownerUserId: string | null
  ownerName: string | null
}

interface Pagination {
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface ApiResponse {
  success: boolean
  data: MilestoneRow[]
  pagination: Pagination
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["", "pending", "in_progress", "completed", "cancelled"] as const

const STATUS_STYLES: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  completed:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  cancelled:   "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ContractMilestonesPage() {
  const t = useTranslations("contractMilestones")

  const [rows, setRows] = useState<MilestoneRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    total: 0, page: 1, pageSize: 50, totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [status, setStatus] = useState("")
  const [overdue, setOverdue] = useState(false)
  const [upcoming, setUpcoming] = useState("")
  const [page, setPage] = useState(1)

  const load = useCallback(async (
    statusVal: string,
    overdueVal: boolean,
    upcomingVal: string,
    pageVal: number,
  ) => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (statusVal) sp.set("status", statusVal)
      if (overdueVal) sp.set("overdue", "true")
      else if (upcomingVal && parseInt(upcomingVal, 10) > 0) sp.set("upcoming", upcomingVal)
      sp.set("page", String(pageVal))
      const res = await fetch(`/api/v1/contract-milestones?${sp}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ApiResponse = await res.json()
      setRows(json.data)
      setPagination(json.pagination)
    } catch {
      setError(t("loadError"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load(status, overdue, upcoming, page)
  }, [load, status, overdue, upcoming, page])

  const handleFilter = () => {
    setPage(1)
    load(status, overdue, upcoming, 1)
  }

  const handleReset = () => {
    setStatus("")
    setOverdue(false)
    setUpcoming("")
    setPage(1)
    load("", false, "", 1)
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <MotionPage className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CheckSquare className="h-6 w-6 text-blue-500" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <HelpButton slug="contracts-milestones" />
      </div>

      {/* Filters */}
      <MotionCard className="flex flex-wrap items-end gap-4 p-4">
        {/* Status */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("filterStatus")}</Label>
          <Select
            className="h-8 w-40 text-sm"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          >
            <option value="">{t("filterStatusAll")}</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </Select>
        </div>

        {/* Overdue toggle */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("filterOverdue")}</Label>
          <Button
            size="sm"
            variant={overdue ? "default" : "outline"}
            className="h-8"
            onClick={() => { setOverdue((v) => !v); setPage(1) }}
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            {t("filterOverdueBtn")}
          </Button>
        </div>

        {/* Upcoming N days */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t("filterUpcoming")}</Label>
          <Input
            type="number"
            min={1}
            max={365}
            className="h-8 w-24 text-sm"
            placeholder={t("filterUpcomingPlaceholder")}
            value={upcoming}
            onChange={(e) => { setUpcoming(e.target.value); setPage(1) }}
            disabled={overdue}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleFilter} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("filterApply")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {t("filterReset")}
          </Button>
        </div>

        {!loading && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t("totalCount", { count: pagination.total })}
          </span>
        )}
      </MotionCard>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <MotionCard className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <CheckSquare className="h-10 w-10 text-muted-foreground/30" />
            <span>{t("emptyState")}</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground text-left">
                  <th className="px-4 py-3 font-medium">{t("colLabel")}</th>
                  <th className="px-4 py-3 font-medium">{t("colContract")}</th>
                  <th className="px-4 py-3 font-medium">{t("colOwner")}</th>
                  <th className="px-4 py-3 font-medium">{t("colDueAt")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    {/* Label + overdue indicator */}
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        {row.isOverdue && (
                          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-medium leading-snug">{row.label}</p>
                          {row.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {row.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Contract link */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/contracts/${row.contractId}`}
                        className="flex items-center gap-1.5 text-blue-600 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-mono text-xs">{row.contractNumber}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {row.contractTitle}
                        </span>
                      </Link>
                    </td>

                    {/* Owner */}
                    <td className="px-4 py-3">
                      {row.ownerName ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {row.ownerName}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Due date */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className={row.isOverdue ? "text-red-600 font-medium" : ""}>
                          {fmtDate(row.dueAt, "en")}
                        </span>
                      </div>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <Badge
                        className={`text-xs font-medium px-2 py-0.5 ${STATUS_STYLES[row.status] ?? ""}`}
                        variant="outline"
                      >
                        {t(`status.${row.status}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MotionCard>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {t("paginationInfo", {
              from: (pagination.page - 1) * pagination.pageSize + 1,
              to: Math.min(pagination.page * pagination.pageSize, pagination.total),
              total: pagination.total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">
              {t("paginationPage", { page: pagination.page, total: pagination.totalPages })}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </MotionPage>
  )
}
