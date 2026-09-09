"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DataTable } from "@/components/data-table"
import {
  Flame, Users, Gauge, AlertTriangle,
  Search, Plus, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface UtilityCustomer {
  id: string
  accountNumber: string
  contactId: string | null
  accountHolderName: string
  serviceCity: string
  servicePostalCode: string | null
  customerClass: string
  status: string
  activatedAt: string | null
  suspendedAt: string | null
  terminatedAt: string | null
  createdAt: string
}

interface Stats {
  total: number
  active: number
  meters: number
  outages: number
}

const CUSTOMER_STATUS_COLORS: Record<string, string> = {
  prospect:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  suspended:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  terminated: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function EnergyCustomersPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("energy")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [customers, setCustomers] = useState<UtilityCustomer[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, meters: 0, outages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchCustomers = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/utility-customers?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.customers) {
        setCustomers(prev => reset ? json.customers : [...prev, ...json.customers])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: UtilityCustomer[] = json.customers
          setStats(s => ({
            ...s,
            total: c.length,
            active: c.filter(x => x.status === "active").length,
          }))
        }
      }
    } catch (err) {
      console.error("[energy/customers]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  const fetchCounters = useCallback(async () => {
    if (!orgId) return
    try {
      const [meterRes, outageRes] = await Promise.allSettled([
        fetch(`/api/v1/metering-points?limit=1`, { headers }),
        fetch(`/api/v1/outages?limit=1`, { headers }),
      ])
      if (meterRes.status === "fulfilled" && meterRes.value.ok) {
        const j = await meterRes.value.json()
        if (j.meters) setStats(s => ({ ...s, meters: j.meters.length }))
      }
      if (outageRes.status === "fulfilled" && outageRes.value.ok) {
        const j = await outageRes.value.json()
        if (j.outages) setStats(s => ({ ...s, outages: j.outages.length }))
      }
    } catch { /* non-critical */ }
  }, [orgId])

  useEffect(() => {
    fetchCustomers(true)
    fetchCounters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchCustomers(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`customerStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "accountNumber",
      label: t("colAccountNumber"),
      sortable: true,
      render: (item: UtilityCustomer) => (
        <span className="font-mono text-xs text-muted-foreground">{item.accountNumber}</span>
      ),
    },
    {
      key: "accountHolderName",
      label: t("colName"),
      sortable: true,
      render: (item: UtilityCustomer) => (
        <div>
          <div className="font-medium text-sm">{item.accountHolderName}</div>
          {item.serviceCity && <div className="text-xs text-muted-foreground">{item.serviceCity}</div>}
        </div>
      ),
    },
    {
      key: "customerClass",
      label: t("colClass"),
      sortable: true,
      render: (item: UtilityCustomer) => (
        <span className="text-sm capitalize">{item.customerClass.replace(/_/g, " ")}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: UtilityCustomer) => (
        <Badge className={cn("text-xs", CUSTOMER_STATUS_COLORS[item.status] || CUSTOMER_STATUS_COLORS.prospect)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "serviceCity",
      label: t("colCity"),
      render: (item: UtilityCustomer) => (
        <span className="text-sm text-muted-foreground">{item.serviceCity || "—"}</span>
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
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("title")} <HelpButton slug="energy-overview" variant="label" /></h1>
              <PageDescription text={t("subtitle")} />
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newCustomer")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("statTotal")} value={String(stats.total)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statActive")} value={String(stats.active)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statMeters")} value={String(stats.meters)} icon={<Gauge className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statOutages")} value={String(stats.outages)} icon={<AlertTriangle className="h-4 w-4" />} />
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
            {["prospect", "active", "suspended", "terminated"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchCustomers(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={customers as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onRowClick={(item: any) => router.push(`/energy/${(item as UtilityCustomer).id}`)}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchCustomers(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
