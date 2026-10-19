"use client"

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, ClipboardCheck, ClipboardList, Clock3, Download, FileSpreadsheet, Lock, LogIn, LogOut, MessageCircleQuestionMark, ShieldAlert, ShieldCheck, UserRoundX, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeCard, HomeKpi, HomePill } from "@/components/mtm/home-parts"
import { createDateFormatter } from "@/lib/format-date"
import { attendanceDayKindLabel, defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { attendanceCorrectionText, attendanceMonthCell, formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { buildAttendanceRiskTable } from "@/lib/mtm/attendance-risk-table"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { attendanceNow, attendanceTodayRange, summarizeAttendanceToday } from "@/lib/mtm/attendance-today"
import { ATTENDANCE_N1T_COLUMNS } from "@/lib/mtm/attendance-view-contract"

/**
 * The N-1t on screen: the form's own columns but the day-by-day one, which
 * the timesheet screen shows and the Excel/PDF export carries — thirty day
 * columns on a 1470 px screen are a sideways scroll inside a card.
 */
const N1T_ON_SCREEN = ATTENDANCE_N1T_COLUMNS.filter((column) => column !== "days")
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import { mtmDemoToday } from "./mtm-demo-data"
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
} from "./personnel-demo-data"

/**
 * Personnel («Kadr uçotu»): the workday module, a module of its own beside the
 * lead story (owner, 2026-10-17: the new employee-attendance module needs its
 * demo).
 *
 * The days are phone facts of an invented company run through the product's
 * own timesheet builder (`personnel-demo-data.ts`); «Bu gün» is summarised
 * by the product's own `summarizeAttendanceToday` and `attendanceNow`, the
 * timesheet cells by `attendanceMonthCell`, the correction by
 * `attendanceCorrectionText`, the N-1t by `buildAttendanceTable` — the same
 * functions the live screens call. The live screens fetch their data, so
 * their frames are redrawn here with the product's parts and words.
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
      <nav aria-label={tNav("groups.Personnel")} className="flex flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-card p-1 dark:border-zinc-700">
        {NAV.map((item) => {
          const active = item.screens.includes(screen)
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => (active ? undefined : hint(S.personnelTabHint))}
              className={cn("rounded-xl px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {tNav(item.key)}
            </button>
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

function TodayScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("personnel")
  const tA = useTranslations("mtmAttendance")
  const locale = useLocale()
  const format = useFormat()
  const dayKinds = useDayKinds()
  const today = mtmDemoToday(snapshot.startedAt)
  const range = attendanceTodayRange(today)
  const report = useMemo(() => personnelDemoReport(today, range.from, range.to, dayKinds), [today, range.from, range.to, dayKinds])
  const summary = useMemo(() => summarizeAttendanceToday(report.rows, today), [report, today])
  const now = useMemo(() => attendanceNow(report.rows, today), [report, today])
  const requests = useMemo(() => personnelDemoRequests(today), [today])
  const approved = snapshot.ui["prs.approved"] === true
  const explained = snapshot.ui["prs.explained"] === true
  const answerRead = snapshot.ui["prs.answerRead"] === true
  const accepted = snapshot.ui["prs.explanationAccepted"] === true
  // The product asks the late and the absent to explain (attendance-today.tsx): a tick per row, all of them to begin with.
  const keyOf = (item: (typeof summary.attention)[number]) => `${item.employeeId}|${item.date}|${item.type}`
  const askable = summary.attention.filter((item) => item.type === "late" || item.type === "absent")
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(askable.map(keyOf)))
  const [reading, setReading] = useState(answerRead && !accepted)
  const answered = (item: (typeof summary.attention)[number]) => explained && item.employeeId === PERSONNEL_DEMO_EXPLANATION.employeeId && item.type === "late"

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

  const tiles = [
    { id: "arrived", label: t("kpiArrived"), icon: <LogIn className="h-4 w-4" />, tone: "green" as const, value: summary.arrived, unit: t("kpiOf", { total: summary.expected }), progress: summary.expected ? (summary.arrived / summary.expected) * 100 : 0 },
    { id: "late", label: t("kpiLate"), icon: <Clock3 className="h-4 w-4" />, tone: "amber" as const, value: summary.late, unit: null, progress: summary.expected ? (summary.late / summary.expected) * 100 : 0 },
    { id: "absent", label: t("kpiAbsent"), icon: <UserRoundX className="h-4 w-4" />, tone: "red" as const, value: summary.absent, unit: t("kpiAbsentUnit", { away: summary.away }), progress: summary.expected ? (summary.absent / summary.expected) * 100 : 0 },
    { id: "missing-finish", label: t("kpiMissing"), icon: <LogOut className="h-4 w-4" />, tone: "blue" as const, value: summary.missingFinish, unit: null, progress: summary.people ? (summary.missingFinish / summary.people) * 100 : 0 },
  ]
  const columns = [
    { key: "working" as const, label: t("nowWorking"), at: (time: string) => t("nowSince", { time }), tone: "text-emerald-700 dark:text-emerald-400" },
    { key: "paused" as const, label: t("nowPaused"), at: (time: string) => t("nowSince", { time }), tone: "text-amber-700 dark:text-amber-400" },
    { key: "left" as const, label: t("nowLeft"), at: (time: string) => t("nowAt", { time }), tone: "text-sky-700 dark:text-sky-400" },
    { key: "notYet" as const, label: t("nowNotYet"), at: null, tone: "text-muted-foreground" },
  ]

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("todayTitle")}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{format.long(today)} · {S.mtmAsOf(PERSONNEL_DEMO_CLOCK)}</p>
      </header>

      <div data-tour-id="prs-today-kpis" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <HomeKpi key={tile.id} testId={`prs-today-${tile.id}`} label={tile.label} icon={tile.icon} tone={tile.tone} value={String(tile.value)} unit={tile.unit} progress={tile.progress} sub={null} />
          ))}
        </div>
        <section className="rounded-2xl border bg-card p-4" aria-label={t("nowTitle", { time: PERSONNEL_DEMO_CLOCK })}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-hidden="true"><Users className="h-4 w-4" /></span>
            {t("nowTitle", { time: PERSONNEL_DEMO_CLOCK })}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {columns.map((column) => {
              const people = now[column.key]
              return (
                <div key={column.key} className="rounded-xl border p-3">
                  <p className={cn("mb-2 text-sm font-semibold", column.tone)}>{column.label} · {people.length}</p>
                  {people.length ? (
                    <ul className="space-y-1.5 text-sm">
                      {people.slice(0, 3).map((person) => (
                        <li key={person.employeeId} className="flex min-w-0 items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{person.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{column.at && person.at ? column.at(format.time(person.at)) : person.dayKind ? attendanceDayKindLabel(person.dayKind, locale) : ""}</span>
                        </li>
                      ))}
                      {people.length > 3 ? <li className="text-xs font-semibold text-primary">{t("nowMore", { count: people.length - 3 })}</li> : null}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">{t("nowNobody")}</p>}
                </div>
              )
            })}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{S.personnelPrivacy}</p>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div data-tour-id="prs-today-requests">
          <HomeCard testId="prs-today-requests-card" titleId="prs-today-requests-title" icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />} tone="orange" title={t("pendingTitle")} badge={String(requests.length - (approved ? 1 : 0))}>
            <ul className="divide-y divide-border">
              {requests.map((request) => {
                const period = `${format.day(request.from)}${request.to !== request.from ? ` – ${format.day(request.to)}` : ""}${request.unit === "HOURS" ? ` · ${request.startTime}–${request.endTime}` : ""}`
                const isLeave = request.id === "req-wait-1"
                return (
                  <li key={request.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{request.employeeName}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"><HomePill tone="blue">{kindLabel(request.kind)}</HomePill>{period}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{request.reason}</p>
                      </div>
                      {isLeave && approved ? (
                        <HomePill tone="green">{S.personnelApproved}</HomePill>
                      ) : (
                        <div className="flex shrink-0 gap-2">
                          <Button
                            size="sm"
                            className="min-h-9 bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() => (isLeave ? press("prs-today-approve", "prs.approved") : hint(S.demoButtonHint))}
                            {...(isLeave ? demoTarget("prs-today-approve") : {})}
                          >
                            {t("approve")}
                          </Button>
                          <Button size="sm" variant="outline" className="min-h-9 text-rose-700 dark:text-rose-300" onClick={() => hint(S.demoButtonHint)}>{t("reject")}</Button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </HomeCard>
        </div>

        <div data-tour-id="prs-today-attention">
          <HomeCard testId="prs-today-attention-card" titleId="prs-today-attention-title" icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />} tone="amber" title={t("attentionTitle")} badge={String(summary.attention.length)}>
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
              {summary.attention.map((item) => {
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
                            : item.type === "late" ? t("lateBy", { duration: t("minutes", { count: Math.round(item.lateSeconds / 60) }), time: format.time(item.startedAt) })
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
                      <Button size="sm" variant="outline" className="min-h-9 shrink-0" onClick={() => hint(S.demoButtonHint)}>{item.type === "absent" ? t("addReason") : t("openDay")}</Button>
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
            </ul>
            <p className="mb-3 text-xs text-muted-foreground">{t("quiet", { count: summary.quiet })}</p>
          </HomeCard>
        </div>
      </div>

      <section className="rounded-2xl border bg-card px-4 py-3">
        <h2 className="mb-2 text-[15px] font-semibold">{t("weekTitle")}</h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${summary.week.length}, minmax(0, 1fr))` }}>
          {summary.week.map((day) => {
            const isToday = day.date === today
            return (
              <div key={day.date} className={cn("rounded-xl p-2 sm:p-3", isToday ? "bg-primary/10 ring-1 ring-primary/40" : day.future ? "border border-dashed" : "bg-muted/50")}>
                <p className={cn("text-xs font-semibold first-letter:uppercase", isToday ? "text-primary" : "text-muted-foreground")}>{format.weekday(day.date)}</p>
                <p className="mt-1 text-sm"><span className="text-base font-bold tabular-nums">{day.future ? "—" : day.present}</span> <span className="hidden text-xs text-muted-foreground sm:inline">{day.future ? t("weekPlan", { total: day.expected }) : t("kpiOf", { total: day.expected })}</span></p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {day.late ? <HomePill tone="amber">{t("chipLate", { count: day.late })}</HomePill> : null}
                  {day.away ? <HomePill tone="blue">{t("chipAway", { count: day.away })}</HomePill> : null}
                  {!day.future && day.absent ? <HomePill tone="red">{t("chipAbsent", { count: day.absent })}</HomePill> : null}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/* ── Tabel ────────────────────────────────────────────────────────────── */

function TimesheetScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("personnel")
  const tA = useTranslations("mtmAttendance")
  const locale = useLocale()
  const format = useFormat()
  const dayKinds = useDayKinds()
  const today = mtmDemoToday(snapshot.startedAt)
  const plan = useMemo(() => personnelDemoPlan(today), [today])
  const report = useMemo(() => personnelDemoReport(today, plan.monthStart, plan.lastMonthEnd, dayKinds), [today, plan, dayKinds])
  const dates = useMemo(() => [...new Set(report.rows.map((row) => row.date))].sort(), [report])
  const byKey = useMemo(() => new Map(report.rows.map((row) => [`${row.employeeId}|${row.date}`, row])), [report])
  const corrected = report.rows.find((row) => row.corrections?.length) ?? null
  const [open, setOpen] = useState<MtmAttendanceReportRow | null>(snapshot.ui["prs.dayOpened"] === true ? corrected : null)
  const legend = useMemo(() => {
    const seen = new Map(report.rows.flatMap((row) => (row.dayKind ? [[row.dayKind.key, row.dayKind] as const] : [])))
    return [...seen.values()]
  }, [report])

  const openCell = (row: MtmAttendanceReportRow) => {
    setOpen(row)
    if (!row.corrections?.length || reviewMode || step?.id !== "prs-timesheet-day") return
    dispatch({ type: "ui", path: "prs.dayOpened", value: true })
  }
  const letter = (row: MtmAttendanceReportRow | undefined) => attendanceMonthCell(row, (key) => tA(key)).split(" · ")[0]

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("timesheetTitle")}</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">{format.month(plan.monthStart)}</p>
        </div>
        <Button variant="outline" onClick={() => hint(S.demoButtonHint)}><FileSpreadsheet className="mr-1.5 h-4 w-4" aria-hidden="true" />Excel</Button>
      </header>
      <div data-tour-id="prs-timesheet" className="space-y-3">
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
          {/* Narrow cells: a whole month fits a 1470 px screen without a sideways scroll. */}
          <table className="w-full min-w-[760px] table-fixed border-collapse text-[10px]">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="sticky left-0 z-10 w-[132px] bg-muted/90 px-2 py-2 text-left font-medium">{tA("reportEmployee")}</th>
                {dates.map((date) => <th key={date} className="px-0 py-2 text-center font-medium tabular-nums">{Number(date.slice(8))}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERSONNEL_DEMO_EMPLOYEES.map((employee) => (
                <tr key={employee.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="sticky left-0 z-10 max-w-[132px] truncate whitespace-nowrap bg-card px-2 py-1 text-xs font-medium">{employee.name}</td>
                  {dates.map((date) => {
                    const row = byKey.get(`${employee.id}|${date}`)
                    const fixed = Boolean(row?.corrections?.length)
                    return (
                      <td key={date} className="px-0 py-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => row && openCell(row)}
                          title={row ? `${employee.name} · ${format.day(date)}` : undefined}
                          {...(fixed ? demoTarget("prs-timesheet-day") : {})}
                          className={cn("h-6 w-[21px] rounded text-[10px] font-semibold", fixed && "ring-2 ring-primary")}
                          style={{ color: row?.dayKind?.color, backgroundColor: row?.dayKind ? `${row.dayKind.color}14` : undefined }}
                        >
                          {letter(row)}{fixed ? "*" : ""}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((kind) => <span key={kind.key}><b style={{ color: kind.color }}>{kind.code}</b> — {attendanceDayKindLabel(kind, locale)}</span>)}
          <span><b>*</b> — {S.personnelCorrectedMark}</span>
        </p>
        {open ? (
          <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">{open.employeeName} · {format.long(open.date)}</h2>
                <p className="text-sm text-muted-foreground">{open.dayKind ? `${open.dayKind.code} · ${attendanceDayKindLabel(open.dayKind, locale)}` : ""}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>×</Button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <DayFact label={tA("reportStarted")} value={format.time(open.startedAt)} />
              <DayFact label={tA("reportFinished")} value={format.time(open.completedAt)} />
              <DayFact label={tA("reportWorked")} value={formatAttendanceDuration(open.workedSeconds)} />
              <DayFact label={tA("reportLate")} value={formatAttendanceDuration(open.lateSeconds)} />
            </dl>
            {open.corrections?.map((correction) => (
              <p key={correction.id} className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                {attendanceCorrectionText(open, correction, locale, (key, values) => tA(key, values))}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function DayFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value || "—"}</dd>
    </div>
  )
}

/* ── Şübhəli qeydlər ──────────────────────────────────────────────────── */

/**
 * «Şübhəli qeydlər» as `MtmAttendanceRiskReview` lays it out: its filters,
 * the counts and the export, the product's own table
 * (`buildAttendanceRiskTable`) with «Yoxlamaq» on every row, and its decision
 * card — the two times, a reason of at least three letters, «Qeydi bağlamaq».
 * The screen fetches and writes through the API, so its frame is drawn here
 * with its words; the reason is a sample the prospect may change. Closing
 * keeps the record with who closed it, when and why — the time itself does
 * not change.
 */
function RiskScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tA = useTranslations("mtmAttendance")
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
    <section className="space-y-5" aria-label={tA("riskTitle")}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{tA("riskTitle")}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{tA("riskDescription")}</p>
      </header>
      <div className="rounded-2xl border border-zinc-200 bg-card px-5 py-4 dark:border-zinc-700">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{table.totals[0]}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => hint(S.demoButtonHint)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{tA("exportExcel")}</Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => hint(S.demoButtonHint)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{tA("exportPdf")}</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{tA("riskEvidenceHint")}</p>
          {closed ? <p role="status" className="text-sm">{tA("riskSaved")}</p> : null}
          <div data-tour-id="prs-risk">
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
        </div>
      </div>
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
  )
}

/* ── Ay sonu ──────────────────────────────────────────────────────────── */

function MonthScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tA = useTranslations("mtmAttendance")
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
      <div data-tour-id="prs-month-close" className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        {closed ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4" aria-hidden="true" />{format.month(plan.monthStart)} · {tA("monthCloseClosed")}</p>
            <p className="text-sm text-muted-foreground">{S.personnelClosedBy(PERSONNEL_DEMO_REVIEWER, PERSONNEL_DEMO_CLOCK)}</p>
            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{tA("monthCloseFrozen")}</p>
            <div className="flex gap-2">
              <Button onClick={() => hint(S.demoButtonHint)}>{tA("monthCloseExcel")}</Button>
              <Button variant="outline" onClick={() => hint(S.demoButtonHint)}>{tA("monthClosePdf")}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{S.personnelCloseNote}</p>
            <Button onClick={close} {...demoTarget("prs-month-close")}><CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />{tA("monthCloseAction")}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
