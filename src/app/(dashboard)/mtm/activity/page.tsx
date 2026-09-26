"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { mtmActivityEntityText } from "@/lib/mtm/activity-entity"
import { Activity, LogIn, LogOut, Camera, ShieldAlert, Download, ChevronRight, Lock } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { ColorStatCard } from "@/components/color-stat-card"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { HelpButton } from "@/components/help/help-button"
import {
  actionMeta, actionLabelKey, TONE_CLASSES, activityRowHref, kindKey,
  relativeTime, dayKeyOf, dayLabel, activityActorName, activityDataSummary, type ActivitySubject,
} from "@/lib/mtm/activity-actions"
import { mtmAccessErrorKey, type MtmAccessErrorKey } from "@/lib/mtm/access-error"
import { formatDate } from "@/lib/format-date"
import { dateInputValueInTimezone } from "@/lib/timezone"

type Period = "today" | "7d" | "30d" | "all"
const PERIODS: Period[] = ["today", "7d", "30d", "all"]
const PERIOD_KEY: Record<Period, string> = { today: "periodToday", "7d": "period7d", "30d": "period30d", all: "periodAll" }
const PAGE_SIZE = 50

interface AgentLite { id: string; name: string }

export default function MtmActivityPage() {
  const t = useTranslations("mtmActivity")
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

  const [period, setPeriod] = useState<Period>("7d")
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

  const toggleViolations = () => { setViolations(v => !v); setType("") }

  const exportCsv = () => {
    if (logs.length === 0) { toast.info(t("exportEmpty")); return }
    const head = [t("colTime"), t("colAgent"), t("colAction"), t("colDetails")]
    const rows = logs.map(l => [
      new Date(l.createdAt).toISOString(),
      activityActorName(l, t),
      t(actionLabelKey(l.action)),
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
  const detailsOf = (l: any): { label: string; title: string | null } => {
    // 2026-09-14: the row used to read «Əməliyyat · Sistem · Əməkdaş». What a
    // manager needs is WHERE — the customer's name, resolved by the API.
    const subject = l.subject as ActivitySubject | undefined
    if (subject?.customerName) return { label: subject.customerName, title: l.entityId ?? null }
    // Audit 2026-09-21: «Запись» said nothing about a broadcast or a bulk
    // assignment; the row's own facts do.
    const summary = activityDataSummary(l, tt)
    if (summary) return { label: summary, title: l.entityId ?? null }
    const k = kindKey(l.metadataKind)
    if (k) return { label: t(k), title: null }
    return mtmActivityEntityText(l, t)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={Activity} title={t("title")} description={t("description")} />
          <HelpButton slug="mtm-activity" variant="label" />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1" /> {t("export")}
        </Button>
      </div>

      {/* KPI cards — scoped to the selected period. The Violations card doubles
          as a one-click compliance lens (toggles the violations filter). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 stagger-children">
        <ColorStatCard label={t("totalActivity")} value={kpi.totalActivities} animate icon={<Activity className="h-4 w-4" />} hint={t("statsPeriodNote")} />
        <ColorStatCard label={t("checkIn")} value={kpi.totalCheckIns} animate icon={<LogIn className="h-4 w-4" />} />
        <ColorStatCard label={t("checkOut")} value={kpi.totalCheckOuts} animate icon={<LogOut className="h-4 w-4" />} />
        <ColorStatCard label={t("photoUpload")} value={kpi.totalPhotos} animate icon={<Camera className="h-4 w-4" />} />
        <button type="button" onClick={toggleViolations} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
          <ColorStatCard
            label={t("violations")}
            value={kpi.totalViolations}
            animate
            icon={<ShieldAlert className="h-4 w-4" />}
            hint={t("violationsHint")}
            className={violations
              ? "ring-2 ring-red-500 border-red-300 dark:border-red-500/50 bg-red-50 dark:bg-red-500/10"
              : "hover:border-red-300 dark:hover:border-red-500/40"}
          />
        </button>
      </div>

      {/* Filters: period + agent + type */}
      <div className="flex items-center gap-2 flex-wrap rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
              {t(PERIOD_KEY[p])}
            </Button>
          ))}
        </div>
        <Select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-[190px]">
          <option value="">{t("allAgents")}</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={type} onChange={e => { setType(e.target.value); setViolations(false) }} className="w-[190px]">
          <option value="">{t("all")}</option>
          <option value="CHECK_IN">{t("checkIn")}</option>
          <option value="CHECK_IN_FORCED">{t("forcedCheckIn")}</option>
          <option value="CHECK_OUT">{t("checkOut")}</option>
          <option value="PHOTO">{t("photoUpload")}</option>
          <option value="ROUTE">{t("typeRoute")}</option>
          <option value="TASK">{t("tasks")}</option>
        </Select>
      </div>

      {errorKey ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center">
          <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{tt(`accessError.${errorKey}`)}</p>
          {errorKey === "loadFailed" && (
            <Button variant="outline" size="sm" onClick={() => load(1, false)}>{tt("accessError.retry")}</Button>
          )}
        </div>
      ) : loading ? (
        <div className="animate-pulse space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}</div>
      ) : logs.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">
          {t("noActivity")}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
          {renderTimeline()}
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 text-xs text-muted-foreground">
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
    return <div>{out}</div>
  }

  function ActivityRow({ log }: { log: any }) {
    const meta = actionMeta(log.action)
    const Icon = meta.icon
    const href = activityRowHref(log)
    const clickable = !!href
    return (
      <div
        onClick={clickable ? () => router.push(href!) : undefined}
        className={`flex items-center gap-3 px-4 py-2.5 border-b last:border-0 border-zinc-100 dark:border-zinc-800 ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
      >
        {/* agent avatar / initials */}
        <Avatar name={log.actor?.name ?? log.agent?.name} avatar={log.actor ? null : log.agent?.avatar} />
        {/* action icon + label */}
        {/* min-w-0 + truncate below sm: long localized actions ("Xəbərdarlıq
            yenidən açıldı") used to push the row past the right edge. */}
        <span title={t(actionLabelKey(log.action))} className={`inline-flex min-w-0 max-w-[45%] items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium sm:max-w-none sm:shrink-0 ${TONE_CLASSES[meta.tone]}`}>
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t(actionLabelKey(log.action))}</span>
        </span>
        {/* agent name + details */}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{activityActorName(log, t)}</div>
          {(() => {
            const details = detailsOf(log)
            return <div className="text-xs text-muted-foreground truncate" title={details.title ?? undefined}>{details.label}</div>
          })()}
        </div>
        {/* time + drill-down chevron */}
        <span className="text-xs text-muted-foreground whitespace-nowrap">{relativeTime(log.createdAt, tt)}</span>
        {clickable && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </div>
    )
  }
}

function Avatar({ name, avatar }: { name?: string; avatar?: string | null }) {
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("")
  if (avatar) return <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
  return (
    <span className="h-8 w-8 rounded-full bg-muted shrink-0 flex items-center justify-center text-[11px] font-semibold text-muted-foreground">
      {initials}
    </span>
  )
}
