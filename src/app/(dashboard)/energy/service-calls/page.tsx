"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DataTable } from "@/components/data-table"
import { HelpButton } from "@/components/help/help-button"
import {
  Flame, PhoneCall, CheckCircle, AlertTriangle,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface ServiceCall {
  id: string
  callNumber: string
  utilityCustomerId: string | null
  meteringPointId: string | null
  outageId: string | null
  callType: string
  priority: string
  status: string
  subject: string
  queueSlug: string | null
  assignedToUserId: string | null
  scheduledAt: string | null
  dispatchedAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  cancelledAt: string | null
  createdAt: string
}

interface Totals {
  total: number
  open: number
  completed: number
  urgent: number
}

const CALL_STATUS_COLORS: Record<string, string> = {
  received:    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  dispatched:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  in_progress: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  resolved:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

export default function ServiceCallsPage() {
  const { data: session } = useSession()
  const t = useTranslations("energy")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [calls, setCalls] = useState<ServiceCall[]>([])
  const [totals, setTotals] = useState<Totals>({ total: 0, open: 0, completed: 0, urgent: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchCalls = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("callNumberSearch", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/service-calls?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.calls) {
        setCalls(prev => reset ? json.calls : [...prev, ...json.calls])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: ServiceCall[] = json.calls
          setTotals({
            total:     c.length,
            open:      c.filter(x => ["received", "dispatched", "in_progress"].includes(x.status)).length,
            completed: c.filter(x => x.status === "resolved").length,
            urgent:    c.filter(x => x.priority === "urgent" || x.priority === "emergency").length,
          })
        }
      }
    } catch (err) {
      console.error("[energy/service-calls]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchCalls(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchCalls(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`callStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const typeLabel = (s: string) =>
    t(`callType_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "callNumber",
      label: t("colCallNumber"),
      sortable: true,
      render: (item: ServiceCall) => (
        <span className="font-mono text-xs text-muted-foreground">{item.callNumber}</span>
      ),
    },
    {
      key: "callType",
      label: t("colCallType"),
      sortable: true,
      render: (item: ServiceCall) => (
        <span className="text-sm capitalize">{typeLabel(item.callType)}</span>
      ),
    },
    {
      key: "status",
      label: t("colCallStatus"),
      sortable: true,
      render: (item: ServiceCall) => (
        <Badge className={cn("text-xs", CALL_STATUS_COLORS[item.status] || CALL_STATUS_COLORS.received)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "scheduledAt",
      label: t("colScheduled"),
      sortable: true,
      render: (item: ServiceCall) => (
        <span className="text-xs text-muted-foreground">
          {item.scheduledAt ? new Date(item.scheduledAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "assignedToUserId",
      label: t("colTechnician"),
      render: (item: ServiceCall) => (
        <span className="text-sm text-muted-foreground">{item.assignedToUserId || "—"}</span>
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
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("serviceCallsPageTitle")}<HelpButton slug="energy-service-calls" variant="label" /></h1>
              <PageDescription text={t("serviceCallsPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("scStatTotal")} value={String(totals.total)} icon={<PhoneCall className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("scStatOpen")} value={String(totals.open)} icon={<PhoneCall className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("scStatCompleted")} value={String(totals.completed)} icon={<CheckCircle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("scStatUrgent")} value={String(totals.urgent)} icon={<AlertTriangle className="h-4 w-4" />} />
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
            {["received", "dispatched", "in_progress", "resolved", "cancelled"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchCalls(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={calls as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchCalls(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
