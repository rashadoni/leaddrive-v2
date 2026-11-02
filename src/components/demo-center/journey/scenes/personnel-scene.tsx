"use client"

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import Link from "next/link"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Clock3, Download, FileSpreadsheet, Lock, LogIn, LogOut, MessageCircleQuestionMark, Plus, Search, ShieldAlert, ShieldCheck, UserRoundX, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { HintValue } from "@/components/hint"
import { HomeCard, HomeKpi, HomePill } from "@/components/mtm/home-parts"
import { MTM_TAB_ROW, mtmTabClass } from "@/components/mtm/calm-classes"
import { createDateFormatter, formatDate, formatTime } from "@/lib/format-date"
import { attendanceDayKindLabel, defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { attendanceApprovedLines, attendanceLunchLines, attendanceCorrectionLines, attendanceJournalEntries, attendanceMonthCell, attendanceStatusText, formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { attendanceCountedOvertimeSeconds, attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"
import { filterMtmAttendanceRows, summarizeMtmAttendanceRows, type MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { ATTENDANCE_RISK_KINDS, ATTENDANCE_RISK_MESSAGES } from "@/lib/mtm/attendance-risk-contract"
import { buildAttendanceRiskTable } from "@/lib/mtm/attendance-risk-table"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { TIMESHEET_ISSUES, type TimesheetIssue } from "@/lib/mtm/attendance-timesheet-filters"
import { attendanceNow, attendanceTodayRange, summarizeAttendanceToday } from "@/lib/mtm/attendance-today"
import { ATTENDANCE_N1T_COLUMNS } from "@/lib/mtm/attendance-view-contract"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import { mtmDemoAt, mtmDemoToday } from "./mtm-demo-data"
import {
  PERSONNEL_DEMO_CLOCK,
  PERSONNEL_DEMO_EMPLOYEES,
  PERSONNEL_DEMO_EXPLANATION,
  PERSONNEL_DEMO_REVIEWER,
  PERSONNEL_DEMO_RISK_REASON,
  personnelDemoPlan,
  personnelDemoReport,
  personnelDemoRequests,
  personnelDemoRiskReport,
  personnelDemoRisks,
} from "./personnel-demo-data"

/**
 * The N-1t on screen: the form's own columns but the day-by-day one, which
 * the timesheet screen shows and the Excel/PDF export carries — thirty day
 * columns on a 1470 px screen are a sideways scroll inside a card.
 */
const N1T_ON_SCREEN = ATTENDANCE_N1T_COLUMNS.filter((column) => column !== "days")

/**
 * Personnel («Kadr uçotu»): the workday module, a module of its own beside the
 * lead story (owner, 2026-10-17: the new employee-attendance module needs its
 * demo).
 *
 * The days are phone facts of an invented company run through the product's
 * own timesheet builder (`personnel-demo-data.ts`); «Bu gün» is summarised
 * by the product's own `summarizeAttendanceToday` and `attendanceNow`, the
 * timesheet cells and the day card by the product's presentation helpers, the
 * N-1t by `buildAttendanceTable` — the same functions the live screens call.
 * The live screens fetch their data, so their frames are redrawn here with
 * the product's parts, words and classes (`attendance-today.tsx`,
 * `attendance-report-workspace.tsx`, `attendance-risk-review.tsx`,
 * `attendance-months.tsx`), in the calm MTM colours of 2026-10-18 — the intro
 * clip is filmed on these screens (owner, 2026-10-20: the clip must be the CRM).
 *
 * Owner's rules kept on screen: no biometrics, a break shows its time and
 * never a place, the employee closes his own day, nothing changes a day
 * without a request and a decision, and a suspicious record is a reason to
 * look, not an accusation.
 */

type PersonnelScreen = "today" | "timesheet" | "risk" | "month"

const SCREEN_OF: Record<string, PersonnelScreen> = {
  "prs-today": "today",
  "prs-explain": "today",
  "prs-timesheet": "timesheet",
  "prs-risk": "risk",
  "prs-month": "month",
}

/** The section's own menu (nav-items «Personnel»), and the screen each lights up. */
const NAV: ReadonlyArray<{ key: "personnelToday" | "personnelTimesheet" | "personnelPeople" | "personnelReports" | "personnelSettings"; screens: readonly PersonnelScreen[] }> = [
  { key: "personnelToday", screens: ["today", "risk"] },
  { key: "personnelTimesheet", screens: ["timesheet"] },
  { key: "personnelPeople", screens: [] },
  { key: "personnelReports", screens: ["month"] },
  { key: "personnelSettings", screens: [] },
]

function useDayKinds() {
  const tA = useTranslations("mtmAttendance")
  return useMemo(() => defaultAttendanceDayKinds((key) => {
    const name = tA(`dayKindName${key}`)
    return { az: name, ru: name, en: name }
  }), [tA])
}

export function PersonnelScene(props: DemoSceneProps) {
  const { section, hint } = props
  const tNav = useTranslations("nav")
  const screen = SCREEN_OF[section.id] ?? "today"

  const keepInDemo = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element | null)?.closest?.("a[href]")
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }

  return (
    <div data-testid="demo-scene-personnel" className="space-y-4" onClickCapture={keepInDemo}>
      {/* The section's tabs inside the page, as MTM draws tabs: dark text over an orange line on one grey rule. */}
      <nav aria-label={tNav("groups.Personnel")} className={MTM_TAB_ROW}>
        {NAV.map((item) => {
          const active = item.screens.includes(screen)
          return (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              size="sm"
              aria-current={active ? "page" : undefined}
              onClick={() => (active ? undefined : hint(S.personnelTabHint))}
              className={mtmTabClass(active)}
            >
              {tNav(item.key)}
            </Button>
          )
        })}
      </nav>
      {screen === "today" && <TodayScreen {...props} />}
      {screen === "timesheet" && <TimesheetScreen {...props} />}
      {screen === "risk" && <RiskScreen {...props} />}
      {screen === "month" && <MonthScreen {...props} />}
    </div>
  )
}

function useFormat() {
  const locale = useLocale()
  return useMemo(() => {
    const time = createDateFormatter(locale, { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    const day = createDateFormatter(locale, { timeZone: "UTC", day: "numeric", month: "short" })
    const long = createDateFormatter(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    const weekday = createDateFormatter(locale, { timeZone: "UTC", weekday: "short", day: "numeric" })
    const month = createDateFormatter(locale, { timeZone: "UTC", month: "long", year: "numeric" })
    const noon = (date: string) => new Date(`${date}T12:00:00.000Z`)
    return {
      time: (iso: string | null) => (iso ? time.format(new Date(iso)) : ""),
      day: (date: string) => day.format(noon(date)),
      long: (date: string) => long.format(noon(date)),
      weekday: (date: string) => weekday.format(noon(date)),
      month: (date: string) => month.format(noon(date)),
    }
  }, [locale])
}

/* ── Bu gün ───────────────────────────────────────────────────────────── */

/** As `attendance-today.tsx` caps its lists. */
const ATTENTION_LIMIT = 6
const REQUESTS_LIMIT = 5
const NOW_LIMIT = 3
const NOW_COLUMNS = [
  { key: "working", label: "nowWorking", time: "nowSince", tone: "text-emerald-700 dark:text-emerald-400" },
  { key: "paused", label: "nowPaused", time: "nowSince", tone: "text-amber-700 dark:text-amber-400" },
  { key: "left", label: "nowLeft", time: "nowAt", tone: "text-sky-700 dark:text-sky-400" },
  { key: "notYet", label: "nowNotYet", time: null, tone: "text-muted-foreground" },
] as const

function TodayScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("personnel")
  const tA = useTranslations("mtmAttendance")
  const locale = useLocale()
  const formatter = useFormatter()
  const format = useFormat()
  const dayKinds = useDayKinds()
  const today = mtmDemoToday(snapshot.startedAt)
  const range = attendanceTodayRange(today)
  const report = useMemo(() => personnelDemoReport(today, range.from, range.to, dayKinds), [today, range.from, range.to, dayKinds])
  const summary = useMemo(() => summarizeAttendanceToday(report.rows, today), [report, today])
  const now = useMemo(() => attendanceNow(report.rows, today), [report, today])
  const approved = snapshot.ui["prs.approved"] === true
  const explained = snapshot.ui["prs.explained"] === true
  const answerRead = snapshot.ui["prs.answerRead"] === true
  const accepted = snapshot.ui["prs.explanationAccepted"] === true
  const riskClosed = snapshot.ui["prs.riskClosed"] === true
  // The queue as the product keeps it: a decided request leaves it.
  const requests = useMemo(() => personnelDemoRequests(today).filter((request) => !(approved && request.id === "req-wait-1")), [today, approved])
  // The week's open suspicious records are part of «Diqqət tələb edir», as the product lists them under the day's own rows.
  const risks = useMemo(() => personnelDemoRisks(today).filter((item) => !(riskClosed && item.id === "risk-1")), [today, riskClosed])
  // The product asks the late and the absent to explain (attendance-today.tsx): a tick per row. Here all of
  // them are ticked to begin with — the guide's «bir düymə ilə»; the product starts with none ticked.
  const keyOf = (item: (typeof summary.attention)[number]) => `${item.employeeId}|${item.date}|${item.type}`
  const askable = summary.attention.filter((item) => item.type === "late" || item.type === "absent")
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(askable.map(keyOf)))
  const [reading, setReading] = useState(answerRead && !accepted)
  const [openNow, setOpenNow] = useState<string | null>(null)
  const answered = (item: (typeof summary.attention)[number]) => explained && item.employeeId === PERSONNEL_DEMO_EXPLANATION.employeeId && item.type === "late"
  const attentionCount = summary.attention.length + risks.length
  // The status line the product writes after each decision (`message` in attendance-today.tsx).
  const message = accepted ? t("decisionSaved")
    : explained ? t("explainSent", { created: askable.filter((item) => picked.has(keyOf(item))).length, already: 0, notNeeded: 0 })
      : approved ? t("decisionSaved") : null

  const press = (stepId: string, path: string) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== stepId) {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path, value: true })
  }
  // Reading an answer is no wrong move at any step: it only records the step when the guide asks for it.
  const pressOptional = (stepId: string, path: string) => {
    if (!reviewMode && step?.id === stepId) dispatch({ type: "ui", path, value: true })
  }
  const kindLabel = (kind: string) => {
    if (kind === "TIME_CORRECTION") return tA("requestsTimeCorrection")
    const dayKind = dayKinds.find((candidate) => candidate.key === kind)
    return dayKind ? attendanceDayKindLabel(dayKind, locale) : kind
  }
  const monthName = formatDate(`${today}T12:00:00.000Z`, locale, { month: "long", timeZone: "UTC" })
  const recordHref = (employeeId: string, date: string) => `/mtm/attendance/recordings?${new URLSearchParams({ employeeId, date })}`
  const dayHref = (employeeId: string, date: string) => `/mtm/attendance/timesheet?${new URLSearchParams({ date, employeeId })}`

  const tiles = [
    { id: "arrived", label: t("kpiArrived"), icon: <LogIn className="h-4 w-4" />, tone: "green" as const, value: summary.arrived, unit: t("kpiOf", { total: summary.expected }), progress: summary.expected ? (summary.arrived / summary.expected) * 100 : 0, href: "/mtm/attendance/reports?report=day", link: t("kpiArrivedLink") },
    { id: "late", label: t("kpiLate"), icon: <Clock3 className="h-4 w-4" />, tone: "amber" as const, value: summary.late, unit: null, progress: summary.expected ? (summary.late / summary.expected) * 100 : 0, href: `/mtm/attendance/reports?report=late&date=${today}`, link: t("kpiLateLink") },
    { id: "absent", label: t("kpiAbsent"), icon: <UserRoundX className="h-4 w-4" />, tone: "red" as const, value: summary.absent, unit: t("kpiAbsentUnit", { away: summary.away }), progress: summary.expected ? (summary.absent / summary.expected) * 100 : 0, href: "/mtm/attendance/reports?report=absent", link: t("kpiAbsentLink") },
    { id: "missing-finish", label: t("kpiMissing"), icon: <LogOut className="h-4 w-4" />, tone: "blue" as const, value: summary.missingFinish, unit: null, progress: summary.people ? (summary.missingFinish / summary.people) * 100 : 0, href: "/mtm/attendance/timesheet?filter=missing-finish", link: t("kpiMissingLink") },
  ]

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("todayTitle")}</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">{format.long(today)} · {S.mtmAsOf(PERSONNEL_DEMO_CLOCK)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11 rounded-full"><Link href="/mtm/attendance/recordings" prefetch={false}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t("recordDay")}</Link></Button>
          <Button asChild className="min-h-11 rounded-full"><Link href="/mtm/attendance/timesheet" prefetch={false}><FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />{t("openTimesheet", { month: monthName })}</Link></Button>
        </div>
      </header>

      <div data-tour-id="prs-today-kpis" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.id} className="relative">
              <HomeKpi testId={`prs-today-${tile.id}`} label={tile.label} icon={tile.icon} tone={tile.tone} value={formatter.number(tile.value)} unit={tile.unit} progress={tile.progress} sub={null} />
              <Link href={tile.href} prefetch={false} className="absolute bottom-3 left-4 text-xs font-semibold text-primary hover:underline">{tile.link} →</Link>
            </div>
          ))}
        </div>
        {/* «İndi» as MtmAttendanceNow draws it; the last line is the demo's own, for what the voice says of it. */}
        <section className="rounded-2xl border bg-card p-4" aria-labelledby="prs-today-now-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="prs-today-now-title" className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-700 dark:text-emerald-300" aria-hidden="true"><Users className="h-4 w-4" /></span>
              {t("nowTitle", { time: PERSONNEL_DEMO_CLOCK })}
            </h2>
            <Link href="/mtm/attendance/reports?report=day" prefetch={false} className="text-sm font-semibold text-primary hover:underline">{t("nowOpenDay")} →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {NOW_COLUMNS.map((column) => {
              const people = now[column.key]
              const expanded = openNow === column.key
              const shown = expanded ? people : people.slice(0, NOW_LIMIT)
              return (
                <div key={column.key} className="rounded-xl border p-3">
                  <p className={cn("mb-2 text-sm font-semibold", column.tone)}>{t(column.label)} · {people.length}</p>
                  {people.length ? (
                    <ul className="space-y-1.5 text-sm">
                      {shown.map((person) => (
                        <li key={person.employeeId} className="flex min-w-0 items-baseline justify-between gap-2">
                          <Link href={`/mtm/attendance/people/${encodeURIComponent(person.employeeId)}`} prefetch={false} className="truncate font-medium hover:underline">{person.name}</Link>
                          <span className="shrink-0 text-xs text-muted-foreground">{column.time ? t(column.time, { time: format.time(person.at) }) : person.dayKind ? attendanceDayKindLabel(person.dayKind, locale) : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">{t("nowNobody")}</p>}
                  {people.length > NOW_LIMIT ? (
                    <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" aria-expanded={expanded} onClick={() => setOpenNow(expanded ? null : column.key)}>
                      {expanded ? t("nowLess") : t("nowMore", { count: people.length - NOW_LIMIT })}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("nowAutoHint")}</p>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{S.personnelPrivacy}</p>
        </section>
      </div>

      {message ? <p role="status" data-testid="prs-today-message" className="rounded-xl bg-muted/60 px-4 py-2 text-sm">{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div data-tour-id="prs-today-requests">
          <HomeCard testId="prs-today-requests-card" titleId="prs-today-requests-title" icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />} tone="orange" title={t("pendingTitle")} badge={requests.length ? String(requests.length) : null} action={{ href: "/mtm/attendance/requests", label: t("allRequests") }}>
            {requests.length === 0 ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />{t("pendingEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {requests.slice(0, REQUESTS_LIMIT).map((request) => {
                  const period = `${format.day(request.from)}${request.to !== request.from ? ` – ${format.day(request.to)}` : ""}${request.unit === "HOURS" ? ` · ${request.startTime}–${request.endTime}` : ""}`
                  const isLeave = request.id === "req-wait-1"
                  return (
                    <li key={request.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{request.employeeName}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><HomePill tone="blue">{kindLabel(request.kind)}</HomePill>{period}</p>
                          {request.reason ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{request.reason}</p> : null}
                        </div>
                        {/* One filled button per screen: a row's «Təsdiqlə» is outlined in green. */}
                        <div className="flex shrink-0 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-9 border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300"
                            onClick={() => (isLeave ? press("prs-today-approve", "prs.approved") : hint(S.demoButtonHint))}
                            {...(isLeave ? demoTarget("prs-today-approve") : {})}
                          >
                            {t("approve")}
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-9 text-rose-700 dark:text-rose-300" onClick={() => hint(S.demoButtonHint)}>{t("reject")}</Button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </HomeCard>
        </div>

        <div data-tour-id="prs-today-attention">
          <HomeCard testId="prs-today-attention-card" titleId="prs-today-attention-title" icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />} tone="amber" title={t("attentionTitle")} badge={attentionCount ? String(attentionCount) : null} action={risks.length ? { href: "/mtm/attendance/review", label: t("allRisks", { count: risks.length }) } : undefined}>
            {askable.length && !explained ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                <label className="inline-flex min-h-9 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={picked.size === askable.length} onChange={(event) => setPicked(event.target.checked ? new Set(askable.map(keyOf)) : new Set())} />
                  {t("explainSelectAll", { count: askable.length })}
                </label>
                <Button size="sm" variant="outline" className="min-h-9" disabled={picked.size === 0} onClick={() => press("prs-explain-ask", "prs.explained")} {...demoTarget("prs-explain-ask")}>
                  <MessageCircleQuestionMark className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("explainAsk", { count: picked.size })}
                </Button>
                <p className="w-full text-xs text-muted-foreground">{t("explainHint")}</p>
              </div>
            ) : null}
            <ul className="divide-y divide-border">
              {summary.attention.slice(0, ATTENTION_LIMIT).map((item) => {
                const askableRow = item.type === "late" || item.type === "absent"
                const asked = explained && picked.has(keyOf(item))
                const answer = asked && answered(item)
                return (
                  <li key={`${item.type}:${item.employeeId}:${item.date}`} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      {askableRow ? (
                        <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={t("explainSelect", { name: item.employeeName })} disabled={explained}
                          checked={!explained && picked.has(keyOf(item))}
                          onChange={(event) => setPicked((current) => { const next = new Set(current); if (event.target.checked) next.add(keyOf(item)); else next.delete(keyOf(item)); return next })} />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.employeeName}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.type === "absent" ? t("absentNoReason")
                            : item.type === "late" ? t("lateBy", { duration: item.lateSeconds < 3600 ? t("minutes", { count: Math.round(item.lateSeconds / 60) }) : formatAttendanceDuration(item.lateSeconds), time: formatTime(item.startedAt, locale, { hour: "2-digit", minute: "2-digit", timeZone: item.timezone }) })
                              : t("missingFinishOn", { date: format.day(item.date) })}
                        </p>
                      </div>
                      {askableRow ? (
                        <span className="shrink-0 text-xs">
                          {!asked ? <span className="text-muted-foreground">{t("explainNotAsked")}</span>
                            : !answer ? <span className="text-amber-700 dark:text-amber-400">{t("explainWaiting", { time: PERSONNEL_DEMO_CLOCK })}</span>
                              : accepted ? <span className="text-emerald-700 dark:text-emerald-400">{t("explainAccepted")}</span>
                                : (
                                  <button type="button" className="font-semibold text-primary hover:underline" aria-expanded={reading} onClick={() => { setReading((value) => !value); pressOptional("prs-explain-read", "prs.answerRead") }} {...(answerRead ? {} : demoTarget("prs-explain-read"))}>
                                    {t("explainAnswered")}
                                  </button>
                                )}
                        </span>
                      ) : null}
                      <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0"><Link prefetch={false} href={item.type === "absent" ? recordHref(item.employeeId, item.date) : dayHref(item.employeeId, item.date)}>{item.type === "absent" ? t("addReason") : t("openDay")}</Link></Button>
                    </div>
                    {answer && reading && !accepted ? (
                      <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-testid="prs-explain-answer">
                        <span className="text-muted-foreground">{t("explainAnswerOf", { name: item.employeeName })}</span> «{PERSONNEL_DEMO_EXPLANATION.answer}»
                        <span className="mt-1 block text-xs text-muted-foreground">{S.personnelAnswerAt(PERSONNEL_DEMO_EXPLANATION.answeredAt)}</span>
                        <span className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" className="min-h-9 border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300" onClick={() => press("prs-explain-accept", "prs.explanationAccepted")} {...demoTarget("prs-explain-accept")}>{t("explainAccept")}</Button>
                          <Button size="sm" variant="outline" className="min-h-9 text-rose-700 dark:text-rose-300" onClick={() => hint(S.demoButtonHint)}>{t("explainReject")}</Button>
                        </span>
                      </div>
                    ) : null}
                  </li>
                )
              })}
              {risks.slice(0, Math.max(0, ATTENTION_LIMIT - summary.attention.length)).map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.employeeName}</p>
                    <p className="text-sm text-muted-foreground">{tA(ATTENDANCE_RISK_MESSAGES[item.kind])}{item.relatedNames.length ? ` · ${item.relatedNames.join(", ")}` : ""}</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="min-h-9 shrink-0"><Link prefetch={false} href="/mtm/attendance/review">{t("check")}</Link></Button>
                </li>
              ))}
            </ul>
            {attentionCount > ATTENTION_LIMIT ? <p className="mb-3 text-xs text-muted-foreground">{t("moreAttention", { count: attentionCount - ATTENTION_LIMIT })}</p> : null}
            {summary.people ? <p className="mb-3 text-xs text-muted-foreground">{t("quiet", { count: summary.quiet })}</p> : null}
          </HomeCard>
        </div>
      </div>

      {/* The week: white cells, today outlined in orange, each day a way into the timesheet. */}
      <section className="rounded-2xl border bg-card px-4 py-3" aria-labelledby="prs-today-week">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="prs-today-week" className="text-[15px] font-semibold">{t("weekTitle")}</h2>
          <span className="text-xs text-muted-foreground">{t("weekHint")}</span>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${summary.week.length}, minmax(0, 1fr))` }}>
          {summary.week.map((day) => {
            const isToday = day.date === today
            return (
              <Link key={day.date} prefetch={false} href={`/mtm/attendance/timesheet?date=${day.date}`}
                className={cn("rounded-xl p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", isToday ? "border border-primary" : day.future ? "border border-dashed" : "border hover:bg-muted/50")}>
                <p className={cn("text-xs font-semibold first-letter:uppercase", isToday ? "text-primary" : "text-muted-foreground")}>{format.weekday(day.date)}{isToday ? ` · ${t("weekToday")}` : ""}</p>
                <p className="mt-1 text-sm"><span className="text-base font-bold tabular-nums">{day.future ? "—" : day.present}</span> <span className="text-xs text-muted-foreground">{day.future ? t("weekPlan", { total: day.expected }) : t("kpiOf", { total: day.expected })}</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {day.late ? <HomePill tone="amber">{t("chipLate", { count: day.late })}</HomePill> : null}
                  {day.away ? <HomePill tone="blue">{t("chipAway", { count: day.away })}</HomePill> : null}
                  {!day.future && day.absent ? <HomePill tone="red">{t("chipAbsent", { count: day.absent })}</HomePill> : null}
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/* ── Tabel ────────────────────────────────────────────────────────────── */

const ISSUE_LABELS: Record<TimesheetIssue, string> = { late: "kpiLate", absent: "kpiAbsent", "missing-finish": "kpiMissing", overtime: "tabs.overtime" }
const REASON_MESSAGES: Record<string, string> = { DUPLICATE_WORKDAY: "reportReasonDuplicate", SCHEDULE_INVALID: "reportReasonSchedule", TIMESTAMP_INVALID: "reportReasonTimestamp",
  EVENT_TYPE_INVALID: "reportReasonEvent", JOURNAL_INCOMPLETE: "reportReasonJournal", PAUSE_TOTAL_MISMATCH: "reportReasonPause", WORKDAY_INCONSISTENT: "reportReasonFacts" }
/** The product's popover card (`PopoverContent`, src/components/ui/popover.tsx), as the timesheet sizes it. */
const DAY_CARD = "z-50 w-80 space-y-3 rounded-xl border border-zinc-200/60 bg-popover p-4 text-left text-base font-normal text-popover-foreground shadow-lg outline-none backdrop-blur-xl origin-[--radix-popover-content-transform-origin] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-zinc-700/60"

/**
 * «Tabel» as `attendance-report-workspace.tsx` lays it out: the month switcher,
 * the exports, the issue chips and search, the month grid with each day's
 * letter in its kind's colour and the totals, the legend — and a day opened
 * on its cell as the product opens it, a card over the grid with the day's
 * facts, its notes and its marks, the original phone mark included.
 */
function TimesheetScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const p = useTranslations("personnel")
  const t = useTranslations("mtmAttendance")
  const locale = useLocale()
  const dayKinds = useDayKinds()
  const today = mtmDemoToday(snapshot.startedAt)
  const plan = useMemo(() => personnelDemoPlan(today), [today])
  const report = useMemo(() => personnelDemoReport(today, plan.monthStart, plan.lastMonthEnd, dayKinds), [today, plan, dayKinds])
  const corrected = report.rows.find((row) => row.corrections?.length) ?? null
  const [openCell, setOpenCell] = useState<string | null>(snapshot.ui["prs.dayOpened"] === true && corrected ? `${corrected.employeeId}:${corrected.date}` : null)
  const [issue, setIssue] = useState<TimesheetIssue | null>(null)
  const [search, setSearch] = useState("")
  const [teamId, setTeamId] = useState("")
  const teams = useMemo(() => [...new Map(PERSONNEL_DEMO_EMPLOYEES.flatMap((employee) => (employee.teamId ? [[employee.teamId, employee.teamName ?? ""] as const] : []))).entries()], [])

  const rows = useMemo(() => {
    const filtered = filterMtmAttendanceRows(report.rows, { teamId: teamId || undefined, form: "ALL" })
    const needle = search.trim().toLocaleLowerCase(locale)
    return needle ? filtered.filter((row) => row.employeeName.toLocaleLowerCase(locale).includes(needle)) : filtered
  }, [report, teamId, search, locale])
  const monthEmployees = useMemo(() => {
    const people = new Map<string, { name: string; team: string | null; rows: MtmAttendanceReportRow[]; dates: Map<string, MtmAttendanceReportRow[]> }>()
    for (const row of rows) {
      if (!people.has(row.employeeId)) people.set(row.employeeId, { name: row.employeeName, team: row.teamName, rows: [], dates: new Map() })
      const employee = people.get(row.employeeId)!
      employee.rows.push(row)
      employee.dates.set(row.date, [...(employee.dates.get(row.date) ?? []), row])
    }
    return [...people].map(([id, person]) => ({ id, ...person, totals: summarizeMtmAttendanceRows(person.rows) }))
  }, [rows])
  const monthDates = useMemo(() => {
    const count = Math.round((Date.parse(plan.lastMonthEnd) - Date.parse(plan.monthStart)) / 86_400_000) + 1
    return Array.from({ length: Math.min(count, 31) }, (_, index) => addDateKeyDays(plan.monthStart, index))
  }, [plan])
  const overtimeRows = useMemo(() => new Set(attendanceOvertimeRows(rows).filter((item) => attendanceCountedOvertimeSeconds(item) > 0).map((item) => item.row)), [rows])
  const hasIssue = (row: MtmAttendanceReportRow, kind: TimesheetIssue) => kind === "late" ? (row.lateSeconds ?? 0) > 0 : kind === "absent" ? row.kind === "ABSENT"
    : kind === "missing-finish" ? row.kind === "MISSING_FINISH" : overtimeRows.has(row)
  const counts = Object.fromEntries(TIMESHEET_ISSUES.map((kind) => [kind, monthEmployees.filter((person) => person.rows.some((row) => hasIssue(row, kind))).length])) as Record<TimesheetIssue, number>
  const people = issue ? monthEmployees.filter((person) => person.rows.some((row) => hasIssue(row, issue))) : monthEmployees
  const monthLabel = formatDate(`${plan.monthStart.slice(0, 7)}-15T12:00:00.000Z`, locale, { month: "long", year: "numeric", timeZone: "UTC" })
  const dateKinds = new Map(monthDates.map((date) => [date, monthEmployees[0]?.dates.get(date)?.[0]?.isWorkingDay ?? true]))
  const legend = [...new Map(rows.flatMap((row) => (row.dayKind ? [[row.dayKind.key, row.dayKind] as const] : []))).values()]
  const chip = (active: boolean) => `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-foreground bg-card font-semibold text-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`
  const dateLabel = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { dateStyle: "medium", timeZone: "UTC" })
  const shortTime = (at: string | null, timezone: string) => (at ? formatTime(at, locale, { timeZone: timezone, hour: "2-digit", minute: "2-digit" }) : "—")
  const baseRowNotes = (row: MtmAttendanceReportRow) => row.factsState === "INVALID"
    ? row.invalidReasons.map((reason) => t(REASON_MESSAGES[reason] ?? "reportReasonFacts")).join(" · ")
    : row.kind === "OPEN" ? t("reportProvisional") : row.kind === "MISSING_FINISH" ? t("reportUnknownTime")
      : row.kind === "ABSENT" ? t("reportAbsenceReasonPending") : row.flags.includes("WORKED_OUTSIDE_EMPLOYMENT") ? t("reportWorkOutsideEmployment") : row.flags.includes("WORKED_ON_APPROVED_ABSENCE") ? t("reportWorkOnLeave") : row.flags.includes("WORKED_ON_DAY_OFF") ? t("reportWorkOnDayOff") : row.calendarName ?? "—"
  // The same note as the exported table: the screen and the file say one thing.
  const rowNotes = (row: MtmAttendanceReportRow) => [baseRowNotes(row), ...attendanceLunchLines(row, t),
    ...(row.explanations ?? []).map((item) => t(`reportExplanation${item.status}`, { answer: item.answer ?? "" })), ...attendanceApprovedLines(row, locale, t), ...attendanceCorrectionLines(row, locale, t)].filter((line) => line !== "—").join(" · ") || "—"
  const cellCode = (row: MtmAttendanceReportRow) => (row.dayKind ? `${row.dayKind.code}${row.corrections?.length ? "*" : ""}` : attendanceMonthCell(row, t))

  const toggle = (row: MtmAttendanceReportRow, cellKey: string, open: boolean) => {
    setOpenCell(open ? cellKey : null)
    if (!open || !row.corrections?.length || reviewMode || step?.id !== "prs-timesheet-day") return
    dispatch({ type: "ui", path: "prs.dayOpened", value: true })
  }

  return (
    <section aria-label={t("reportTitle")} className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{p("timesheetTitle")}</h1>
          <div className="inline-flex items-center gap-1 rounded-xl border bg-card p-1">
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("previousMonth")} onClick={() => hint(S.demoButtonHint)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <span className="min-w-36 px-2 text-center text-sm font-semibold capitalize">{monthLabel}</span>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={p("nextMonth")} onClick={() => hint(S.demoButtonHint)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => hint(S.demoButtonHint)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{t("exportExcel")}</Button>
            <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => hint(S.demoButtonHint)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{t("exportPdf")}</Button>
          </div>
          <Button asChild variant="outline" className="min-h-11 rounded-full"><Link href="/mtm/attendance/timesheet?view=months" prefetch={false}><Lock className="mr-2 h-4 w-4" aria-hidden="true" />{p("closeMonth")}</Link></Button>
          <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => hint(S.demoButtonHint)}>{p("more")}<ChevronDown className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={p("filterLabel")}>
        <button type="button" className={chip(issue === null)} aria-pressed={issue === null} onClick={() => setIssue(null)}>{p("filterAll")} <span className="tabular-nums">· {monthEmployees.length}</span></button>
        {TIMESHEET_ISSUES.map((kind) => (
          <button key={kind} type="button" className={chip(issue === kind)} aria-pressed={issue === kind} onClick={() => setIssue(issue === kind ? null : kind)}>{p(ISSUE_LABELS[kind])} <span className="tabular-nums">· {counts[kind]}</span></button>
        ))}
        <span className="flex-1" />
        <label className="relative">
          <span className="sr-only">{p("searchEmployee")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" className="min-h-10 w-56 pl-9" placeholder={p("searchEmployee")} value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <select aria-label={t("reportTeam")} className="min-h-10 min-w-44 rounded-lg border border-zinc-200 bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-zinc-700" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">{t("reportAllTeams")}</option>
          {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      <div data-tour-id="prs-timesheet" className="space-y-5">
        <div className="space-y-4 rounded-2xl border bg-card p-3">
          {people.length ? (
            <div className="overflow-x-auto" role="region" aria-label={t("reportMonth")} tabIndex={0}>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 w-40 min-w-40 bg-card px-2 py-2 text-left text-xs font-medium text-muted-foreground">{t("reportEmployee")}</th>
                    {monthDates.map((date) => (
                      <th key={date} scope="col" className={cn("px-px py-1.5 text-center font-semibold", date === today ? "font-bold text-primary" : dateKinds.get(date) === false ? "text-muted-foreground/60" : "")}>
                        <time dateTime={date} title={dateLabel(date)} className="block text-[11px]">{Number(date.slice(-2))}</time>
                        <span className="block text-[9.5px] font-medium opacity-70">{formatDate(`${date}T12:00:00.000Z`, locale, { weekday: "short", timeZone: "UTC" })}</span>
                      </th>
                    ))}
                    {(["colDays", "colHours", "colLeave", "colSick", "colMissed"] as const).map((key) => <th key={key} scope="col" className="w-11 px-1 py-2 text-center text-[11px] font-semibold text-muted-foreground"><HintValue text={p(`${key}Hint`)}>{p(key)}</HintValue></th>)}
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => {
                    const worked = person.rows.filter((row) => row.startedAt !== null).length
                    const sick = person.rows.filter((row) => row.dayKind?.key === "SICK_LEAVE" || row.dayKind?.key === "UNPAID_SICK").length
                    const missed = person.totals.absentCount + person.totals.missingFinishCount
                    return (
                      <tr key={person.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left">
                          <span className="block truncate text-[13px] font-semibold">{person.name}</span>
                          <span className="block text-[11px] font-normal text-muted-foreground">{person.team ?? t("reportNoTeam")}</span>
                        </th>
                        {monthDates.map((date) => {
                          const entries = person.dates.get(date) ?? []
                          const row = entries[0]
                          const cellKey = `${person.id}:${date}`
                          const dimmed = issue !== null && !entries.some((entry) => hasIssue(entry, issue))
                          const fixed = Boolean(row?.corrections?.length)
                          return (
                            <td key={date} className="px-px py-1 text-center">
                              {row ? (
                                <PopoverPrimitive.Root open={openCell === cellKey} onOpenChange={(open) => toggle(row, cellKey, open)}>
                                  <PopoverPrimitive.Trigger asChild>
                                    <button
                                      type="button"
                                      aria-label={`${person.name} · ${dateLabel(date)} · ${attendanceStatusText(row, locale, t)}`}
                                      {...(fixed ? demoTarget("prs-timesheet-day") : {})}
                                      className={cn("flex h-7 w-full min-w-[22px] items-center justify-center rounded-md text-[11px] font-bold outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:ring-2 data-[state=open]:ring-primary", dimmed && "opacity-25", row.kind === "NOT_EMPLOYED" && !row.dayKind && "opacity-40")}
                                      style={row.dayKind && row.kind !== "UPCOMING" ? { color: row.dayKind.color } : { color: "var(--muted-foreground, #8a94a3)" }}
                                    >
                                      {cellCode(row)}{entries.length > 1 ? "+" : ""}
                                    </button>
                                  </PopoverPrimitive.Trigger>
                                  {/* No portal: the card stays inside the scene, where the guide and the filming find it. */}
                                  <PopoverPrimitive.Content align="center" sideOffset={4} className={DAY_CARD} data-testid="prs-day-card">
                                    {entries.map((entry) => {
                                      const marks = attendanceJournalEntries(entry, locale, t)
                                      return (
                                        <div key={entry.sourceDate ?? entry.date} className="space-y-3">
                                          <div>
                                            <p className="text-sm font-bold">{person.name} · {dateLabel(entry.sourceDate ?? date)}</p>
                                            <p className="text-xs text-muted-foreground">{attendanceStatusText(entry, locale, t)}</p>
                                          </div>
                                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                                            <dt className="text-muted-foreground">{p("dayStarted")}</dt><dd className="font-semibold tabular-nums">{shortTime(entry.startedAt, entry.timezone)}{(entry.lateSeconds ?? 0) > 0 ? <span className="ml-1 text-amber-700 dark:text-amber-300">(+{formatAttendanceDuration(entry.lateSeconds)})</span> : null}</dd>
                                            <dt className="text-muted-foreground">{p("dayFinished")}</dt><dd className="font-semibold tabular-nums">{shortTime(entry.completedAt, entry.timezone)}</dd>
                                            <dt className="text-muted-foreground">{p("dayWorked")}</dt><dd className="font-semibold tabular-nums">{formatAttendanceDuration(entry.workedSeconds)}</dd>
                                            <dt className="text-muted-foreground">{p("dayPause")}</dt><dd className="font-semibold tabular-nums">{formatAttendanceDuration(entry.pausedSeconds)}</dd>
                                          </dl>
                                          {rowNotes(entry) !== "—" ? <p className="text-xs leading-relaxed text-muted-foreground">{rowNotes(entry)}</p> : null}
                                          {marks.length ? (
                                            <div className="space-y-1">
                                              <p className="text-xs font-semibold text-muted-foreground">{p("dayMarks")}</p>
                                              <ul className="space-y-1 text-xs">{marks.map((mark) => <li key={mark.id} className="flex gap-2"><span className="w-11 shrink-0 font-semibold tabular-nums">{shortTime(mark.phoneAt ?? mark.serverAt, entry.timezone)}</span><span className={mark.correction ? "text-primary" : ""}>{mark.description}</span></li>)}</ul>
                                            </div>
                                          ) : null}
                                        </div>
                                      )
                                    })}
                                    <Button asChild size="sm" className="min-h-9 w-full"><Link prefetch={false} href={`/mtm/attendance/recordings?date=${date}&employeeId=${encodeURIComponent(person.id)}`}>{entries.some((entry) => entry.kind === "ABSENT") ? p("addReason") : p("fixDay")}</Link></Button>
                                  </PopoverPrimitive.Content>
                                </PopoverPrimitive.Root>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                          )
                        })}
                        <td className="px-1 text-center text-[13px] font-bold tabular-nums">{worked}</td>
                        <td className="whitespace-nowrap px-1 text-center text-[13px] font-bold tabular-nums">{formatAttendanceDuration(person.totals.workedSeconds)}{!person.totals.isComplete ? "*" : ""}</td>
                        <td className="px-1 text-center text-[13px] font-bold tabular-nums">{person.totals.annualLeaveDays || "—"}</td>
                        <td className="px-1 text-center text-[13px] font-bold tabular-nums">{sick || "—"}</td>
                        <td className={cn("px-1 text-center text-[13px] font-bold tabular-nums", missed && "text-rose-700 dark:text-rose-300")}>{missed || "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="rounded-xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">{issue ? p("filterEmpty") : t("reportEmpty")}</p>}
        </div>
        {legend.length ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label={t("reportLegend")}>
            {legend.map((kind) => (
              <span key={kind.key} className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-[10.5px] font-bold" style={{ color: kind.color, backgroundColor: `${kind.color}1a` }}>{kind.code}</span>
                {attendanceDayKindLabel(kind, locale)}
              </span>
            ))}
            {/* The demo's own line: what the star the voice speaks of means. */}
            <span className="inline-flex items-center gap-1.5"><span className="font-bold">*</span>{S.personnelCorrectedMark}</span>
            <span className="ml-auto">{p("cellHint")}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/* ── Şübhəli qeydlər ──────────────────────────────────────────────────── */

/**
 * «Şübhəli qeydlər» as `MtmAttendanceRiskReview` lays it out, under its way
 * back to «Bu gün»: its filters, the counts and the export, the product's own
 * table (`buildAttendanceRiskTable`) with «Yoxlamaq» on every row and its
 * pages, and its decision card — the two times, a reason of at least three
 * letters, «Qeydi bağlamaq». The screen fetches and writes through the API,
 * so its frame is drawn here with its words; the reason is a sample the
 * prospect may change. Closing keeps the record with who closed it, when and
 * why — the time itself does not change. The filters show what the list is:
 * the last seven days, open and closed alike.
 */
function RiskScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tA = useTranslations("mtmAttendance")
  const tP = useTranslations("personnel")
  const rawLocale = useLocale()
  const locale = rawLocale === "az" || rawLocale === "ru" ? rawLocale : "en"
  const today = mtmDemoToday(snapshot.startedAt)
  const opened = snapshot.ui["prs.riskOpened"] === true
  const closed = snapshot.ui["prs.riskClosed"] === true
  const [reason, setReason] = useState(PERSONNEL_DEMO_RISK_REASON)
  const [selected, setSelected] = useState<string | null>(opened && !closed ? "risk-1" : null)
  const report = useMemo(() => personnelDemoRiskReport(today, closed ? { reason: PERSONNEL_DEMO_RISK_REASON } : null), [today, closed])
  const table = useMemo(() => buildAttendanceRiskTable(report, locale, (key, values) => tA(key, values)), [report, locale, tA])
  const selectedItem = report.items.find((item) => item.id === selected) ?? null
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const query = report.snapshot.query
  const teams = [...new Map(report.directory.flatMap((employee) => (employee.teamId ? [[employee.teamId, employee.teamName ?? ""] as const] : []))).entries()]
  const control = "min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
  useEffect(() => { if (selected) reasonRef.current?.focus() }, [selected])

  const review = (id: string) => {
    if (id !== "risk-1") return hint(S.personnelRiskOther)
    setSelected(id)
    if (!reviewMode && step?.id === "prs-risk-review") dispatch({ type: "ui", path: "prs.riskOpened", value: true })
  }
  const dismiss = () => {
    if (reviewMode) return hint(S.reviewOnly)
    if (step?.id !== "prs-risk-close") return hint(S.hintFollow(step?.title ?? ""))
    if (reason.trim().length < 3) return
    setSelected(null)
    dispatch({ type: "ui", path: "prs.riskClosed", value: true })
  }

  return (
    <div className="space-y-6">
      <Link href="/mtm/attendance" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />{tP("todayTitle")}
      </Link>
      <section className="space-y-5" aria-label={tA("riskTitle")}>
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{tA("riskTitle")}</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{tA("riskDescription")}</p>
        </header>
        <Card className="rounded-2xl px-5 py-1">
          <div className="space-y-4 py-4">
            <form className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={tA("journalFilters")} onSubmit={(event) => event.preventDefault()}>
              {(["from", "to"] as const).map((key) => (
                <div key={key} className="space-y-2">
                  <label htmlFor={`prs-risk-${key}`} className="text-sm font-medium">{tA(key === "from" ? "reportFrom" : "reportTo")}</label>
                  <Input id={`prs-risk-${key}`} type="date" className="min-h-11" value={query[key]} onChange={() => hint(S.demoButtonHint)} />
                </div>
              ))}
              <div className="space-y-2"><label htmlFor="prs-risk-team" className="text-sm font-medium">{tA("riskSelectTeam")}</label><select id="prs-risk-team" className={control} value={query.teamId} onChange={() => hint(S.demoButtonHint)}><option value="">{tA("riskAll")}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
              <div className="space-y-2"><label htmlFor="prs-risk-employee" className="text-sm font-medium">{tA("riskSelectEmployee")}</label><select id="prs-risk-employee" className={control} value={query.employeeId} onChange={() => hint(S.demoButtonHint)}><option value="">{tA("riskAll")}</option>{report.directory.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
              <div className="space-y-2"><label htmlFor="prs-risk-status" className="text-sm font-medium">{tA("journalStatus")}</label><select id="prs-risk-status" className={control} value={query.status} onChange={() => hint(S.demoButtonHint)}>{(["ALL", "OPEN", "DISMISSED"] as const).map((status) => <option key={status} value={status}>{tA(status === "ALL" ? "riskAll" : status === "OPEN" ? "riskOpen" : "riskDismissed")}</option>)}</select></div>
              <div className="space-y-2"><label htmlFor="prs-risk-kind" className="text-sm font-medium">{tA("riskFinding")}</label><select id="prs-risk-kind" className={control} value={query.kind} onChange={() => hint(S.demoButtonHint)}><option value="ALL">{tA("riskAllKinds")}</option>{ATTENDANCE_RISK_KINDS.map((kind) => <option key={kind} value={kind}>{tA(ATTENDANCE_RISK_MESSAGES[kind])}</option>)}</select></div>
            </form>
            {closed ? <p role="status" className="text-sm">{tA("riskSaved")}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">{table.totals[0]}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-11" onClick={() => hint(S.demoButtonHint)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{tA("exportExcel")}</Button>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => hint(S.demoButtonHint)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{tA("exportPdf")}</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{tA("riskEvidenceHint")}</p>
            <div data-tour-id="prs-risk" className="overflow-x-auto">
              <table className="block w-full text-sm lg:table">
                <caption className="sr-only">{tA("riskTitle")}</caption>
                <thead className="hidden lg:table-header-group">
                  <tr>
                    {table.columns.map((column) => <th key={column.key} scope="col" className="border-b px-3 py-3 text-left text-xs font-semibold text-muted-foreground">{column.label}</th>)}
                    <th scope="col" className="sr-only">{tA("riskReview")}</th>
                  </tr>
                </thead>
                <tbody className="block lg:table-row-group">
                  {table.rows.map((row) => (
                    <tr key={row.key} data-testid="risk-row" className="block border-b py-4 lg:table-row lg:py-0">
                      {row.cells.map((cell, index) => (
                        <td key={index} className="grid grid-cols-[6rem_1fr] gap-3 px-1 py-2 align-top lg:table-cell lg:px-3 lg:py-4">
                          <span className="text-xs text-muted-foreground lg:hidden">{table.columns[index].label}</span>
                          <span className="min-w-0 whitespace-pre-line break-words">{cell}</span>
                        </td>
                      ))}
                      <td className="block px-1 py-2 lg:table-cell lg:px-3 lg:py-4">
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => review(row.key)} {...(row.key === "risk-1" && !opened && !closed ? demoTarget("prs-risk-review") : {})}>{tA("riskReview")}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs">{tA("journalPage", { page: 1, pages: 1, count: table.rows.length })}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="min-h-11" disabled>{tA("journalPrevious")}</Button>
                <Button type="button" variant="outline" className="min-h-11" disabled>{tA("journalNext")}</Button>
              </div>
            </div>
          </div>
        </Card>
        {selectedItem ? (
          <div data-tour-id="prs-risk-decision">
            <HomeCard testId="attendance-risk-decision-card" titleId="attendance-risk-decision-title" icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />} title={`${tA("riskReview")}: ${selectedItem.employeeName}`} tone="amber">
              <div className="space-y-4 py-4" data-testid="risk-decision">
                <HomePill tone="amber">{tA("riskOpen")}</HomePill>
                <p className="whitespace-pre-line text-sm">{table.rows.find((row) => row.key === selectedItem.id)?.cells[3]}</p>
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); dismiss() }}>
                  <label htmlFor="prs-risk-reason" className="block text-sm font-medium">{tA("riskReason")}</label>
                  <textarea id="prs-risk-reason" ref={reasonRef} className="min-h-28 w-full rounded-lg border bg-background p-3 text-sm" required minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
                  <p className="text-sm text-muted-foreground">{tA("riskReasonHint")} {S.personnelRiskReasonSample(PERSONNEL_DEMO_REVIEWER)}</p>
                  <Button type="submit" className="min-h-11" disabled={reason.trim().length < 3} {...demoTarget("prs-risk-close")}>{tA("riskDismiss")}</Button>
                </form>
              </div>
            </HomeCard>
          </div>
        ) : null}
      </section>
    </div>
  )
}

/* ── Ay sonu ──────────────────────────────────────────────────────────── */

function MonthScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tA = useTranslations("mtmAttendance")
  const locale = useLocale()
  const format = useFormat()
  const dayKinds = useDayKinds()
  const today = mtmDemoToday(snapshot.startedAt)
  const plan = useMemo(() => personnelDemoPlan(today), [today])
  const report = useMemo(() => personnelDemoReport(today, plan.monthStart, plan.lastMonthEnd, dayKinds), [today, plan, dayKinds])
  const table = useMemo(() => buildAttendanceTable(report, {
    version: 1,
    mode: "MONTH",
    columns: [...N1T_ON_SCREEN],
    showTotals: true,
    filters: { from: plan.monthStart, to: plan.lastMonthEnd, form: "ALL" },
  }, "az", (key, values) => tA(key, values)), [report, plan, tA])
  const closed = snapshot.ui["prs.monthClosed"] === true
  // When and by whom, as «Bağlanmış aylar» prints it (`attendance-months.tsx`): the month's key, the closer and the moment.
  const closedAt = createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baku" }).format(new Date(mtmDemoAt(today, PERSONNEL_DEMO_CLOCK)))

  const close = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "prs-month-close") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path: "prs.monthClosed", value: true })
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{tA("reportN1tTitle")}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{format.month(plan.monthStart)}</p>
      </header>
      <div data-tour-id="prs-n1t" className="overflow-x-auto rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>{table.columns.map((column) => <th key={column.key} className="px-2 py-2 font-medium">{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                {row.cells.map((cell, index) => <td key={index} className={cn("px-2 py-1.5", typeof cell === "number" && "tabular-nums")}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {table.totals.length ? <p className="border-t border-zinc-100 px-3 py-2 text-xs text-muted-foreground dark:border-zinc-800">{table.totals.join(" · ")}</p> : null}
      </div>
      <Card data-tour-id="prs-month-close" className="space-y-5 p-4 sm:p-6">
        {closed ? (
          // The closed month's card as «Bağlanmış aylar» draws it: the exports beside the heading, the note white with a green edge.
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{plan.monthStart.slice(0, 7)} · {tA("monthCloseClosed")}</h2>
                <p className="text-sm text-muted-foreground">{PERSONNEL_DEMO_REVIEWER} · {closedAt}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button className="min-h-11" onClick={() => hint(S.demoButtonHint)}>{tA("monthCloseExcel")}</Button>
                <Button className="min-h-11" variant="outline" onClick={() => hint(S.demoButtonHint)}>{tA("monthClosePdf")}</Button>
              </div>
            </div>
            <p className="rounded-xl border border-l-4 border-zinc-200 border-l-emerald-500 bg-card p-4 text-sm text-foreground dark:border-zinc-700 dark:border-l-emerald-500">{tA("monthCloseFrozen")}</p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{S.personnelCloseNote}</p>
            <Button className="min-h-11" onClick={close} {...demoTarget("prs-month-close")}><CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />{tA("monthCloseAction")}</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
