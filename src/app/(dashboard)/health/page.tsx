"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { DataTable } from "@/components/data-table"
import {
  HeartPulse, Users, ClipboardPlus, FileCheck,
  Search, Plus, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Patient {
  id: string
  mrn: string
  fullName: string
  email: string | null
  phone: string | null
  status: string
  primaryProviderId: string | null
  registeredAt: string | null
  createdAt: string
}

interface Stats {
  total: number
  active: number
  encounters30d: number
  activePlans: number
}

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  deceased: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function HealthPatientsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const t = useTranslations("health")
  const locale = useLocale()
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [patients, setPatients] = useState<Patient[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, encounters30d: 0, activePlans: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const fetchPatients = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (search.trim()) params.set("search", search.trim())
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/health-patients?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.patients) {
        setPatients(prev => reset ? json.patients : [...prev, ...json.patients])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)

        // Compute stats from current full list (or use server stats when available)
        if (reset) {
          const activeCount = (json.patients as Patient[]).filter(p => p.status === "active").length
          setStats(s => ({ ...s, total: json.patients.length, active: activeCount }))
        }
      }
    } catch (err) {
      console.error("[health/patients]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, search, cursor, headers])

  // Also fetch encounter + care-plan counts
  const fetchCounters = useCallback(async () => {
    if (!orgId) return
    try {
      const [encRes, cpRes] = await Promise.allSettled([
        fetch(`/api/v1/health-encounters?limit=1`, { headers }),
        fetch(`/api/v1/health-care-plans?status=active&limit=1`, { headers }),
      ])
      // We just want approximate counts from hasMore signal
      if (encRes.status === "fulfilled" && encRes.value.ok) {
        const j = await encRes.value.json()
        if (j.encounters) setStats(s => ({ ...s, encounters30d: j.encounters.length }))
      }
      if (cpRes.status === "fulfilled" && cpRes.value.ok) {
        const j = await cpRes.value.json()
        if (j.plans) setStats(s => ({ ...s, activePlans: j.plans.length }))
      }
    } catch { /* non-critical */ }
  }, [orgId])

  useEffect(() => {
    fetchPatients(true)
    fetchCounters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetchPatients(true), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { active: t("statusActive"), inactive: t("statusInactive"), deceased: t("statusDeceased") }
    return map[s] || s
  }

  const columns = [
    {
      key: "mrn",
      label: t("colMrn"),
      sortable: true,
      render: (item: Patient) => (
        <span className="font-mono text-xs text-muted-foreground">{item.mrn}</span>
      ),
    },
    {
      key: "fullName",
      label: t("colName"),
      sortable: true,
      render: (item: Patient) => (
        <div>
          <div className="font-medium">{item.fullName}</div>
          {item.email && (
            <div className="text-xs text-muted-foreground">{item.email}</div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      sortable: true,
      render: (item: Patient) => (
        <Badge className={cn("text-xs", STATUS_COLORS[item.status] || STATUS_COLORS.inactive)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "phone",
      label: t("colPhone"),
      render: (item: Patient) => (
        <span className="text-sm text-muted-foreground">{item.phone || "—"}</span>
      ),
    },
    {
      key: "createdAt",
      label: t("colRegistered"),
      sortable: true,
      render: (item: Patient) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(item.registeredAt || item.createdAt, locale)}
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
            <div className="p-2 bg-rose-500/10 rounded-lg">
              <HeartPulse className="h-6 w-6 text-rose-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("title")} <HelpButton slug="health-overview" variant="label" /></h1>
              <PageDescription text={t("subtitle")} />
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newPatient")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard
              label={t("statTotalPatients")}
              value={String(stats.total)}
              icon={<Users className="h-4 w-4" />}
             
            />
          </MotionItem>
          <MotionItem>
            <ColorStatCard
              label={t("statActive")}
              value={String(stats.active)}
              icon={<HeartPulse className="h-4 w-4" />}
             
            />
          </MotionItem>
          <MotionItem>
            <ColorStatCard
              label={t("statEncounters")}
              value={String(stats.encounters30d)}
              icon={<ClipboardPlus className="h-4 w-4" />}
             
            />
          </MotionItem>
          <MotionItem>
            <ColorStatCard
              label={t("statCarePlans")}
              value={String(stats.activePlans)}
              icon={<FileCheck className="h-4 w-4" />}
             
            />
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
            <option value="active">{t("statusActive")}</option>
            <option value="inactive">{t("statusInactive")}</option>
            <option value="deceased">{t("statusDeceased")}</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPatients(true)}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={patients as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onRowClick={(item: any) => router.push(`/health/${(item as Patient).id}`)}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPatients(false)}
              disabled={loading}
            >
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
