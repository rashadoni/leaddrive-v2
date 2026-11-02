"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Activity, ArrowUpRight, MessageCircleQuestionMark, Search, ShieldCheck, Users } from "lucide-react"
import { formatDate, formatTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Hint } from "@/components/hint"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { MTM_TAB_ROW, mtmChipClass, mtmTabClass } from "@/components/mtm/calm-classes"
import { attendanceDayKindLabel } from "@/lib/mtm/attendance-day-kinds"
import { attendanceCountedOvertimeSeconds, attendanceOvertimeRows } from "@/lib/mtm/attendance-overtime"
import { attendanceApprovedLines, attendanceCorrectionLines, attendanceJournalEntries, formatAttendanceMinutes } from "@/lib/mtm/attendance-presentation"
import { ATTENDANCE_BOARD_FILTERS, attendanceBoard, attendanceExplanationKey, type AttendanceBoardFilter, type AttendanceBoardGroup, type AttendanceBoardPerson } from "@/lib/mtm/attendance-today"
import type { AttendanceExplanationDto } from "@/lib/mtm/attendance-explanation-contract"
import type { AttendanceReviewItem } from "@/lib/mtm/attendance-request-review"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"

const CARD = "rounded-2xl border border-border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
/** Rows drawn before «Show everyone»: the page grows with the list, it never scrolls inside a frame. */
export const ATTENDANCE_BOARD_ROWS = 12
const FILTER_LABEL: Record<AttendanceBoardFilter, string> = { all: "filterAll", working: "filterWorking", paused: "filterPaused", late: "filterLate", absent: "filterAbsent", notYet: "filterNotYet", away: "filterAway", left: "filterLeft" }
// A status is said by the colour of its words, never by a filled pill (calm colours, 2026-10-18).
const FILTER_TONE: Record<AttendanceBoardFilter, string | undefined> = {
  all: undefined, working: "text-emerald-700 dark:text-emerald-400", paused: "text-sky-700 dark:text-sky-400", late: "text-amber-700 dark:text-amber-400",
  absent: "text-rose-700 dark:text-rose-300", notYet: "text-muted-foreground", away: "text-sky-700 dark:text-sky-400", left: "text-muted-foreground",
}
type Tab = "summary" | "marks" | "requests" | "corrections"
const TABS: readonly [Tab, string][] = [["summary", "drawerTabSummary"], ["marks", "drawerTabMarks"], ["requests", "drawerTabRequests"], ["corrections", "drawerTabCorrections"]]

const matches = (person: AttendanceBoardPerson, filter: AttendanceBoardFilter) =>
  filter === "all" || (filter === "late" ? person.late : person.status === filter)

/**
 * Personnel → Today → the live board (owner, 2026-11-02, approved mockup after
 * the HRSS clip): who is in, department by department, everyone of the day in
 * one table, and the day of one person in a side card. Its figures come from
 * `attendanceBoard`, the same rows and rules as the tiles above it.
 */
export function MtmAttendanceBoard({ rows, today, timezone, loadedAt, canManage, explanations, requests, busy, onAsk }: {
  rows: readonly MtmAttendanceReportRow[]; today: string; timezone: string; loadedAt: string; canManage: boolean
  /** Null when this user may not ask for explanations: the side card shows no explanation. */
  explanations: readonly AttendanceExplanationDto[] | null
  requests: readonly AttendanceReviewItem[] | null
  busy: boolean
  onAsk: (key: string) => void
}) {
  const t = useTranslations("personnel")
  const locale = useLocale()
  const board = useMemo(() => attendanceBoard(rows, today), [rows, today])
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<AttendanceBoardFilter>("all")
  const [query, setQuery] = useState("")
  const [everyone, setEveryone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const clock = (value: string | null) => value ? formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : "—"

  // A department that left the board on a refresh stops filtering instead of emptying the table.
  const group = board.groups.find(item => item.key === groupKey) ?? null
  const counts = group?.counts ?? board.counts
  const needle = query.trim().toLocaleLowerCase(locale)
  const chosen = board.people.filter(person => (!group || person.groupKey === group.key) && matches(person, filter)
    && (!needle || person.name.toLocaleLowerCase(locale).includes(needle) || (person.position ?? "").toLocaleLowerCase(locale).includes(needle)))
  const shown = everyone ? chosen : chosen.slice(0, ATTENDANCE_BOARD_ROWS)
  const open = board.people.find(person => person.employeeId === openId) ?? null
  const groupName = (item: Pick<AttendanceBoardGroup, "name">) => board.grouping === "department"
    ? item.name ? t("boardDepartment", { name: item.name }) : t("boardNoDepartment")
    : item.name ? t("boardSection", { name: item.name }) : t("boardNoSection")

  return <section className="space-y-4" aria-labelledby="attendance-today-now-title" data-testid="attendance-today-now">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="attendance-today-now-title" className="flex items-center gap-2 text-[15px] font-semibold">
        <Activity className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />{t("nowTitle", { time: clock(loadedAt) })}
        {board.groups.length ? <span className="font-normal text-muted-foreground">{t(board.grouping === "department" ? "boardByDepartment" : "boardBySection")}</span> : null}
      </h2>
      <p className="text-xs text-muted-foreground" data-testid="attendance-board-hint">{t(board.groups.length ? "boardHint" : "boardRefreshHint")}</p>
    </div>

    {board.groups.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="attendance-board-groups">
      {board.groups.map(item => {
        const active = group?.key === item.key, name = groupName(item)
        const percent = item.expected ? Math.round(item.arrived / item.expected * 100) : null
        return <Hint key={item.key} text={t("boardCardHint", { name })}>
          <button type="button" data-crm-color-role="toggle" aria-pressed={active} data-testid="attendance-board-group"
            onClick={() => { setGroupKey(active ? null : item.key); setEveryone(false) }}
            className={cn(CARD, "flex min-w-0 flex-col p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "border-foreground ring-1 ring-foreground")}>
            <span className="flex w-full items-start justify-between gap-2">
              <span className="line-clamp-2 min-w-0 break-words text-sm font-semibold">{name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t(active ? "boardSelected" : "boardShow")}</span>
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[28px] font-bold leading-none tracking-tight tabular-nums" data-testid="attendance-board-percent">{percent === null ? "—" : `${percent}%`}</span>
              <span className="text-sm text-muted-foreground">{item.expected ? t("boardArrived", { arrived: item.arrived, expected: item.expected }) : t("boardNobodyDue")}</span>
            </span>
            <span className="mt-2.5 block h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${percent ?? 0}%` }} />
            </span>
            <span className="mt-2 text-xs text-muted-foreground" data-testid="attendance-board-facts">
              {t("boardTotal", { count: item.total })}
              {" · "}<span className={item.late ? "text-amber-700 dark:text-amber-400" : undefined}>{t("boardLate", { count: item.late })}</span>
              {" · "}<span className={item.absent ? "font-semibold text-rose-700 dark:text-rose-300" : undefined}>{t("boardAbsent", { count: item.absent })}</span>
              {" · "}{t("boardAway", { count: item.away })}
              {item.notYet ? <>{" · "}{t("boardNotYet", { count: item.notYet })}</> : null}
            </span>
            {item.sections.length ? <span className="mt-2.5 block w-full space-y-1 border-t border-border pt-2.5 text-xs">
              {item.sections.map(section => <span key={section.key} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{section.name ?? t("boardNoSection")}</span>
                <span className={cn("shrink-0 tabular-nums", section.arrived < section.expected ? "font-semibold text-foreground" : "text-muted-foreground")}>{t("boardSectionFigure", { arrived: section.arrived, expected: section.expected })}</span>
              </span>)}
            </span> : null}
          </button>
        </Hint>
      })}
    </div> : null}

    <div className={cn(CARD, "flex min-w-0 flex-col")} data-testid="attendance-board-people">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold">{t("peopleTitle")}</h3>
        <span className="inline-flex items-center rounded-full border border-border px-2 text-xs font-semibold leading-5 text-muted-foreground">{group ? groupName(group) : t("peopleEveryone")}</span>
        {group ? <button type="button" className="min-h-9 text-xs font-semibold text-primary hover:underline" onClick={() => setGroupKey(null)}>{t("peopleShowEveryone")}</button> : null}
        <label className="relative w-full sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label={t("peopleSearch")} placeholder={t("peopleSearch")} value={query} onChange={event => setQuery(event.target.value)} className="min-h-9 pl-9" />
        </label>
      </header>
      <div className="flex flex-wrap gap-2 px-5 pb-1 pt-3.5" role="group" aria-label={t("peopleTitle")}>
        {ATTENDANCE_BOARD_FILTERS.map(key => <button key={key} type="button" data-crm-filter="" data-state={filter === key ? "active" : "inactive"} aria-pressed={filter === key}
          data-testid={`attendance-board-filter-${key}`} onClick={() => { setFilter(key); setEveryone(false) }}
          className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mtmChipClass(filter === key, FILTER_TONE[key]))}>
          <span>{t(FILTER_LABEL[key])}</span><span className="tabular-nums text-muted-foreground">{counts[key]}</span>
        </button>)}
      </div>

      {chosen.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">{t("peopleNobody")}</p> : <>
        <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm" data-testid="attendance-board-table">
          <thead><tr className="text-left text-xs font-semibold text-muted-foreground">
            <th scope="col" className="py-2.5 pl-5 pr-3 font-semibold">{t("colEmployee")}</th>
            <th scope="col" className="hidden px-3 py-2.5 font-semibold xl:table-cell">{t("colSection")}</th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 font-semibold">{t("colPlan")}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t("colIn")}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t("colOut")}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t("colWorked")}</th>
            <th scope="col" className="hidden px-3 py-2.5 font-semibold xl:table-cell">{t("colPaused")}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{t("colLate")}</th>
            <th scope="col" className="hidden whitespace-nowrap px-3 py-2.5 font-semibold xl:table-cell">{t("colEarly")}</th>
            <th scope="col" className="px-3 py-2.5 pr-5 font-semibold">{t("colNow")}</th>
          </tr></thead>
          <tbody>{shown.map(person => {
            const row = person.row
            return <tr key={person.employeeId} data-testid="attendance-board-row" data-employee={person.employeeId} onClick={() => setOpenId(person.employeeId)}
              className={cn("cursor-pointer border-t border-border hover:bg-muted/40", openId === person.employeeId && "bg-muted/60")}>
              <td className="py-2.5 pl-5 pr-3">
                <Hint text={t("peopleOpenHint", { name: person.name })}><button type="button" className="text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => { event.stopPropagation(); setOpenId(person.employeeId) }}>{person.name}</button></Hint>
                <p className="text-xs text-muted-foreground">{[person.position, person.teamName].filter(Boolean).map((part, index) => <span key={index} className={index ? "xl:hidden" : undefined}>{index ? " · " : ""}{part}</span>)}</p>
              </td>
              <td className="hidden px-3 py-2.5 xl:table-cell"><p>{person.teamName ?? "—"}</p>{board.grouping === "department" && person.departmentName ? <p className="text-xs text-muted-foreground">{person.departmentName}</p> : null}</td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{row.plannedStartAt && row.plannedEndAt ? `${clock(row.plannedStartAt)}–${clock(row.plannedEndAt)}` : "—"}</td>
              <td className="px-3 py-2.5 tabular-nums">{clock(row.startedAt)}</td>
              <td className="px-3 py-2.5 tabular-nums">{clock(row.completedAt)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{row.startedAt ? formatAttendanceMinutes(row.workedSeconds) : "—"}</td>
              <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums xl:table-cell">{row.startedAt ? formatAttendanceMinutes(row.pausedSeconds) : "—"}</td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{person.late ? <span className="font-semibold text-primary">{minutesText(t, row.lateSeconds ?? 0)}</span> : "—"}</td>
              <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums xl:table-cell">{(row.earlyLeaveSeconds ?? 0) > 0 ? minutesText(t, row.earlyLeaveSeconds ?? 0) : "—"}</td>
              <td className="px-3 py-2.5 pr-5"><BoardStatus person={person} clock={clock} /></td>
            </tr>
          })}</tbody>
        </table>
        </div>
        <ul className="md:hidden" data-testid="attendance-board-list">{shown.map(person => <li key={person.employeeId} className="border-t border-border">
          <button type="button" className="block w-full px-4 py-3 text-left" onClick={() => setOpenId(person.employeeId)}>
            <span className="flex items-baseline justify-between gap-2"><span className="font-semibold">{person.name}</span>
              {person.late ? <span className="shrink-0 text-xs font-semibold text-primary">{minutesText(t, person.row.lateSeconds ?? 0)}</span> : null}</span>
            <span className="block text-xs text-muted-foreground">{[person.position, person.teamName].filter(Boolean).join(" · ")}</span>
            <span className="mt-1 block text-sm"><BoardStatus person={person} clock={clock} /></span>
            {person.row.startedAt ? <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">{clock(person.row.startedAt)}–{person.row.completedAt ? clock(person.row.completedAt) : "…"} · {formatAttendanceMinutes(person.row.workedSeconds)}</span> : null}
          </button>
        </li>)}</ul>
      </>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span data-testid="attendance-board-shown">{t("peopleShown", { shown: shown.length, total: chosen.length })}</span>
        {chosen.length > shown.length ? <Button type="button" variant="outline" size="sm" className="ml-auto min-h-9 rounded-full" onClick={() => setEveryone(true)}>{t("peopleShowAll", { count: chosen.length })}</Button> : null}
      </div>
    </div>

    {/* What the «Kadr uçotu» clip says under «Now» (owner, 2026-10-20), each claim true of the product:
      no biometric step anywhere in a mark; a break shows its start time only and no input writes a
      place inside it (workday-pauses.ts); no cron and no manager finishes anyone's day. */}
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="attendance-now-privacy"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("nowPrivacy")}</p>

    <Sheet open={open !== null} onOpenChange={value => { if (!value) setOpenId(null) }}>
      {open ? <BoardDayCard key={open.employeeId} person={open} today={today} canManage={canManage} clock={clock} grouping={board.grouping}
        explanations={explanations} requests={requests} busy={busy} onAsk={onAsk} /> : null}
    </Sheet>
  </section>
}

type Text = ReturnType<typeof useTranslations>
function minutesText(t: Text, seconds: number) {
  return seconds < 3600 ? t("minutes", { count: Math.round(seconds / 60) }) : formatAttendanceMinutes(seconds)
}

function BoardStatus({ person, clock }: { person: AttendanceBoardPerson; clock: (value: string | null) => string }) {
  const t = useTranslations("personnel"), a = useTranslations("mtmAttendance"), locale = useLocale()
  const row = person.row
  const [tone, text] = person.status === "working" ? [FILTER_TONE.working, t("statusWorking", { time: clock(person.since) })]
    : person.status === "paused" ? [FILTER_TONE.paused, t("statusPaused", { time: clock(person.since) })]
    : person.status === "left" ? [FILTER_TONE.left, t("statusLeft", { time: clock(person.since) })]
    : person.status === "absent" ? [FILTER_TONE.absent, t("statusAbsent")]
    : person.status === "away" ? [FILTER_TONE.away, row.dayKind ? attendanceDayKindLabel(row.dayKind, locale) : a("reportApprovedRequest")]
    : person.status === "check" ? ["text-amber-700 dark:text-amber-400", t("statusCheck")]
    : [FILTER_TONE.notYet, row.plannedStartAt ? t("statusNotYet", { time: clock(row.plannedStartAt) }) : t("statusNotYetNoPlan")]
  return <span className={cn("font-medium", tone)} data-testid="attendance-board-status" data-status={person.status}>{text}</span>
}

/** One person's day in a side card: plan and actual, what is off, the marks, requests and corrections. */
function BoardDayCard({ person, today, canManage, clock, grouping, explanations, requests, busy, onAsk }: {
  person: AttendanceBoardPerson; today: string; canManage: boolean; clock: (value: string | null) => string
  grouping: "department" | "team" | "none"
  explanations: readonly AttendanceExplanationDto[] | null; requests: readonly AttendanceReviewItem[] | null
  busy: boolean; onAsk: (key: string) => void
}) {
  const t = useTranslations("personnel"), a = useTranslations("mtmAttendance"), locale = useLocale()
  const [tab, setTab] = useState<Tab>("summary")
  const row = person.row
  const open = row.startedAt !== null && row.completedAt === null
  const overtime = attendanceOvertimeRows([row])[0]
  const overtimeSeconds = overtime && overtime.state !== "UNKNOWN" ? attendanceCountedOvertimeSeconds(overtime) : null
  // Today's explanation is asked about lateness or absence, one per person and day.
  const explainKind = person.status === "absent" ? "ABSENT" : person.late ? "LATE" : null
  const explanation = explanations?.find(item => item.employeeId === person.employeeId && item.date === today)
  const canAsk = explanations !== null && explainKind !== null && !explanation
  const explanationText = !explanation ? t("explainNotAsked") : explanation.status === "REQUESTED" ? t("explainWaiting", { time: explanation.requestedAt ? clock(explanation.requestedAt) : "" })
    : explanation.status === "ANSWERED" ? t("explainAnswered") : t(explanation.status === "ACCEPTED" ? "explainAccepted" : "explainRejected")
  const pending = (requests ?? []).filter(item => item.agentId === person.employeeId)
  const initials = person.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase(locale)
  const where = [person.position, grouping === "department" ? person.departmentName : null, person.teamName].filter(Boolean).join(" · ")
  const tile = (label: string, value: string, sub: string | null) => <div className="rounded-xl border border-border p-3">
    <p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value}</p>{sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
  </div>
  const deviation = (label: string, value: string, accent = false) => <li className="flex items-baseline justify-between gap-2 py-1.5">
    <span className="text-muted-foreground">{label}</span><span className={cn("tabular-nums", accent && "font-semibold text-primary")}>{value}</span>
  </li>
  const lines = (items: string[], empty: string) => items.length ? <ul className="space-y-2 text-sm">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>
  const workedShare = row.expectedWorkSeconds > 0 && row.workedSeconds !== null ? Math.min(100, row.workedSeconds / row.expectedWorkSeconds * 100) : null
  const left = open && row.workedSeconds !== null && row.expectedWorkSeconds > row.workedSeconds ? row.expectedWorkSeconds - row.workedSeconds : null
  const dateLabel = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { day: "numeric", month: "short", timeZone: "UTC" })

  return <SheetContent side="right" closeLabel={t("drawerClose")} data-testid="attendance-board-card" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
    <div className="flex items-start gap-3 px-5 pb-3 pr-14 pt-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold" aria-hidden="true">{initials}</span>
      <div className="min-w-0 flex-1">
        <SheetTitle className="text-base font-semibold">{person.name}</SheetTitle>
        <SheetDescription className="text-xs text-muted-foreground">{where || "—"}</SheetDescription>
        <p className="mt-1 text-sm"><BoardStatus person={person} clock={clock} />
          {person.late ? <> · <span className="font-semibold text-primary">{t("drawerLate")} {minutesText(t, row.lateSeconds ?? 0)}</span></> : null}</p>
      </div>
    </div>
    <div className={cn(MTM_TAB_ROW, "px-3")} role="tablist">
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={cn("text-sm", mtmTabClass(tab === key))} onClick={() => setTab(key)}>{t(label)}</button>)}
    </div>
    <div className="flex-1 space-y-4 px-5 py-4" role="tabpanel" data-testid={`attendance-board-tab-${tab}`}>
      {tab === "summary" ? <>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("drawerPlanFact")}</p>
          <div className="grid grid-cols-2 gap-2">
            {tile(t("drawerPlan"), row.plannedStartAt && row.plannedEndAt ? `${clock(row.plannedStartAt)}–${clock(row.plannedEndAt)}` : "—", null)}
            {tile(t("drawerFact"), row.startedAt ? `${clock(row.startedAt)} – ${row.completedAt ? clock(row.completedAt) : "…"}` : "—", open ? t("drawerDayGoing") : null)}
            {tile(t("drawerWorked"), row.startedAt ? formatAttendanceMinutes(row.workedSeconds) : "—", null)}
            {tile(t("drawerNorm"), row.expectedWorkSeconds > 0 ? formatAttendanceMinutes(row.expectedWorkSeconds) : "—", left !== null ? t("drawerLeft", { time: formatAttendanceMinutes(left) }) : null)}
          </div>
          {workedShare !== null ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${workedShare}%` }} /></div> : null}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("drawerDeviations")}</p>
          <ul className="divide-y divide-border text-sm" data-testid="attendance-board-deviations">
            {deviation(t("drawerLate"), (row.lateSeconds ?? 0) > 0 ? minutesText(t, row.lateSeconds ?? 0) : "—", (row.lateSeconds ?? 0) > 0)}
            {deviation(t("drawerEarly"), (row.earlyLeaveSeconds ?? 0) > 0 ? minutesText(t, row.earlyLeaveSeconds ?? 0) : "—", (row.earlyLeaveSeconds ?? 0) > 0)}
            {deviation(t("drawerBreaks"), row.startedAt ? formatAttendanceMinutes(row.pausedSeconds) : "—")}
            {deviation(t("drawerOvertime"), overtimeSeconds ? formatAttendanceMinutes(overtimeSeconds) : "—")}
          </ul>
        </div>
        {explanations !== null && explainKind ? <p className="rounded-xl border border-border px-3 py-2.5 text-sm" data-testid="attendance-board-explanation">
          <span className="text-muted-foreground">{t(explainKind === "LATE" ? "explainForLate" : "explainForAbsent")}:</span> {explanationText}
        </p> : null}
      </> : tab === "marks" ? lines(attendanceJournalEntries(row, locale, a).map(entry => `${entry.phoneAt ? clock(entry.phoneAt) : ""} ${entry.description}`.trim()), t("drawerNoMarks"))
      : tab === "requests" ? <>
        {lines(attendanceApprovedLines(row, locale, a), t("drawerNoRequests"))}
        {pending.length ? <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("drawerPending")}</p>
          {lines(pending.map(item => `${item.details.kind === "TIME_CORRECTION" ? a("requestsTimeCorrection") : attendanceDayKindLabel(item.details.dayKind, locale)} · ${dateLabel(item.startDate)}${item.endDate !== item.startDate ? ` – ${dateLabel(item.endDate)}` : ""}`), "")}</div> : null}
      </> : lines(attendanceCorrectionLines(row, locale, a), t("drawerNoCorrections"))}
    </div>
    <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3.5">
      {canAsk ? <Button type="button" className="min-h-10 rounded-full" disabled={busy} data-testid="attendance-board-ask"
        onClick={() => onAsk(attendanceExplanationKey(person.employeeId, today, explainKind!))}><MessageCircleQuestionMark className="mr-2 h-4 w-4" aria-hidden="true" />{t("drawerAsk")}</Button> : null}
      <Button asChild variant="outline" className="min-h-10 rounded-full"><Link prefetch={false} href={`/mtm/attendance/timesheet?${new URLSearchParams({ date: today, employeeId: person.employeeId })}`}>{t("drawerOpenDay")}</Link></Button>
      {canManage ? <Button asChild variant="outline" className="min-h-10 rounded-full"><Link prefetch={false} href={`/mtm/attendance/people/${encodeURIComponent(person.employeeId)}`}>{t("drawerEmployee")}<ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Link></Button> : null}
    </div>
  </SheetContent>
}
