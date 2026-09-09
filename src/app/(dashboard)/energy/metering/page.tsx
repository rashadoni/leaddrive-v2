"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { DataTable } from "@/components/data-table"
import {
  Flame, Gauge, CheckCircle, AlertTriangle,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface MeteringPoint {
  id: string
  utilityCustomerId: string
  meterNumber: string
  commodityType: string
  latitude: number | null
  longitude: number | null
  manufacturer: string | null
  modelNumber: string | null
  installedAt: string | null
  status: string
  disconnectedAt: string | null
  retiredAt: string | null
  tariffPlanSlug: string | null
  createdAt: string
}

interface Totals {
  total: number
  active: number
  faulty: number
}

const METER_STATUS_COLORS: Record<string, string> = {
  pending_install: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  disconnected:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  retired:         "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

export default function MeteringPointsPage() {
  const { data: session } = useSession()
  const t = useTranslations("energy")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [meters, setMeters] = useState<MeteringPoint[]>([])
  const [totals, setTotals] = useState<Totals>({ total: 0, active: 0, faulty: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchMeters = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("meterNumberSearch", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/metering-points?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.meters) {
        setMeters(prev => reset ? json.meters : [...prev, ...json.meters])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const m: MeteringPoint[] = json.meters
          setTotals({
            total:  m.length,
            active: m.filter(x => x.status === "active").length,
            faulty: m.filter(x => x.status === "disconnected").length,
          })
        }
      }
    } catch (err) {
      console.error("[energy/metering]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchMeters(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchMeters(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`meterStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const typeLabel = (s: string) =>
    t(`meterType_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "meterNumber",
      label: t("colMeterSerial"),
      sortable: true,
      render: (item: MeteringPoint) => (
        <span className="font-mono text-xs text-muted-foreground">{item.meterNumber}</span>
      ),
    },
    {
      key: "status",
      label: t("colMeterStatus"),
      sortable: true,
      render: (item: MeteringPoint) => (
        <Badge className={cn("text-xs", METER_STATUS_COLORS[item.status] || METER_STATUS_COLORS.retired)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "commodityType",
      label: t("colMeterType"),
      sortable: true,
      render: (item: MeteringPoint) => (
        <span className="text-sm capitalize">{typeLabel(item.commodityType)}</span>
      ),
    },
    {
      key: "installedAt",
      label: t("colInstalled"),
      sortable: true,
      render: (item: MeteringPoint) => (
        <span className="text-xs text-muted-foreground">
          {item.installedAt ? new Date(item.installedAt).toLocaleDateString() : "—"}
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
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("meteringPageTitle")}<HelpButton slug="energy-metering" variant="label" /></h1>
              <PageDescription text={t("meteringPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("meterStatTotal")} value={String(totals.total)} icon={<Gauge className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("meterStatActive")} value={String(totals.active)} icon={<CheckCircle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("meterStatFaulty")} value={String(totals.faulty)} icon={<AlertTriangle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("meterStatTotal")} value={String(totals.total - totals.active - totals.faulty)} icon={<Gauge className="h-4 w-4" />} />
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
            {["pending_install", "active", "disconnected", "retired"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchMeters(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={meters as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchMeters(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
