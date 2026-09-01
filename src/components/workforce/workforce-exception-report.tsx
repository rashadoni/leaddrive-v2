"use client"

import Link from "next/link"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { BarChart3, ChevronLeft, Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type ExceptionReport = {
  summary: {
    employees: number
    cases: number
    open: number
    awaitingEmployeeResponse: number
    hrReview: number
    resolved: number
    dataIntegrityReview: number
    employeeResponsesReceived: number
  }
  byType: Array<{
    type: string
    triageSeverity: "ROUTINE_REVIEW" | "ATTENTION_REVIEW"
    cases: number
    open: number
    awaitingEmployeeResponse: number
    hrReview: number
    resolved: number
    dataIntegrityReview: number
  }>
}

type ReportResponse = {
  timezone: string
  start: string
  end: string
  dateBasis: "CASE_RECORDED_AT"
  report: ExceptionReport
}

export function WorkforceExceptionReport() {
  const { data: session } = useSession()
  const t = useTranslations("workforceExceptionReport")
  const tQueue = useTranslations("workforceExceptionQueue")
  const [data, setData] = useState<ReportResponse | null>(null)
  const [draftRange, setDraftRange] = useState({ start: "", end: "" })
  const [requestedRange, setRequestedRange] = useState<{ start: string; end: string } | null>(null)
  const [accessDeniedRequestKey, setAccessDeniedRequestKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  const requestKey = `${organizationId}:${retry}`
  const accessDenied = accessDeniedRequestKey === requestKey
  const number = useMemo(() => new Intl.NumberFormat(), [])

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams()
    if (requestedRange) {
      parameters.set("start", requestedRange.start)
      parameters.set("end", requestedRange.end)
    }
    const suffix = parameters.size > 0 ? `?${parameters.toString()}` : ""
    fetch(`/api/v1/workforce/exception-reports${suffix}`, {
      headers: organizationId ? { "x-organization-id": organizationId } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        // The matching queue route accepts a scoped Workforce grant after
        // rollout. Do not pre-empt that server decision with a stale CRM role
        // in the browser.
        if (response.status === 403) {
          setData(null)
          setAccessDeniedRequestKey(requestKey)
          return
        }
        if (!response.ok || !body.success) throw new Error("WORKFORCE_EXCEPTION_REPORT_LOAD_FAILED")
        const next = body.data as ReportResponse
        setData(next)
        if (!requestedRange) setDraftRange({ start: next.start, end: next.end })
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name !== "AbortError") {
          setData(null)
          setError(t("loadFailed"))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [organizationId, requestKey, requestedRange, t])

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draftRange.start || !draftRange.end) {
      setError(t("rangeRequired"))
      return
    }
    setLoading(true)
    setError(null)
    setRequestedRange({ ...draftRange })
  }

  function refresh() {
    setLoading(true)
    setError(null)
    setRetry((value) => value + 1)
  }

  if (accessDenied) {
    return <section className="space-y-6"><PageDescription title={t("title")} description={t("subtitle")} /><div className="rounded-lg border border-zinc-200 p-4 text-sm text-muted-foreground dark:border-zinc-700" role="status">{t("adminOnly")}</div></section>
  }

  const report = data?.report
  return <section className="space-y-6">
    <PageDescription title={t("title")} description={t("subtitle")} />
    <section data-testid="workforce-exception-report-boundary" aria-labelledby="workforce-exception-report-boundary" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h2 id="workforce-exception-report-boundary" className="font-semibold">{t("boundaryTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{t("boundaryHint")}</p></div></div>
    </section>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <form className="flex flex-wrap items-end gap-3" onSubmit={applyRange}>
        <label className="grid gap-1 text-sm font-medium"><span>{t("start")}</span><input className="h-10 rounded-md border border-input bg-background px-3 text-sm" type="date" value={draftRange.start} onChange={(event) => setDraftRange((current) => ({ ...current, start: event.target.value }))} required /></label>
        <label className="grid gap-1 text-sm font-medium"><span>{t("end")}</span><input className="h-10 rounded-md border border-input bg-background px-3 text-sm" type="date" value={draftRange.end} onChange={(event) => setDraftRange((current) => ({ ...current, end: event.target.value }))} required /></label>
        <Button type="submit" className="min-h-10" disabled={loading}>{loading ? <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" /> : <BarChart3 className="mr-2 size-4" />}{t("apply")}</Button>
      </form>
      <div className="flex gap-2"><Button asChild type="button" variant="outline" className="min-h-10"><Link href="/workforce/exceptions"><ChevronLeft className="mr-2 size-4" />{t("backToQueue")}</Link></Button><Button type="button" variant="outline" className="min-h-10" onClick={refresh} disabled={loading}>{loading ? <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="mr-2 size-4" />}{t("refresh")}</Button></div>
    </div>
    {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div> : null}
    {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t("loading")}</div> : null}
    {data && report && !loading ? <>
      <section aria-labelledby="workforce-exception-report-summary" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="workforce-exception-report-summary" className="font-semibold">{t("summaryTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("periodHint", { start: data.start, end: data.end, timezone: data.timezone })}</p></div><Badge variant="outline">{t("recordedCaseDate")}</Badge></div><dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label={t("metrics.cases")} value={report.summary.cases} number={number} /><Metric label={t("metrics.employees")} value={report.summary.employees} number={number} /><Metric label={tQueue("stages.OPEN")} value={report.summary.open} number={number} /><Metric label={tQueue("stages.AWAITING_EMPLOYEE_RESPONSE")} value={report.summary.awaitingEmployeeResponse} number={number} /><Metric label={tQueue("stages.HR_REVIEW")} value={report.summary.hrReview} number={number} /><Metric label={tQueue("stages.RESOLVED")} value={report.summary.resolved} number={number} /><Metric label={tQueue("stages.DATA_INTEGRITY_REVIEW")} value={report.summary.dataIntegrityReview} number={number} /><Metric label={t("metrics.employeeResponsesReceived")} value={report.summary.employeeResponsesReceived} number={number} /></dl></section>
      <section aria-labelledby="workforce-exception-report-types" className="rounded-lg border border-zinc-200 dark:border-zinc-700"><div className="border-b border-zinc-200 p-4 dark:border-zinc-700"><h2 id="workforce-exception-report-types" className="font-semibold">{t("typesTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("typesHint")}</p></div><div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" role="region" tabIndex={0} aria-label={t("typesTitle")}><table className="min-w-[840px] text-left text-sm"><thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-muted-foreground dark:border-zinc-700"><tr><th className="px-4 py-3 font-medium">{tQueue("type")}</th><th className="px-4 py-3 text-right font-medium">{t("metrics.cases")}</th><th className="px-4 py-3 text-right font-medium">{tQueue("stages.OPEN")}</th><th className="px-4 py-3 text-right font-medium">{tQueue("stages.AWAITING_EMPLOYEE_RESPONSE")}</th><th className="px-4 py-3 text-right font-medium">{tQueue("stages.HR_REVIEW")}</th><th className="px-4 py-3 text-right font-medium">{tQueue("stages.RESOLVED")}</th><th className="px-4 py-3 text-right font-medium">{tQueue("stages.DATA_INTEGRITY_REVIEW")}</th></tr></thead><tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">{report.byType.map((item) => <tr key={item.type}><td className="px-4 py-3"><Badge variant={item.triageSeverity === "ATTENTION_REVIEW" ? "secondary" : "outline"}>{tQueue(`types.${item.type}`)}</Badge></td><td className="px-4 py-3 text-right tabular-nums">{number.format(item.cases)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(item.open)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(item.awaitingEmployeeResponse)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(item.hrReview)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(item.resolved)}</td><td className="px-4 py-3 text-right tabular-nums">{number.format(item.dataIntegrityReview)}</td></tr>)}{report.byType.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">{t("empty")}</td></tr> : null}</tbody></table></div></section>
    </> : null}
  </section>
}

function Metric({ label, value, number }: { label: string; value: number; number: Intl.NumberFormat }) {
  return <div className="rounded-md bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{number.format(value)}</dd></div>
}
