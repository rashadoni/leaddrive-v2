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
  Tv2, Users, Star, Megaphone,
  Search, Plus, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Subscriber {
  id: string
  subscriberNumber: string
  displayName: string
  email: string | null
  tierSlug: string
  billingRegion: string | null
  status: string
  trialStartedAt: string | null
  activatedAt: string | null
  churnedAt: string | null
  lifetimeRevenueCents: string
  createdAt: string
}

interface Stats {
  total: number
  active: number
  premium: number
  campaigns: number
}

const SUBSCRIBER_STATUS_COLORS: Record<string, string> = {
  trial:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  active:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  churned: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  banned:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function MediaSubscribersPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("media")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, premium: 0, campaigns: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchSubscribers = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/media-subscribers?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.subscribers) {
        setSubscribers(prev => reset ? json.subscribers : [...prev, ...json.subscribers])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const s: Subscriber[] = json.subscribers
          setStats(prev => ({
            ...prev,
            total: s.length,
            active: s.filter(x => x.status === "active").length,
            premium: s.filter(x => x.tierSlug === "premium").length,
          }))
        }
      }
    } catch (err) {
      console.error("[media/subscribers]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  const fetchCampaignCount = useCallback(async () => {
    if (!orgId) return
    try {
      const res = await fetch(`/api/v1/media-ad-campaigns?limit=1`, { headers })
      if (res.ok) {
        const j = await res.json()
        if (j.campaigns) setStats(s => ({ ...s, campaigns: j.campaigns.length }))
      }
    } catch { /* non-critical */ }
  }, [orgId])

  useEffect(() => {
    fetchSubscribers(true)
    fetchCampaignCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchSubscribers(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`subscriberStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const fmtRevenue = (v: string) => {
    const cents = parseInt(v, 10)
    if (isNaN(cents)) return "—"
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100)
  }

  const columns = [
    {
      key: "subscriberNumber",
      label: t("colSubscriberNumber"),
      sortable: true,
      render: (item: Subscriber) => (
        <span className="font-mono text-xs text-muted-foreground">{item.subscriberNumber}</span>
      ),
    },
    {
      key: "displayName",
      label: t("colName"),
      sortable: true,
      render: (item: Subscriber) => (
        <div>
          <div className="font-medium text-sm">{item.displayName}</div>
          {item.email && <div className="text-xs text-muted-foreground">{item.email}</div>}
        </div>
      ),
    },
    {
      key: "tierSlug",
      label: t("colPlan"),
      sortable: true,
      render: (item: Subscriber) => (
        <span className="text-sm capitalize">{item.tierSlug}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: Subscriber) => (
        <Badge className={cn("text-xs", SUBSCRIBER_STATUS_COLORS[item.status] || SUBSCRIBER_STATUS_COLORS.churned)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "lifetimeRevenueCents",
      label: t("colRevenue"),
      sortable: true,
      render: (item: Subscriber) => (
        <span className="text-sm text-muted-foreground">{fmtRevenue(item.lifetimeRevenueCents)}</span>
      ),
    },
  ]

  return (
    <MotionPage>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-fuchsia-500/10 rounded-lg">
              <Tv2 className="h-6 w-6 text-fuchsia-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("title")} <HelpButton slug="media-overview" variant="label" /></h1>
              <PageDescription text={t("subtitle")} />
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newSubscriber")}
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
            <ColorStatCard label={t("statPremium")} value={String(stats.premium)} icon={<Star className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statCampaigns")} value={String(stats.campaigns)} icon={<Megaphone className="h-4 w-4" />} />
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
            {["trial", "active", "paused", "churned", "banned"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchSubscribers(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={subscribers as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onRowClick={(item: any) => router.push(`/media/${(item as Subscriber).id}`)}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchSubscribers(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
