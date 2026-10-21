"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { formatDate, formatTime } from "@/lib/format-date"
import { CheckCircle2, ChevronDown, ClipboardCheck, MessageCircleQuestionMark, Users, Clock3, FileSpreadsheet, LogIn, LogOut, Paperclip, Plus, ShieldAlert, ShieldCheck, UserRoundX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Hint } from "@/components/hint"
import { HomeCard, HomeKpi, HomePill } from "@/components/mtm/home-parts"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"
import { formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { attendanceAskableExplanations, attendanceExplanationKey, attendanceNewlyAskable, attendanceNow, attendanceRowExplanation, attendanceTodayRange, summarizeAttendanceToday, type AttendanceNow, type AttendanceNowPerson, type AttendanceTodayAttention, type AttendanceTodaySummary } from "@/lib/mtm/attendance-today"
import { ATTENDANCE_RISK_MESSAGES, type AttendanceRiskItem } from "@/lib/mtm/attendance-risk-contract"
import type { AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"
import type { AttendanceExplanationDto } from "@/lib/mtm/attendance-explanation-contract"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { MtmAttendanceSetupChecklist } from "@/components/mtm/attendance-setup-checklist"

const ATTENTION_LIMIT = 6
const REQUESTS_LIMIT = 5
type Loaded = { today: string; summary: AttendanceTodaySummary; requests: AttendanceReviewItem[] | null; risks: AttendanceRiskItem[] | null
  now: AttendanceNow; timezone: string; loadedAt: string; canManage: boolean
  /** Null when this user may not ask for explanations: the controls are not drawn. */
  explanations: AttendanceExplanationDto[] | null }
const NOW_LIMIT = 3
const NOW_COLUMNS = [
  { key: "working", label: "nowWorking", time: "nowSince", tone: "text-emerald-700 dark:text-emerald-400" },
  { key: "paused", label: "nowPaused", time: "nowSince", tone: "text-amber-700 dark:text-amber-400" },
  { key: "left", label: "nowLeft", time: "nowAt", tone: "text-sky-700 dark:text-sky-400" },
  { key: "notYet", label: "nowNotYet", time: null, tone: "text-muted-foreground" },
] as const

/**
 * Personnel → Today → «Now» (owner, 2026-10-16, approved mockup): who is at
 * work, on a break, gone and not yet in. A name opens the employee's page for
 * an administrator, their day in the timesheet for anyone else.
 */
function MtmAttendanceNow({ data }: { data: Loaded }) {
  const t = useTranslations("personnel"), locale = useLocale()
  const [open, setOpen] = useState<string | null>(null)
  const time = (value: string | null) => value ? formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: data.timezone }) : ""
  const href = (person: AttendanceNowPerson) => data.canManage ? `/mtm/attendance/people/${encodeURIComponent(person.employeeId)}`
    : `/mtm/attendance/timesheet?${new URLSearchParams({ date: data.today, employeeId: person.employeeId })}`
  return <section className="rounded-2xl border bg-card p-4" aria-labelledby="attendance-today-now-title" data-testid="attendance-today-now">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 id="attendance-today-now-title" className="flex items-center gap-2 text-[15px] font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-700 dark:text-emerald-300" aria-hidden="true"><Users className="h-4 w-4" /></span>{t("nowTitle", { time: time(data.loadedAt) })}</h2>
      <Link href="/mtm/attendance/reports?report=day" prefetch={false} className="text-sm font-semibold text-primary hover:underline">{t("nowOpenDay")} →</Link>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{NOW_COLUMNS.map(column => {
      const people = data.now[column.key], expanded = open === column.key, shown = expanded ? people : people.slice(0, NOW_LIMIT)
      return <div key={column.key} className="rounded-xl border p-3" data-testid={`attendance-now-${column.key}`}>
        <p className={`mb-2 text-sm font-semibold ${column.tone}`}>{t(column.label)} · {people.length}</p>
        {people.length ? <ul className="space-y-1.5 text-sm">{shown.map(person => <li key={person.employeeId} className="flex min-w-0 items-baseline justify-between gap-2">
          <Link href={href(person)} prefetch={false} className="truncate font-medium hover:underline">{person.name}</Link>
          <span className="shrink-0 text-xs text-muted-foreground">{column.time ? t(column.time, { time: time(person.at) }) : person.dayKind ? attendanceDayKindLabel(person.dayKind, locale) : ""}</span></li>)}</ul>
          : <p className="text-sm text-muted-foreground">{t("nowNobody")}</p>}
        {people.length > NOW_LIMIT ? <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : column.key)}>
          {expanded ? t("nowLess") : t("nowMore", { count: people.length - NOW_LIMIT })}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></button> : null}
      </div>
    })}</div>
    <p className="mt-3 text-xs text-muted-foreground">{t("nowAutoHint")}</p>
    {/* What the «Kadr uçotu» clip says under «Now» (owner, 2026-10-20), each claim true of the product:
      no biometric step anywhere in a mark; a break shows its start time only and no input writes a
      place inside it (workday-pauses.ts); no cron and no manager finishes anyone's day. */}
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="attendance-now-privacy"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("nowPrivacy")}</p>
  </section>
}

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
  // Owner, 2026-10-16 (approved mockup): tick the late and absent, ask them to explain.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Rows this screen has already shown: each is ticked once, when it first appears (attendanceNewlyAskable).
  const seen = useRef<Set<string>>(new Set())
  const [reading, setReading] = useState<string | null>(null)
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
      const [report, requests, risks, explanations] = await Promise.all([
        fetch(`/api/v1/mtm/attendance/report?${new URLSearchParams({ from: range.from, to: range.to, form: "ALL" })}`, { cache: "no-store", signal: controller.signal }),
        fetch("/api/v1/mtm/attendance/requests?status=PENDING", { cache: "no-store", signal: controller.signal }),
        fetch(`/api/v1/mtm/attendance/review?${new URLSearchParams({ from: addDateKeyDays(today, -6), to: today, status: "OPEN" })}`, { cache: "no-store", signal: controller.signal }),
        fetch(`/api/v1/mtm/attendance/explanations?${new URLSearchParams({ from: today, to: today })}`, { cache: "no-store", signal: controller.signal }),
      ])
      const [reportBody, requestsBody, risksBody, explanationsBody] = await Promise.all([readJson(report), readJson(requests), readJson(risks), readJson(explanations)])
      if (controller.signal.aborted) return
      if (!report.ok || reportBody?.success !== true || !Array.isArray(reportBody.data?.rows)) {
        setError(a([401, 403, 404].includes(report.status) ? "reportAccessUnavailable" : "reportLoadError")); return
      }
      const rows = reportBody.data.rows as MtmAttendanceReportRow[]
      const explanationItems: AttendanceExplanationDto[] | null = explanations.ok && explanationsBody?.success === true && Array.isArray(explanationsBody.data?.items) ? explanationsBody.data.items : null
      // Today's explanations go into the summary: one whose row has left the list keeps a row of its own until decided.
      const summary = summarizeAttendanceToday(rows, today, explanationItems ?? [])
      if (explanationItems) {
        const fresh = attendanceNewlyAskable(attendanceAskableExplanations(summary.attention, explanationItems), seen.current)
        if (fresh.length) setSelected(current => new Set([...current, ...fresh]))
      }
      setData({
        today,
        summary,
        now: attendanceNow(rows, today), timezone: rows.find(row => row.date === today)?.timezone ?? "Asia/Baku",
        loadedAt: new Date().toISOString(), canManage: rulesBody.data?.canManageRules === true,
        // Viewing attendance and deciding requests are separate rights: a
        // refused queue hides the card instead of failing the screen.
        requests: requests.ok && requestsBody?.success === true && Array.isArray(requestsBody.data?.items) ? requestsBody.data.items : null,
        risks: risks.ok && Array.isArray(risksBody?.data?.items) ? risksBody.data.items : null,
        explanations: explanationItems,
      })
    } catch {
      if (!controller.signal.aborted) setError(a("reportLoadError"))
    }
  }, [a])

  useEffect(() => { void load(); return () => active.current?.abort() }, [load])
  // «Now» keeps itself current: once a minute while the tab is in view.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load() }, 60_000)
    return () => clearInterval(timer)
  }, [load])

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

  async function askExplanations(keys: string[]) {
    if (busyId || !keys.length) return
    setBusyId("explanations"); setMessage(null)
    try {
      const items = keys.map(value => { const [agentId, date, kind] = value.split("|"); return { agentId, date, kind } })
      const response = await fetch("/api/v1/mtm/attendance/explanations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      const body = await readJson(response)
      if (response.ok && body?.success === true) { setSelected(new Set()); setMessage(t("explainSent", body.data)); void load() }
      else setMessage(t("explainFailed"))
    } catch { setMessage(t("explainFailed")) }
    finally { setBusyId(null) }
  }
  async function decideExplanation(item: AttendanceExplanationDto, decision: "ACCEPTED" | "REJECTED") {
    if (busyId) return
    setBusyId(item.id); setMessage(null)
    try {
      const response = await fetch(`/api/v1/mtm/attendance/explanations/${encodeURIComponent(item.id)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) })
      const body = await readJson(response)
      if (response.ok && body?.success === true) { setReading(null); setMessage(t("decisionSaved")); void load() }
      else setMessage(t(response.status === 409 ? "decisionChanged" : "explainFailed"))
    } catch { setMessage(t("explainFailed")) }
    finally { setBusyId(null) }
  }

  // Through the shared helper, not Intl directly: ICU without Azerbaijani data
  // prints "M10 14, Wed" (seen on prod 2026-10-14); format-date assembles az itself.
  const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => formatDate(`${date}T12:00:00.000Z`, locale, { ...options, timeZone: "UTC" })
  const recordHref = (employeeId: string, date: string) => `/mtm/attendance/recordings?${new URLSearchParams({ employeeId, date })}`
  const dayHref = (employeeId: string, date: string) => `/mtm/attendance/timesheet?${new URLSearchParams({ date, employeeId })}`

  if (error) return <div className="space-y-3"><h1 className="text-2xl font-bold tracking-tight">{t("todayTitle")}</h1><p role="alert" className="text-sm text-destructive">{error}</p>
    <Button variant="outline" className="min-h-11" onClick={() => void load()}>{a("reportReload")}</Button></div>

  const summary = data?.summary
  const month = data ? dateLabel(data.today, { month: "long" }) : ""
  const attention = [
    ...(summary?.attention ?? []).map(item => ({ key: `${item.type}:${item.employeeId}:${item.date}${item.type === "explanation" ? `:${item.kind}` : ""}`, item })),
  ]
  const risks = data?.risks ?? []
  const attentionCount = attention.length + risks.length
  // The row's own explanation, or on a late or absent row the one the person already has that day (attendanceRowExplanation).
  const explanationOf = (item: AttendanceTodayAttention) => data?.explanations ? attendanceRowExplanation(item, data.explanations) : undefined
  const explainKey = (item: AttendanceTodayAttention) => item.type === "missing-finish" ? null
    : attendanceExplanationKey(item.employeeId, item.date, item.type === "explanation" ? item.kind : item.type === "late" ? "LATE" : "ABSENT")
  // Those still to be asked: late or absent today, nothing asked or written for that person and day yet.
  const askable = data?.explanations ? attendanceAskableExplanations(summary?.attention ?? [], data.explanations) : []
  const clock = (value: string) => formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: data?.timezone ?? "Asia/Baku" })
  const picked = askable.filter(key => selected.has(key))
  // The card keeps to ATTENTION_LIMIT rows but never hides a late or absent row that is asked or
  // will be: one still to ask comes ticked, so everyone «İzahat istə» sends to is on screen with a
  // tick HR can take off; one already asked keeps its row, because this card is the only place in
  // the CRM where its answer is read and decided. So does an explanation on a row of its own.
  const askableKeys = new Set(askable)
  const shown = attention.filter(({ item }, index) => { const key = explainKey(item); return index < ATTENTION_LIMIT || (key !== null && (askableKeys.has(key) || explanationOf(item) !== undefined)) })
  const shownRisks = risks.slice(0, Math.max(0, ATTENTION_LIMIT - shown.length))
  const notShown = attentionCount - shown.length - shownRisks.length

  return <div className="space-y-4" data-testid="attendance-today">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">{t("todayTitle")}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{data ? dateLabel(data.today, { weekday: "long", day: "numeric", month: "long" }) : " "}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11 rounded-full"><Link href="/mtm/attendance/recordings" prefetch={false}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t("recordDay")}</Link></Button>
        <Button asChild className="min-h-11 rounded-full"><Link href="/mtm/attendance/timesheet" prefetch={false}><FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />{month ? t("openTimesheet", { month }) : t("timesheetTitle")}</Link></Button>
      </div>
    </header>

    {data ? <MtmAttendanceSetupChecklist year={data.today.slice(0, 4)} /> : null}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {([
        { id: "arrived", label: t("kpiArrived"), icon: <LogIn className="h-4 w-4" />, tone: "green", value: summary?.arrived, unit: summary ? t("kpiOf", { total: summary.expected }) : null,
          progress: summary?.expected ? summary.arrived / summary.expected * 100 : 0, href: "/mtm/attendance/reports?report=day", link: t("kpiArrivedLink") },
        { id: "late", label: t("kpiLate"), icon: <Clock3 className="h-4 w-4" />, tone: "amber", value: summary?.late, unit: null,
          progress: summary?.expected ? summary.late / summary.expected * 100 : 0, href: `/mtm/attendance/reports?report=late${data ? `&date=${data.today}` : ""}`, link: t("kpiLateLink") },
        { id: "absent", label: t("kpiAbsent"), icon: <UserRoundX className="h-4 w-4" />, tone: "red", value: summary?.absent, unit: summary ? t("kpiAbsentUnit", { away: summary.away }) : null,
          progress: summary?.expected ? summary.absent / summary.expected * 100 : 0, href: "/mtm/attendance/reports?report=absent", link: t("kpiAbsentLink") },
        { id: "missing-finish", label: t("kpiMissing"), icon: <LogOut className="h-4 w-4" />, tone: "blue", value: summary?.missingFinish, unit: null,
          progress: summary?.people ? summary.missingFinish / summary.people * 100 : 0, href: "/mtm/attendance/timesheet?filter=missing-finish", link: t("kpiMissingLink") },
      ] as const).map(card => <div key={card.id} className="relative">
        <HomeKpi testId={`attendance-today-${card.id}`} label={card.label} icon={card.icon} tone={card.tone} value={card.value === undefined ? null : format.number(card.value)} unit={card.unit} progress={card.progress} sub={null} />
        <Link href={card.href} prefetch={false} className="absolute bottom-3 left-4 text-xs font-semibold text-primary hover:underline">{card.link} →</Link>
      </div>)}
    </div>

    {data ? <MtmAttendanceNow data={data} /> : null}

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
                  <Button size="sm" variant="outline" className="min-h-9 border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300" disabled={busyId !== null} onClick={() => void decide(item, "APPROVED")}>{t("approve")}</Button>
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
        title={t("attentionTitle")} badge={attentionCount ? String(attentionCount) : null} action={risks.length ? { href: "/mtm/attendance/review", label: t("allRisks", { count: risks.length }) } : undefined}>
        {!data ? <p role="status" className="py-6 text-sm text-muted-foreground">{a("reportLoading")}</p>
          : attentionCount === 0 ? <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />{t("attentionEmpty")}</p>
          : <>{askable.length ? <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5" data-testid="attendance-explain-bar">
              <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={picked.length === askable.length}
                onChange={event => setSelected(event.target.checked ? new Set(askable) : new Set())} />{t("explainSelectAll", { count: askable.length })}</label>
              <Hint text={t("explainAskHint")} wrap={!picked.length || busyId !== null}><Button size="sm" variant="outline" className="min-h-9" disabled={!picked.length || busyId !== null} onClick={() => void askExplanations(picked)} data-testid="attendance-explain-ask">
                <MessageCircleQuestionMark className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("explainAsk", { count: picked.length })}</Button></Hint>
              <p className="w-full text-xs text-muted-foreground">{t("explainHint")}</p>
            </div> : null}
          <ul className="divide-y divide-border">
            {shown.map(({ key, item }) => {
              const explainId = explainKey(item), explanation = explanationOf(item)
              // What the explanation is about, said when the row does not say it: its own row, or a row of the other kind.
              const about = explanation && (item.type === "explanation" || explanation.kind !== (item.type === "late" ? "LATE" : "ABSENT"))
                ? t(explanation.kind === "LATE" ? "explainForLate" : "explainForAbsent") : null
              return <li key={key} className="py-2.5" data-testid="attendance-today-attention-item" data-type={item.type}><div className="flex flex-wrap items-center gap-3">
              {explainId && data?.explanations ? <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={t("explainSelect", { name: item.employeeName })} disabled={!!explanation}
                checked={!explanation && selected.has(explainId)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(explainId); else next.delete(explainId); return next })} /> : null}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.employeeName}</p>
                {item.type === "explanation" ? null : <p className="text-sm text-muted-foreground">{item.type === "absent" ? t("absentNoReason")
                  : item.type === "late" ? t("lateBy", { duration: item.lateSeconds < 3600 ? t("minutes", { count: Math.round(item.lateSeconds / 60) }) : formatAttendanceDuration(item.lateSeconds), time: formatTime(item.startedAt, locale, { hour: "2-digit", minute: "2-digit", timeZone: item.timezone }) })
                  : t("missingFinishOn", { date: dateLabel(item.date) })}</p>}
                {about ? <p className="text-sm text-muted-foreground" data-testid="attendance-explain-about">{about}</p> : null}</div>
              {explainId && data?.explanations ? <span className="shrink-0 text-xs" data-testid="attendance-explain-status">{!explanation ? <span className="text-muted-foreground">{t("explainNotAsked")}</span>
                : explanation.status === "REQUESTED" ? <span className="text-amber-700 dark:text-amber-400">{t("explainWaiting", { time: explanation.requestedAt ? clock(explanation.requestedAt) : "" })}</span>
                : explanation.status === "ANSWERED" ? <button type="button" className="font-semibold text-primary hover:underline" aria-expanded={reading === explanation.id} onClick={() => setReading(reading === explanation.id ? null : explanation.id)}>{t("explainAnswered")}</button>
                : <span className={explanation.status === "ACCEPTED" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-300"}>{t(explanation.status === "ACCEPTED" ? "explainAccepted" : "explainRejected")}</span>}</span> : null}
              <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0"><Link prefetch={false} href={item.type === "absent" ? recordHref(item.employeeId, item.date) : dayHref(item.employeeId, item.date)}>{item.type === "absent" ? t("addReason") : t("openDay")}</Link></Button>
              </div>
              {explanation && reading === explanation.id ? <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-testid="attendance-explain-answer">
                <span className="text-muted-foreground">{t("explainAnswerOf", { name: item.employeeName })}</span> «{explanation.answer}»
                {explanation.answeredAt ? <span className="mt-1 block text-xs text-muted-foreground" data-testid="attendance-explain-answered-at">{t("explainAnsweredAt", { time: clock(explanation.answeredAt) })}</span> : null}
                <span className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" className="min-h-9 border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300" disabled={busyId !== null} onClick={() => void decideExplanation(explanation, "ACCEPTED")}>{t("explainAccept")}</Button>
                  <Button size="sm" variant="outline" className="min-h-9 text-rose-700 dark:text-rose-300" disabled={busyId !== null} onClick={() => void decideExplanation(explanation, "REJECTED")}>{t("explainReject")}</Button></span>
              </div> : null}
            </li> })}
            {shownRisks.map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="attendance-today-attention-item" data-type="risk">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.employeeName}</p>
                <p className="text-sm text-muted-foreground">{a(ATTENDANCE_RISK_MESSAGES[item.kind])}{item.relatedNames.length ? ` · ${item.relatedNames.join(", ")}` : ""}</p></div>
              <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0"><Link prefetch={false} href="/mtm/attendance/review">{t("check")}</Link></Button>
            </li>)}
          </ul></>}
        {data && notShown > 0 ? <p className="mb-3 text-xs text-muted-foreground">{t("moreAttention", { count: notShown })}</p> : null}
        {data && summary && summary.people ? <p className="mb-3 text-xs text-muted-foreground">{t("quiet", { count: summary.quiet })}</p> : null}
      </HomeCard>
    </div>

    {summary ? <section className="rounded-2xl border bg-card px-4 py-3" aria-labelledby="attendance-today-week" data-testid="attendance-today-week">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 id="attendance-today-week" className="text-[15px] font-semibold">{t("weekTitle")}</h2><span className="text-xs text-muted-foreground">{t("weekHint")}</span></div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${summary.week.length}, minmax(0, 1fr))` }}>
        {summary.week.map(day => {
          const isToday = day.date === data?.today
          return <Link key={day.date} prefetch={false} href={`/mtm/attendance/timesheet?date=${day.date}`} data-testid="attendance-today-day"
            className={`rounded-xl p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${isToday ? "border border-primary" : day.future ? "border border-dashed" : "border hover:bg-muted/50"}`}>
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
