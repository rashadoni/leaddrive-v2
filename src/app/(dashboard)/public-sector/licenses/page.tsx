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
  Landmark, BookOpen, CheckCircle, XCircle,
  Search, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"
import { HelpButton } from "@/components/help/help-button"

interface PublicSectorLicense {
  id: string
  licenseNumber: string
  licenseType: string
  status: string
  citizenId: string | null
  caseId: string | null
  issuingOfficialId: string | null
  appliedAt: string
  issuedAt: string | null
  expiresAt: string | null
  feeAmount: string | null
  feeCurrency: string
  createdAt: string
}

interface Stats {
  total: number
  active: number
  expired: number
  revoked: number
}

const LICENSE_STATUS_COLORS: Record<string, string> = {
  applied:      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  under_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  issued:       "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  denied:       "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired:      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  suspended:    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  revoked:      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
}

export default function PublicSectorLicensesPage() {
  const { data: session } = useSession()
  const t = useTranslations("publicSector")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [licenses, setLicenses] = useState<PublicSectorLicense[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, expired: 0, revoked: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchLicenses = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("licenseNumberSearch", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/public-sector-licenses?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.licenses) {
        setLicenses(prev => reset ? json.licenses : [...prev, ...json.licenses])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const l: PublicSectorLicense[] = json.licenses
          setStats({
            total:   l.length,
            active:  l.filter(x => x.status === "issued").length,
            expired: l.filter(x => x.status === "expired").length,
            revoked: l.filter(x => x.status === "revoked").length,
          })
        }
      }
    } catch (err) {
      console.error("[public-sector/licenses]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  useEffect(() => {
    fetchLicenses(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchLicenses(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`licStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "licenseNumber",
      label: t("colLicNumber"),
      sortable: true,
      render: (item: PublicSectorLicense) => (
        <span className="font-mono text-xs text-muted-foreground">{item.licenseNumber}</span>
      ),
    },
    {
      key: "licenseType",
      label: t("colType"),
      sortable: true,
      render: (item: PublicSectorLicense) => (
        <span className="text-sm font-medium capitalize">{item.licenseType.replace(/_/g, " ")}</span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: PublicSectorLicense) => (
        <Badge className={cn("text-xs", LICENSE_STATUS_COLORS[item.status] || LICENSE_STATUS_COLORS.applied)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "issuedAt",
      label: t("colIssuedDate"),
      sortable: true,
      render: (item: PublicSectorLicense) => (
        <span className="text-xs text-muted-foreground">
          {item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "expiresAt",
      label: t("colExpiresDate"),
      sortable: true,
      render: (item: PublicSectorLicense) => (
        <span className="text-xs text-muted-foreground">
          {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "—"}
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
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("licensesPageTitle")}<HelpButton slug="public-sector-licenses" variant="label" /></h1>
              <PageDescription text={t("licensesPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("licStatTotal")} value={String(stats.total)} icon={<BookOpen className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("licStatActive")} value={String(stats.active)} icon={<CheckCircle className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("licStatExpired")} value={String(stats.expired)} icon={<BookOpen className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("licStatRevoked")} value={String(stats.revoked)} icon={<XCircle className="h-4 w-4" />} />
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
            {["applied","under_review","issued","denied","expired","suspended","revoked"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchLicenses(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={licenses as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchLicenses(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
