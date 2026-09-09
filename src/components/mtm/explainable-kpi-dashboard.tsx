"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  Filter,
  History,
  ListChecks,
  MapPinned,
  RefreshCw,
  Route,
  Sigma,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  aggregateExplainableKpiTrend,
  type ExplainableKpiTrendGranularity,
  type ExplainableKpiTrendPoint,
} from "@/lib/mtm/explainable-kpi"
import { createDateFormatter } from "@/lib/format-date"

type VisitType = "ALL" | "DOUBLE" | "INDEPENDENT"
type LoadState = "loading" | "recalculating" | "ready" | "error"
type MetricKey = "plan" | "gps"
type DrilldownBucket = "numerator" | "denominator" | "exclusions" | "gpsDays"
type GpsEvidenceState = "CONFIRMED" | "MISSING_CHECK_IN" | "MISSING_CHECK_OUT" | "INVALID_CHECK_IN" | "INVALID_CHECK_OUT" | "MANUALLY_EXCLUDED"

type Ratio = {
  numerator: number
  denominator: number
  percentage: number
}

type PlanFact = {
  routePointId: string
  routeId?: string
  agentId: string
  agentName: string
  customerId: string
  customerName: string
  contactId: string | null
  date: string
  visitType: string
  brandIds: string[]
  completed: boolean
  attributedAgentIds?: string[]
  attributedAgents?: Array<{ id: string; name: string }>
  sourceAgentId?: string | null
  sourceAgentName?: string | null
  adjustable?: boolean
}

type VisitFact = {
  visitId: string
  agentId: string
  agentName: string
  customerId: string
  customerName: string
  contactId: string | null
  routePointId: string | null
  date: string
  visitType: string
  brandIds: string[]
  completed: boolean
  gpsConfirmed: boolean
  gpsEvidenceState?: GpsEvidenceState
  attributedAgentIds?: string[]
  attributedAgents?: Array<{ id: string; name: string }>
  sourceAgentId?: string | null
  sourceAgentName?: string | null
  adjustable?: boolean
}

type ExplainableKpiReport = {
  formula: {
    version: string
    generatedAt: string
    sourceUpdatedAt: string | null
    sourceFreshness: "CURRENT" | "LATE" | "HISTORICAL" | "NO_SOURCE"
    sourceFreshnessThresholdMinutes?: number
    completeness: "COMPLETE" | "PARTIAL"
    calculationState: "READY" | "RECALCULATING"
    authoritative: boolean
    authorityReason?: "SIGNED_POLICY" | "UNSIGNED_POLICY" | "PARTIAL_DATA"
    policy?: {
      id: string
      code: string
      version: number
      definitionHash: string
      approvalReference: string
      effectiveFrom: string
      effectiveTo: string | null
    } | null
    planDefinition: string
    gpsDefinition: string
    exclusions: string[]
    adjustments: KpiAdjustment[]
  }
  plan: Ratio
  gps: Ratio
  totals: {
    planned: number
    completedPlan: number
    completedVisits: number
    gpsConfirmedVisits: number
  }
  trend: ExplainableKpiTrendPoint[]
  drilldown: {
    planNumerator: PlanFact[]
    planDenominator: PlanFact[]
    gpsNumerator: VisitFact[]
    gpsDenominator: VisitFact[]
    gpsDays: GpsDay[]
    exclusions: {
      planPoints: PlanFact[]
      visits: VisitFact[]
    }
  }
}

type GpsDay = {
  agentId: string
  agentName: string
  date: string
  completedVisits: number
  gpsConfirmedVisits: number
  visitIds: string[]
  gpsEvidenceStates: Record<string, number>
  sourceAgents?: Array<{ id: string; name: string }>
  workdayId?: string | null
  workdayState?: string
  evidenceSource: string
}

type KpiAdjustment = {
  factType: "PLAN_POINT" | "GPS_VISIT"
  factId: string
  action: "EXCLUDE" | "RESTORE"
  reason: string
  createdAt: string
  actorAgentId: string | null
  auditId?: string
}

type KpiAgent = {
  id: string
  name: string
  teamId: string | null
  team?: { name: string } | null
}

type KpiResponseData = {
  snapshotId?: string
  scope?: {
    from: string
    toExclusive: string
    teamId: string | null
    agentId: string | null
    visitType: VisitType
    brandId: string | null
    timezone: string
  }
  agents?: KpiAgent[]
  teams?: Array<{ id: string; name: string }>
  brands?: Array<{ id: string; name: string }>
  report: ExplainableKpiReport | null
  outOfScope?: boolean
  contract?: {
    workforceEnabled?: boolean
    maxFacts: number
    maxAgents?: number
    truncated: boolean
    truncationReasons?: Array<{ cohort: string; limit: number }>
    partialLimit?: number | null
    brandSource: string
  }
}

type AppliedFilters = {
  from: string
  to: string
  teamId: string
  agentId: string
  visitType: VisitType
  brandId: string
}

type DrilldownSelection = {
  metric: MetricKey
  bucket: DrilldownBucket
}

type AdjustmentEditor = {
  factType: "PLAN_POINT" | "GPS_VISIT"
  factId: string
  action: "EXCLUDE" | "RESTORE"
}

export interface ExplainableKpiDashboardProps {
  orgId?: string
  className?: string
}

const PAGE_SIZE = 50

const VISIT_TYPE_LABELS: Record<VisitType, "visitTypeAll" | "visitTypeDouble" | "visitTypeIndependent"> = {
  ALL: "visitTypeAll",
  DOUBLE: "visitTypeDouble",
  INDEPENDENT: "visitTypeIndependent",
}

const BASELINE_EXCLUSION_LABELS: Record<string, "exclusionDraftRoutes" | "exclusionCancelledRoutes" | "exclusionCancelledVisits" | "exclusionSoftDeleted"> = {
  "draft routes": "exclusionDraftRoutes",
  "cancelled routes": "exclusionCancelledRoutes",
  "cancelled visits": "exclusionCancelledVisits",
  "soft-deleted records": "exclusionSoftDeleted",
}

const SOURCE_FRESHNESS_LABELS: Record<ExplainableKpiReport["formula"]["sourceFreshness"], "sourceCurrent" | "sourceLate" | "sourceHistorical" | "sourceMissing"> = {
  CURRENT: "sourceCurrent",
  LATE: "sourceLate",
  HISTORICAL: "sourceHistorical",
  NO_SOURCE: "sourceMissing",
}

const GPS_EVIDENCE_LABELS: Record<GpsEvidenceState, "evidenceConfirmed" | "evidenceMissingCheckIn" | "evidenceMissingCheckOut" | "evidenceInvalidCheckIn" | "evidenceInvalidCheckOut" | "evidenceManuallyExcluded"> = {
  CONFIRMED: "evidenceConfirmed",
  MISSING_CHECK_IN: "evidenceMissingCheckIn",
  MISSING_CHECK_OUT: "evidenceMissingCheckOut",
  INVALID_CHECK_IN: "evidenceInvalidCheckIn",
  INVALID_CHECK_OUT: "evidenceInvalidCheckOut",
  MANUALLY_EXCLUDED: "evidenceManuallyExcluded",
}

const WORKDAY_STATE_LABELS: Record<string, "workdayStarted" | "workdayPaused" | "workdayCompleted" | "workdayNotRecorded"> = {
  STARTED: "workdayStarted",
  PAUSED: "workdayPaused",
  COMPLETED: "workdayCompleted",
  NOT_RECORDED: "workdayNotRecorded",
}

const EVIDENCE_SOURCE_LABELS: Record<string, "evidenceSourceVisitCoordinates"> = {
  VISIT_COORDINATES: "evidenceSourceVisitCoordinates",
}

function isGpsEvidenceState(value: string): value is GpsEvidenceState {
  return value in GPS_EVIDENCE_LABELS
}

function emptyFilters(): AppliedFilters {
  return {
    from: "",
    to: "",
    teamId: "",
    agentId: "",
    visitType: "ALL",
    brandId: "",
  }
}

function inclusiveEndDate(exclusiveDate: string): string {
  const value = new Date(`${exclusiveDate}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

function exclusiveEndDate(inclusiveDate: string): string {
  const value = new Date(`${inclusiveDate}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) merged.set(item.id, item)
  return [...merged.values()].sort((left, right) => {
    const leftLabel = "name" in left && typeof left.name === "string" ? left.name : left.id
    const rightLabel = "name" in right && typeof right.name === "string" ? right.name : right.id
    return leftLabel.localeCompare(rightLabel)
  })
}

function MetricLedger({
  metric,
  ratio,
  definition,
  active,
  onOpen,
}: {
  metric: MetricKey
  ratio: Ratio
  definition: string
  active: DrilldownSelection | null
  onOpen: (selection: DrilldownSelection) => void
}) {
  const t = useTranslations("mtmExplainableKpi")
  const locale = useLocale()
  const isPlan = metric === "plan"
  const Icon = isPlan ? ListChecks : MapPinned
  const accent = isPlan ? "bg-primary" : "bg-teal-600 dark:bg-teal-500"
  const buckets: DrilldownBucket[] = isPlan
    ? ["numerator", "denominator", "exclusions"]
    : ["numerator", "denominator", "gpsDays", "exclusions"]

  return (
    <article className="min-w-0 border-y border-zinc-200 bg-card px-4 py-5 dark:border-zinc-700 sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", isPlan ? "bg-primary/10 text-primary" : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300")}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t(isPlan ? "planTitle" : "gpsTitle")}</h3>
            <p className="mt-0.5 max-w-[62ch] text-xs leading-5 text-muted-foreground">{definition}</p>
          </div>
        </div>
        <strong className="shrink-0 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
          {ratio.percentage.toLocaleString(locale, { maximumFractionDigits: 1 })}%
        </strong>
      </div>

      <div className="mt-5" role="progressbar" aria-label={t("attainmentAria", { value: ratio.percentage })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio.percentage}>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-transform duration-300", accent)} style={{ width: `${Math.max(0, Math.min(100, ratio.percentage))}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm tabular-nums">
            <strong>{ratio.numerator.toLocaleString(locale)}</strong>
            <span className="text-muted-foreground"> / {ratio.denominator.toLocaleString(locale)}</span>
          </span>
          <span className="text-xs text-muted-foreground">{t("numeratorOverDenominator")}</span>
        </div>
      </div>

      <div className={cn("mt-4 grid gap-1 rounded-lg bg-muted/60 p-1", isPlan ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
        {buckets.map((bucket) => {
          const selected = active?.metric === metric && active.bucket === bucket
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => onOpen({ metric, bucket })}
              aria-pressed={selected}
              className={cn(
                "min-h-11 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10",
                selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
              )}
            >
              {t(bucket)}
            </button>
          )
        })}
      </div>
    </article>
  )
}

function TrendChart({
  points,
  granularity,
  onOpen,
}: {
  points: ExplainableKpiTrendPoint[]
  granularity: ExplainableKpiTrendGranularity
  onOpen: (metric: MetricKey) => void
}) {
  const t = useTranslations("mtmExplainableKpi")
  const locale = useLocale()
  const titleId = useId()
  const descriptionId = useId()
  const width = 860
  const height = 196
  const chartLeft = 42
  const chartRight = 810
  const chartTop = 18
  const chartBottom = 142
  const xFor = (index: number) => points.length <= 1
    ? (chartLeft + chartRight) / 2
    : chartLeft + (index / (points.length - 1)) * (chartRight - chartLeft)
  const yFor = (value: number) => chartBottom - (Math.max(0, Math.min(100, value)) / 100) * (chartBottom - chartTop)
  const maxCount = Math.max(1, ...points.flatMap((point) => [point.planned, point.completed]))
  const countYFor = (value: number) => chartBottom - (Math.max(0, value) / maxCount) * (chartBottom - chartTop)
  const barWidth = Math.max(4, Math.min(13, (chartRight - chartLeft) / Math.max(1, points.length) / 4))
  const planLine = points.map((point, index) => `${xFor(index)},${yFor(point.planPercentage)}`).join(" ")
  const gpsLine = points.map((point, index) => `${xFor(index)},${yFor(point.gpsPercentage)}`).join(" ")
  const labelStep = Math.max(1, Math.ceil(points.length / 6))
  const dateFormatter = createDateFormatter(locale, {
    ...(granularity === "QUARTER" ? { year: "numeric" as const } : granularity === "MONTH" ? { month: "short" as const, year: "2-digit" as const } : { day: "2-digit" as const, month: "short" as const }),
    timeZone: "UTC",
  })
  const dateLabel = (date: string) => {
    const value = new Date(`${date}T00:00:00.000Z`)
    if (granularity === "QUARTER") return t("trendQuarterLabel", { quarter: Math.floor(value.getUTCMonth() / 3) + 1, year: value.getUTCFullYear() })
    return dateFormatter.format(value)
  }

  if (points.length === 0) {
    return (
      <div className="grid min-h-56 place-items-center px-6 text-center">
        <div className="max-w-md">
          <BarChart3 className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">{t("trendEmptyTitle")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("trendEmptyDescription")}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="overflow-x-auto pb-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-h-[220px] min-w-[620px] w-full"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>{t("trendTitle")}</title>
        <desc id={descriptionId}>{t("trendDescription")}</desc>
        {[0, 25, 50, 75, 100].map((value) => {
          const y = yFor(value)
          return (
            <g key={value}>
              <line x1={chartLeft} x2={chartRight} y1={y} y2={y} className="stroke-border" strokeWidth="1" />
              <text x={chartLeft - 8} y={y + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{value}%</text>
            </g>
          )
        })}
        <text x={chartRight + 8} y={chartTop + 4} className="fill-muted-foreground text-[10px] tabular-nums">{maxCount}</text>
        <text x={chartRight + 8} y={chartBottom + 4} className="fill-muted-foreground text-[10px] tabular-nums">0</text>

        {points.map((point, index) => {
          const x = xFor(index)
          const plannedY = countYFor(point.planned)
          const completedY = countYFor(point.completed)
          return (
            <g key={`bars-${point.date}`}>
              <title>{t("trendPointSummary", { date: dateLabel(point.date), planned: point.planned, completed: point.completed, planPercentage: point.planPercentage, gps: point.gps, visits: point.visits, gpsPercentage: point.gpsPercentage })}</title>
              <rect x={x - barWidth - 1} y={plannedY} width={barWidth} height={chartBottom - plannedY} rx="2" className="fill-zinc-300 dark:fill-zinc-600">
                <title>{t("trendPointPlanned", { date: point.date, value: point.planned })}</title>
              </rect>
              <rect x={x + 1} y={completedY} width={barWidth} height={chartBottom - completedY} rx="2" className="fill-primary/55">
                <title>{t("trendPointCompleted", { date: point.date, value: point.completed })}</title>
              </rect>
            </g>
          )
        })}

        {points.length > 1 ? (
          <>
            <polyline points={planLine} fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={gpsLine} fill="none" className="stroke-teal-600 dark:stroke-teal-400" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 6" />
          </>
        ) : null}

        {points.map((point, index) => {
          const x = xFor(index)
          const showLabel = index === 0 || index === points.length - 1 || index % labelStep === 0
          return (
            <g key={point.date}>
              <circle cx={x} cy={yFor(point.planPercentage)} r="4" className="fill-card stroke-primary" strokeWidth="2">
                <title>{t("trendPointPlan", { date: point.date, value: point.planPercentage, numerator: point.completed, denominator: point.planned })}</title>
              </circle>
              <rect x={x - 4} y={yFor(point.gpsPercentage) - 4} width="8" height="8" className="fill-card stroke-teal-600 dark:stroke-teal-400" strokeWidth="2">
                <title>{t("trendPointGps", { date: point.date, value: point.gpsPercentage, numerator: point.gps, denominator: point.visits })}</title>
              </rect>
              {showLabel ? (
                <text x={x} y={chartBottom + 23} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
                  {dateLabel(point.date)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onOpen("plan")}>{t("openPlanLedger")}</Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onOpen("gps")}>{t("openGpsLedger")}</Button>
      </div>
    </div>
  )
}

function LoadingState() {
  const t = useTranslations("mtmExplainableKpi")
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div className="h-24 animate-pulse rounded-lg bg-muted/70" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg bg-muted/70" />
        <div className="h-64 animate-pulse rounded-lg bg-muted/70" />
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-muted/70" />
    </div>
  )
}

export function ExplainableKpiDashboard({ orgId, className }: ExplainableKpiDashboardProps) {
  const t = useTranslations("mtmExplainableKpi")
  const locale = useLocale()
  const [filters, setFilters] = useState<AppliedFilters>(emptyFilters)
  const [hydrated, setHydrated] = useState(false)
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters | null>(null)
  const [data, setData] = useState<KpiResponseData | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [agents, setAgents] = useState<KpiAgent[]>([])
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([])
  const [drilldown, setDrilldown] = useState<DrilldownSelection | null>(null)
  const [visibleFacts, setVisibleFacts] = useState(PAGE_SIZE)
  const [visibleAdjustments, setVisibleAdjustments] = useState(PAGE_SIZE)
  const [adjustmentEditor, setAdjustmentEditor] = useState<AdjustmentEditor | null>(null)
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [adjustmentBusy, setAdjustmentBusy] = useState(false)
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null)
  const [adjustmentNotice, setAdjustmentNotice] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [trendGranularity, setTrendGranularity] = useState<ExplainableKpiTrendGranularity>("DAY")
  const hasLoadedRef = useRef(false)
  const skipNextLoadRef = useRef<string | null>(null)
  const drilldownRef = useRef<HTMLElement>(null)
  const authorityStatusId = useId()

  const rangeDays = filters.from && filters.to
    ? (new Date(`${exclusiveEndDate(filters.to)}T00:00:00.000Z`).getTime() - new Date(`${filters.from}T00:00:00.000Z`).getTime()) / 86_400_000
    : 0
  const bootstrappingRange = hydrated && !filters.from && !filters.to
  const invalidRange = hydrated && !bootstrappingRange && (!filters.from || !filters.to || filters.from > filters.to || rangeDays > 366)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    // Organization switches can happen without a full document reload. Never
    // leave roster labels or a previously calculated report visible while the
    // next tenant-scoped request is resolving.
    hasLoadedRef.current = false
    skipNextLoadRef.current = null
    setData(null)
    setAppliedFilters(null)
    setAgents([])
    setTeams([])
    setBrands([])
    setDrilldown(null)
    setFilters(emptyFilters())
    setAdjustmentEditor(null)
    setAdjustmentReason("")
    setAdjustmentError(null)
    setAdjustmentNotice(null)
    setLoadState("loading")
    setError(null)
  }, [orgId])

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (invalidRange) {
      setError(t("invalidRange"))
      setLoadState(hasLoadedRef.current ? "ready" : "error")
      return
    }
    const filterSignature = JSON.stringify(filters)
    if (skipNextLoadRef.current === filterSignature) {
      skipNextLoadRef.current = null
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams({ visitType: filters.visitType })
    if (!bootstrappingRange) {
      params.set("from", filters.from)
      params.set("to", exclusiveEndDate(filters.to))
    }
    if (filters.teamId) params.set("teamId", filters.teamId)
    if (filters.agentId) params.set("agentId", filters.agentId)
    if (filters.brandId) params.set("brandId", filters.brandId)

    setLoadState(hasLoadedRef.current ? "recalculating" : "loading")
    setError(null)

    async function load() {
      try {
        const response = await fetch(`/api/v1/mtm/kpi?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: orgId ? { "x-organization-id": orgId } : {},
        })
        const result = await response.json().catch(() => null) as { success?: boolean; data?: KpiResponseData } | null
        if (!response.ok || !result?.success || !result.data) throw new Error(t("loadFailed"))

        if (bootstrappingRange) {
          if (!result.data.scope?.from || !result.data.scope.toExclusive) throw new Error(t("loadFailed"))
          const resolvedFilters = {
            ...filters,
            from: result.data.scope.from,
            to: inclusiveEndDate(result.data.scope.toExclusive),
          }
          setData(result.data)
          setAppliedFilters(resolvedFilters)
          setAgents(result.data.agents ?? [])
          setTeams(result.data.teams ?? [])
          setBrands(result.data.brands ?? [])
          hasLoadedRef.current = true
          skipNextLoadRef.current = JSON.stringify(resolvedFilters)
          setFilters(resolvedFilters)
          setLoadState("ready")
          setError(null)
          setExportError(null)
          return
        }

        setData(result.data)
        setAppliedFilters({ ...filters })
        setAgents((current) => mergeById(current, result.data?.agents ?? []))
        setTeams((current) => mergeById(current, result.data?.teams ?? []))
        setBrands((current) => mergeById(current, result.data?.brands ?? []))
        hasLoadedRef.current = true
        setLoadState("ready")
        setError(null)
        setExportError(null)
      } catch (reason) {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : t("loadFailed"))
        setLoadState(hasLoadedRef.current ? "ready" : "error")
      }
    }

    void load()
    return () => controller.abort()
  }, [bootstrappingRange, filters, hydrated, invalidRange, orgId, refreshSequence, t])

  const dateFormatter = useMemo(() => createDateFormatter(locale, { dateStyle: "medium", timeZone: "UTC" }), [locale])
  const dateTimeFormatter = useMemo(
    () => createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short", timeZone: data?.scope?.timezone }),
    [data?.scope?.timezone, locale],
  )

  const filteredAgents = useMemo(
    () => agents.filter((agent) => !filters.teamId || agent.teamId === filters.teamId),
    [agents, filters.teamId],
  )
  const brandNameById = useMemo(() => new Map(brands.map((brand) => [brand.id, brand.name])), [brands])
  const aggregatedTrend = useMemo(
    () => aggregateExplainableKpiTrend(data?.report?.trend ?? [], trendGranularity),
    [data?.report?.trend, trendGranularity],
  )

  const reportedFreshness = data?.report?.formula.sourceFreshness ?? null
  const sourceUpdatedAtMs = data?.report?.formula.sourceUpdatedAt ? new Date(data.report.formula.sourceUpdatedAt).getTime() : null
  const sourceFreshnessThresholdMs = (data?.report?.formula.sourceFreshnessThresholdMinutes ?? 15) * 60_000
  const sourceFreshness = reportedFreshness === "CURRENT" && sourceUpdatedAtMs != null && clock - sourceUpdatedAtMs > sourceFreshnessThresholdMs
    ? "LATE"
    : reportedFreshness
  const freshnessLabel = sourceFreshness ? t(SOURCE_FRESHNESS_LABELS[sourceFreshness]) : null

  const updateTeam = useCallback((teamId: string) => {
    setFilters((current) => {
      const selectedAgent = agents.find((agent) => agent.id === current.agentId)
      return {
        ...current,
        teamId,
        agentId: selectedAgent && teamId && selectedAgent.teamId !== teamId ? "" : current.agentId,
      }
    })
  }, [agents])

  const openDrilldown = useCallback((selection: DrilldownSelection) => {
    setDrilldown(selection)
    setVisibleFacts(PAGE_SIZE)
    setVisibleAdjustments(PAGE_SIZE)
    setAdjustmentEditor(null)
    setAdjustmentReason("")
    setAdjustmentError(null)
    setAdjustmentNotice(null)
    window.requestAnimationFrame(() => drilldownRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }, [])

  const report = data?.report ?? null
  const workforceEnabled = data?.contract?.workforceEnabled !== false
  const recalculating = loadState === "recalculating" || report?.formula.calculationState === "RECALCULATING"
  const isEmpty = Boolean(report && report.plan.denominator === 0 && report.gps.denominator === 0)

  const drilldownFacts = useMemo((): Array<PlanFact | VisitFact> => {
    if (!report || !drilldown || drilldown.bucket === "exclusions" || drilldown.bucket === "gpsDays") return []
    if (drilldown.metric === "plan") {
      return drilldown.bucket === "numerator" ? report.drilldown.planNumerator : report.drilldown.planDenominator
    }
    return drilldown.bucket === "numerator" ? report.drilldown.gpsNumerator : report.drilldown.gpsDenominator
  }, [drilldown, report])

  const gpsDays = report?.drilldown.gpsDays ?? []

  const excludedFacts = useMemo((): Array<PlanFact | VisitFact> => {
    if (!report || !drilldown) return []
    return drilldown.metric === "plan" ? report.drilldown.exclusions.planPoints : report.drilldown.exclusions.visits
  }, [drilldown, report])

  const latestAdjustmentByFact = useMemo(() => {
    const values = new Map<string, KpiAdjustment>()
    for (const adjustment of report?.formula.adjustments ?? []) {
      const key = `${adjustment.factType}:${adjustment.factId}`
      const current = values.get(key)
      const order = current
        ? current.createdAt.localeCompare(adjustment.createdAt)
          || (current.auditId ?? "").localeCompare(adjustment.auditId ?? "")
        : -1
      if (order <= 0) values.set(key, adjustment)
    }
    return values
  }, [report?.formula.adjustments])

  const metricAdjustments = useMemo(() => {
    if (!report || !drilldown) return []
    const factType = drilldown.metric === "plan" ? "PLAN_POINT" : "GPS_VISIT"
    return report.formula.adjustments
      .filter((adjustment) => adjustment.factType === factType)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }, [drilldown, report])

  const preservedFilters = useCallback(() => {
    const sourceFilters = appliedFilters ?? filters
    const params = new URLSearchParams({
      from: sourceFilters.from,
      to: sourceFilters.to,
      visitType: sourceFilters.visitType,
    })
    if (sourceFilters.teamId) params.set("teamId", sourceFilters.teamId)
    if (sourceFilters.agentId) params.set("agentId", sourceFilters.agentId)
    if (sourceFilters.brandId) params.set("brandId", sourceFilters.brandId)
    return params
  }, [appliedFilters, filters])

  const factHref = useCallback((fact: PlanFact | VisitFact) => {
    const params = preservedFilters()
    if (drilldown?.metric === "gps" && "visitId" in fact) {
      params.set("visitId", fact.visitId)
      params.set("date", fact.date)
      return `/mtm/visits?${params.toString()}`
    }
    const relatedVisit = "visitId" in fact
      ? fact
      : [...(report?.drilldown.gpsDenominator ?? []), ...(report?.drilldown.exclusions.visits ?? [])]
          .find((visit) => visit.routePointId === fact.routePointId)
    if (relatedVisit) {
      params.set("visitId", relatedVisit.visitId)
      return `/mtm/visits?${params.toString()}`
    }
    params.set("agentId", fact.agentId)
    params.set("date", fact.date)
    if (!("visitId" in fact) && fact.routeId) params.set("routeId", fact.routeId)
    if (fact.routePointId) params.set("routePointId", fact.routePointId)
    return `/mtm/routes?${params.toString()}`
  }, [drilldown?.metric, preservedFilters, report?.drilldown.exclusions.visits, report?.drilldown.gpsDenominator])

  const gpsDayHref = useCallback((day: GpsDay) => {
    const params = preservedFilters()
    params.set("date", day.date)
    if (day.sourceAgents?.length === 1) {
      const filteredAgentId = params.get("agentId")
      if (filteredAgentId && filteredAgentId !== day.sourceAgents[0].id) params.set("kpiAgentId", filteredAgentId)
      params.set("mode", "history")
      params.set("agentId", day.sourceAgents[0].id)
      return `/mtm/map?${params.toString()}`
    }
    return `/mtm/visits?${params.toString()}`
  }, [preservedFilters])

  const startAdjustment = useCallback((fact: PlanFact | VisitFact, action: "EXCLUDE" | "RESTORE") => {
    setAdjustmentEditor({
      factType: "visitId" in fact ? "GPS_VISIT" : "PLAN_POINT",
      factId: "visitId" in fact ? fact.visitId : fact.routePointId,
      action,
    })
    setAdjustmentReason("")
    setAdjustmentError(null)
    setAdjustmentNotice(null)
  }, [])

  const submitAdjustment = useCallback(async () => {
    if (recalculating || !adjustmentEditor || adjustmentReason.trim().length < 10 || adjustmentReason.trim().length > 500) return
    setAdjustmentBusy(true)
    setAdjustmentError(null)
    try {
      const response = await fetch("/api/v1/mtm/kpi", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({ ...adjustmentEditor, reason: adjustmentReason.trim() }),
      })
      const result = await response.json().catch(() => null) as { success?: boolean } | null
      if (!response.ok || !result?.success) throw new Error(t("adjustmentFailed"))
      setAdjustmentNotice(t(adjustmentEditor.action === "EXCLUDE" ? "factExcluded" : "factRestored"))
      setAdjustmentEditor(null)
      setAdjustmentReason("")
      setRefreshSequence((value) => value + 1)
    } catch (reason) {
      setAdjustmentError(reason instanceof Error ? reason.message : t("adjustmentFailed"))
    } finally {
      setAdjustmentBusy(false)
    }
  }, [adjustmentEditor, adjustmentReason, orgId, recalculating, t])

  const exportCsv = useCallback(async () => {
    if (invalidRange || exportBusy || !report?.formula.authoritative || report.formula.calculationState !== "READY") return
    const sourceFilters = appliedFilters ?? filters
    const params = new URLSearchParams({
      from: sourceFilters.from,
      to: exclusiveEndDate(sourceFilters.to),
      visitType: sourceFilters.visitType,
    })
    if (sourceFilters.teamId) params.set("teamId", sourceFilters.teamId)
    if (sourceFilters.agentId) params.set("agentId", sourceFilters.agentId)
    if (sourceFilters.brandId) params.set("brandId", sourceFilters.brandId)
    if (data?.snapshotId) params.set("snapshotId", data.snapshotId)
    setExportBusy(true)
    setExportError(null)
    try {
      const response = await fetch(`/api/v1/mtm/kpi/export?${params.toString()}`, {
        cache: "no-store",
        headers: orgId ? { "x-organization-id": orgId } : {},
      })
      if (response.status === 409) {
        setRefreshSequence((value) => value + 1)
        throw new Error(t("exportStaleSnapshot"))
      }
      if (!response.ok) throw new Error(t("exportFailed"))
      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition")
      const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? `mtm-plan-gps-kpi-${sourceFilters.from}-${sourceFilters.to}.csv`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : t("exportFailed"))
    } finally {
      setExportBusy(false)
    }
  }, [appliedFilters, data?.snapshotId, exportBusy, filters, invalidRange, orgId, report?.formula.authoritative, report?.formula.calculationState, t])

  const resetFilters = () => setFilters(emptyFilters())
  const appliedScopeLabel = [
    appliedFilters?.agentId
      ? agents.find((agent) => agent.id === appliedFilters.agentId)?.name
      : appliedFilters?.teamId
        ? teams.find((team) => team.id === appliedFilters.teamId)?.name
        : t("allScope"),
    appliedFilters?.brandId ? brands.find((brand) => brand.id === appliedFilters.brandId)?.name ?? appliedFilters.brandId : null,
  ].filter(Boolean).join(" · ")

  const renderFactList = (facts: Array<PlanFact | VisitFact>, action: "EXCLUDE" | "RESTORE") => {
    if (facts.length === 0) {
      return <div className="grid min-h-44 place-items-center px-6 text-center text-sm text-muted-foreground">{t(action === "RESTORE" ? "noExcludedFacts" : "noFacts")}</div>
    }

    return (
      <>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {facts.slice(0, visibleFacts).map((fact) => {
            const factType = "visitId" in fact ? "GPS_VISIT" as const : "PLAN_POINT" as const
            const factId = "visitId" in fact ? fact.visitId : fact.routePointId
            const latestAdjustment = latestAdjustmentByFact.get(`${factType}:${factId}`)
            const effectiveAction = latestAdjustment?.action === "EXCLUDE" ? "RESTORE" : action
            const editorOpen = adjustmentEditor?.factType === factType && adjustmentEditor.factId === factId && adjustmentEditor.action === effectiveAction
            const visitType = fact.visitType.toUpperCase() in VISIT_TYPE_LABELS ? fact.visitType.toUpperCase() as VisitType : "INDEPENDENT"
            const evidenceState = "visitId" in fact
              ? latestAdjustment?.action === "EXCLUDE"
                ? "MANUALLY_EXCLUDED"
                : fact.gpsEvidenceState ?? (fact.gpsConfirmed ? "CONFIRMED" : undefined)
              : undefined
            const canAdjustEvidence = "visitId" in fact ? fact.gpsConfirmed || latestAdjustment?.action === "EXCLUDE" : true
            const canAdjust = fact.adjustable !== false && canAdjustEvidence

            return (
              <article key={`${drilldown?.metric}-${drilldown?.bucket}-${factType}-${factId}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{fact.customerName}</strong>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{fact.agentName}</span>
                  {effectiveAction === "RESTORE" && latestAdjustment?.reason ? (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      <span className="font-medium text-foreground">{t("adjustmentReason")}:</span> {latestAdjustment.reason}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <time dateTime={fact.date} className="tabular-nums">{dateFormatter.format(new Date(`${fact.date}T00:00:00.000Z`))}</time>
                  <span>{t(VISIT_TYPE_LABELS[visitType])}</span>
                  {fact.brandIds.length ? <span className="max-w-52 truncate">{fact.brandIds.map((id) => brandNameById.get(id) ?? id).join(", ")}</span> : null}
                  {"visitId" in fact ? (
                    <Badge variant={evidenceState === "CONFIRMED" ? "success" : evidenceState === "MANUALLY_EXCLUDED" ? "warning" : evidenceState?.startsWith("INVALID") ? "destructive" : "outline"}>
                      {evidenceState ? t(GPS_EVIDENCE_LABELS[evidenceState]) : t("evidenceUnknown")}
                    </Badge>
                  ) : null}
                  {fact.sourceAgentName && fact.sourceAgentId !== fact.agentId ? (
                    <span className="max-w-80 truncate" title={fact.sourceAgentName}>{t("sourceOwner")}: {fact.sourceAgentName}</span>
                  ) : null}
                  {(fact.attributedAgents?.length || fact.attributedAgentIds?.length) ? (
                    <span
                      className="max-w-80 truncate"
                      title={(fact.attributedAgents?.map((agent) => agent.name) ?? fact.attributedAgentIds ?? []).join(", ")}
                    >
                      {t("attributedAgents", { count: fact.attributedAgents?.length ?? fact.attributedAgentIds?.length ?? 0 })} · {(fact.attributedAgents?.map((agent) => agent.name) ?? fact.attributedAgentIds ?? []).join(", ")}
                    </span>
                  ) : null}
                  {effectiveAction === "RESTORE" && latestAdjustment?.createdAt ? (
                    <time dateTime={latestAdjustment.createdAt}>{t("adjustedAt", { date: dateTimeFormatter.format(new Date(latestAdjustment.createdAt)) })}</time>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:min-h-8 sm:w-auto">
                    <a href={factHref(fact)}>
                      {drilldown?.metric === "gps" ? <History className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      {t("openSource")}
                    </a>
                  </Button>
                  {canAdjust ? (
                    <Button
                      type="button"
                      variant={effectiveAction === "EXCLUDE" ? "outline" : "secondary"}
                      size="sm"
                      className={cn("min-h-11 w-full sm:min-h-8 sm:w-auto", effectiveAction === "EXCLUDE" && "text-amber-800 dark:text-amber-300")}
                      onClick={() => startAdjustment(fact, effectiveAction)}
                      disabled={adjustmentBusy || recalculating}
                    >
                      {effectiveAction === "EXCLUDE" ? <AlertTriangle className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                      {t(factType === "GPS_VISIT"
                        ? effectiveAction === "EXCLUDE" ? "excludeGpsEvidence" : "restoreGpsEvidence"
                        : effectiveAction === "EXCLUDE" ? "excludeFact" : "restoreFact")}
                    </Button>
                  ) : fact.adjustable === false ? <Badge variant="outline">{t("factReadOnly")}</Badge> : <Badge variant="outline">{t("gpsEvidenceMissing")}</Badge>}
                </div>

                {editorOpen && canAdjust ? (
                  <div className="grid gap-3 rounded-lg border border-zinc-200 bg-muted/40 p-3 sm:col-span-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end dark:border-zinc-700">
                    <label className="space-y-1 text-sm font-medium">
                      <span>{t(effectiveAction === "EXCLUDE" ? "excludeReasonLabel" : "restoreReasonLabel")}</span>
                      <Textarea value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} rows={2} minLength={10} maxLength={500} placeholder={t("adjustmentReasonPlaceholder")} aria-invalid={adjustmentReason.length > 0 && adjustmentReason.trim().length < 10} />
                      <span className={cn("flex justify-between gap-3 text-xs font-normal", adjustmentReason.length > 0 && adjustmentReason.trim().length < 10 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                        <span>{t("adjustmentReasonHint")}</span>
                        <span className="tabular-nums">{t("reasonCharacters", { count: adjustmentReason.length })}</span>
                      </span>
                    </label>
                    <div className="flex flex-col gap-2 sm:min-w-44">
                      {adjustmentError ? <span className="text-xs text-destructive" role="alert">{adjustmentError}</span> : null}
                      <Button type="button" size="sm" className="min-h-11 sm:min-h-8" onClick={() => void submitAdjustment()} disabled={recalculating || adjustmentBusy || adjustmentReason.trim().length < 10 || adjustmentReason.trim().length > 500}>
                        {adjustmentBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                        {t(effectiveAction === "EXCLUDE" ? "confirmExclude" : "confirmRestore")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => { setAdjustmentEditor(null); setAdjustmentReason(""); setAdjustmentError(null) }} disabled={adjustmentBusy}>{t("cancel")}</Button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 text-xs text-muted-foreground dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>{t("showingFacts", { shown: Math.min(visibleFacts, facts.length), total: facts.length })}</span>
          {visibleFacts < facts.length ? <Button type="button" variant="outline" size="sm" onClick={() => setVisibleFacts((value) => value + PAGE_SIZE)}>{t("showMore")}</Button> : null}
        </div>
      </>
    )
  }

  const renderGpsDays = () => {
    if (gpsDays.length === 0) {
      return <div className="grid min-h-44 place-items-center px-6 text-center text-sm text-muted-foreground">{t("noGpsDays")}</div>
    }
    return (
      <>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {gpsDays.slice(0, visibleFacts).map((day) => {
            const percentage = day.completedVisits > 0 ? Math.round((day.gpsConfirmedVisits / day.completedVisits) * 1_000) / 10 : 0
            const workdayState = day.workdayState ?? "NOT_RECORDED"
            const workdayStateLabel = workforceEnabled ? WORKDAY_STATE_LABELS[workdayState] : null
            const evidenceSourceLabel = EVIDENCE_SOURCE_LABELS[day.evidenceSource]
            const evidenceBreakdown = Object.entries(day.gpsEvidenceStates)
              .filter(([, count]) => count > 0)
              .sort(([left], [right]) => left.localeCompare(right))
            return (
              <article key={`${day.agentId}:${day.date}`} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(220px,1.2fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{day.agentName}</strong>
                  <time dateTime={day.date} className="mt-0.5 block text-xs text-muted-foreground">{dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}</time>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {workforceEnabled ? <Badge variant={workdayState === "STARTED" ? "success" : workdayState === "PAUSED" ? "warning" : "outline"}>
                      {t(workdayStateLabel ?? "workdayUnknown")}
                    </Badge> : null}
                    <span className="text-xs text-muted-foreground">
                      {t("evidenceSource")}: {t(evidenceSourceLabel ?? "evidenceSourceUnknown")}
                    </span>
                  </div>
                  {workforceEnabled && day.workdayId ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={day.workdayId}>
                      {t("workdayRecord")}: <span className="font-mono text-[11px]">{day.workdayId}</span>
                    </p>
                  ) : null}
                  {day.sourceAgents?.length ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={day.sourceAgents.map((agent) => agent.name).join(", ")}>
                      {t("sourceOwner")}: {day.sourceAgents.map((agent) => agent.name).join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{t("gpsDayRatio")}</span>
                    <strong className="tabular-nums">{day.gpsConfirmedVisits.toLocaleString(locale)} / {day.completedVisits.toLocaleString(locale)} · {percentage.toLocaleString(locale, { maximumFractionDigits: 1 })}%</strong>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={t("gpsDayRatio")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percentage}
                  >
                    <div className="h-full rounded-full bg-teal-600 dark:bg-teal-500" style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />
                  </div>
                  {evidenceBreakdown.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t("evidenceBreakdown")}>
                      {evidenceBreakdown.map(([state, count]) => (
                        <Badge key={state} variant={state === "CONFIRMED" ? "success" : state === "MANUALLY_EXCLUDED" ? "warning" : state.startsWith("INVALID") ? "destructive" : "outline"}>
                          {t(isGpsEvidenceState(state) ? GPS_EVIDENCE_LABELS[state] : "evidenceUnknown")}: {count.toLocaleString(locale)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button asChild variant="outline" size="sm" className="min-h-11 w-full sm:min-h-8 sm:w-auto">
                  <a href={gpsDayHref(day)}><History className="h-4 w-4" />{t(day.sourceAgents?.length === 1 ? "openGpsHistory" : "openSource")}</a>
                </Button>
              </article>
            )
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 text-xs text-muted-foreground dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <span>{t("showingFacts", { shown: Math.min(visibleFacts, gpsDays.length), total: gpsDays.length })}</span>
          {visibleFacts < gpsDays.length ? <Button type="button" variant="outline" size="sm" onClick={() => setVisibleFacts((value) => value + PAGE_SIZE)}>{t("showMore")}</Button> : null}
        </div>
      </>
    )
  }

  return (
    <div data-testid="mtm-explainable-kpi" data-state={loadState} className={cn("space-y-5", className)}>
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                <Sigma className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
              {recalculating ? (
                <Badge variant="warning" role="status"><RefreshCw className="mr-1 h-3 w-3 animate-spin" />{t("recalculating")}</Badge>
              ) : report ? (
                <Badge variant="success" role="status"><CheckCircle2 className="mr-1 h-3 w-3" />{t("ready")}</Badge>
              ) : null}
            </div>
            <p className="mt-2 max-w-[72ch] text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {report ? <Badge variant="outline">{t("formulaVersion", { version: report.formula.version })}</Badge> : null}
            {freshnessLabel ? (
              <Badge variant={sourceFreshness === "CURRENT" ? "success" : sourceFreshness === "LATE" ? "warning" : sourceFreshness === "NO_SOURCE" ? "destructive" : "outline"}>
                <Clock3 className="mr-1 h-3 w-3" />
                {freshnessLabel}
                {report?.formula.sourceUpdatedAt ? ` · ${dateTimeFormatter.format(new Date(report.formula.sourceUpdatedAt))}` : null}
              </Badge>
            ) : null}
            {report ? <Badge id={authorityStatusId} variant={report.formula.authoritative ? "info" : "warning"}>{t(report.formula.completeness === "COMPLETE" ? "complete" : "partial")} · {t(report.formula.authoritative ? "authoritative" : report.formula.authorityReason === "UNSIGNED_POLICY" ? "unsignedPolicy" : "nonAuthoritative")}</Badge> : null}
            {report?.formula.policy ? <Badge variant="outline" title={report.formula.policy.approvalReference}>{t("approvedPolicy", { code: report.formula.policy.code, version: report.formula.policy.version })}</Badge> : null}
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => void exportCsv()} disabled={!report || !report.formula.authoritative || exportBusy || invalidRange || recalculating} title={report && !report.formula.authoritative ? t("exportUnavailablePartial") : undefined} aria-describedby={report && !report.formula.authoritative ? authorityStatusId : undefined}>
              {exportBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t("exportCsv")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setRefreshSequence((value) => value + 1)} disabled={loadState === "loading" || recalculating || invalidRange}>
              <RefreshCw className={cn("h-4 w-4", recalculating && "animate-spin")} />
              {t("refresh")}
            </Button>
          </div>
        </div>

        {report ? (
          <div className="grid gap-px border-t border-zinc-200 bg-zinc-200 text-xs dark:border-zinc-700 dark:bg-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center gap-2 bg-card px-4 py-3"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{t("period")}</span><strong className="ml-auto tabular-nums">{appliedFilters ? `${dateFormatter.format(new Date(`${appliedFilters.from}T00:00:00.000Z`))} – ${dateFormatter.format(new Date(`${appliedFilters.to}T00:00:00.000Z`))}` : "—"}{data?.scope?.timezone ? <span className="ml-1 font-normal text-muted-foreground">({data.scope.timezone})</span> : null}</strong></div>
            <div className="flex items-center gap-2 bg-card px-4 py-3"><Route className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{t("visitType")}</span><strong className="ml-auto">{t(VISIT_TYPE_LABELS[appliedFilters?.visitType ?? "ALL"])}</strong></div>
            <div className="flex items-center gap-2 bg-card px-4 py-3"><Clock3 className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">{t("generated")}</span><strong className="ml-auto tabular-nums">{dateTimeFormatter.format(new Date(report.formula.generatedAt))}</strong></div>
            <div className="flex min-w-0 items-center gap-2 bg-card px-4 py-3"><Filter className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="shrink-0 text-muted-foreground">{t("scope")}</span><strong data-testid="mtm-kpi-applied-scope" className="ml-auto min-w-0 text-right leading-5">{appliedScopeLabel}</strong></div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
          onClick={() => setFiltersOpen((value) => !value)}
          aria-expanded={filtersOpen}
          aria-controls="mtm-kpi-filters"
        >
          <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("filters")}
          <span className="ml-auto hidden text-xs font-normal text-muted-foreground sm:inline">{t("filtersHint")}</span>
          {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {filtersOpen ? (
          <div>
            <div id="mtm-kpi-filters" className="grid gap-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
              <label className="space-y-1 text-sm font-medium">
                <span>{t("from")}</span>
                <Input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>{t("to")}</span>
                <Input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
              </label>
              <div className="space-y-1">
                <label htmlFor="mtm-kpi-team" className="text-sm font-medium">{t("team")}</label>
                <SearchableSelect id="mtm-kpi-team" value={filters.teamId} onValueChange={updateTeam} options={teams.map((team) => ({ value: team.id, label: team.name }))} placeholder={t("allTeams")} searchPlaceholder={t("searchTeams")} noResultsLabel={t("noFilterResults")} />
              </div>
              <div className="space-y-1">
                <label htmlFor="mtm-kpi-agent" className="text-sm font-medium">{t("employee")}</label>
                <SearchableSelect id="mtm-kpi-agent" value={filters.agentId} onValueChange={(agentId) => setFilters((current) => ({ ...current, agentId }))} options={filteredAgents.map((agent) => ({ value: agent.id, label: agent.name }))} placeholder={t("allEmployees")} searchPlaceholder={t("searchEmployees")} noResultsLabel={t("noFilterResults")} />
              </div>
              <Select label={t("visitType")} value={filters.visitType} onChange={(event) => setFilters((current) => ({ ...current, visitType: event.target.value as VisitType }))}>
                {(Object.keys(VISIT_TYPE_LABELS) as VisitType[]).map((value) => <option key={value} value={value}>{t(VISIT_TYPE_LABELS[value])}</option>)}
              </Select>
              <div className="space-y-1">
                <label htmlFor="mtm-kpi-brand" className="text-sm font-medium">{t("brand")}</label>
                <SearchableSelect id="mtm-kpi-brand" value={filters.brandId} onValueChange={(brandId) => setFilters((current) => ({ ...current, brandId }))} options={brands.map((brand) => ({ value: brand.id, label: brand.name }))} placeholder={t("allBrands")} searchPlaceholder={t("searchBrands")} noResultsLabel={t("noFilterResults")} />
              </div>
              <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between xl:col-span-3">
                <p className="max-w-[72ch] text-xs leading-5 text-muted-foreground">{t("brandFilterHint")}</p>
                <Button type="button" variant="ghost" size="sm" className="self-start sm:self-auto" onClick={resetFilters}>{t("resetFilters")}</Button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {error && report ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200 sm:flex-row sm:items-center" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" className="sm:ml-auto" onClick={() => setRefreshSequence((value) => value + 1)} disabled={invalidRange}>{t("retry")}</Button>
        </div>
      ) : null}

      {exportError ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" />{exportError}
        </div>
      ) : null}

      {data?.contract?.truncated ? (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><strong>{t("truncatedTitle")}</strong><p className="mt-1 text-xs leading-5 opacity-80">{t("truncatedDescription", { count: (data.contract.partialLimit ?? data.contract.maxFacts).toLocaleString(locale) })}</p></div>
        </div>
      ) : null}

      {loadState === "loading" ? <LoadingState /> : null}

      {loadState === "error" && !report ? (
        <section className="grid min-h-64 place-items-center rounded-xl border border-dashed border-zinc-300 bg-card px-6 text-center dark:border-zinc-700">
          <div className="max-w-md">
            <AlertTriangle className="mx-auto h-7 w-7 text-destructive" />
            <h3 className="mt-3 text-base font-semibold">{t("errorTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{error ?? t("errorDescription")}</p>
            <Button type="button" className="mt-4" onClick={() => setRefreshSequence((value) => value + 1)} disabled={invalidRange}>{t("retry")}</Button>
          </div>
        </section>
      ) : null}

      {data?.outOfScope ? (
        <section className="grid min-h-64 place-items-center rounded-xl border border-dashed border-zinc-300 bg-card px-6 text-center dark:border-zinc-700">
          <div className="max-w-lg">
            <Filter className="mx-auto h-7 w-7 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">{t("outOfScopeTitle")}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("outOfScopeDescription")}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={resetFilters}>{t("resetFilters")}</Button>
          </div>
        </section>
      ) : null}

      {report && !data?.outOfScope ? (
        <div className={cn("space-y-5 transition-opacity", recalculating && "opacity-60")} aria-busy={recalculating}>
          {isEmpty ? (
            <section className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 bg-card px-5 py-5 dark:border-zinc-700 sm:flex-row sm:items-center">
              <BarChart3 className="h-7 w-7 shrink-0 text-muted-foreground" />
              <div className="max-w-lg"><h3 className="text-base font-semibold">{t("emptyTitle")}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("emptyDescription")}</p></div>
              <Button type="button" variant="outline" className="sm:ml-auto" onClick={resetFilters}>{t("resetFilters")}</Button>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <MetricLedger metric="plan" ratio={report.plan} definition={t("planDefinition")} active={drilldown} onOpen={openDrilldown} />
            <MetricLedger metric="gps" ratio={report.gps} definition={t("gpsDefinition")} active={drilldown} onOpen={openDrilldown} />
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
            <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:flex-row sm:items-end sm:justify-between sm:px-5">
              <div>
                <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{t("trendTitle")}</h3></div>
                <p className="mt-1 text-xs text-muted-foreground">{t("trendDescription")}</p>
              </div>
              <div className="flex flex-col gap-3 sm:items-end">
                <Select label={t("trendGranularity")} value={trendGranularity} onChange={(event) => setTrendGranularity(event.target.value as ExplainableKpiTrendGranularity)} className="min-w-44">
                  <option value="DAY">{t("trendGranularityDay")}</option>
                  <option value="WEEK">{t("trendGranularityWeek")}</option>
                  <option value="MONTH">{t("trendGranularityMonth")}</option>
                  <option value="QUARTER">{t("trendGranularityQuarter")}</option>
                </Select>
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden="true">
                  <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-zinc-300 dark:bg-zinc-600" />{t("trendPlanned")}</span>
                  <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-primary/55" />{t("trendCompleted")}</span>
                  <span className="flex items-center gap-2"><span className="h-0.5 w-6 bg-primary" />{t("trendPlanRate")}</span>
                  <span className="flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-teal-600 dark:border-teal-400" />{t("trendGpsRate")}</span>
                </div>
              </div>
            </div>
            <div className="px-2 py-3 sm:px-4"><TrendChart points={aggregatedTrend} granularity={trendGranularity} onOpen={(metric) => openDrilldown({ metric, bucket: "denominator" })} /></div>
          </section>

          {drilldown ? (
            <section ref={drilldownRef} className="scroll-mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700" aria-live="polite">
              <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <div className="flex items-center gap-2">
                    {drilldown.metric === "gps" ? <History className="h-4 w-4 text-teal-700 dark:text-teal-300" /> : <Route className="h-4 w-4 text-primary" />}
                    <h3 className="text-sm font-semibold">{t("drilldownTitle", { metric: t(drilldown.metric === "plan" ? "planTitle" : "gpsTitle") })}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("drilldownDescription")}</p>
                </div>
                <Badge variant="outline">{drilldown.bucket === "exclusions" ? excludedFacts.length : drilldown.bucket === "gpsDays" ? gpsDays.length : drilldownFacts.length} {t("facts")}</Badge>
              </div>

              <div className={cn("grid gap-1 border-b border-zinc-200 bg-muted/40 p-2 dark:border-zinc-700 sm:border-r", drilldown.metric === "gps" ? "grid-cols-2 sm:max-w-2xl sm:grid-cols-4" : "grid-cols-3 sm:max-w-lg")}>
                {(drilldown.metric === "gps" ? ["numerator", "denominator", "gpsDays", "exclusions"] as const : ["numerator", "denominator", "exclusions"] as const).map((bucket) => (
                  <button key={bucket} type="button" onClick={() => { setDrilldown({ ...drilldown, bucket }); setVisibleFacts(PAGE_SIZE); setVisibleAdjustments(PAGE_SIZE); setAdjustmentEditor(null); setAdjustmentReason(""); setAdjustmentError(null); setAdjustmentNotice(null) }} aria-pressed={drilldown.bucket === bucket} className={cn("min-h-11 rounded-md px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10", drilldown.bucket === bucket ? "bg-card shadow-sm" : "text-muted-foreground hover:bg-card/70")}>
                    {t(bucket)}
                  </button>
                ))}
              </div>

              {adjustmentNotice ? (
                <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />{adjustmentNotice}
                </div>
              ) : null}

              {drilldown.bucket === "gpsDays" ? renderGpsDays() : drilldown.bucket === "exclusions" ? (
                <div>
                  <div className="border-b border-zinc-200 bg-muted/25 px-4 py-4 dark:border-zinc-700 sm:px-5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("formulaExclusions")}</h4>
                    {report.formula.exclusions.length ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {report.formula.exclusions.map((reason) => (
                          <li key={reason} className="rounded-full border border-zinc-200 bg-card px-3 py-1.5 text-xs dark:border-zinc-700">
                            {BASELINE_EXCLUSION_LABELS[reason] ? t(BASELINE_EXCLUSION_LABELS[reason]) : t("formulaExclusionFallback", { reason })}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-3 text-sm text-muted-foreground">{t("noExclusions")}</p>}
                    <p className="mt-3 max-w-[72ch] text-xs leading-5 text-muted-foreground">{t("managerExclusionsDescription")}</p>
                  </div>
                  <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:px-5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("adjustmentAudit")}</h4>
                    {metricAdjustments.length ? (
                      <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                        {metricAdjustments.slice(0, visibleAdjustments).map((adjustment, index) => (
                          <li key={`${adjustment.auditId ?? `${adjustment.factType}:${adjustment.factId}:${index}`}:${adjustment.createdAt}:${adjustment.action}`} className="rounded-lg border border-zinc-200 px-3 py-3 text-xs dark:border-zinc-700">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={adjustment.action === "EXCLUDE" ? "warning" : "success"}>{t(adjustment.action === "EXCLUDE" ? "adjustmentActionExclude" : "adjustmentActionRestore")}</Badge>
                              <span className="text-muted-foreground">{t(adjustment.factType === "PLAN_POINT" ? "adjustmentFactPlan" : "adjustmentFactGps")}</span>
                              <time dateTime={adjustment.createdAt} className="ml-auto tabular-nums text-muted-foreground">{dateTimeFormatter.format(new Date(adjustment.createdAt))}</time>
                            </div>
                            <p className="mt-2 leading-5"><span className="font-medium">{t("adjustmentReason")}:</span> {adjustment.reason}</p>
                            <code className="mt-1 block truncate text-[10px] text-muted-foreground" title={adjustment.factId}>{adjustment.factId}</code>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-3 text-sm text-muted-foreground">{t("noAdjustments")}</p>}
                    {metricAdjustments.length ? (
                      <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                        <span>{t("showingAdjustments", { shown: Math.min(visibleAdjustments, metricAdjustments.length), total: metricAdjustments.length })}</span>
                        {visibleAdjustments < metricAdjustments.length ? <Button type="button" variant="outline" size="sm" onClick={() => setVisibleAdjustments((value) => value + PAGE_SIZE)}>{t("showMore")}</Button> : null}
                      </div>
                    ) : null}
                  </div>
                  {renderFactList(excludedFacts, "RESTORE")}
                </div>
              ) : (
                renderFactList(drilldownFacts, "EXCLUDE")
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default ExplainableKpiDashboard
