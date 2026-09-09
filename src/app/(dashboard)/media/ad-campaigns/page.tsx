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
  Tv2, Megaphone, Play, DollarSign,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Campaign {
  id: string
  campaignNumber: string
  advertiserCompanyId: string | null
  name: string
  status: string
  campaignGoal: string
  totalBudget: string
  dailyBudgetCap: string | null
  spentAmount: string
  currency: string
  flightStartAt: string | null
  flightEndAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

interface Totals {
  total: number
  active: number
  completed: number
  totalBudget: number
}

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft:      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  scheduled:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  running:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused:     "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed:  "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  cancelled:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function MediaAdCampaignsPage() {
  const { data: session } = useSession()
  const t = useTranslations("media")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [totals, setTotals] = useState<Totals>({ total: 0, active: 0, completed: 0, totalBudget: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchCampaigns = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("campaignNumberSearch", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/media-ad-campaigns?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.campaigns) {
        setCampaigns(prev => reset ? json.campaigns : [...prev, ...json.campaigns])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: Campaign[] = json.campaigns
          setTotals({
            total:       c.length,
            active:      c.filter(x => x.status === "running").length,
            completed:   c.filter(x => x.status === "completed").length,
            totalBudget: c.reduce((sum, x) => sum + parseFloat(x.totalBudget || "0"), 0),
          })
        }
      }
    } catch (err) {
      console.error("[media/ad-campaigns]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchCampaigns(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchCampaigns(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`campaignStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const fmtMoney = (v: string, currency = "USD") => {
    const n = parseFloat(v)
    if (isNaN(n)) return "—"
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)
  }

  const columns = [
    {
      key: "campaignNumber",
      label: t("colCampaignName"),
      sortable: true,
      render: (item: Campaign) => (
        <div>
          <div className="font-medium text-sm">{item.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{item.campaignNumber}</div>
        </div>
      ),
    },
    {
      key: "status",
      label: t("colCampaignStatus"),
      sortable: true,
      render: (item: Campaign) => (
        <Badge className={cn("text-xs", CAMPAIGN_STATUS_COLORS[item.status] || CAMPAIGN_STATUS_COLORS.draft)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "totalBudget",
      label: t("colBudget"),
      sortable: true,
      render: (item: Campaign) => (
        <span className="text-sm text-muted-foreground">{fmtMoney(item.totalBudget, item.currency)}</span>
      ),
    },
    {
      key: "spentAmount",
      label: t("colSpent"),
      sortable: true,
      render: (item: Campaign) => (
        <span className="text-sm text-muted-foreground">{fmtMoney(item.spentAmount, item.currency)}</span>
      ),
    },
    {
      key: "flightStartAt",
      label: t("colStartDate"),
      sortable: true,
      render: (item: Campaign) => (
        <span className="text-xs text-muted-foreground">
          {item.flightStartAt ? new Date(item.flightStartAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "flightEndAt",
      label: t("colEndDate"),
      sortable: true,
      render: (item: Campaign) => (
        <span className="text-xs text-muted-foreground">
          {item.flightEndAt ? new Date(item.flightEndAt).toLocaleDateString() : "—"}
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
            <div className="p-2 bg-fuchsia-500/10 rounded-lg">
              <Tv2 className="h-6 w-6 text-fuchsia-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                {t("campaignsPageTitle")}
                <HelpButton slug="media-ad-campaigns" variant="label" />
              </h1>
              <PageDescription text={t("campaignsPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("campaignStatTotal")} value={String(totals.total)} icon={<Megaphone className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("campaignStatActive")} value={String(totals.active)} icon={<Play className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("campaignStatCompleted")} value={String(totals.completed)} icon={<Megaphone className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("campaignStatBudget")} value={fmtMoney(String(totals.totalBudget))} icon={<DollarSign className="h-4 w-4" />} />
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
            {["draft", "scheduled", "running", "paused", "completed", "cancelled"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchCampaigns(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={campaigns as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchCampaigns(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
