"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate, formatTime } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { MTM_TAB_ROW, mtmTabClass } from "@/components/mtm/calm-classes"
import { ATTENDANCE_EXPLANATION_LOOKBACK_DAYS, type AttendanceExplanationDto } from "@/lib/mtm/attendance-explanation-contract"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"

type Filter = "waiting" | "asked" | "all"
const FILTERS: readonly Filter[] = ["waiting", "asked", "all"]

/** What the list shows first: an answer that waits for a decision, then the newest. */
const ORDER: Record<AttendanceExplanationDto["status"], number> = { ANSWERED: 0, REQUESTED: 1, ACCEPTED: 2, REJECTED: 2 }

export function attendanceExplanationsShown(items: readonly AttendanceExplanationDto[], filter: Filter): AttendanceExplanationDto[] {
  const kept = items.filter(item => filter === "all" || (filter === "waiting" ? item.status === "ANSWERED" : item.status === "REQUESTED"))
  return [...kept].sort((a, b) => ORDER[a.status] - ORDER[b.status]
    || (b.answeredAt ?? b.requestedAt ?? b.date).localeCompare(a.answeredAt ?? a.requestedAt ?? a.date))
}

/**
 * Personnel → Explanations (owner, 2026-11-20: «нет отдельного блока izahatlar»): every
 * explanation of the last month in one place — asked by HR or written by the employee on
 * their own — with «Accept» / «Reject» on the ones answered. Today keeps only today's.
 */
export function MtmAttendanceExplanations() {
  const t = useTranslations("personnel")
  const locale = useLocale()
  const [items, setItems] = useState<AttendanceExplanationDto[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>("waiting")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    const today = currentDateKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
    // A day ahead: the browser's calendar may be behind the company's.
    const query = new URLSearchParams({ from: addDateKeyDays(today, -ATTENDANCE_EXPLANATION_LOOKBACK_DAYS), to: addDateKeyDays(today, 1) })
    try {
      const response = await fetch(`/api/v1/mtm/attendance/explanations?${query}`, { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.items)) { setFailed(true); return }
      setItems(body.data.items)
    } catch { setFailed(true) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function decide(item: AttendanceExplanationDto, decision: "ACCEPTED" | "REJECTED") {
    if (busy) return
    setBusy(item.id); setMessage(null)
    try {
      const response = await fetch(`/api/v1/mtm/attendance/explanations/${encodeURIComponent(item.id)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.success === true) { setMessage(t("decisionSaved")); await load() }
      else setMessage(t(response.status === 409 ? "decisionChanged" : "explainFailed"))
    } catch { setMessage(t("explainFailed")) }
    finally { setBusy(null) }
  }

  const dateLabel = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { day: "numeric", month: "long", timeZone: "UTC" })
  const shown = items ? attendanceExplanationsShown(items, filter) : []
  const count = (value: Filter) => items ? attendanceExplanationsShown(items, value).length : 0

  return (
    <div className="space-y-5" data-testid="attendance-explanations">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("explanationsTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("explanationsHint")}</p>
      </div>
      <div className={MTM_TAB_ROW} role="tablist">
        {FILTERS.map(value => (
          <button key={value} type="button" role="tab" aria-selected={filter === value}
            className={`${mtmTabClass(filter === value)} inline-flex items-center text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring`}
            onClick={() => setFilter(value)} data-testid={`attendance-explanations-filter-${value}`}>
            {t(`explanationsFilter_${value}`)} · {count(value)}
          </button>
        ))}
      </div>
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      {failed ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{t("explainFailed")}</p>
        <Button variant="outline" className="min-h-11" onClick={() => void load()}>{t("explanationsReload")}</Button></div>
        : items === null ? <p className="text-sm text-muted-foreground">{t("explanationsLoading")}</p>
        : shown.length === 0 ? <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground" data-testid="attendance-explanations-empty">{t(`explanationsEmpty_${filter}`)}</p>
        : <ul className="divide-y rounded-xl border bg-card">
          {shown.map(item => (
            <li key={item.id} className="space-y-2 p-4" data-testid="attendance-explanation-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.employeeName}</p>
                  <p className="text-sm text-muted-foreground">
                    {dateLabel(item.date)} · {item.kind === "LATE"
                      ? (item.lateMinutes ? t("explanationsLate", { minutes: item.lateMinutes }) : t("explainForLate"))
                      : t("explainForAbsent")}
                    {" · "}{item.requestedByName ? t("explanationsAskedBy", { name: item.requestedByName }) : t("explanationsUnasked")}
                  </p>
                </div>
                <span className={`text-xs font-medium ${item.status === "ANSWERED" ? "text-primary" : item.status === "REQUESTED" ? "text-amber-700 dark:text-amber-400"
                  : item.status === "ACCEPTED" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-300"}`}>
                  {item.status === "ANSWERED" ? t("explanationsStatusAnswered")
                    : item.status === "REQUESTED" ? t("explainWaiting", { time: item.requestedAt ? formatTime(item.requestedAt, locale, { hour: "2-digit", minute: "2-digit" }) : "" })
                    : t(item.status === "ACCEPTED" ? "explainAccepted" : "explainRejected")}
                </span>
              </div>
              {item.answer ? <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" data-testid="attendance-explanation-answer">«{item.answer}»</p> : null}
              {item.status === "ANSWERED" ? <div className="flex flex-wrap gap-2">
                <Button size="sm" className="min-h-10" disabled={busy !== null} onClick={() => void decide(item, "ACCEPTED")}>{t("explainAccept")}</Button>
                <Button size="sm" variant="outline" className="min-h-10" disabled={busy !== null} onClick={() => void decide(item, "REJECTED")}>{t("explainReject")}</Button>
              </div> : null}
            </li>
          ))}
        </ul>}
    </div>
  )
}
