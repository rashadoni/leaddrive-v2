"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { AttendanceReportTable, AttendanceReportTotals } from "@/components/mtm/attendance-report-table"
import { attendanceMonthLabel } from "@/components/mtm/attendance-closed-month"
import { formatDate } from "@/lib/format-date"
import type { AttendanceMonthN1tState } from "@/lib/mtm/attendance-month-contract"

const endpoint = "/api/v1/mtm/attendance/months"
type Command = { requestId: string; month: string; agentIds: string[]; preview: { hash: string; asOf: string } }
/** Refusals that mean "look again": the page reloads the month and says why. */
const AGAIN: Record<string, string> = {
  MTM_ATTENDANCE_MONTH_ALREADY_CLOSED: "monthCloseAlreadyClosed", MTM_ATTENDANCE_MONTH_SOURCE_CLOSED: "monthCloseAlreadyClosed",
  MTM_ATTENDANCE_MONTH_CHANGED: "monthCloseN1tChanged", MTM_ATTENDANCE_MONTH_PREVIEW_EXPIRED: "monthCloseN1tChanged",
  MTM_ATTENDANCE_MONTH_UNRESOLVED: "monthCloseN1tChanged", MTM_ATTENDANCE_MONTH_INVALID: "monthCloseN1tChanged",
}
const BLOCKER_TEXT: Record<string, string> = { OPEN: "reportOpenDay", MISSING_FINISH: "reportMissingFinish", INVALID_FACTS: "reportInvalidFacts", UPCOMING: "reportUpcoming" }

function isState(value: unknown): value is AttendanceMonthN1tState {
  const state = value as AttendanceMonthN1tState | null
  return !!state && typeof state.month === "string" && Array.isArray(state.legacy) && Array.isArray(state.candidates) && Array.isArray(state.blockers)
    && (state.closed === null || (typeof state.closed === "object" && Array.isArray(state.closed.table?.rows) && Array.isArray(state.closed.closes)))
    && (state.preview === null || Array.isArray(state.preview?.rows))
}

/**
 * The month behind Personnel → Reports → N-1t (owner, 2026-10-20: «Bu tabeli
 * bağla» on the N-1t itself, one press, as in the clip). `month` is null for a
 * month that is not over: nothing is read and nothing can be closed.
 *
 * The screen shows one N-1t for the whole month; a press sends it as the exact
 * snapshots of its blocks — one close per at most 100 people, in the order of
 * the form's lines — each with its own request id. A lost answer keeps those
 * bodies, so «Bağlamanın nəticəsini yoxla» repeats them and the server answers
 * from its receipt instead of closing twice.
 */
export function useAttendanceN1tMonth(month: string | null, onAccessLost: () => void) {
  const locale = useLocale() as "az" | "ru" | "en"
  const [state, setState] = useState<AttendanceMonthN1tState | null>(null)
  const [loading, setLoading] = useState(false), [failedFor, setFailedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<Command[] | null>(null), [message, setMessage] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null), writing = useRef(false), mounted = useRef(true)
  const lost = useRef(onAccessLost)
  useEffect(() => { lost.current = onAccessLost }, [onAccessLost])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort() } }, [])

  const reload = useCallback(async () => {
    request.current?.abort()
    if (!month) { setState(null); setLoading(false); setFailedFor(null); return }
    const controller = new AbortController(); request.current = controller
    setLoading(true); setFailedFor(null)
    try {
      const response = await fetch(`${endpoint}/n1t?${new URLSearchParams({ month, locale })}`, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted || !mounted.current) return
      if ([401, 403, 404].includes(response.status)) { setState(null); lost.current(); return }
      if (!response.ok || body?.success !== true || !isState(body.data) || body.data.month !== month) throw new Error("INVALID_MONTH")
      setState(body.data)
    } catch { if (!controller.signal.aborted && mounted.current) { setState(null); setFailedFor(month) } }
    finally { if (!controller.signal.aborted && mounted.current) setLoading(false) }
  }, [month, locale])
  // Another month or language: forget the previous answer before reading the next.
  useEffect(() => { setState(null); setMessage(null); setPending(null); void reload() }, [reload])

  const send = useCallback(async (commands: Command[]) => {
    if (writing.current || !commands.length) return
    writing.current = true; setBusy(true); setPending(commands); setMessage(null)
    try {
      for (const command of commands) {
        let response: Response
        try { response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }) }
        catch { if (mounted.current) setMessage("monthCloseUnknown"); return }
        const body = await response.json().catch(() => null)
        if (!mounted.current) return
        if ([401, 403, 404].includes(response.status)) { setPending(null); setState(null); lost.current(); return }
        if (response.ok && body?.success === true && typeof body.data?.id === "string") continue
        const again = typeof body?.code === "string" ? AGAIN[body.code] : undefined
        if (again) { setPending(null); await reload(); if (mounted.current) setMessage(again); return }
        setMessage("monthCloseUnknown"); return
      }
      // Closed: the frozen card replaces the button straight away, without choosing anything.
      setPending(null); await reload(); if (mounted.current) setMessage("monthCloseDone")
    } finally { writing.current = false; if (mounted.current) setBusy(false) }
  }, [reload])

  const close = useCallback(() => {
    if (!state?.candidates.length || state.blockers.length) return
    void send(state.candidates.map(candidate => ({ requestId: crypto.randomUUID(), month: state.month, agentIds: candidate.agentIds, preview: { hash: candidate.hash, asOf: candidate.asOf } })))
  }, [state, send])
  const retry = useCallback(() => { if (pending) void send(pending) }, [pending, send])
  // Settled: the answer (or the failure) is about this very month. Until then a past N-1t waits.
  const current = state?.month === month ? state : null
  const settled = month === null || current !== null || failedFor === month
  return { state: current, loading, failed: failedFor !== null && failedFor === month, settled, busy, pending, message, close, retry }
}
export type AttendanceN1tMonth = ReturnType<typeof useAttendanceN1tMonth>

/**
 * What «Bu tabeli bağla» will freeze — one N-1t for everyone, exactly as it
 * will be kept, however many blocks of 100 carry it — and, under it, the press
 * itself with the sentence that says what happens; or, when a day still blocks
 * the month, the list of those days instead of the button (an unfinished,
 * open, unclosed or broken day is never frozen).
 */
export function AttendanceN1tClosePanel({ month }: { month: AttendanceN1tMonth }) {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale() as "az" | "ru" | "en"
  const state = month.state
  if (!state || !state.candidates.length || !state.preview) return null
  const label = attendanceMonthLabel(state.month, locale)
  const count = state.candidates.reduce((total, candidate) => total + candidate.agentIds.length, 0)
  const day = (date: string) => formatDate(`${date}T12:00:00.000Z`, locale, { dateStyle: "medium", timeZone: "UTC" })
  return <div className="space-y-4" data-testid="attendance-n1t-close">
    <div className="rounded-2xl border bg-card p-4" data-testid="attendance-n1t-candidate">
      <AttendanceReportTable table={state.preview} />
      <AttendanceReportTotals period={state.preview.details[0] ?? null} totals={state.preview.totals} />
    </div>
    <Card className="space-y-4 p-4 sm:p-6">
      {state.blockers.length ? <div className="space-y-2 rounded-xl border border-l-4 border-zinc-200 border-l-amber-500 bg-card p-4 text-sm dark:border-zinc-700 dark:border-l-amber-500" role="alert" data-testid="attendance-n1t-blockers">
        <p className="font-medium">{t("monthCloseN1tBlocked")}</p>
        <ul className="space-y-1">{state.blockers.map(blocker => <li key={`${blocker.employeeId}:${blocker.date}`} className="flex flex-wrap items-center gap-x-2" data-testid="attendance-n1t-blocker">
          <span>{blocker.employeeName || "—"} · {day(blocker.date)} · <span className="text-amber-700 dark:text-amber-400">{t(BLOCKER_TEXT[blocker.kind] ?? "reportInvalidFacts")}</span></span>
          <Hint text={t("monthCloseBlockerOpenDayHint")}><Link prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline"
            href={`/mtm/attendance/timesheet?${new URLSearchParams({ date: blocker.date, employeeId: blocker.employeeId })}`}>{t("monthCloseBlockerOpenDay")}</Link></Hint>
        </li>)}</ul>
        {state.moreBlockers > 0 ? <p className="text-muted-foreground">{t("monthCloseBlockersMore", { count: state.moreBlockers })}</p> : null}
      </div> : <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground" data-testid="attendance-n1t-will-freeze">{t("monthCloseN1tWillFreeze", { month: label, count })}</p>
        <Hint text={t("monthCloseActionHint")}>
          <Button type="button" className="min-h-11" disabled={month.busy || !!month.pending} onClick={month.close} data-testid="attendance-n1t-close-button">
            <Lock className="mr-1.5 h-4 w-4" aria-hidden="true" />{t(month.busy ? "monthCloseClosing" : "monthCloseAction")}</Button>
        </Hint>
      </div>}
      {state.ownOpen ? <p className="text-sm text-muted-foreground">{t("monthCloseOwn")}</p> : null}
      {state.notIncluded > 0 ? <p className="text-sm text-muted-foreground">{t("monthCloseN1tNotIncluded", { count: state.notIncluded })}</p> : null}
    </Card>
  </div>
}

/** Why a finished open month has no button for this viewer. */
export function AttendanceN1tNotes({ month }: { month: AttendanceN1tMonth }) {
  const t = useTranslations("mtmAttendance")
  const state = month.state
  if (!state || state.candidates.length || !state.finished || state.open === 0) return null
  return <div className="space-y-1 text-sm text-muted-foreground" data-testid="attendance-n1t-notes">
    {!state.canClose ? <p>{t("monthCloseN1tReadOnly")}</p> : null}
    {state.canClose && state.ownOpen ? <p>{t("monthCloseOwn")}</p> : null}
    {state.canClose && state.notIncluded > 0 ? <p>{t("monthCloseN1tNotIncluded", { count: state.notIncluded })}</p> : null}
  </div>
}

/** The answer to the last press, and the way to repeat a press whose answer was lost. */
export function AttendanceN1tMessages({ month }: { month: AttendanceN1tMonth }) {
  const t = useTranslations("mtmAttendance")
  if (!month.message) return null
  const failure = month.message === "monthCloseUnknown"
  return <div className="space-y-2">
    <p role={failure ? "alert" : "status"} className={`text-sm ${failure ? "text-destructive" : "text-muted-foreground"}`} data-testid="attendance-n1t-message">{t(month.message)}</p>
    {failure && month.pending ? <Hint text={t("monthCloseRetryHint")}><Button type="button" variant="outline" className="min-h-11" disabled={month.busy} onClick={month.retry}>{t("monthCloseRetry")}</Button></Hint> : null}
  </div>
}
