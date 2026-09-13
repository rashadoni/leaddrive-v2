"use client"

import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type TransitionMetrics = {
  claims: number
  arrivals: number
  departures: number
  completedSegments: number
  incompleteSegments: number
  pendingReviewClaims: number
  legacyUnknownClaims: number
}

type SiteTransitionReport = {
  source: "APPEND_ONLY_SITE_TRANSITION_CLAIMS"
  summary: TransitionMetrics & { employees: number; sites: number }
  bySite: Array<TransitionMetrics & { siteId: string; name: string }>
  byEmployee: Array<TransitionMetrics & { agentId: string; name: string }>
  boundaries: {
    physicalPresence: "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE"
    rawLocation: "EXCLUDED_FROM_TRANSITION_REPORT"
    proofDetails: "EXCLUDED_FROM_TRANSITION_REPORT"
    payroll: "NOT_A_PAYROLL_INPUT"
  }
}

type ReportData = {
  timezone: string
  start: string
  end: string
  dateBasis: "CLAIMED_AT"
  report: SiteTransitionReport
}

type ReportFilter = { start: string; end: string; agentId: string; siteId: string }

const METRICS = [
  "claims",
  "arrivals",
  "departures",
  "completedSegments",
  "incompleteSegments",
  "pendingReviewClaims",
  "legacyUnknownClaims",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function metrics(value: Record<string, unknown>): TransitionMetrics | null {
  if (!METRICS.every((key) => safeInteger(value[key]))) return null
  return Object.fromEntries(METRICS.map((key) => [key, value[key]])) as TransitionMetrics
}

function namedRows(
  value: unknown,
  idKey: "siteId" | "agentId",
): Array<TransitionMetrics & { id: string; name: string }> | null {
  if (!Array.isArray(value) || value.length > 5_000) return null
  const rows = value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const rowMetrics = metrics(candidate)
    const id = candidate[idKey]
    if (
      !rowMetrics
      || typeof id !== "string"
      || !/^[A-Za-z0-9_-]{1,191}$/.test(id)
      || typeof candidate.name !== "string"
      || candidate.name.length < 1
      || candidate.name.length > 500
    ) return []
    return [{ id, name: candidate.name, ...rowMetrics }]
  })
  if (rows.length !== value.length || new Set(rows.map((row) => row.id)).size !== rows.length) return null
  return rows
}

function supportedTimezone(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function parseReportData(value: unknown): ReportData | null {
  if (
    !isRecord(value)
    || !supportedTimezone(value.timezone)
    || typeof value.start !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.start)
    || typeof value.end !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.end)
    || value.end < value.start
    || value.dateBasis !== "CLAIMED_AT"
    || !isRecord(value.report)
  ) return null
  const report = value.report
  if (
    report.source !== "APPEND_ONLY_SITE_TRANSITION_CLAIMS"
    || !isRecord(report.summary)
    || !isRecord(report.boundaries)
    || report.boundaries.physicalPresence !== "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE"
    || report.boundaries.rawLocation !== "EXCLUDED_FROM_TRANSITION_REPORT"
    || report.boundaries.proofDetails !== "EXCLUDED_FROM_TRANSITION_REPORT"
    || report.boundaries.payroll !== "NOT_A_PAYROLL_INPUT"
  ) return null
  const summaryMetrics = metrics(report.summary)
  const bySite = namedRows(report.bySite, "siteId")
  const byEmployee = namedRows(report.byEmployee, "agentId")
  if (
    !summaryMetrics
    || !safeInteger(report.summary.employees)
    || !safeInteger(report.summary.sites)
    || !bySite
    || !byEmployee
    || report.summary.employees !== byEmployee.length
    || report.summary.sites !== bySite.length
    || summaryMetrics.arrivals + summaryMetrics.departures !== summaryMetrics.claims
    || METRICS.some((key) => bySite.reduce((sum, row) => sum + row[key], 0) !== summaryMetrics[key])
    || METRICS.some((key) => byEmployee.reduce((sum, row) => sum + row[key], 0) !== summaryMetrics[key])
  ) return null
  return {
    timezone: value.timezone,
    start: value.start,
    end: value.end,
    dateBasis: value.dateBasis,
    report: {
      source: report.source,
      summary: { employees: report.summary.employees, sites: report.summary.sites, ...summaryMetrics },
      bySite: bySite.map(({ id, ...row }) => ({ siteId: id, ...row })),
      byEmployee: byEmployee.map(({ id, ...row }) => ({ agentId: id, ...row })),
      boundaries: {
        physicalPresence: report.boundaries.physicalPresence,
        rawLocation: report.boundaries.rawLocation,
        proofDetails: report.boundaries.proofDetails,
        payroll: report.boundaries.payroll,
      },
    },
  }
}

function initialFilter(): ReportFilter {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 13)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), agentId: "", siteId: "" }
}

export function WorkforceSiteTransitionReport() {
  const { data: session } = useSession()
  const t = useTranslations("workforceSiteTransitionReport")
  const locale = useLocale()
  const [filters, setFilters] = useState(initialFilter)
  const [applied, setApplied] = useState<ReportFilter | null>(null)
  const [data, setData] = useState<ReportData | null>(null)
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([])
  const [sites, setSites] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams()
    if (applied) {
      query.set("start", applied.start)
      query.set("end", applied.end)
      if (applied.agentId) query.set("agentId", applied.agentId)
      if (applied.siteId) query.set("siteId", applied.siteId)
    }
    fetch(`/api/v1/workforce/site-transition-reports?${query}`, {
      cache: "no-store",
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    }).then(async (response) => {
      const result: unknown = await response.json().catch(() => ({}))
      if (!response.ok || !isRecord(result) || result.success !== true) throw new Error("LOAD_FAILED")
      const next = parseReportData(result.data)
      if (!next) throw new Error("RESPONSE_INVALID")
      if (controller.signal.aborted) return
      setData(next)
      if (!applied?.agentId && !applied?.siteId) {
        setEmployees(next.report.byEmployee.map(({ agentId: id, name }) => ({ id, name })))
        setSites(next.report.bySite.map(({ siteId: id, name }) => ({ id, name })))
      }
      setFilters((current) => ({ ...current, start: next.start, end: next.end }))
    }).catch((cause: unknown) => {
      if (cause instanceof Error && cause.name === "AbortError") return
      setData(null)
      setError(t("loadFailed"))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [applied, organizationId, retry, t])

  const number = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const report = data?.report ?? null
  function apply() {
    if (!filters.start || !filters.end || filters.end < filters.start) {
      setError(t("rangeInvalid"))
      return
    }
    setError(null)
    setLoading(true)
    setApplied(filters)
  }

  return <section className="space-y-6">
    <PageDescription title={t("title")} description={t("subtitle")} />
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] xl:items-end">
        <FilterDate id="transition-report-start" label={t("start")} value={filters.start} disabled={loading} onChange={(start) => setFilters({ ...filters, start })} />
        <FilterDate id="transition-report-end" label={t("end")} value={filters.end} disabled={loading} onChange={(end) => setFilters({ ...filters, end })} />
        <FilterSelect id="transition-report-agent" label={t("employee")} all={t("allEmployees")} value={filters.agentId} options={employees} disabled={loading || filters.siteId !== ""} onChange={(agentId) => setFilters({ ...filters, agentId, siteId: "" })} />
        <FilterSelect id="transition-report-site" label={t("site")} all={t("allSites")} value={filters.siteId} options={sites} disabled={loading || filters.agentId !== ""} onChange={(siteId) => setFilters({ ...filters, siteId, agentId: "" })} />
        <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={apply}>{t("apply")}</Button><Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("refresh")} disabled={loading} onClick={() => { setError(null); setLoading(true); setRetry((value) => value + 1) }}>{loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}</Button></div>
      </div>
      {data ? <p className="mt-3 text-sm text-muted-foreground">{t("timezone", { timezone: data.timezone })}</p> : null}
    </div>
    {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
    {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div> : null}
    {report && !loading ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label={t("claims")} value={report.summary.claims} number={number} /><Metric label={t("completed")} value={report.summary.completedSegments} number={number} /><Metric label={t("incomplete")} value={report.summary.incompleteSegments} number={number} /><Metric label={t("pendingReview")} value={report.summary.pendingReviewClaims} number={number} /></div>
      <ReportTable title={t("bySite")} identityLabel={t("site")} rows={report.bySite.map(({ siteId, name, ...row }) => ({ id: siteId, name, ...row }))} number={number} labels={{ arrivals: t("arrivals"), departures: t("departures"), completed: t("completed"), incomplete: t("incomplete"), pendingReview: t("pendingReview"), empty: t("empty") }} />
      <ReportTable title={t("byEmployee")} identityLabel={t("employee")} rows={report.byEmployee.map(({ agentId, name, ...row }) => ({ id: agentId, name, ...row }))} number={number} labels={{ arrivals: t("arrivals"), departures: t("departures"), completed: t("completed"), incomplete: t("incomplete"), pendingReview: t("pendingReview"), empty: t("empty") }} />
      <section aria-labelledby="transition-report-boundary" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 id="transition-report-boundary" className="font-semibold">{t("boundaryTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("boundary")}</p></div></div></section>
    </> : null}
  </section>
}

function FilterDate(props: { id: string; label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><label htmlFor={props.id} className="text-sm font-medium">{props.label}</label><Input id={props.id} type="date" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)} className="min-h-11" /></div>
}

function FilterSelect(props: { id: string; label: string; all: string; value: string; options: Array<{ id: string; name: string }>; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><label htmlFor={props.id} className="text-sm font-medium">{props.label}</label><select id={props.id} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)} className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"><option value="">{props.all}</option>{props.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>
}

function Metric({ label, value, number }: { label: string; value: number; number: Intl.NumberFormat }) {
  return <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{number.format(value)}</p></div>
}

function ReportTable({ title, identityLabel, rows, number, labels }: { title: string; identityLabel: string; rows: Array<TransitionMetrics & { id: string; name: string }>; number: Intl.NumberFormat; labels: { arrivals: string; departures: string; completed: string; incomplete: string; pendingReview: string; empty: string } }) {
  return <section aria-label={title} className="rounded-lg border border-zinc-200 dark:border-zinc-700"><div className="border-b border-zinc-200 p-4 dark:border-zinc-700"><h2 className="font-semibold">{title}</h2></div><div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}><table className="min-w-[760px] text-left text-sm"><thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700"><tr><th className="px-4 py-3 font-medium">{identityLabel}</th><th className="px-4 py-3 text-right font-medium">{labels.arrivals}</th><th className="px-4 py-3 text-right font-medium">{labels.departures}</th><th className="px-4 py-3 text-right font-medium">{labels.completed}</th><th className="px-4 py-3 text-right font-medium">{labels.incomplete}</th><th className="px-4 py-3 text-right font-medium">{labels.pendingReview}</th></tr></thead><tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">{rows.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium">{row.name}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(row.arrivals)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(row.departures)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(row.completedSegments)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(row.incompleteSegments)}</td><td className="px-4 py-3 text-right tabular-nums"><Badge variant={row.pendingReviewClaims > 0 ? "secondary" : "outline"}>{number.format(row.pendingReviewClaims)}</Badge></td></tr>)}{rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{labels.empty}</td></tr> : null}</tbody></table></div></section>
}
