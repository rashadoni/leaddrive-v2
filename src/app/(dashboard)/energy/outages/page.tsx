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
  Flame, AlertTriangle, CheckCircle, Zap,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface Outage {
  id: string
  outageNumber: string
  cause: string
  severity: string
  status: string
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  actualStartAt: string | null
  actualEndAt: string | null
  affectedMeterCount: number
  publicSummary: string | null
  createdAt: string
}

interface Totals {
  total: number
  active: number
  resolved: number
  critical: number
}

const OUTAGE_STATUS_COLORS: Record<string, string> = {
  pending:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  resolved:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

const OUTAGE_SEVERITY_COLORS: Record<string, string> = {
  minor:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  moderate: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  major:    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function OutagesPage() {
  const { data: session } = useSession()
  const t = useTranslations("energy")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [outages, setOutages] = useState<Outage[]>([])
  const [totals, setTotals] = useState<Totals>({ total: 0, active: 0, resolved: 0, critical: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchOutages = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/outages?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.outages) {
        setOutages(prev => reset ? json.outages : [...prev, ...json.outages])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const o: Outage[] = json.outages
          setTotals({
            total:    o.length,
            active:   o.filter(x => x.status === "active").length,
            resolved: o.filter(x => x.status === "resolved").length,
            critical: o.filter(x => x.severity === "critical").length,
          })
        }
      }
    } catch (err) {
      console.error("[energy/outages]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchOutages(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  const statusLabel = (s: string) =>
    t(`outageStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const typeLabel = (s: string) =>
    t(`outageType_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "outageNumber",
      label: t("colOutageType"),
      sortable: true,
      render: (item: Outage) => (
        <div>
          <div className="font-mono text-xs text-muted-foreground">{item.outageNumber}</div>
          <div className="text-xs text-muted-foreground capitalize">{typeLabel(item.cause)}</div>
        </div>
      ),
    },
    {
      key: "status",
      label: t("colOutageStatus"),
      sortable: true,
      render: (item: Outage) => (
        <Badge className={cn("text-xs", OUTAGE_STATUS_COLORS[item.status] || OUTAGE_STATUS_COLORS.pending)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "severity",
      label: t("colSeverity"),
      sortable: true,
      render: (item: Outage) => (
        <Badge className={cn("text-xs", OUTAGE_SEVERITY_COLORS[item.severity] || OUTAGE_SEVERITY_COLORS.minor)}>
          {item.severity}
        </Badge>
      ),
    },
    {
      key: "affectedMeterCount",
      label: t("colAffected"),
      sortable: true,
      render: (item: Outage) => (
        <span className="text-sm text-muted-foreground">{item.affectedMeterCount.toLocaleString()}</span>
      ),
    },
    {
      key: "actualStartAt",
      label: t("colStartTime"),
      sortable: true,
      render: (item: Outage) => (
        <span className="text-xs text-muted-foreground">
          {item.actualStartAt ? new Date(item.actualStartAt).toLocaleString() : "—"}
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
            <div className="p-2 bg-yellow-500/10 rounded-lg">
              <Flame className="h-6 w-6 text-yellow-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("outagesPageTitle")}<HelpButton slug="energy-outages" variant="label" /></h1>
              <PageDescription text={t("outagesPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("outageStatTotal")} value={String(totals.total)} icon={<Zap className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("outageStatActive")} value={String(totals.active)} icon={<AlertTriangle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("outageStatResolved")} value={String(totals.resolved)} icon={<CheckCircle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("outageStatCritical")} value={String(totals.critical)} icon={<AlertTriangle className="h-4 w-4" />} />
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
            {["pending", "active", "resolved", "cancelled"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchOutages(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={outages as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchOutages(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
