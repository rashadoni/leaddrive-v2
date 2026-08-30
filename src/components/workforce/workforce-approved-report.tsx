"use client"

import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, RefreshCw } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ApprovedReport = {
  start: string
  end: string
  summary: {
    employees: number
    workdays: number
    expectedWorkSeconds: number
    workedSeconds: number
    pausedSeconds: number
    lateStartSeconds: number
    undertimeSeconds: number
    overtimeSeconds: number
    longPauseSeconds: number
    approvalsExamined: number
    overlappingRowsSuppressed: number
  }
  byEmployee: Array<{
    agentId: string
    name: string
    workdays: number
    expectedWorkSeconds: number
    workedSeconds: number
    pausedSeconds: number
    lateStartSeconds: number
    undertimeSeconds: number
    overtimeSeconds: number
    longPauseSeconds: number
  }>
  unavailable: {
    noShow: string
    siteTransitions: string
    freeTextAppeals: string
  }
}

type ReportData = { timezone: string; report: ApprovedReport }

function duration(value: number): string {
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, "0")}`
}

function initialRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 13)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export function WorkforceApprovedReport() {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations("workforcePage")
  const defaults = useMemo(() => initialRange(), [])
  const [filters, setFilters] = useState(defaults)
  const [applied, setApplied] = useState(defaults)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams(applied)
    fetch("/api/v1/workforce/reports?" + parameters.toString(), {
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
        setData(result.data as ReportData)
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "AbortError") return
        setError(cause instanceof Error ? cause.message : t("approvedReportLoadFailed"))
        setData(null)
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [applied, organizationId, retry, t])

  const formatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const report = data?.report ?? null
  const hasDeviations = report != null && (
    report.summary.lateStartSeconds > 0
    || report.summary.undertimeSeconds > 0
    || report.summary.overtimeSeconds > 0
    || report.summary.longPauseSeconds > 0
  )

  function apply() {
    if (!filters.start || !filters.end || filters.end < filters.start) {
      setError(t("approvedReportRangeInvalid"))
      return
    }
    setLoading(true)
    setError(null)
    setApplied(filters)
  }

  return <section className="space-y-6">
    <PageDescription title={t("approvedReportTitle")} description={t("approvedReportSubtitle")} />
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5"><label htmlFor="workforce-report-start" className="text-sm font-medium">{t("approvalPeriodStart")}</label><Input id="workforce-report-start" type="date" value={filters.start} onChange={(event) => setFilters({ ...filters, start: event.target.value })} disabled={loading} className="min-h-11" /></div>
        <div className="space-y-1.5"><label htmlFor="workforce-report-end" className="text-sm font-medium">{t("approvalPeriodEnd")}</label><Input id="workforce-report-end" type="date" value={filters.end} onChange={(event) => setFilters({ ...filters, end: event.target.value })} disabled={loading} className="min-h-11" /></div>
        <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={apply}>{t("approvedReportApply")}</Button><Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("refresh")} disabled={loading} onClick={() => { setLoading(true); setError(null); setRetry((value) => value + 1) }}>{loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}</Button></div>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{t("approvedReportSourceHint")}</p>
    </div>
    {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
    {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("approvedReportLoading")}</div> : null}
    {report && !loading ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReportMetric label={t("approvedReportEmployees")} value={formatter.format(report.summary.employees)} />
        <ReportMetric label={t("approvedReportWorkdays")} value={formatter.format(report.summary.workdays)} />
        <ReportMetric label={t("approvedReportExpected")} value={duration(report.summary.expectedWorkSeconds)} />
        <ReportMetric label={t("approvedReportWorked")} value={duration(report.summary.workedSeconds)} />
      </div>
      <section aria-labelledby="workforce-approved-report-deviations" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 id="workforce-approved-report-deviations" className="font-semibold">{t("approvedReportDeviationTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("overtimeOperationalNotice")}</p></div><Badge variant={hasDeviations ? "secondary" : "default"}>{hasDeviations ? t("needsReview") : t("onPlan")}</Badge></div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricDefinition label={t("timesheetException.LATE_START", { duration: "" }).trim()} value={duration(report.summary.lateStartSeconds)} /><MetricDefinition label={t("timesheetException.UNDERTIME", { duration: "" }).trim()} value={duration(report.summary.undertimeSeconds)} /><MetricDefinition label={t("timesheetException.OVERTIME", { duration: "" }).trim()} value={duration(report.summary.overtimeSeconds)} /><MetricDefinition label={t("timesheetException.LONG_PAUSE", { duration: "" }).trim()} value={duration(report.summary.longPauseSeconds)} /></dl>
      </section>
      <section aria-labelledby="workforce-approved-report-employees" className="rounded-lg border border-zinc-200 dark:border-zinc-700"><div className="border-b border-zinc-200 p-4 dark:border-zinc-700"><h2 id="workforce-approved-report-employees" className="font-semibold">{t("approvedReportEmployeeBreakdown")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("approvedReportEmployeeHint")}</p></div><div className="overflow-x-auto"><table className="min-w-[820px] text-left text-sm"><thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700"><tr><th className="px-4 py-3 font-medium">{t("employee")}</th><th className="px-4 py-3 text-right font-medium">{t("approvedReportWorkdays")}</th><th className="px-4 py-3 text-right font-medium">{t("approvedReportExpected")}</th><th className="px-4 py-3 text-right font-medium">{t("approvedReportWorked")}</th><th className="px-4 py-3 text-right font-medium">{t("exportPaused")}</th><th className="px-4 py-3 text-right font-medium">{t("deviations")}</th></tr></thead><tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">{report.byEmployee.map((employee) => <tr key={employee.agentId}><td className="px-4 py-3 font-medium">{employee.name}</td><td className="px-4 py-3 text-right tabular-nums">{formatter.format(employee.workdays)}</td><td className="px-4 py-3 text-right tabular-nums">{duration(employee.expectedWorkSeconds)}</td><td className="px-4 py-3 text-right tabular-nums">{duration(employee.workedSeconds)}</td><td className="px-4 py-3 text-right tabular-nums">{duration(employee.pausedSeconds)}</td><td className="px-4 py-3 text-right text-xs text-muted-foreground">{[employee.lateStartSeconds > 0 ? t("lateStart", { duration: duration(employee.lateStartSeconds) }) : null, employee.undertimeSeconds > 0 ? t("undertime", { duration: duration(employee.undertimeSeconds) }) : null, employee.overtimeSeconds > 0 ? t("overtime", { duration: duration(employee.overtimeSeconds) }) : null, employee.longPauseSeconds > 0 ? t("longPause", { duration: duration(employee.longPauseSeconds) }) : null].filter((value): value is string => value != null).join(" · ") || t("onPlan")}</td></tr>)}{report.byEmployee.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{t("approvedReportNoApprovals")}</td></tr> : null}</tbody></table></div></section>
      <section aria-labelledby="workforce-approved-report-boundaries" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><h2 id="workforce-approved-report-boundaries" className="font-semibold">{t("approvedReportBoundaryTitle")}</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground"><li>{t("approvedReportNoShowUnavailable")}</li><li>{t("approvedReportSiteUnavailable")}</li><li>{t("approvedReportAppealUnavailable")}</li></ul></section>
    </> : null}
  </section>
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>
}

function MetricDefinition({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>
}
