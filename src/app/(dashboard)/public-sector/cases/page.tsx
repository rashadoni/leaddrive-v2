"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DataTable } from "@/components/data-table"
import {
  Landmark, FileText, CheckCircle, XCircle,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface PublicSectorCase {
  id: string
  caseNumber: string
  citizenId: string
  caseType: string
  status: string
  priority: string
  agencySlug: string
  departmentSlug: string | null
  assignedOfficialId: string | null
  subject: string
  statutoryDueAt: string | null
  submittedAt: string
  resolvedAt: string | null
  deniedAt: string | null
  withdrawnAt: string | null
  createdAt: string
}

interface Stats {
  total: number
  open: number
  closed: number
  resolved: number
}

const CASE_STATUS_COLORS: Record<string, string> = {
  submitted:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  intake:      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  assigned:    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  escalated:   "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  resolved:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  denied:      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  withdrawn:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

const CASE_PRIORITY_COLORS: Record<string, string> = {
  routine:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  elevated:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  urgent:    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  emergency: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function PublicSectorCasesPage() {
  const { data: session } = useSession()
  const t = useTranslations("publicSector")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [cases, setCases] = useState<PublicSectorCase[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, open: 0, closed: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchCases = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("caseNumberSearch", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/public-sector-cases?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.cases) {
        setCases(prev => reset ? json.cases : [...prev, ...json.cases])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: PublicSectorCase[] = json.cases
          setStats({
            total:    c.length,
            open:     c.filter(x => ["submitted","intake","assigned","in_progress","escalated"].includes(x.status)).length,
            closed:   c.filter(x => ["denied","withdrawn"].includes(x.status)).length,
            resolved: c.filter(x => x.status === "resolved").length,
          })
        }
      }
    } catch (err) {
      console.error("[public-sector/cases]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchCases(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchCases(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`caseStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const priorityLabel = (p: string) =>
    t(`casePriority_${p}` as Parameters<typeof t>[0], { fallback: p }) ?? p

  const columns = [
    {
      key: "caseNumber",
      label: t("colCaseNumber"),
      sortable: true,
      render: (item: PublicSectorCase) => (
        <span className="font-mono text-xs text-muted-foreground">{item.caseNumber}</span>
      ),
    },
    {
      key: "subject",
      label: t("colSubject"),
      sortable: true,
      render: (item: PublicSectorCase) => (
        <div>
          <div className="font-medium text-sm line-clamp-1">{item.subject}</div>
          <div className="text-xs text-muted-foreground">{item.agencySlug}</div>
        </div>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: PublicSectorCase) => (
        <Badge className={cn("text-xs", CASE_STATUS_COLORS[item.status] || CASE_STATUS_COLORS.submitted)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "priority",
      label: t("colPriority"),
      sortable: true,
      render: (item: PublicSectorCase) => (
        <Badge className={cn("text-xs", CASE_PRIORITY_COLORS[item.priority] || CASE_PRIORITY_COLORS.routine)}>
          {priorityLabel(item.priority)}
        </Badge>
      ),
    },
    {
      key: "assignedOfficialId",
      label: t("colAssigned"),
      render: (item: PublicSectorCase) => (
        <span className="text-xs text-muted-foreground">{item.assignedOfficialId || "—"}</span>
      ),
    },
    {
      key: "statutoryDueAt",
      label: t("colDueDate"),
      sortable: true,
      render: (item: PublicSectorCase) => (
        <span className="text-xs text-muted-foreground">
          {item.statutoryDueAt ? new Date(item.statutoryDueAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
  ]

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 rounded-lg">
              <Landmark className="h-6 w-6 text-teal-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("casesPageTitle")}<HelpButton slug="public-sector-cases" variant="label" /></h1>
              <PageDescription text={t("casesPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("caseStatTotal")} value={String(stats.total)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("caseStatOpen")} value={String(stats.open)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("caseStatResolved")} value={String(stats.resolved)} icon={<CheckCircle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("caseStatClosed")} value={String(stats.closed)} icon={<XCircle className="h-4 w-4" />} />
          </MotionItem>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full pl-9 pr-3 h-9 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allStatuses")}</option>
            {["submitted","intake","assigned","in_progress","escalated","resolved","denied","withdrawn"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchCases(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={cases as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchCases(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
