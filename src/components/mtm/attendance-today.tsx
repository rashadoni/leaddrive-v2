"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { CheckCircle2, ClipboardCheck, Clock3, FileSpreadsheet, LogIn, LogOut, Paperclip, Plus, ShieldAlert, UserRoundX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomeKpi, HomePill } from "@/components/mtm/home-parts"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"
import { formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { attendanceTodayRange, summarizeAttendanceToday, type AttendanceTodaySummary } from "@/lib/mtm/attendance-today"
import { ATTENDANCE_RISK_MESSAGES, type AttendanceRiskItem } from "@/lib/mtm/attendance-risk-contract"
import type { AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"

const ATTENTION_LIMIT = 6
const REQUESTS_LIMIT = 5
type Loaded = { today: string; summary: AttendanceTodaySummary; requests: AttendanceReviewItem[] | null; risks: AttendanceRiskItem[] | null }

async function readJson(response: Response) { return response.json().catch(() => null) }

/** Personnel → Today: what HR needs now, with the action next to each fact. */
export function MtmAttendanceToday() {
  const t = useTranslations("personnel")
  const a = useTranslations("mtmAttendance")
  const format = useFormatter()
  const locale = useLocale()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const active = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setError(null)
    try {
      const rules = await fetch("/api/v1/mtm/attendance/rules", { cache: "no-store", signal: controller.signal })
      const rulesBody = await readJson(rules)
      if (controller.signal.aborted) return
      if (!rules.ok || rulesBody?.success !== true || !isDateKey(rulesBody.data?.today)) {
        setError(a([401, 403, 404].includes(rules.status) ? "reportAccessUnavailable" : "reportLoadError")); return
      }
      const today: string = rulesBody.data.today
      const range = attendanceTodayRange(today)
      const [report, requests, risks] = await Promise.all([
        fetch(`/api/v1/mtm/attendance/report?${new URLSearchParams({ from: range.from, to: range.to, form: "ALL" })}`, { cache: "no-store", signal: controller.signal }),
        fetch("/api/v1/mtm/attendance/requests?status=PENDING", { cache: "no-store", signal: controller.signal }),
        fetch(`/api/v1/mtm/attendance/review?${new URLSearchParams({ from: addDateKeyDays(today, -6), to: today, status: "OPEN" })}`, { cache: "no-store", signal: controller.signal }),
      ])
      const [reportBody, requestsBody, risksBody] = await Promise.all([readJson(report), readJson(requests), readJson(risks)])
      if (controller.signal.aborted) return
      if (!report.ok || reportBody?.success !== true || !Array.isArray(reportBody.data?.rows)) {
        setError(a([401, 403, 404].includes(report.status) ? "reportAccessUnavailable" : "reportLoadError")); return
      }
      setData({
        today,
        summary: summarizeAttendanceToday(reportBody.data.rows as MtmAttendanceReportRow[], today),
        // Viewing attendance and deciding requests are separate rights: a
        // refused queue hides the card instead of failing the screen.
        requests: requests.ok && requestsBody?.success === true && Array.isArray(requestsBody.data?.items) ? requestsBody.data.items : null,
        risks: risks.ok && Array.isArray(risksBody?.data?.items) ? risksBody.data.items : null,
      })
    } catch {
      if (!controller.signal.aborted) setError(a("reportLoadError"))
    }
  }, [a])

  useEffect(() => { void load(); return () => active.current?.abort() }, [load])

  async function decide(item: AttendanceReviewItem, decision: "APPROVED" | "REJECTED") {
    if (busyId) return
    if (decision === "REJECTED" && reason.trim().length < 3) return
    setBusyId(item.id); setMessage(null)
    try {
      const response = await fetch(`/api/v1/mtm/attendance/requests/${encodeURIComponent(item.id)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, version: item.version, note: decision === "REJECTED" ? reason.trim() : null }),
      })
      const body = await readJson(response)
      if (response.ok && body?.success === true) {
        setData(current => current && current.requests ? { ...current, requests: current.requests.filter(row => row.id !== item.id) } : current)
        setRejecting(null); setReason(""); setMessage(t("decisionSaved"))
      } else {
        // Someone else decided or the request changed: show the current queue.
        setMessage(t(response.status === 409 ? "decisionChanged" : "decisionFailed"))
        if (response.status === 409) void load()
      }
    } catch { setMessage(t("decisionFailed")) }
    finally { setBusyId(null) }
  }

  const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => format.dateTime(new Date(`${date}T12:00:00.000Z`), { ...options, timeZone: "UTC" })
  const recordHref = (employeeId: string, date: string) => `/mtm/attendance/recordings?${new URLSearchParams({ employeeId, date })}`
  const dayHref = (employeeId: string, date: string) => `/mtm/attendance/timesheet?${new URLSearchParams({ tab: "journal", date, employeeId })}`

  if (error) return <div className="space-y-3"><h1 className="text-2xl font-bold tracking-tight">{t("todayTitle")}</h1><p role="alert" className="text-sm text-destructive">{error}</p>
    <Button variant="outline" className="min-h-11" onClick={() => void load()}>{a("reportReload")}</Button></div>

  const summary = data?.summary
  const month = data ? dateLabel(data.today, { month: "long" }) : ""
  const attention = [
    ...(summary?.attention ?? []).map(item => ({ key: `${item.type}:${item.employeeId}:${item.date}`, item })),
  ]
  const risks = data?.risks ?? []
  const attentionCount = attention.length + risks.length

  return <div className="space-y-4" data-testid="attendance-today">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">{t("todayTitle")}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{data ? dateLabel(data.today, { weekday: "long", day: "numeric", month: "long" }) : " "}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11 rounded-full"><Link href="/mtm/attendance/recordings" prefetch={false}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t("recordDay")}</Link></Button>
        <Button asChild className="min-h-11 rounded-full"><Link href="/mtm/attendance/timesheet?tab=month" prefetch={false}><FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />{month ? t("openTimesheet", { month }) : t("timesheetTitle")}</Link></Button>
      </div>
    </header>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {([
        { id: "arrived", label: t("kpiArrived"), icon: <LogIn className="h-4 w-4" />, tone: "green", value: summary?.arrived, unit: summary ? t("kpiOf", { total: summary.expected }) : null,
          progress: summary?.expected ? summary.arrived / summary.expected * 100 : 0, href: "/mtm/attendance/timesheet?tab=days", link: t("kpiArrivedLink") },
        { id: "late", label: t("kpiLate"), icon: <Clock3 className="h-4 w-4" />, tone: "amber", value: summary?.late, unit: null,
          progress: summary?.expected ? summary.late / summary.expected * 100 : 0, href: "/mtm/attendance/timesheet?tab=late", link: t("kpiLateLink") },
        { id: "absent", label: t("kpiAbsent"), icon: <UserRoundX className="h-4 w-4" />, tone: "red", value: summary?.absent, unit: summary ? t("kpiAbsentUnit", { away: summary.away }) : null,
          progress: summary?.expected ? summary.absent / summary.expected * 100 : 0, href: "/mtm/attendance/timesheet?tab=absence", link: t("kpiAbsentLink") },
        { id: "missing-finish", label: t("kpiMissing"), icon: <LogOut className="h-4 w-4" />, tone: "blue", value: summary?.missingFinish, unit: null,
          progress: summary?.people ? summary.missingFinish / summary.people * 100 : 0, href: "/mtm/attendance/timesheet?tab=journal", link: t("kpiMissingLink") },
      ] as const).map(card => <div key={card.id} className="relative">
        <HomeKpi testId={`attendance-today-${card.id}`} label={card.label} icon={card.icon} tone={card.tone} value={card.value === undefined ? null : format.number(card.value)} unit={card.unit} progress={card.progress} sub={null} />
        <Link href={card.href} prefetch={false} className="absolute bottom-3 left-4 text-xs font-semibold text-primary hover:underline">{card.link} →</Link>
      </div>)}
    </div>

    {message ? <p role="status" className="rounded-xl bg-muted/60 px-4 py-2 text-sm">{message}</p> : null}

    <div className={`grid gap-4 ${data?.requests ? "xl:grid-cols-2" : ""}`}>
      {data?.requests ? <HomeCard testId="attendance-today-requests" titleId="attendance-today-requests-title" icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />} tone="orange"
        title={t("pendingTitle")} badge={data.requests.length ? String(data.requests.length) : null} action={{ href: "/mtm/attendance/requests", label: t("allRequests") }}>
        {data.requests.length === 0 ? <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />{t("pendingEmpty")}</p>
          : <ul className="divide-y divide-border">{data.requests.slice(0, REQUESTS_LIMIT).map(item => {
            const kind = item.details.kind === "TIME_CORRECTION" ? a("requestsTimeCorrection") : attendanceDayKindLabel(item.details.dayKind, locale)
            const period = `${dateLabel(item.startDate)}${item.endDate !== item.startDate ? ` – ${dateLabel(item.endDate)}` : ""}${item.details.unit === "HOURS" ? ` · ${item.details.startTime}–${item.details.endTime}` : ""}`
            return <li key={item.id} className="py-2.5" data-testid={`attendance-today-request-${item.id}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.employeeName}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><HomePill tone="blue">{kind}</HomePill>{period}
                    {item.details.attachmentIds.length ? <a href={`/api/v1/mtm/attendance/attachments/${encodeURIComponent(item.details.attachmentIds[0])}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{t("document")}</a> : null}</p>
                  {item.reason ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.reason}</p> : null}</div>
                {rejecting !== item.id ? <div className="flex shrink-0 gap-2">
                  <Button size="sm" className="min-h-9 bg-emerald-600 text-white hover:bg-emerald-700" disabled={busyId !== null} onClick={() => void decide(item, "APPROVED")}>{t("approve")}</Button>
                  <Button size="sm" variant="outline" className="min-h-9 text-rose-700 dark:text-rose-300" disabled={busyId !== null} onClick={() => { setRejecting(item.id); setReason("") }}>{t("reject")}</Button>
                </div> : null}
              </div>
              {rejecting === item.id ? <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void decide(item, "REJECTED") }}>
                <Input autoFocus aria-label={t("rejectReason")} placeholder={t("rejectReason")} value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} className="min-h-9 min-w-56 flex-1" />
                <Button type="submit" size="sm" variant="destructive" className="min-h-9" disabled={busyId !== null || reason.trim().length < 3}>{t("rejectConfirm")}</Button>
                <Button type="button" size="sm" variant="ghost" className="min-h-9" onClick={() => { setRejecting(null); setReason("") }}>{t("cancel")}</Button>
              </form> : null}
            </li>
          })}</ul>}
        {data.requests.length > REQUESTS_LIMIT ? <Link href="/mtm/attendance/requests" prefetch={false} className="mb-3 text-sm font-semibold text-primary hover:underline">{t("moreRequests", { count: data.requests.length - REQUESTS_LIMIT })}</Link> : null}
      </HomeCard> : null}

      <HomeCard testId="attendance-today-attention" titleId="attendance-today-attention-title" icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />} tone="amber"
        title={t("attentionTitle")} badge={attentionCount ? String(attentionCount) : null}>
        {!data ? <p role="status" className="py-6 text-sm text-muted-foreground">{a("reportLoading")}</p>
          : attentionCount === 0 ? <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />{t("attentionEmpty")}</p>
          : <ul className="divide-y divide-border">
            {attention.slice(0, ATTENTION_LIMIT).map(({ key, item }) => <li key={key} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="attendance-today-attention-item" data-type={item.type}>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.employeeName}</p>
                <p className="text-sm text-muted-foreground">{item.type === "absent" ? t("absentNoReason")
                  : item.type === "late" ? t("lateBy", { duration: item.lateSeconds < 3600 ? t("minutes", { count: Math.round(item.lateSeconds / 60) }) : formatAttendanceDuration(item.lateSeconds), time: format.dateTime(new Date(item.startedAt), { hour: "2-digit", minute: "2-digit", timeZone: item.timezone }) })
                  : t("missingFinishOn", { date: dateLabel(item.date) })}</p></div>
              <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0"><Link prefetch={false} href={item.type === "absent" ? recordHref(item.employeeId, item.date) : dayHref(item.employeeId, item.date)}>{item.type === "absent" ? t("addReason") : t("openDay")}</Link></Button>
            </li>)}
            {risks.slice(0, Math.max(0, ATTENTION_LIMIT - attention.length)).map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="attendance-today-attention-item" data-type="risk">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.employeeName}</p>
                <p className="text-sm text-muted-foreground">{a(ATTENDANCE_RISK_MESSAGES[item.kind])}{item.relatedNames.length ? ` · ${item.relatedNames.join(", ")}` : ""}</p></div>
              <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0"><Link prefetch={false} href="/mtm/attendance/settings?tab=review">{t("check")}</Link></Button>
            </li>)}
          </ul>}
        {data && attentionCount > ATTENTION_LIMIT ? <p className="mb-3 text-xs text-muted-foreground">{t("moreAttention", { count: attentionCount - ATTENTION_LIMIT })}</p> : null}
        {data && summary && summary.people ? <p className="mb-3 text-xs text-muted-foreground">{t("quiet", { count: summary.quiet })}</p> : null}
      </HomeCard>
    </div>

    {summary ? <section className="rounded-2xl border bg-card px-4 py-3" aria-labelledby="attendance-today-week" data-testid="attendance-today-week">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 id="attendance-today-week" className="text-[15px] font-semibold">{t("weekTitle")}</h2><span className="text-xs text-muted-foreground">{t("weekHint")}</span></div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${summary.week.length}, minmax(0, 1fr))` }}>
        {summary.week.map(day => {
          const isToday = day.date === data?.today
          return <Link key={day.date} prefetch={false} href={`/mtm/attendance/timesheet?tab=days&date=${day.date}`} data-testid="attendance-today-day"
            className={`rounded-xl p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${isToday ? "bg-primary/10 ring-1 ring-primary/40" : day.future ? "border border-dashed" : "bg-muted/50 hover:bg-muted"}`}>
            <p className={`text-xs font-semibold first-letter:uppercase ${isToday ? "text-primary" : "text-muted-foreground"}`}>{dateLabel(day.date, { weekday: "short", day: "numeric" })}{isToday ? ` · ${t("weekToday")}` : ""}</p>
            <p className="mt-1 text-sm"><span className="text-base font-bold tabular-nums">{day.future ? "—" : day.present}</span> <span className="text-xs text-muted-foreground">{day.future ? t("weekPlan", { total: day.expected }) : t("kpiOf", { total: day.expected })}</span></p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {day.late ? <HomePill tone="amber">{t("chipLate", { count: day.late })}</HomePill> : null}
              {day.away ? <HomePill tone="blue">{t("chipAway", { count: day.away })}</HomePill> : null}
              {!day.future && day.absent ? <HomePill tone="red">{t("chipAbsent", { count: day.absent })}</HomePill> : null}
            </div>
          </Link>
        })}
      </div>
    </section> : null}
  </div>
}
