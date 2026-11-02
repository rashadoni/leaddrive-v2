"use client"

import { Hint } from "@/components/hint"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { mtmActivityEntityKey, mtmActivityEntityText } from "@/lib/mtm/activity-entity"
import { ShieldAlert, Download, ChevronRight, Lock } from "lucide-react"
import { MtmPageHeader } from "@/components/mtm/page-header"
import { MtmFilterBar, MtmFilterSelect, MtmResultLine } from "@/components/mtm/filter-bar"
import { Button } from "@/components/ui/button"
import {
  actionMeta, actionLabelKey, TONE_CLASSES, activityRowHref, kindKey,
  relativeTime, dayKeyOf, dayLabel, activityActorName, activityDataSummary, type ActivitySubject,
} from "@/lib/mtm/activity-actions"
import { mtmAccessErrorKey, type MtmAccessErrorKey } from "@/lib/mtm/access-error"
import { formatDate, formatTime } from "@/lib/format-date"
import { dateInputValueInTimezone } from "@/lib/timezone"

type Period = "today" | "7d" | "30d" | "all"
const PERIODS: Period[] = ["today", "7d", "30d", "all"]
const PERIOD_KEY: Record<Period, string> = { today: "periodToday", "7d": "period7d", "30d": "period30d", all: "periodAll" }
const PAGE_SIZE = 50

interface AgentLite { id: string; name: string }

export default function MtmActivityPage() {
  const t = useTranslations("mtmActivity")
  const tf = useTranslations("mtmFilters")
  const locale = useLocale()
  const router = useRouter()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  // typed helper so the i18n interpolation ({n}, {shown}) satisfies the registry
  const tt = (k: string, v?: Record<string, unknown>) => t(k, v as any) as string

  const [logs, setLogs] = useState<any[]>([])
  const [kpi, setKpi] = useState({ totalActivities: 0, totalCheckIns: 0, totalCheckOuts: 0, totalPhotos: 0, totalViolations: 0 })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [agents, setAgents] = useState<AgentLite[]>([])
  const [errorKey, setErrorKey] = useState<MtmAccessErrorKey | null>(null)
  // Day headers follow the organization's calendar, the same one the period
  // filter uses on the server — not the browser's.
  const [timezone, setTimezone] = useState<string | null>(null)

  // Opens on today (owner 2026-10-31: seven days were 58 rows, 5.5 screens).
  // An empty today widens itself to seven days once and says so.
  const [period, setPeriod] = useState<Period>("today")
  const [periodChosen, setPeriodChosen] = useState(false)
  const [widenedFrom, setWidenedFrom] = useState<Period | null>(null)
  const [agentId, setAgentId] = useState("")
  const [type, setType] = useState("")
  const [violations, setViolations] = useState(false)

  const headers: Record<string, string> = {}
  if (orgId) headers["x-organization-id"] = String(orgId)

  // Agent list for the filter dropdown (once per org).
  useEffect(() => {
    if (!orgId) return
    fetch(`/api/v1/mtm/agents`, { headers })
      .then(r => r.ok ? r.json() : null)
      // The roster answers { data: { agents } }; the old reader expected an
      // array and the employee filter stayed empty.
      .then(j => { const arr = j?.data?.agents ?? j?.data ?? j?.agents; if (Array.isArray(arr)) setAgents(arr.map((a: any) => ({ id: a.id, name: a.name }))) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const load = useCallback(async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true); else setLoading(true)
    try {
      const qs = new URLSearchParams({ period, page: String(nextPage), limit: String(PAGE_SIZE) })
      if (agentId) qs.set("agentId", agentId)
      if (violations) qs.set("violations", "1")
      else if (type) qs.set("type", type)
      const res = await fetch(`/api/v1/mtm/activity?${qs}`, { headers })
      const r = await res.json().catch(() => null)
      // #204: never paste the server's English sentence; the code decides
      // which localized explanation the page shows in place of the feed.
      if (!res.ok || !r?.success) { setErrorKey(mtmAccessErrorKey(res.status, r)); return }
      setErrorKey(null)
      if (typeof r.data.timezone === "string") setTimezone(r.data.timezone)
      setKpi(r.data.kpi)
      setTotal(r.data.total)
      setPage(nextPage)
      setLogs(prev => append ? [...prev, ...r.data.logs] : r.data.logs)
    } catch {
      setErrorKey("loadFailed")
    } finally { setLoading(false); setLoadingMore(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, period, agentId, type, violations])

  // Reset to page 1 whenever a filter changes.
  useEffect(() => { if (orgId) load(1, false) }, [orgId, period, agentId, type, violations, load])

  useEffect(() => {
    if (loading || errorKey || periodChosen || widenedFrom || period !== "today") return
    if (total !== 0 || agentId || type || violations) return
    setWidenedFrom("today")
    setPeriod("7d")
  }, [loading, errorKey, periodChosen, widenedFrom, period, total, agentId, type, violations])

  const toggleViolations = () => { setViolations(v => !v); setType("") }

  const exportCsv = () => {
    if (logs.length === 0) { toast.info(t("exportEmpty")); return }
    const head = [t("colTime"), t("colWho"), t("colAction"), t("colSubject"), t("colDetails")]
    const rows = logs.map(l => [
      new Date(l.createdAt).toISOString(),
      activityActorName(l, t),
      t(actionLabelKey(l.action)),
      subjectOf(l) ?? "",
      detailsOf(l).label,
    ])
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
    const csv = [head, ...rows].map(r => r.map(esc).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url; a.download = `activity-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // C12: строка читалась как «mtm_pharmacy_promotion_execution · 4f2a9c» —
  // имя таблицы и шесть символов идентификатора. Ни то, ни другое не язык, а
  // по обрывку id ничего и не найти. Полный id уехал в подсказку.
  /**
   * Owner, 2026-11-01: «журнал активности — мало информации». A row reads as a
   * sentence: who did what, to whom or what, with the facts of the change.
   * «Kimə / nəyə» is the client the API resolved, or the employee the row is
   * about when somebody else acted on him.
   */
  const subjectOf = (l: any): string | null => {
    const subject = l.subject as ActivitySubject | undefined
    if (subject?.customerName) return subject.customerName
    const about = typeof l.agent?.name === "string" && l.agent.name.trim() ? l.agent.name.trim() : null
    return about && about !== activityActorName(l, t) ? about : null
  }
  // C12: строка читалась как «mtm_pharmacy_promotion_execution · 4f2a9c» —
  // имя таблицы и шесть символов идентификатора. Полный id — в подсказке.
  // 2026-11-01: «Запись» в каждой строке тоже ничего не говорила — нет фактов,
  // нет и подписи; известный вид записи («Визит», «Маршрут») остаётся.
  const detailsOf = (l: any): { label: string; title: string | null } => {
    const summary = activityDataSummary(l, tt, locale)
    if (summary) return { label: summary, title: l.entityId ?? null }
    const k = kindKey(l.metadataKind)
    if (k) return { label: t(k), title: null }
    if (mtmActivityEntityKey(l.entity)) return mtmActivityEntityText(l, t)
    return { label: "", title: null }
  }
  // formatTime, not formatDate: in Azerbaijani formatDate draws the date
  // alone and drops the hours — the column stood empty on prod (2026-11-01).
  const timeOf = (iso: string) => formatTime(iso, locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timezone ? { timeZone: timezone } : {}) })

  return (
    <div className="space-y-4">
      <MtmPageHeader
        title={t("title")}
        description={t("description")}
        help="mtm-activity"
        actions={(
          <Hint text={t("hint.export")}>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1" /> {t("export")}
            </Button>
          </Hint>
        )}
      />

      {/* Owner 2026-09-27: filters in one row. Five stat cards stood above a
          card of period buttons and two selects; the «Violations» card was a
          hidden toggle. Now it is a visible pill, the counts one line. */}
      <div className="space-y-2">
        <MtmFilterBar testId="mtm-activity-filters">
          <MtmFilterSelect testId="mtm-activity-period" label={tf("period")} value={period} emptyValue="today" showValue allLabel={t(PERIOD_KEY.today)}
            options={PERIODS.map((p) => ({ value: p, label: t(PERIOD_KEY[p]) }))}
            onChange={(value) => { setPeriodChosen(true); setWidenedFrom(null); setPeriod(value as Period) }} />
          <MtmFilterSelect testId="mtm-activity-agent" label={tf("employee")} value={agentId} allLabel={t("allAgents")}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
            onChange={setAgentId} />
          <MtmFilterSelect testId="mtm-activity-type" label={tf("type")} value={type} allLabel={t("all")}
            options={[
              { value: "CHECK_IN", label: t("checkIn") },
              { value: "CHECK_IN_FORCED", label: t("forcedCheckIn") },
              { value: "CHECK_OUT", label: t("checkOut") },
              { value: "PHOTO", label: t("photoUpload") },
              { value: "ROUTE", label: t("typeRoute") },
              { value: "TASK", label: t("tasks") },
            ]}
            onChange={(value) => { setType(value); setViolations(false) }} />
          <Hint text={t("hint.violations")}>
            <button type="button" data-testid="mtm-activity-violations" aria-pressed={violations} onClick={toggleViolations}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${violations ? "border-red-400 text-red-700 dark:border-red-500/50 dark:text-red-300" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              {t("violations")} ({kpi.totalViolations})
            </button>
          </Hint>
        </MtmFilterBar>
        {widenedFrom ? (
          <p role="status" data-testid="mtm-activity-widened" className="text-sm text-muted-foreground">
            {t("widenedNotice", { from: t(PERIOD_KEY[widenedFrom]), to: t(PERIOD_KEY[period]) })}
          </p>
        ) : null}
        <MtmResultLine aside={t("statsPeriodNote")}>
          <span className="font-medium text-foreground">{t("totalActivity")}: {kpi.totalActivities}</span> · {t("checkIn")}: {kpi.totalCheckIns} · {t("checkOut")}: {kpi.totalCheckOuts} · {t("photoUpload")}: {kpi.totalPhotos}
        </MtmResultLine>
      </div>

      {errorKey ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 p-4 text-sm sm:flex-row sm:items-center">
          <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{tt(`accessError.${errorKey}`)}</p>
          {errorKey === "loadFailed" && (
            <Button variant="outline" size="sm" onClick={() => load(1, false)}>{tt("accessError.retry")}</Button>
          )}
        </div>
      ) : loading ? (
        <div className="animate-pulse space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}</div>
      ) : logs.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground border border-border rounded-lg bg-card">
          {t("noActivity")}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {renderTimeline()}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
            <span>{t("showingOf", { shown: logs.length, total })}</span>
            {logs.length < total && (
              <Button size="sm" variant="outline" onClick={() => load(page + 1, true)} disabled={loadingMore}>
                {t("loadMore")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )

  function renderTimeline() {
    const out: ReactNode[] = []
    let lastDay = ""
    const now = new Date()
    const todayKey = timezone ? dateInputValueInTimezone(now, timezone) : null
    const yesterdayKey = timezone ? dateInputValueInTimezone(new Date(now.getTime() - 86_400_000), timezone) : null
    for (const log of logs) {
      const dk = timezone ? dateInputValueInTimezone(log.createdAt, timezone) : dayKeyOf(log.createdAt)
      if (dk !== lastDay) {
        lastDay = dk
        const label = !timezone
          ? dayLabel(log.createdAt, tt, locale)
          : dk === todayKey ? t("dayToday")
          : dk === yesterdayKey ? t("dayYesterday")
          : formatDate(log.createdAt, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })
        out.push(
          <div key={`d-${dk}`} className="px-4 py-1.5 bg-muted/50 text-xs font-medium text-muted-foreground">
            {label}
          </div>
        )
      }
      out.push(<ActivityRow key={log.id} log={log} />)
    }
    return (
      <div>
        <div aria-hidden="true" className={`hidden border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground sm:grid ${ROW_GRID}`}>
          <span>{t("colTime")}</span><span>{t("colWho")}</span><span>{t("colAction")}</span><span>{t("colSubject")}</span><span>{t("colDetails")}</span>
        </div>
        {out}
      </div>
    )
  }

  function ActivityRow({ log }: { log: any }) {
    const meta = actionMeta(log.action)
    const Icon = meta.icon
    const href = activityRowHref(log)
    const clickable = !!href
    const subject = subjectOf(log)
    const details = detailsOf(log)
    return (
      <div
        onClick={clickable ? () => router.push(href!) : undefined}
        data-testid="mtm-activity-row"
        className={`grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5 last:border-0 sm:min-h-12 ${ROW_GRID} ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
      >
        <span className="row-span-4 self-start text-sm tabular-nums text-muted-foreground sm:row-span-1 sm:self-center" title={relativeTime(log.createdAt, tt)} data-testid="mtm-activity-time">{timeOf(log.createdAt)}</span>
        <span className="truncate text-sm font-medium" data-testid="mtm-activity-who">{activityActorName(log, t)}</span>
        {/* The words of the action keep their colour; no pill under them. */}
        <span title={t(actionLabelKey(log.action))} className={`col-start-2 inline-flex min-w-0 items-center gap-1.5 text-sm sm:col-start-auto ${TONE_CLASSES[meta.tone]}`} data-testid="mtm-activity-action">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t(actionLabelKey(log.action))}</span>
        </span>
        <span className={`col-start-2 truncate text-sm sm:col-start-auto ${subject ? "text-foreground" : "hidden text-muted-foreground sm:block"}`} data-testid="mtm-activity-subject">{subject ?? "—"}</span>
        <span className="col-start-2 flex min-w-0 items-center gap-2 sm:col-start-auto" data-testid="mtm-activity-details">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={details.title ?? undefined}>{details.label}</span>
          {clickable && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </span>
      </div>
    )
  }
}

/** The journal's columns: time, who, what, to whom or what, the facts. */
const ROW_GRID = "sm:grid-cols-[3.5rem_minmax(0,9rem)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.1fr)]"
