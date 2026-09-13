"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  CalendarDays,
  Check,
  Clock3,
  ClipboardList,
  Loader2,
  Pause,
  RefreshCw,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type WorkforceView = "today" | "timesheet" | "requests"
type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"

type TodayData = {
  date: string
  timezone: string
  scope: string
  summary: { started: number; paused: number; completed: number; notStarted: number; previousOpen: number }
  people: Array<{
    id: string
    name: string
    role: string
    status: "STARTED" | "PAUSED" | "COMPLETED" | "NOT_STARTED"
    workday: { startedAt: string; pausedAt: string | null; completedAt: string | null } | null
    previousOpenWorkday: { workDate: string; status: "STARTED" | "PAUSED" } | null
  }>
}

type WorkforceTimesheetCalculationView = {
  status: "STARTED" | "PAUSED" | "COMPLETED"
  isFinal: boolean
  plan: {
    plannedStartAt: string
    plannedEndAt: string
    expectedWorkSeconds: number
    timezone: string
  }
  fact: {
    workedSeconds: number
    pausedSeconds: number
  }
  deviations: {
    lateStartSeconds: number
    undertimeSeconds: number
    overtimeSeconds: number
    longPauseSeconds: number
  }
}

type TimesheetData = {
  timezone: string
  start: string
  end: string
  agents: Array<{ id: string; name: string; role: string }>
  rows: Array<{
    id: string
    agentId: string
    date: string
    status: "STARTED" | "PAUSED" | "COMPLETED"
    startedAt: string
    completedAt: string | null
    totalPausedSeconds: number
    workedSeconds: number | null
    calculationStatus: "WORKFORCE_TIMESHEET_SNAPSHOT_MISSING" | "WORKFORCE_TIMESHEET_CALCULATED" | "WORKFORCE_WORKDAY_HISTORY_INVALID" | "WORKFORCE_TIMESHEET_SNAPSHOT_READ_DISABLED"
    calculation: WorkforceTimesheetCalculationView | null
  }>
  summary: { totalWorkedSeconds: number; workdayCount: number }
}

type TimesheetFilters = {
  agentId: string
  start: string
  end: string
}

type TimesheetApprovalData = {
  id: string
  revision: number
  recordKind: "APPROVAL" | "CORRECTION"
  periodStart: string
  periodEnd: string
  agentId: string
  rowsHash: string
  factsHash: string
  calculationVersion: number
}

type TimesheetApprovalBlocker = {
  workdayId?: string
  caseReference?: string
  workDate: string
  reason: "WORKDAY_NOT_FINAL" | "SNAPSHOT_MISSING" | "HISTORY_INVALID" | "UNRESOLVED_EXCEPTION"
  exceptionType?: "LATE_START" | "UNDERTIME" | "OVERTIME" | "LONG_PAUSE" | "NO_SHOW" | "MISSED_FINISH" | "DELAYED_CLAIM" | "SITE_TRANSITION_REVIEW" | "DEVICE_SECURITY_REVIEW" | "ATTENDANCE_PROOF_REVIEW"
  exceptionStage?: "OPEN" | "AWAITING_EMPLOYEE_RESPONSE" | "HR_REVIEW" | "DATA_INTEGRITY_REVIEW"
}

type TimesheetApprovalOutcome =
  | { success: true; idempotent: boolean; data: TimesheetApprovalData }
  | { success: false; error: string; code: string | null; blockers: TimesheetApprovalBlocker[] }

type TimesheetExportPreview = {
  approval: {
    id: string
    recordKind: "APPROVAL" | "CORRECTION"
    revision: number
    calculationVersion: number
    approvedAt: string
  }
  scope: {
    employee: { id: string; name: string }
    periodStart: string
    periodEnd: string
    rowCount: number
    siteScope: "EXCLUDED_FROM_ORDINARY_EXPORT"
  }
  delivery: {
    purpose: "HR_RECORD_REVIEW"
    recipient: "SESSION_DIRECT_DOWNLOAD"
    artifactPersistence: "NONE"
  }
  warningCodes: TimesheetExportWarningCode[]
  rows: TimesheetExportPreviewRow[]
}

type TimesheetExportPreviewRow = {
  workdayId: string
  agentId: string
  workDate: string
  status: "COMPLETED"
  workedSeconds: number
  pausedSeconds: number
  lateStartSeconds: number
  undertimeSeconds: number
  overtimeSeconds: number
  overtimeClassification: "OPERATIONAL_DEVIATION_NOT_PAYABLE"
  longPauseSeconds: number
}

type TimesheetExportWarningCode =
  | "WORKFORCE_EXPORT_TIME_FACTS_ONLY"
  | "WORKFORCE_EXPORT_SITE_SCOPE_EXCLUDED"
  | "WORKFORCE_EXPORT_OVERTIME_NOT_PAYABLE"

type TimesheetExportPreviewOutcome =
  | { success: true; data: TimesheetExportPreview }
  | { success: false; error: string }

const TIMESHEET_BLOCKER_REASONS = new Set([
  "WORKDAY_NOT_FINAL", "SNAPSHOT_MISSING", "HISTORY_INVALID", "UNRESOLVED_EXCEPTION",
])
const TIMESHEET_EXCEPTION_TYPES = new Set([
  "LATE_START", "UNDERTIME", "OVERTIME", "LONG_PAUSE", "NO_SHOW", "MISSED_FINISH", "DELAYED_CLAIM",
  "SITE_TRANSITION_REVIEW", "DEVICE_SECURITY_REVIEW", "ATTENDANCE_PROOF_REVIEW",
])
const TIMESHEET_EXCEPTION_STAGES = new Set([
  "OPEN", "AWAITING_EMPLOYEE_RESPONSE", "HR_REVIEW", "DATA_INTEGRITY_REVIEW",
])
const TIMESHEET_EXPORT_WARNING_CODES = new Set<TimesheetExportWarningCode>([
  "WORKFORCE_EXPORT_TIME_FACTS_ONLY",
  "WORKFORCE_EXPORT_SITE_SCOPE_EXCLUDED",
  "WORKFORCE_EXPORT_OVERTIME_NOT_PAYABLE",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function parseTimesheetExportRow(value: unknown): TimesheetExportPreviewRow | null {
  if (!isRecord(value)) return null
  if (
    typeof value.workdayId !== "string"
    || typeof value.agentId !== "string"
    || typeof value.workDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.workDate)
    || value.status !== "COMPLETED"
    || value.overtimeClassification !== "OPERATIONAL_DEVIATION_NOT_PAYABLE"
    || !isNonNegativeInteger(value.workedSeconds)
    || !isNonNegativeInteger(value.pausedSeconds)
    || !isNonNegativeInteger(value.lateStartSeconds)
    || !isNonNegativeInteger(value.undertimeSeconds)
    || !isNonNegativeInteger(value.overtimeSeconds)
    || !isNonNegativeInteger(value.longPauseSeconds)
  ) return null
  return {
    workdayId: value.workdayId,
    agentId: value.agentId,
    workDate: value.workDate,
    status: value.status,
    workedSeconds: value.workedSeconds,
    pausedSeconds: value.pausedSeconds,
    lateStartSeconds: value.lateStartSeconds,
    undertimeSeconds: value.undertimeSeconds,
    overtimeSeconds: value.overtimeSeconds,
    overtimeClassification: value.overtimeClassification,
    longPauseSeconds: value.longPauseSeconds,
  }
}

function parseTimesheetExportPreview(value: unknown): TimesheetExportPreview | null {
  if (!isRecord(value) || !isRecord(value.approval) || !isRecord(value.scope) || !isRecord(value.delivery)) return null
  const { approval, scope, delivery } = value
  if (
    typeof approval.id !== "string"
    || (approval.recordKind !== "APPROVAL" && approval.recordKind !== "CORRECTION")
    || !isNonNegativeInteger(approval.revision)
    || approval.revision < 1
    || !isNonNegativeInteger(approval.calculationVersion)
    || typeof approval.approvedAt !== "string"
    || !Number.isFinite(Date.parse(approval.approvedAt))
    || !isRecord(scope.employee)
    || typeof scope.employee.id !== "string"
    || typeof scope.employee.name !== "string"
    || typeof scope.periodStart !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(scope.periodStart)
    || typeof scope.periodEnd !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(scope.periodEnd)
    || !isNonNegativeInteger(scope.rowCount)
    || scope.siteScope !== "EXCLUDED_FROM_ORDINARY_EXPORT"
    || delivery.purpose !== "HR_RECORD_REVIEW"
    || delivery.recipient !== "SESSION_DIRECT_DOWNLOAD"
    || delivery.artifactPersistence !== "NONE"
    || !Array.isArray(value.warningCodes)
    || value.warningCodes.some((code) => typeof code !== "string" || !TIMESHEET_EXPORT_WARNING_CODES.has(code as TimesheetExportWarningCode))
    || !Array.isArray(value.rows)
    || value.rows.length !== scope.rowCount
  ) return null
  const rows = value.rows.map(parseTimesheetExportRow)
  if (rows.some((row) => row == null)) return null
  return {
    approval: {
      id: approval.id,
      recordKind: approval.recordKind,
      revision: approval.revision,
      calculationVersion: approval.calculationVersion,
      approvedAt: approval.approvedAt,
    },
    scope: {
      employee: { id: scope.employee.id, name: scope.employee.name },
      periodStart: scope.periodStart,
      periodEnd: scope.periodEnd,
      rowCount: scope.rowCount,
      siteScope: scope.siteScope,
    },
    delivery: {
      purpose: delivery.purpose,
      recipient: delivery.recipient,
      artifactPersistence: delivery.artifactPersistence,
    },
    warningCodes: value.warningCodes as TimesheetExportWarningCode[],
    rows: rows as TimesheetExportPreviewRow[],
  }
}

function parseTimesheetApprovalBlockers(value: unknown): TimesheetApprovalBlocker[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return []
    const item = candidate as Record<string, unknown>
    if (
      typeof item.workDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(item.workDate)
      || typeof item.reason !== "string"
      || !TIMESHEET_BLOCKER_REASONS.has(item.reason)
      || (item.workdayId !== undefined && typeof item.workdayId !== "string")
      || (item.caseReference !== undefined && typeof item.caseReference !== "string")
      || (item.exceptionType !== undefined && (typeof item.exceptionType !== "string" || !TIMESHEET_EXCEPTION_TYPES.has(item.exceptionType)))
      || (item.exceptionStage !== undefined && (typeof item.exceptionStage !== "string" || !TIMESHEET_EXCEPTION_STAGES.has(item.exceptionStage)))
    ) return []
    return [item as TimesheetApprovalBlocker]
  })
}

type WorkforceRequest = {
  id: string
  agentId: string
  type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
  status: RequestStatus
  startDate: string
  endDate: string
  correctionWorkdayId: string | null
  requestedStartAt: string | null
  requestedEndAt: string | null
  reason: string
  decisionNote: string | null
  submittedAt: string
  agent: { id: string; name: string; role: string }
}

type RequestsData = {
  scope: string
  timezone: string
  canDecide: boolean
  canSubmitSelf: boolean
  selfWorkdays: Array<{
    id: string
    workDate: string
    status: "STARTED" | "PAUSED" | "COMPLETED"
    completedAt: string | null
  }>
  requests: WorkforceRequest[]
  nextCursor: string | null
}
type RouteConflict = { id: string; name: string | null; date: string; status: string; totalPoints: number }

const apiForView: Record<WorkforceView, string> = {
  today: "/api/v1/workforce/today",
  timesheet: "/api/v1/workforce/timesheet",
  requests: "/api/v1/workforce/requests",
}

function endpointForView(view: WorkforceView, timesheetQuery: TimesheetFilters): string {
  if (view !== "timesheet") return apiForView[view]
  const parameters = new URLSearchParams()
  if (timesheetQuery.agentId) parameters.set("agentId", timesheetQuery.agentId)
  if (timesheetQuery.start) parameters.set("start", timesheetQuery.start)
  if (timesheetQuery.end) parameters.set("end", timesheetQuery.end)
  const query = parameters.toString()
  return query ? apiForView.timesheet + "?" + query : apiForView.timesheet
}

function duration(value: number | null): string {
  if (value == null) return "—"
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, "0")}`
}

function requestTypeKey(type: WorkforceRequest["type"]): "leave" | "absence" | "correction" {
  if (type === "LEAVE") return "leave"
  if (type === "ABSENCE") return "absence"
  return "correction"
}

function createSelfRequestClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return "self-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
}

function statusTone(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "COMPLETED" || status === "APPROVED") return "default"
  if (status === "PAUSED" || status === "PENDING") return "secondary"
  if (status === "REJECTED") return "destructive"
  return "outline"
}

export function WorkforceWorkbench({ view }: { view: WorkforceView }) {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const locale = useLocale()
  const t = useTranslations("workforcePage")
  const tNav = useTranslations("nav")
  const [data, setData] = useState<TodayData | TimesheetData | RequestsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<Record<string, RouteConflict[]>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [submittingSelfRequest, setSubmittingSelfRequest] = useState(false)
  const [cancellingSelfRequestId, setCancellingSelfRequestId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [timesheetQuery, setTimesheetQuery] = useState<TimesheetFilters>({ agentId: "", start: "", end: "" })
  const [timesheetFilters, setTimesheetFilters] = useState<TimesheetFilters>({ agentId: "", start: "", end: "" })
  const [approvingTimesheet, setApprovingTimesheet] = useState(false)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const canApproveTimesheet = session?.user?.role === "manager"
    || session?.user?.role === "admin"
    || session?.user?.role === "superadmin"
  const preselectedCorrectionWorkdayId = view === "requests"
    ? searchParams.get("correctionWorkdayId")
    : null
  const preselectedExceptionCaseId = view === "requests"
    ? searchParams.get("exceptionCaseId")
    : null

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch(endpointForView(view, timesheetQuery), {
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
        if (!cancelled) {
          setData(result.data)
          if (view === "timesheet") {
            const resultData = result.data as TimesheetData
            setTimesheetFilters({
              agentId: timesheetQuery.agentId,
              start: timesheetQuery.start || resultData.start,
              end: timesheetQuery.end || resultData.end,
            })
          }
        }
      })
      .catch((cause: unknown) => {
        const aborted = cause instanceof Error && cause.name === "AbortError"
        if (!cancelled && !aborted) {
          setError(cause instanceof Error ? cause.message : t("loadFailed"))
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [organizationId, retry, t, timesheetQuery, view])

  const today = view === "today" ? data as TodayData | null : null
  const timesheet = view === "timesheet" ? data as TimesheetData | null : null
  const requests = view === "requests" ? data as RequestsData | null : null
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale])

  async function decide(request: WorkforceRequest, decision: "APPROVED" | "REJECTED", acknowledgeRouteConflicts = false) {
    const note = notes[request.id]?.trim() || undefined
    if (decision === "REJECTED" && !note) {
      toast.error(t("rejectionNoteRequired"))
      return
    }
    setSavingId(request.id)
    try {
      const response = await fetch(`/api/v1/workforce/requests/${request.id}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": organizationId } : {}),
        },
        body: JSON.stringify({ decision, note, acknowledgeRouteConflicts }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.status === 409 && result.code === "WORKFORCE_ROUTE_CONFLICT" && Array.isArray(result.conflicts)) {
        setConflicts((current) => ({ ...current, [request.id]: result.conflicts }))
        return
      }
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
      toast.success(result.idempotent ? t("decisionAlreadyApplied") : t("decisionSaved"))
      setConflicts((current) => {
        const next = { ...current }
        delete next[request.id]
        return next
      })
      setRetry((value) => value + 1)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("decisionFailed"))
    } finally {
      setSavingId(null)
    }
  }

  async function loadMoreRequests() {
    if (!requests?.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await fetch(`${apiForView.requests}?cursor=${encodeURIComponent(requests.nextCursor)}`, {
        headers: organizationId ? { "x-organization-id": organizationId } : {},
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
      const page = result.data as RequestsData
      setData((current) => {
        if (!current || !("requests" in current)) return page
        const known = new Set(current.requests.map((request) => request.id))
        return {
          ...page,
          requests: [...current.requests, ...page.requests.filter((request) => !known.has(request.id))],
        }
      })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("loadFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  async function submitSelfRequest(input: {
    clientRequestId: string
    type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
    startDate: string
    endDate: string
    reason: string
    correctionWorkdayId?: string
    exceptionCaseId?: string
    requestedStartLocal?: string
    requestedEndLocal?: string
  }): Promise<{ idempotent: boolean }> {
    setSubmittingSelfRequest(true)
    try {
      const response = await fetch(apiForView.requests, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": organizationId } : {}),
        },
        body: JSON.stringify(input),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) throw new Error(result.error || "HTTP " + response.status)
      toast.success(result.idempotent ? t("selfRequestAlreadySubmitted") : t("selfRequestSubmitted"))
      setRetry((value) => value + 1)
      return { idempotent: Boolean(result.idempotent) }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("selfRequestSubmitFailed"))
      throw cause
    } finally {
      setSubmittingSelfRequest(false)
    }
  }

  async function cancelSelfRequest(request: WorkforceRequest) {
    setCancellingSelfRequestId(request.id)
    try {
      const response = await fetch("/api/v1/workforce/requests/" + encodeURIComponent(request.id) + "/cancel", {
        method: "POST",
        headers: organizationId ? { "x-organization-id": organizationId } : {},
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) throw new Error(result.error || "HTTP " + response.status)
      toast.success(result.idempotent ? t("selfRequestAlreadyCancelled") : t("selfRequestCancelled"))
      setRetry((value) => value + 1)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("selfRequestCancelFailed"))
    } finally {
      setCancellingSelfRequestId(null)
    }
  }

  function applyTimesheetFilters() {
    if (!timesheetFilters.start || !timesheetFilters.end || timesheetFilters.end < timesheetFilters.start) {
      toast.error(t("timesheetRangeInvalid"))
      return
    }
    setTimesheetQuery(timesheetFilters)
  }

  async function approveTimesheet(input: {
    agentId: string
    periodStart: string
    periodEnd: string
    correctionReason?: string
  }): Promise<TimesheetApprovalOutcome> {
    setApprovingTimesheet(true)
    try {
      const response = await fetch("/api/v1/workforce/timesheet/approvals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizationId ? { "x-organization-id": organizationId } : {}),
        },
        body: JSON.stringify(input),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) {
        const error = result.error || "HTTP " + response.status
        return {
          success: false,
          error,
          code: typeof result.code === "string" ? result.code : null,
          blockers: parseTimesheetApprovalBlockers(result.blockers),
        }
      }
      const data = result.data as TimesheetApprovalData
      toast.success(result.idempotent ? t("timesheetApprovalAlreadyRecorded") : t(data.recordKind === "CORRECTION" ? "timesheetCorrectionRecorded" : "timesheetApprovalRecorded"))
      return { success: true, idempotent: Boolean(result.idempotent), data }
    } catch (cause) {
      return {
        success: false,
        error: cause instanceof Error ? cause.message : t("timesheetApprovalFailed"),
        code: null,
        blockers: [],
      }
    } finally {
      setApprovingTimesheet(false)
    }
  }

  async function previewApprovedTimesheetExport(approvalId: string): Promise<TimesheetExportPreviewOutcome> {
    try {
      const response = await fetch(
        "/api/v1/workforce/timesheet/approvals/" + encodeURIComponent(approvalId) + "/preview?purpose=HR_RECORD_REVIEW",
        {
          cache: "no-store",
          headers: organizationId ? { "x-organization-id": organizationId } : {},
        },
      )
      const result: unknown = await response.json().catch(() => ({}))
      if (!response.ok || !isRecord(result) || result.success !== true) {
        const detail = isRecord(result) && typeof result.error === "string"
          ? result.error
          : "HTTP " + response.status
        return { success: false, error: detail }
      }
      const preview = parseTimesheetExportPreview(result.data)
      if (!preview) return { success: false, error: t("timesheetExportPreviewInvalid") }
      return { success: true, data: preview }
    } catch (cause) {
      return { success: false, error: cause instanceof Error ? cause.message : t("timesheetExportPreviewFailed") }
    }
  }

  const title = view === "today" ? tNav("workforceToday") : view === "timesheet" ? tNav("workforceTimesheet") : tNav("workforceRequests")
  const Icon = view === "today" ? Clock3 : view === "timesheet" ? CalendarDays : ClipboardList

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-700 lg:flex-row lg:items-end lg:justify-between">
        <PageDescription icon={Icon} title={title} description={t(`${view}Subtitle`)} />
        <nav className="flex flex-wrap gap-2" aria-label={t("sectionNavigation")}>
          {(["today", "timesheet", "requests"] as WorkforceView[]).map((item) => {
            const href = item === "today" ? "/workforce" : `/workforce/${item}`
            const label = item === "today" ? tNav("workforceToday") : item === "timesheet" ? tNav("workforceTimesheet") : tNav("workforceRequests")
            return <Button key={item} asChild size="sm" variant={item === view ? "default" : "outline"} className="min-h-12"><Link href={href}>{label}</Link></Button>
          })}
          <Button type="button" size="sm" variant="ghost" className="min-h-12" onClick={() => setRetry((value) => value + 1)} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : ""} />{t("refresh")}
          </Button>
        </nav>
      </header>

      {loading ? <div className="h-48 animate-pulse border-y border-zinc-200 bg-muted/40 motion-reduce:animate-none dark:border-zinc-700" aria-label={t("loading")} role="status" /> : null}
      {!loading && error ? (
        <section className="flex flex-col gap-3 border-y border-zinc-200 bg-card py-5 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <div><p className="font-medium">{t("loadFailed")}</p><p className="mt-1 text-sm text-muted-foreground">{error}</p></div>
          <Button type="button" variant="outline" className="min-h-12" onClick={() => setRetry((value) => value + 1)}>{t("tryAgain")}</Button>
        </section>
      ) : null}

      {!loading && !error && today ? <TodayView data={today} t={t} formatter={formatter} locale={locale} /> : null}
      {!loading && !error && timesheet ? (
        <TimesheetView
          data={timesheet}
          t={t}
          formatter={formatter}
          locale={locale}
          appliedFilters={timesheetQuery}
          filters={timesheetFilters}
          loading={loading}
          approving={approvingTimesheet}
          canApproveTimesheet={canApproveTimesheet}
          onPreviewApprovedExport={previewApprovedTimesheetExport}
          onFiltersChange={setTimesheetFilters}
          onApplyFilters={applyTimesheetFilters}
          onApprove={approveTimesheet}
        />
      ) : null}
      {!loading && !error && requests ? (
        <RequestsView
          data={requests}
          t={t}
          formatter={formatter}
          canDecide={requests.canDecide}
          locale={locale}
          notes={notes}
          conflicts={conflicts}
          savingId={savingId}
          submittingSelfRequest={submittingSelfRequest}
          cancellingSelfRequestId={cancellingSelfRequestId}
          loadingMore={loadingMore}
          preselectedCorrectionWorkdayId={preselectedCorrectionWorkdayId}
          preselectedExceptionCaseId={preselectedExceptionCaseId}
          onNoteChange={(id, value) => setNotes((current) => ({ ...current, [id]: value }))}
          onDecide={decide}
          onSubmitSelf={submitSelfRequest}
          onCancelSelf={cancelSelfRequest}
          onLoadMore={loadMoreRequests}
        />
      ) : null}
    </div>
  )
}

function TodayView({ data, t, formatter, locale }: { data: TodayData; t: ReturnType<typeof useTranslations>; formatter: Intl.DateTimeFormat; locale: string }) {
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: data.timezone,
  }), [data.timezone, locale])
  const items = [
    { key: "started", label: t("started"), value: data.summary.started, icon: Clock3 },
    { key: "paused", label: t("paused"), value: data.summary.paused, icon: Pause },
    { key: "completed", label: t("completed"), value: data.summary.completed, icon: Check },
    { key: "previousOpen", label: t("needsReview"), value: data.summary.previousOpen, icon: TriangleAlert },
  ]
  return <>
    <section className="grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-700 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("dailySummary")}>
      {items.map(({ key, label, value, icon: Icon }) => <div key={key} className="flex min-h-28 flex-col justify-between bg-card p-5">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div>
      </div>)}
    </section>
    <section aria-labelledby="workforce-today-list" className="border-y border-zinc-200 dark:border-zinc-700">
      <div className="flex flex-col gap-1 px-1 py-5 sm:flex-row sm:items-baseline sm:justify-between">
        <div><h3 id="workforce-today-list" className="text-base font-semibold">{t("teamToday")}</h3><p className="text-sm text-muted-foreground">{formatter.format(new Date(`${data.date}T12:00:00`))} · {data.timezone}</p></div>
        <span className="text-sm text-muted-foreground">{t("peopleCount", { count: data.people.length })}</span>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {data.people.map((person) => <article key={person.id} className="grid gap-3 px-1 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <div className="min-w-0"><p className="truncate font-medium">{person.name}</p><p className="text-sm text-muted-foreground">{person.role}</p></div>
          <Badge variant={statusTone(person.status)}>{t(`status.${person.status}`)}</Badge>
          {person.previousOpenWorkday ? <span className="inline-flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><TriangleAlert className="h-4 w-4" />{t("previousOpen", { date: person.previousOpenWorkday.workDate.slice(0, 10) })}</span> : <span className="text-sm text-muted-foreground">{person.workday?.startedAt ? t("startedAt", { time: timeFormatter.format(new Date(person.workday.startedAt)) }) : t("notStarted")}</span>}
        </article>)}
        {data.people.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t("noPeople")}</p> : null}
      </div>
    </section>
  </>
}

function TimesheetView({ data, t, formatter, locale, appliedFilters, filters, loading, approving, canApproveTimesheet, onFiltersChange, onApplyFilters, onApprove, onPreviewApprovedExport }: {
  data: TimesheetData
  t: ReturnType<typeof useTranslations>
  formatter: Intl.DateTimeFormat
  locale: string
  appliedFilters: TimesheetFilters
  filters: TimesheetFilters
  loading: boolean
  approving: boolean
  canApproveTimesheet: boolean
  onFiltersChange: (next: TimesheetFilters) => void
  onApplyFilters: () => void
  onApprove: (input: { agentId: string; periodStart: string; periodEnd: string; correctionReason?: string }) => Promise<TimesheetApprovalOutcome>
  onPreviewApprovedExport: (approvalId: string) => Promise<TimesheetExportPreviewOutcome>
}) {
  const names = new Map(data.agents.map((agent) => [agent.id, agent.name]))
  const timeFormatters = new Map<string, Intl.DateTimeFormat>()
  const planTime = (value: string, timezone: string) => {
    let timeFormatter = timeFormatters.get(timezone)
    if (!timeFormatter) {
      timeFormatter = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      })
      timeFormatters.set(timezone, timeFormatter)
    }
    return timeFormatter.format(new Date(value))
  }
  return <>
    <TimesheetApprovalPanel
      key={[appliedFilters.agentId, data.start, data.end].join(":")}
      data={data}
      t={t}
      filters={filters}
      appliedFilters={appliedFilters}
      loading={loading}
      approving={approving}
      canApproveTimesheet={canApproveTimesheet}
      formatter={formatter}
      onFiltersChange={onFiltersChange}
      onApplyFilters={onApplyFilters}
      onApprove={onApprove}
      onPreviewApprovedExport={onPreviewApprovedExport}
    />
    <section className="flex flex-col gap-1 border-y border-zinc-200 py-5 dark:border-zinc-700 sm:flex-row sm:items-end sm:justify-between">
      <div><h3 className="text-base font-semibold">{t("recordedTime")}</h3><p className="text-sm text-muted-foreground">{data.start} — {data.end} · {data.timezone}</p></div>
      <p className="text-sm text-muted-foreground">{t("totalRecorded", { duration: duration(data.summary.totalWorkedSeconds), count: data.summary.workdayCount })}</p>
    </section>
    <div className="overflow-x-auto border-y border-zinc-200 dark:border-zinc-700">
      <table className="min-w-[900px] text-left text-sm"><thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700"><tr><th className="px-1 py-3 font-medium">{t("employee")}</th><th className="px-3 py-3 font-medium">{t("date")}</th><th className="px-3 py-3 font-medium">{t("statusLabel")}</th><th className="px-3 py-3 font-medium">{t("planned")}</th><th className="px-3 py-3 text-right font-medium">{t("actual")}</th><th className="px-3 py-3 font-medium">{t("deviations")}</th></tr></thead><tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {data.rows.map((row) => {
          const calculation = row.calculationStatus === "WORKFORCE_TIMESHEET_CALCULATED" ? row.calculation : null
          const deviations = calculation == null ? [] : [
            calculation.deviations.lateStartSeconds > 0 ? t("lateStart", { duration: duration(calculation.deviations.lateStartSeconds) }) : null,
            calculation.deviations.undertimeSeconds > 0 ? t("undertime", { duration: duration(calculation.deviations.undertimeSeconds) }) : null,
            calculation.deviations.overtimeSeconds > 0 ? t("overtime", { duration: duration(calculation.deviations.overtimeSeconds) }) : null,
            calculation.deviations.longPauseSeconds > 0 ? t("longPause", { duration: duration(calculation.deviations.longPauseSeconds) }) : null,
          ].filter((value): value is string => value != null)
          const unavailableReason = row.calculationStatus === "WORKFORCE_TIMESHEET_SNAPSHOT_MISSING"
            ? t("snapshotMissing")
            : row.calculationStatus === "WORKFORCE_TIMESHEET_SNAPSHOT_READ_DISABLED"
              ? t("snapshotReadDisabled")
              : t("historyInvalid")
          return <tr key={row.id}>
            <td className="whitespace-nowrap px-1 py-4 font-medium">{names.get(row.agentId) ?? t("unknownEmployee")}</td>
            <td className="whitespace-nowrap px-3 py-4">{formatter.format(new Date(`${row.date}T12:00:00`))}</td>
            <td className="px-3 py-4"><Badge variant={statusTone(row.status)}>{t(`status.${row.status}`)}</Badge></td>
            <td className="whitespace-nowrap px-3 py-4 tabular-nums">
              {calculation ? <div><p>{planTime(calculation.plan.plannedStartAt, calculation.plan.timezone)} — {planTime(calculation.plan.plannedEndAt, calculation.plan.timezone)}</p><p className="mt-1 text-xs text-muted-foreground">{t("plannedDuration", { duration: duration(calculation.plan.expectedWorkSeconds) })}</p></div> : <span className="text-muted-foreground">—</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-4 text-right font-medium tabular-nums">
              {calculation ? <div><p>{duration(calculation.fact.workedSeconds)}</p><p className="mt-1 text-xs font-normal text-muted-foreground">{t("pausedDuration", { duration: duration(calculation.fact.pausedSeconds) })}</p></div> : <Badge variant="destructive">{t("needsReview")}</Badge>}
            </td>
            <td className="px-3 py-4">
              {calculation ? <div className="flex max-w-sm flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{deviations.length > 0 ? deviations.map((deviation) => <span key={deviation}>{deviation}</span>) : <span>{t("onPlan")}</span>}</div> : <p className="max-w-xs text-xs leading-5 text-muted-foreground">{unavailableReason}</p>}
            </td>
          </tr>
        })}
        {data.rows.length === 0 ? <tr><td colSpan={6} className="px-1 py-12 text-center text-muted-foreground">{t("noWorkdays")}</td></tr> : null}
      </tbody></table>
    </div>
  </>
}

function TimesheetApprovalPanel({
  data,
  t,
  filters,
  appliedFilters,
  loading,
  approving,
  canApproveTimesheet,
  formatter,
  onFiltersChange,
  onApplyFilters,
  onApprove,
  onPreviewApprovedExport,
}: {
  data: TimesheetData
  t: ReturnType<typeof useTranslations>
  filters: TimesheetFilters
  appliedFilters: TimesheetFilters
  loading: boolean
  approving: boolean
  canApproveTimesheet: boolean
  formatter: Intl.DateTimeFormat
  onFiltersChange: (next: TimesheetFilters) => void
  onApplyFilters: () => void
  onApprove: (input: { agentId: string; periodStart: string; periodEnd: string; correctionReason?: string }) => Promise<TimesheetApprovalOutcome>
  onPreviewApprovedExport: (approvalId: string) => Promise<TimesheetExportPreviewOutcome>
}) {
  const [correctionReason, setCorrectionReason] = useState("")
  const [failure, setFailure] = useState<Extract<TimesheetApprovalOutcome, { success: false }> | null>(null)
  const [record, setRecord] = useState<TimesheetApprovalData | null>(null)
  const [exportPreview, setExportPreview] = useState<TimesheetExportPreview | null>(null)
  const [previewingExport, setPreviewingExport] = useState(false)
  const [exportPreviewFailure, setExportPreviewFailure] = useState<string | null>(null)
  const selectedAgent = appliedFilters.agentId
    ? data.agents.find((agent) => agent.id === appliedFilters.agentId) ?? null
    : null
  const selectedRows = selectedAgent
    ? data.rows.filter((row) => row.agentId === selectedAgent.id)
    : []
  const approvalReady = selectedRows.length > 0 && selectedRows.every((row) => (
    row.status === "COMPLETED" && row.calculationStatus === "WORKFORCE_TIMESHEET_CALCULATED"
  ))
  const correctionReasonRequired = failure?.code === "WORKFORCE_TIMESHEET_APPROVAL_INVALID"
    && failure.error.toLowerCase().includes("correction reason")

  async function submit() {
    if (!selectedAgent || !approvalReady || !canApproveTimesheet) return
    const outcome = await onApprove({
      agentId: selectedAgent.id,
      periodStart: data.start,
      periodEnd: data.end,
      ...(correctionReason.trim() ? { correctionReason: correctionReason.trim() } : {}),
    })
    if (outcome.success) {
      setFailure(null)
      setRecord(outcome.data)
      setExportPreview(null)
      setExportPreviewFailure(null)
      return
    }
    setFailure(outcome)
  }

  async function previewExport() {
    if (!record || previewingExport) return
    setPreviewingExport(true)
    const outcome = await onPreviewApprovedExport(record.id)
    setPreviewingExport(false)
    if (outcome.success) {
      setExportPreview(outcome.data)
      setExportPreviewFailure(null)
      return
    }
    setExportPreview(null)
    setExportPreviewFailure(outcome.error)
  }

  return (
    <section aria-labelledby="workforce-timesheet-approval" className="border-y border-zinc-200 py-5 dark:border-zinc-700">
      <div className="flex flex-col gap-1">
        <h3 id="workforce-timesheet-approval" className="text-base font-semibold">{t("timesheetApprovalTitle")}</h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("timesheetApprovalHint")}</p>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.6fr)_minmax(10rem,0.6fr)_auto] md:items-end">
        <Select
          id="workforce-timesheet-agent"
          label={t("approvalEmployee")}
          value={filters.agentId}
          onChange={(event) => onFiltersChange({ ...filters, agentId: event.target.value })}
          disabled={loading}
          className="min-h-12"
        >
          <option value="">{t("approvalSelectEmployee")}</option>
          {data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </Select>
        <div className="space-y-1.5">
          <label htmlFor="workforce-timesheet-start" className="text-sm font-medium">{t("approvalPeriodStart")}</label>
          <Input
            id="workforce-timesheet-start"
            type="date"
            value={filters.start}
            onChange={(event) => onFiltersChange({ ...filters, start: event.target.value })}
            disabled={loading}
            className="min-h-12"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="workforce-timesheet-end" className="text-sm font-medium">{t("approvalPeriodEnd")}</label>
          <Input
            id="workforce-timesheet-end"
            type="date"
            value={filters.end}
            onChange={(event) => onFiltersChange({ ...filters, end: event.target.value })}
            disabled={loading}
            className="min-h-12"
          />
        </div>
        <Button type="button" variant="outline" className="min-h-12" disabled={loading} onClick={onApplyFilters}>{t("applyTimesheetFilter")}</Button>
      </div>

      {!selectedAgent ? <p className="mt-5 text-sm text-muted-foreground">{t("approvalSelectEmployeeHint")}</p> : (
        <div className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-700">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-medium">{selectedAgent.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("approvalPeriodSummary", { start: data.start, end: data.end, count: selectedRows.length })}</p>
            </div>
            <Badge variant={approvalReady ? "default" : "secondary"}>{approvalReady ? t("approvalReady") : t("approvalNotReady")}</Badge>
          </div>
          {!approvalReady ? <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{selectedRows.length === 0 ? t("approvalNoWorkdays") : t("approvalIncompleteWorkdays")}</p> : null}
          {!canApproveTimesheet ? <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{t("approvalManagerRequired")}</p> : null}
          {correctionReasonRequired ? (
            <div className="mt-4 max-w-3xl space-y-2">
              <label htmlFor="workforce-timesheet-correction-reason" className="text-sm font-medium">{t("timesheetCorrectionReason")}</label>
              <Textarea
                id="workforce-timesheet-correction-reason"
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                maxLength={1000}
                className="min-h-24"
                aria-describedby="workforce-timesheet-correction-hint"
              />
              <p id="workforce-timesheet-correction-hint" className="text-sm text-muted-foreground">{t("timesheetCorrectionReasonHint")}</p>
            </div>
          ) : null}
          {failure ? <p className="mt-4 text-sm text-destructive" role="alert">{failure.error}</p> : null}
          {failure?.blockers.length ? (
            <div className="mt-4 border-l-2 border-amber-500 pl-4" role="status">
              <p className="font-medium">{t("timesheetApprovalBlockingRows")}</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {failure.blockers.map((blocker) => (
                  <li key={[blocker.workDate, blocker.workdayId, blocker.caseReference, blocker.reason, blocker.exceptionType].filter(Boolean).join(":")}>
                    {blocker.workDate}
                    {blocker.caseReference ? ` · ${blocker.caseReference}` : ""}
                    {` · ${t(`timesheetApprovalBlocker.${blocker.reason}`)}`}
                    {blocker.exceptionType ? ` · ${t(`timesheetApprovalException.${blocker.exceptionType}`)}` : ""}
                    {blocker.exceptionStage ? ` · ${t(`timesheetApprovalStage.${blocker.exceptionStage}`)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {record ? <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300" role="status">{t(record.recordKind === "CORRECTION" ? "timesheetCorrectionStatus" : "timesheetApprovalStatus", { revision: record.revision })}</p> : null}
          {record ? (
            <div className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="font-medium">{t("timesheetExportPreviewTitle")}</h4>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("timesheetExportPreviewHint")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={previewingExport}
                  onClick={() => void previewExport()}
                >
                  {previewingExport ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ClipboardList />}
                  {t("previewApprovedExport")}
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{t("timesheetExportCustodianRequired")}</p>
              {exportPreviewFailure ? <p className="mt-3 text-sm text-destructive" role="alert">{exportPreviewFailure}</p> : null}
              {exportPreview ? (
                <div className="mt-4 space-y-4 border-y border-zinc-200 py-4 dark:border-zinc-700">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">{exportPreview.scope.employee.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("approvedExportScope", {
                          start: exportPreview.scope.periodStart,
                          end: exportPreview.scope.periodEnd,
                          count: exportPreview.scope.rowCount,
                        })}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {t(exportPreview.approval.recordKind === "CORRECTION" ? "approvedExportCorrectionRevision" : "approvedExportRevision", {
                        revision: exportPreview.approval.revision,
                      })}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-sm leading-6 text-muted-foreground">
                    <p>{t("approvedExportSiteScopeExcluded")}</p>
                    {exportPreview.warningCodes.map((warning) => (
                      <p key={warning}>{t("approvedExportWarning." + warning)}</p>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[760px] text-left text-sm">
                      <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700">
                        <tr>
                          <th className="py-2 pr-3 font-medium">{t("date")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("worked")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("exportPaused")}</th>
                          <th className="px-3 py-2 font-medium">{t("deviations")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {exportPreview.rows.map((row) => {
                          const deviations = [
                            row.lateStartSeconds > 0 ? t("lateStart", { duration: duration(row.lateStartSeconds) }) : null,
                            row.undertimeSeconds > 0 ? t("undertime", { duration: duration(row.undertimeSeconds) }) : null,
                            row.overtimeSeconds > 0 ? t("overtime", { duration: duration(row.overtimeSeconds) }) : null,
                            row.longPauseSeconds > 0 ? t("longPause", { duration: duration(row.longPauseSeconds) }) : null,
                          ].filter((value): value is string => value != null)
                          return (
                            <tr key={row.workdayId}>
                              <td className="whitespace-nowrap py-3 pr-3">{formatter.format(new Date(row.workDate + "T12:00:00"))}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{duration(row.workedSeconds)}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{duration(row.pausedSeconds)}</td>
                              <td className="px-3 py-3 text-xs text-muted-foreground">{deviations.join(" · ") || t("onPlan")}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-sm text-muted-foreground">{t("approvedExportDirectSessionOnly")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {canApproveTimesheet ? <div className="mt-5">
            <Button
              type="button"
              className="min-h-12"
              disabled={!approvalReady || approving || (correctionReasonRequired && !correctionReason.trim())}
              onClick={submit}
            >
              {approving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}
              {correctionReasonRequired ? t("recordTimesheetCorrection") : t("recordTimesheetApproval")}
            </Button>
          </div> : null}
        </div>
      )}
    </section>
  )
}

function SelfRequestPanel({ data, t, submitting, preselectedCorrectionWorkdayId, preselectedExceptionCaseId, onSubmit }: {
  data: RequestsData
  t: ReturnType<typeof useTranslations>
  submitting: boolean
  preselectedCorrectionWorkdayId: string | null
  preselectedExceptionCaseId: string | null
  onSubmit: (input: {
    clientRequestId: string
    type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
    startDate: string
    endDate: string
    reason: string
    correctionWorkdayId?: string
    exceptionCaseId?: string
    requestedStartLocal?: string
    requestedEndLocal?: string
  }) => Promise<{ idempotent: boolean }>
}) {
  const [draft, setDraft] = useState({
    type: "LEAVE" as "LEAVE" | "ABSENCE" | "TIME_CORRECTION",
    startDate: "",
    endDate: "",
    reason: "",
    correctionWorkdayId: "",
    requestedStartLocal: "",
    requestedEndLocal: "",
  })
  const [clientRequestId, setClientRequestId] = useState(createSelfRequestClientId)
  const [prefillDismissed, setPrefillDismissed] = useState(false)
  const prefilledWorkdayId = !prefillDismissed && preselectedCorrectionWorkdayId && data.selfWorkdays.some((workday) => workday.id === preselectedCorrectionWorkdayId)
    ? preselectedCorrectionWorkdayId
    : ""
  const selectedWorkdayId = draft.correctionWorkdayId || prefilledWorkdayId
  const requestType = draft.type === "LEAVE" && prefilledWorkdayId ? "TIME_CORRECTION" : draft.type
  const exceptionCaseId = !prefillDismissed && prefilledWorkdayId && preselectedExceptionCaseId
    ? preselectedExceptionCaseId
    : undefined
  const selectedWorkday = data.selfWorkdays.find((workday) => workday.id === selectedWorkdayId) ?? null
  const correction = requestType === "TIME_CORRECTION"
  const startDate = correction ? selectedWorkday?.workDate.slice(0, 10) ?? "" : draft.startDate
  const endDate = correction ? selectedWorkday?.workDate.slice(0, 10) ?? "" : draft.endDate
  const hasTimeBoundary = Boolean(draft.requestedStartLocal || draft.requestedEndLocal)
  const ready = Boolean(draft.reason.trim() && startDate && endDate && (!correction || (selectedWorkday && hasTimeBoundary)))

  async function submit() {
    if (!ready) return
    try {
      await onSubmit({
        clientRequestId,
        type: requestType,
        startDate,
        endDate,
        reason: draft.reason.trim(),
        ...(correction ? {
          correctionWorkdayId: selectedWorkday?.id,
          ...(exceptionCaseId ? { exceptionCaseId } : {}),
          requestedStartLocal: draft.requestedStartLocal || undefined,
          requestedEndLocal: draft.requestedEndLocal || undefined,
        } : {}),
      })
      setDraft({
        type: "LEAVE",
        startDate: "",
        endDate: "",
        reason: "",
        correctionWorkdayId: "",
        requestedStartLocal: "",
        requestedEndLocal: "",
      })
      setPrefillDismissed(true)
      setClientRequestId(createSelfRequestClientId())
    } catch {
      // Keep the same idempotency key and entered text so a network retry remains safe.
    }
  }

  return <section aria-labelledby="workforce-self-request" className="border-y border-zinc-200 py-5 dark:border-zinc-700">
    <div className="max-w-3xl">
      <h3 id="workforce-self-request" className="text-base font-semibold">{t("selfRequestTitle")}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("selfRequestHint")}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground"><Link href="/workforce/exceptions/mine" className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("selfExceptionReview")}</Link><span className="ml-1">{t("selfExceptionReviewHint")}</span></p>
    </div>
    <form className="mt-5 grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <Select
        id="workforce-self-request-type"
        label={t("selfRequestType")}
        value={requestType}
        onChange={(event) => {
          setPrefillDismissed(true)
          setDraft((current) => ({
            ...current,
            type: event.target.value as "LEAVE" | "ABSENCE" | "TIME_CORRECTION",
          }))
        }}
        disabled={submitting}
        className="min-h-12"
      >
        <option value="LEAVE">{t("requestType.leave")}</option>
        <option value="ABSENCE">{t("requestType.absence")}</option>
        <option value="TIME_CORRECTION">{t("requestType.correction")}</option>
      </Select>

      {correction ? <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="workforce-self-request-workday"
          label={t("selfRequestWorkday")}
          value={selectedWorkdayId}
          onChange={(event) => {
            setPrefillDismissed(true)
            setDraft((current) => ({ ...current, correctionWorkdayId: event.target.value }))
          }}
          disabled={submitting || data.selfWorkdays.length === 0}
          className="min-h-12"
        >
          <option value="">{t("selfRequestSelectWorkday")}</option>
          {data.selfWorkdays.map((workday) => <option key={workday.id} value={workday.id}>{workday.workDate.slice(0, 10)} · {t(`status.${workday.status}`)}</option>)}
        </Select>
        <div className="space-y-1.5">
          <label htmlFor="workforce-self-request-start-time" className="text-sm font-medium">{t("selfRequestStartTime", { timezone: data.timezone })}</label>
          <Input id="workforce-self-request-start-time" type="datetime-local" value={draft.requestedStartLocal} onChange={(event) => setDraft((current) => ({ ...current, requestedStartLocal: event.target.value }))} disabled={submitting || !selectedWorkday} className="min-h-12" />
        </div>
        <div className="space-y-1.5 md:col-start-2">
          <label htmlFor="workforce-self-request-end-time" className="text-sm font-medium">{t("selfRequestEndTime", { timezone: data.timezone })}</label>
          <Input id="workforce-self-request-end-time" type="datetime-local" value={draft.requestedEndLocal} onChange={(event) => setDraft((current) => ({ ...current, requestedEndLocal: event.target.value }))} disabled={submitting || !selectedWorkday} className="min-h-12" />
        </div>
        {data.selfWorkdays.length === 0 ? <p className="text-sm text-muted-foreground md:col-span-2">{t("selfRequestNoWorkdays")}</p> : <p className="text-sm text-muted-foreground md:col-span-2">{t("selfRequestTimeHint")}</p>}
      </div> : <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="workforce-self-request-start-date" className="text-sm font-medium">{t("selfRequestStartDate")}</label>
          <Input id="workforce-self-request-start-date" type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value, endDate: !current.endDate || current.endDate < event.target.value ? event.target.value : current.endDate }))} disabled={submitting} className="min-h-12" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="workforce-self-request-end-date" className="text-sm font-medium">{t("selfRequestEndDate")}</label>
          <Input id="workforce-self-request-end-date" type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))} disabled={submitting} className="min-h-12" required />
        </div>
      </div>}

      <div className="space-y-1.5">
        <label htmlFor="workforce-self-request-reason" className="text-sm font-medium">{t("selfRequestReason")}</label>
        <Textarea id="workforce-self-request-reason" value={draft.reason} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} maxLength={1000} minLength={3} disabled={submitting} className="min-h-28" aria-describedby="workforce-self-request-reason-hint" required />
        <p id="workforce-self-request-reason-hint" className="text-sm text-muted-foreground">{t("selfRequestReasonHint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-12" disabled={submitting || !ready}>{submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{t("selfRequestSubmit")}</Button>
        {correction ? <span className="text-sm text-muted-foreground">{t("selfRequestPendingHint")}</span> : null}
      </div>
    </form>
  </section>
}

function RequestsView({
  data, t, formatter, locale, canDecide, notes, conflicts, savingId, submittingSelfRequest, cancellingSelfRequestId, loadingMore, preselectedCorrectionWorkdayId, preselectedExceptionCaseId, onNoteChange, onDecide, onSubmitSelf, onCancelSelf, onLoadMore,
}: {
  data: RequestsData
  t: ReturnType<typeof useTranslations>
  formatter: Intl.DateTimeFormat
  locale: string
  canDecide: boolean
  notes: Record<string, string>
  conflicts: Record<string, RouteConflict[]>
  savingId: string | null
  submittingSelfRequest: boolean
  cancellingSelfRequestId: string | null
  loadingMore: boolean
  preselectedCorrectionWorkdayId: string | null
  preselectedExceptionCaseId: string | null
  onNoteChange: (id: string, value: string) => void
  onDecide: (request: WorkforceRequest, decision: "APPROVED" | "REJECTED", acknowledgeRouteConflicts?: boolean) => void
  onSubmitSelf: (input: {
    clientRequestId: string
    type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
    startDate: string
    endDate: string
    reason: string
    correctionWorkdayId?: string
    exceptionCaseId?: string
    requestedStartLocal?: string
    requestedEndLocal?: string
  }) => Promise<{ idempotent: boolean }>
  onCancelSelf: (request: WorkforceRequest) => Promise<void>
  onLoadMore: () => void
}) {
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: data.timezone,
  })
  return <>
    {data.canSubmitSelf ? <SelfRequestPanel data={data} t={t} submitting={submittingSelfRequest} preselectedCorrectionWorkdayId={preselectedCorrectionWorkdayId} preselectedExceptionCaseId={preselectedExceptionCaseId} onSubmit={onSubmitSelf} /> : null}
    <section aria-labelledby="workforce-request-list" className="border-y border-zinc-200 dark:border-zinc-700">
    <div className="flex flex-col gap-1 px-1 py-5 sm:flex-row sm:items-baseline sm:justify-between"><div><h3 id="workforce-request-list" className="text-base font-semibold">{data.canSubmitSelf ? t("selfRequestHistory") : t("requestQueue")}</h3><p className="text-sm text-muted-foreground">{data.canSubmitSelf ? t("selfRequestPendingHint") : t("requestQueueHint")}</p></div><span className="text-sm text-muted-foreground">{t("requestCount", { count: data.requests.length })}</span></div>
    <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
      {data.requests.map((request) => <article key={request.id} className="py-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{request.agent.name}</p><Badge variant={statusTone(request.status)}>{t(`requestStatus.${request.status}`)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{t(`requestType.${requestTypeKey(request.type)}`)} · {formatter.format(new Date(`${request.startDate.slice(0, 10)}T12:00:00`))}{request.endDate.slice(0, 10) !== request.startDate.slice(0, 10) ? ` — ${formatter.format(new Date(`${request.endDate.slice(0, 10)}T12:00:00`))}` : ""}</p><p className="mt-3 max-w-3xl text-sm leading-6">{request.reason}</p>{request.type === "TIME_CORRECTION" ? <p className="mt-2 text-sm text-muted-foreground">{t("requestedCorrection", { start: request.requestedStartAt ? dateTimeFormatter.format(new Date(request.requestedStartAt)) : t("unchanged"), end: request.requestedEndAt ? dateTimeFormatter.format(new Date(request.requestedEndAt)) : t("unchanged") })}</p> : null}{request.decisionNote ? <p className="mt-2 text-sm text-muted-foreground">{t("decisionNote")}: {request.decisionNote}</p> : null}</div><span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="h-4 w-4" />{request.agent.role}</span></div>
        {canDecide && request.status === "PENDING" ? <div className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700 lg:grid-cols-[minmax(0,1fr)_auto]"><Textarea aria-label={t("decisionNoteLabel", { name: request.agent.name })} value={notes[request.id] ?? ""} onChange={(event) => onNoteChange(request.id, event.target.value)} placeholder={t("decisionNotePlaceholder")} className="min-h-24" maxLength={1000} /><div className="flex flex-wrap items-start gap-2"><Button type="button" className="min-h-12" disabled={savingId === request.id} onClick={() => onDecide(request, "APPROVED")}><Check />{t("approve")}</Button><Button type="button" variant="outline" className="min-h-12" disabled={savingId === request.id} onClick={() => onDecide(request, "REJECTED")}><X />{t("reject")}</Button></div></div> : null}
        {data.canSubmitSelf && request.status === "PENDING" ? <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700"><Button type="button" variant="outline" className="min-h-12" disabled={cancellingSelfRequestId === request.id} onClick={() => void onCancelSelf(request)}>{cancellingSelfRequestId === request.id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <X />}{t("selfRequestCancel")}</Button></div> : null}
        {conflicts[request.id]?.length ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"><div className="flex gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" /><div className="min-w-0"><p className="font-medium text-amber-950 dark:text-amber-100">{t("routeConflictTitle")}</p><p className="mt-1 text-sm text-amber-900/80 dark:text-amber-100/80">{t("routeConflictHint")}</p><ul className="mt-3 space-y-1 text-sm text-amber-950 dark:text-amber-100">{conflicts[request.id].map((conflict) => <li key={conflict.id}>{conflict.date.slice(0, 10)} · {conflict.name || conflict.id}</li>)}</ul><Button type="button" variant="outline" className="mt-4 min-h-12 border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:hover:bg-amber-900/30" disabled={savingId === request.id} onClick={() => onDecide(request, "APPROVED", true)}>{savingId === request.id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{t("approveWithConflicts")}</Button></div></div></div> : null}
      </article>)}
      {data.requests.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{t("noRequests")}</p> : null}
      {data.nextCursor ? <div className="flex justify-center py-5"><Button type="button" variant="outline" className="min-h-12" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}{t("loadMore")}</Button></div> : null}
    </div>
    </section>
  </>
}
