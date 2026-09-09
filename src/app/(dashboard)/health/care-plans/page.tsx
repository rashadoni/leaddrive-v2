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
  FileCheck, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface CarePlan {
  id: string
  patientId: string
  providerId: string | null
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  activatedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  createdAt: string
}

const CARE_PLAN_STATUS_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  active:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const CARE_PLAN_STATUSES = ["draft", "active", "paused", "completed", "cancelled"]

export default function HealthCarePlansPage() {
  const { data: session } = useSession()
  const t = useTranslations("health")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [plans, setPlans] = useState<CarePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totals, setTotals] = useState({ total: 0, active: 0, completed: 0, draft: 0 })

  const fetchPlans = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/health-care-plans?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.plans) {
        setPlans(prev => reset ? json.plans : [...prev, ...json.plans])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const p: CarePlan[] = json.plans
          setTotals({
            total:     p.length,
            active:    p.filter(x => x.status === "active").length,
            completed: p.filter(x => x.status === "completed").length,
            draft:     p.filter(x => x.status === "draft").length,
          })
        }
      }
    } catch (err) {
      console.error("[health/care-plans]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, cursor, headers])

  useEffect(() => {
    fetchPlans(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  const statusLabel = (s: string) =>
    t(`cpStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "name",
      label: t("carePlanName"),
      sortable: true,
      render: (item: CarePlan) => (
        <span className="font-medium text-sm">{item.name}</span>
      ),
    },
    {
      key: "status",
      label: t("carePlanStatus"),
      sortable: true,
      render: (item: CarePlan) => (
        <Badge className={cn("text-xs", CARE_PLAN_STATUS_COLORS[item.status] || CARE_PLAN_STATUS_COLORS.draft)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "startDate",
      label: t("carePlanStartDate"),
      sortable: true,
      render: (item: CarePlan) => (
        <span className="text-sm text-muted-foreground">
          {item.startDate ? new Date(item.startDate).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "endDate",
      label: t("carePlanEndDate"),
      render: (item: CarePlan) => (
        <span className="text-sm text-muted-foreground">
          {item.endDate ? new Date(item.endDate).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      key: "activatedAt",
      label: t("cpActivated"),
      render: (item: CarePlan) => (
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
            <div className="p-2 bg-teal-500/10 rounded-lg">
              <FileCheck className="h-6 w-6 text-teal-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("cpPageTitle")}<HelpButton slug="health-care-plans" variant="label" /></h1>
              <PageDescription text={t("cpPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("cpStatTotal")} value={String(totals.total)} icon={<FileCheck className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("cpStatActive")} value={String(totals.active)} icon={<FileCheck className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("cpStatCompleted")} value={String(totals.completed)} icon={<FileCheck className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("cpStatDraft")} value={String(totals.draft)} icon={<FileCheck className="h-4 w-4" />} />
          </MotionItem>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{t("allStatuses")}</option>
            {CARE_PLAN_STATUSES.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchPlans(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={plans as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchPlans(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
