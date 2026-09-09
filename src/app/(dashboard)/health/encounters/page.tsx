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
  ClipboardPlus, RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MotionPage, MotionItem } from "@/components/ui/motion"

interface Encounter {
  id: string
  patientId: string
  providerId: string | null
  encounterType: string
  status: string
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  location: string | null
  reason: string | null
  completedAt: string | null
  cancelledAt: string | null
  noShowAt: string | null
  createdAt: string
}

const ENCOUNTER_STATUS_COLORS: Record<string, string> = {
  scheduled:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  checked_in:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  in_progress: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  completed:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  no_show:     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const ENCOUNTER_STATUSES = ["scheduled", "checked_in", "in_progress", "completed", "cancelled", "no_show"]

export default function HealthEncountersPage() {
  const { data: session } = useSession()
  const t = useTranslations("health")
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totals, setTotals] = useState({ total: 0, scheduled: 0, completed: 0, noShow: 0 })

  const fetchEncounters = useCallback(async (reset = false) => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (statusFilter) params.set("status", statusFilter)
      if (!reset && cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/v1/health-encounters?${params}`, { headers })
      const json = await res.json()
      if (res.ok && json.encounters) {
        setEncounters(prev => reset ? json.encounters : [...prev, ...json.encounters])
        setHasMore(json.hasMore ?? false)
        setCursor(json.nextCursor ?? null)
        if (reset) {
          const enc: Encounter[] = json.encounters
          setTotals({
            total: enc.length,
            scheduled:  enc.filter(e => e.status === "scheduled").length,
            completed:  enc.filter(e => e.status === "completed").length,
            noShow:     enc.filter(e => e.status === "no_show").length,
          })
        }
      }
    } catch (err) {
      console.error("[health/encounters]", err)
    } finally {
      setLoading(false)
    }
  }, [orgId, statusFilter, cursor, headers])

  useEffect(() => {
    fetchEncounters(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  const statusLabel = (s: string) =>
    t(`encStatus_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const typeLabel = (s: string) =>
    t(`encType_${s}` as Parameters<typeof t>[0], { fallback: s }) ?? s

  const columns = [
    {
      key: "encounterType",
      label: t("encounterType"),
      sortable: true,
      render: (item: Encounter) => (
        <span className="text-sm font-medium capitalize">{typeLabel(item.encounterType)}</span>
      ),
    },
    {
      key: "status",
      label: t("encounterStatus"),
      sortable: true,
      render: (item: Encounter) => (
        <Badge className={cn("text-xs", ENCOUNTER_STATUS_COLORS[item.status] || ENCOUNTER_STATUS_COLORS.scheduled)}>
          {statusLabel(item.status)}
        </Badge>
      ),
    },
    {
      key: "scheduledStartAt",
      label: t("encounterDate"),
      sortable: true,
      render: (item: Encounter) => (
        <span className="text-sm text-muted-foreground">
          {item.scheduledStartAt
            ? new Date(item.scheduledStartAt).toLocaleDateString()
            : "—"}
        </span>
      ),
    },
    {
      key: "location",
      label: t("encLocation"),
      render: (item: Encounter) => (
        <span className="text-sm text-muted-foreground">{item.location || "—"}</span>
      ),
    },
    {
      key: "reason",
      label: t("encReason"),
      render: (item: Encounter) => (
        <span className="text-sm text-muted-foreground line-clamp-1">{item.reason || "—"}</span>
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
              <ClipboardPlus className="h-6 w-6 text-violet-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">{t("encPageTitle")}<HelpButton slug="health-encounters" variant="label" /></h1>
              <PageDescription text={t("encPageSubtitle")} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MotionItem>
            <ColorStatCard label={t("encStatTotal")} value={String(totals.total)} icon={<ClipboardPlus className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("encStatScheduled")} value={String(totals.scheduled)} icon={<ClipboardPlus className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("encStatCompleted")} value={String(totals.completed)} icon={<ClipboardPlus className="h-4 w-4" />} />
          </MotionItem>
          <MotionItem>
            <ColorStatCard label={t("encStatNoShow")} value={String(totals.noShow)} icon={<ClipboardPlus className="h-4 w-4" />} />
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
            {ENCOUNTER_STATUSES.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>

          <Button variant="outline" size="sm" onClick={() => fetchEncounters(true)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Table */}
        <DataTable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={encounters as any[]}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          columns={columns as any}
        />

        {/* Load More */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => fetchEncounters(false)} disabled={loading}>
              {t("loadMore")}
            </Button>
          </div>
        )}
      </div>
    </MotionPage>
  )
}
