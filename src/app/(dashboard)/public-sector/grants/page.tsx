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
  Landmark, DollarSign, CheckCircle, XCircle,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface PublicSectorGrant {
  id: string
  grantNumber: string
  programSlug: string
  status: string
  citizenId: string | null
  caseId: string | null
  assignedOfficialId: string | null
  requestedAmount: string
  approvedAmount: string | null
  disbursedAmount: string | null
  currency: string
  submittedAt: string
  approvedAt: string | null
  disbursedAt: string | null
  createdAt: string
}

interface Stats {
  total: number
  active: number
  disbursed: number
  revoked: number
}

const GRANT_STATUS_COLORS: Record<string, string> = {
  submitted:    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  under_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  approved:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  disbursing:   "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  disbursed:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  denied:       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  withdrawn:    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  cancelled:    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
}

export default function PublicSectorGrantsPage() {
  const { data: session } = useSession()
  const t = useTranslations("publicSector")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [grants, setGrants] = useState<PublicSectorGrant[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, disbursed: 0, revoked: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchGrants = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("grantNumberSearch", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/public-sector-grants?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.grants) {
        setGrants(prev => reset ? json.grants : [...prev, ...json.grants])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const g: PublicSectorGrant[] = json.grants
          setStats({
            total:     g.length,
            active:    g.filter(x => ["approved","disbursing"].includes(x.status)).length,
            disbursed: g.filter(x => x.status === "disbursed").length,
            revoked:   g.filter(x => ["denied","cancelled","withdrawn"].includes(x.status)).length,
          })
        }
      }
    } catch (err) {
      console.error("[public-sector/grants]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchGrants(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchGrants(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`grantStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const fmtAmount = (v: string | null, currency: string) =>
    v == null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currency || "USD",
          maximumFractionDigits: 0,
        }).format(Number(v))

  const columns = [
    {
      key: "grantNumber",
      label: t("colGrantNumber"),
      sortable: true,
      render: (item: PublicSectorGrant) => (
        <span className="font-mono text-xs text-muted-foreground">{item.grantNumber}</span>
      ),
    },
    {
      key: "programSlug",
      label: t("colProgramName"),
      sortable: true,
      render: (item: PublicSectorGrant) => (
        <span className="text-sm font-medium">{item.programSlug}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: PublicSectorGrant) => (
        <Badge className={cn("text-xs", GRANT_STATUS_COLORS[item.status] || GRANT_STATUS_COLORS.submitted)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "requestedAmount",
      label: t("colAmount"),
      sortable: true,
      render: (item: PublicSectorGrant) => (
        <span className="text-sm text-muted-foreground">
          {fmtAmount(item.approvedAmount ?? item.requestedAmount, item.currency)}
        </span>
      ),
    },
    {
      key: "submittedAt",
      label: t("colStartDate"),
      sortable: true,
      render: (item: PublicSectorGrant) => (
        <span className="text-xs text-muted-foreground">
          {new Date(item.submittedAt).toLocaleDateString()}
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
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("grantsPageTitle")}<HelpButton slug="public-sector-grants" variant="label" /></h1>
              <PageDescription text={t("grantsPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("grantStatTotal")} value={String(stats.total)} icon={<DollarSign className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("grantStatActive")} value={String(stats.active)} icon={<DollarSign className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("grantStatDisbursed")} value={String(stats.disbursed)} icon={<CheckCircle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("grantStatRevoked")} value={String(stats.revoked)} icon={<XCircle className="h-4 w-4" />} />
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
            {["submitted","under_review","approved","disbursing","disbursed","denied","withdrawn","cancelled"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchGrants(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={grants as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchGrants(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
