"use client"

import { useLocale, useTranslations } from "next-intl"
import { HintValue } from "@/components/hint"
import { formatTime } from "@/lib/format-date"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { formatAttendanceDuration } from "@/lib/mtm/attendance-presentation"
import { attendanceDayPlanFact } from "@/lib/mtm/attendance-plan-fact"

/**
 * «Plan / fact» of one employee's day (owner, 2026-11-01, after the HRSS clip):
 * by the schedule and in fact, worked against the norm, then each deviation.
 * Shared by the timesheet's day popover and Personnel → Today, so both say the
 * same thing about the same day.
 */
/** `lunchNote`: off where the day's notes already name the automatic lunch (the timesheet popover). */
export function MtmAttendanceDayPlanFact({ row, lunchNote = true }: { row: MtmAttendanceReportRow; lunchNote?: boolean }) {
  const p = useTranslations("personnel"), locale = useLocale()
  const day = attendanceDayPlanFact(row)
  const clock = (value: string | null) => value ? formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: row.timezone }) : "—"
  const minutes = (seconds: number | null) => seconds === null ? "—" : seconds > 0 ? formatAttendanceDuration(seconds) : "—"
  const box = "rounded-xl border bg-background px-3 py-2"
  const caption = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
  const value = "mt-0.5 text-base font-bold tabular-nums"
  const deviations = [
    { key: "late", label: p("planFactLate"), hint: p("planFactLateHint"), seconds: day.lateSeconds, warn: true },
    { key: "early", label: p("planFactEarly"), hint: p("planFactEarlyHint"), seconds: day.earlyLeaveSeconds, warn: true },
    { key: "breaks", label: p("planFactBreaks"), hint: p("planFactBreaksHint"), seconds: day.pausedSeconds, warn: false },
    { key: "overtime", label: p("planFactOvertime"), hint: p("planFactOvertimeHint"), seconds: day.overtimeSeconds, warn: false },
  ]
  return <div className="space-y-3" data-testid="attendance-plan-fact">
    <div className="grid grid-cols-2 gap-2">
      <div className={box} data-testid="attendance-plan-fact-plan"><p className={caption}>{p("planFactSchedule")}</p>
        <p className={value}>{day.plan ? `${clock(day.plan.start)}–${clock(day.plan.end)}` : p("planFactDayOff")}</p></div>
      <div className={box} data-testid="attendance-plan-fact-actual"><p className={caption}>{p("planFactActual")}</p>
        <p className={value}>{day.actual.start ? day.actual.open ? clock(day.actual.start) : `${clock(day.actual.start)}–${clock(day.actual.end)}` : "—"}</p>
        {day.actual.open ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{p("planFactStillThere")}</p> : null}</div>
      <div className={`${box} ${day.short ? "border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10" : ""}`} data-testid="attendance-plan-fact-worked" data-short={day.short || undefined}>
        <p className={caption}>{p("planFactWorked")}</p><p className={`${value} ${day.short ? "text-amber-800 dark:text-amber-300" : ""}`}>{formatAttendanceDuration(day.workedSeconds)}</p></div>
      <div className={box} data-testid="attendance-plan-fact-norm"><p className={caption}><HintValue text={p("planFactNormHint")}>{p("planFactNorm")}</HintValue></p>
        <p className={value}>{day.normSeconds > 0 ? formatAttendanceDuration(day.normSeconds) : "—"}</p></div>
    </div>
    <div>
      <p className={caption}>{p("planFactDeviations")}</p>
      <dl className="mt-1 divide-y divide-border text-sm">{deviations.map(item => <div key={item.key} className="flex items-center justify-between gap-3 py-1.5" data-testid={`attendance-plan-fact-${item.key}`}>
        <dt className="text-muted-foreground"><HintValue text={item.hint}>{item.label}</HintValue></dt>
        <dd className={`font-semibold tabular-nums ${item.warn && (item.seconds ?? 0) > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{minutes(item.seconds)}</dd>
      </div>)}</dl>
      {lunchNote && day.lunchAutoSeconds > 0 ? <p className="mt-1 text-xs text-muted-foreground" data-testid="attendance-plan-fact-lunch">{p("planFactLunchAuto", { time: formatAttendanceDuration(day.lunchAutoSeconds) })}</p> : null}
    </div>
  </div>
}
