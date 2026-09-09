"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DataTable } from "@/components/data-table"
import {
  Landmark, Users, FileText, BookOpen,
  Search, Plus, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Citizen {
  id: string
  citizenNumber: string
  fullName: string
  email: string | null
  phone: string | null
  status: string
  jurisdictionSlug: string | null
  createdAt: string
}

interface Stats {
  total: number
  active: number
  cases: number
  licenses: number
}

const CITIZEN_STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  deceased: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function PublicSectorCitizensPage() {
  const { data: session } = useSession()
  const t = useTranslations("publicSector")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [citizens, setCitizens] = useState<Citizen[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, cases: 0, licenses: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchCitizens = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/citizens?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.citizens) {
        setCitizens(prev => reset ? json.citizens : [...prev, ...json.citizens])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const c: Citizen[] = json.citizens
          setStats(s => ({
            ...s,
            total: c.length,
            active: c.filter(x => x.status === "active").length,
          }))
        }
      }
    } catch (err) {
      console.error("[public-sector/citizens]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  const fetchCounters = useCallback(async () => {
    if (!orgId) return
    try {
      const [caseRes, licRes] = await Promise.allSettled([
        fetch(`/api/v1/public-sector-cases?limit=1`, { headers }),
        fetch(`/api/v1/public-sector-licenses?limit=1`, { headers }),
      ])
      if (caseRes.status === "fulfilled" && caseRes.value.ok) {
        const j = await caseRes.value.json()
        if (j.cases) setStats(s => ({ ...s, cases: j.cases.length }))
      }
      if (licRes.status === "fulfilled" && licRes.value.ok) {
        const j = await licRes.value.json()
        if (j.licenses) setStats(s => ({ ...s, licenses: j.licenses.length }))
      }
    } catch { /* non-critical */ }
  }, [orgId])

  useEffect(() => {
    fetchCitizens(true)
    fetchCounters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  useEffect(() => {
    const id = setTimeout(() => fetchCitizens(true), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) =>
    t(`citizenStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "citizenNumber",
      label: t("colCitizenId"),
      sortable: true,
      render: (item: Citizen) => (
        <span className="font-mono text-xs text-muted-foreground">{item.citizenNumber}</span>
      ),
    },
    {
      key: "fullName",
      label: t("colName"),
      sortable: true,
      render: (item: Citizen) => (
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
      render: (item: Citizen) => (
        <Badge className={cn("text-xs", CITIZEN_STATUS_COLORS[item.status] || CITIZEN_STATUS_COLORS.inactive)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "jurisdictionSlug",
      label: t("colCity"),
      render: (item: Citizen) => (
        <span className="text-sm text-muted-foreground">{item.jurisdictionSlug || "—"}</span>
      ),
    },
    {
      key: "createdAt",
      label: t("colCreated"),
      sortable: true,
      render: (item: Citizen) => (
        <span className="text-xs text-muted-foreground">
          {new Date(item.createdAt).toLocaleDateString()}
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
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("title")} <HelpButton slug="public-sector-overview" variant="label" /></h1>
              <PageDescription text={t("subtitle")} />
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newCitizen")}
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
            <ColorStatCard label={t("statCases")} value={String(stats.cases)} icon={<FileText className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("statLicenses")} value={String(stats.licenses)} icon={<BookOpen className="h-4 w-4" />} />
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
            {["active", "inactive", "deceased"].map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchCitizens(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={citizens as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchCitizens(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
