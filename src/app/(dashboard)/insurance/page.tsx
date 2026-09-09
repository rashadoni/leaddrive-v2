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
  Umbrella, Users, FileText, Shield,
  Search, Plus, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface PolicyHolder {
  id: string
  holderNumber: string
  fullName: string
  email: string | null
  phone: string | null
  status: string
  activatedAt: string | null
  createdAt: string
}

interface Stats {
  total: number
  active: number
  policies: number
  claims: number
}

const HOLDER_STATUS_COLORS: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  deceased: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function InsurancePolicyHoldersPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("insurance")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [holders, setHolders] = useState<PolicyHolder[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, policies: 0, claims: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchHolders = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/policy-holders?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.holders) {
        setHolders(prev => reset ? json.holders : [...prev, ...json.holders])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const h: PolicyHolder[] = json.holders
          setStats(s => ({ ...s, total: h.length, active: h.filter(x => x.status === "active").length }))
        }
      }
    } catch (err) {
      console.error("[insurance/holders]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  const fetchCounters = useCallback(async () => {
    if (!orgId) return
    try {
      const [polRes, clmRes] = await Promise.allSettled([
        fetch(`/api/v1/policies?limit=1`, { headers }),
        fetch(`/api/v1/claims?limit=1`, { headers }),
      ])
      if (polRes.status === "fulfilled" && polRes.value.ok) {
        const j = await polRes.value.json()
        if (j.policies) setStats(s => ({ ...s, policies: j.policies.length }))
      }
      if (clmRes.status === "fulfilled" && clmRes.value.ok) {
        const j = await clmRes.value.json()
        if (j.claims) setStats(s => ({ ...s, claims: j.claims.length }))
      }
    } catch { /* non-critical */ }
  }, [orgId])

  useEffect(() => {
    fetchHolders(true)
    fetchCounters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchHolders(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`holderStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "holderNumber",
      label: t("colHolderNumber"),
      sortable: true,
      render: (item: PolicyHolder) => (
        <span className="font-mono text-xs text-muted-foreground">{item.holderNumber}</span>
      ),
    },
    {
      key: "fullName",
      label: t("colName"),
      sortable: true,
      render: (item: PolicyHolder) => (
        <div>
          <div className="font-medium text-sm">{item.fullName}</div>
          {item.email && <div className="text-xs text-muted-foreground">{item.email}</div>}
        </div>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: PolicyHolder) => (
        <Badge className={cn("text-xs", HOLDER_STATUS_COLORS[item.status] || HOLDER_STATUS_COLORS.inactive)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "phone",
      label: t("colPhone"),
      render: (item: PolicyHolder) => (
        <span className="text-sm text-muted-foreground">{item.phone || "—"}</span>
      ),
    },
    {
      key: "activatedAt",
      label: t("colActivated"),
      sortable: true,
      render: (item: PolicyHolder) => (
        <span className="text-xs text-muted-foreground">
          {item.activatedAt ? new Date(item.activatedAt).toLocaleDateString() : "—"}
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
            <div className="p-2 bg-violet-500/10 rounded-lg">
              <Umbrella className="h-6 w-6 text-violet-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("title")} <HelpButton slug="insurance-overview" variant="label" /></h1>
              <PageDescription text={t("subtitle")} />
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newHolder")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("statTotalHolders")} value={String(stats.total)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statActiveHolders")} value={String(stats.active)} icon={<Users className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statPolicies")} value={String(stats.policies)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statClaims")} value={String(stats.claims)} icon={<Shield className="h-4 w-4" />} />
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
            {["prospect","active","inactive","deceased"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchHolders(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={holders as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onRowClick={(item: any) => router.push(`/insurance/${(item as PolicyHolder).id}`)}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchHolders(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
