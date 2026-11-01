"use client"

import { Hint, HintValue } from "@/components/hint"
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { MtmPageHeader } from "@/components/mtm/page-header"
import { ConfirmDialog, DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { MtmFilterBar, MtmFilterDate, MtmFilterSelect, MtmResultLine } from "@/components/mtm/filter-bar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertTriangle, CheckCircle2, Trash2, MoreHorizontal, Lightbulb, Satellite, AlarmClock, CalendarX2, Coffee, ShieldAlert, Navigation, BatteryLow, Timer, ChevronDown, MapPin, ExternalLink, Lock, CalendarDays, type LucideIcon } from "lucide-react"
import { formatDate, formatTime } from "@/lib/format-date"
import { readMtmAlertMessage } from "@/lib/mtm/alert-messages"
import { mtmAccessErrorKey, type MtmAccessErrorKey } from "@/lib/mtm/access-error"
import { formatMtmDistance } from "@/lib/mtm/visit-place-check"
import type { MtmAlertDayGroup, MtmAlertDayItem } from "@/lib/mtm/alert-day-groups"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"

/**
 * Office alert list (prod 2026-09-14).
 *
 * Before: 31 identical English cards «Route deviation detected» for one agent,
 * no link anywhere, April alerts still open between today's, and a 403 for a
 * web user without an employee card showed the server's English sentence.
 * Now one row per employee + situation + day — «Anar · marşrutdan kənar ·
 * 17:41–18:38 · 10 dəfə · Marşrutdan 7,7 km kənarda» — that opens into its
 * individual alerts, links to the GPS history of that window and to the visit,
 * and closes as a group. Open alerts older than a week sit apart, collapsed.
 *
 * Owner, 2026-10-15: the Panel said «7 не решено», its button opened one day
 * and the page showed 1 of the 7 — it read one day at a time, and an alert
 * two to six days old was on no screen. It now opens on every open alert,
 * day by day, newest day first, each day closable at once; a date chosen in
 * the filter shows that one day as before.
 */

// Importance is the colour of the icon only; the row reads as plain text
// (owner 2026-10-31: 215 orange rows hid the one that mattered).
const categoryColors: Record<string, string> = { CRITICAL: "text-red-700 dark:text-red-400", WARNING: "text-amber-700 dark:text-amber-400", INFO: "text-sky-700 dark:text-sky-400" }

// Per-type friendly icon (human label + "what to do" hint come from i18n:
// typeLabel_<TYPE> / typeHint_<TYPE>). Unknown types fall back to AlertTriangle.
const alertTypeIcons: Record<string, LucideIcon> = {
  GPS_ANOMALY: Satellite,
  LATE_START: AlarmClock,
  MISSED_VISIT: CalendarX2,
  LONG_BREAK: Coffee,
  GPS_SPOOFING: ShieldAlert,
  OUT_OF_ZONE: Navigation,
  LOW_BATTERY: BatteryLow,
  OVERTIME: Timer,
}
const ALERT_TYPES = Object.keys(alertTypeIcons)
const stripSeed = (s?: string | null) => (s || "").replace(/^\s*\[SEED\]\s*/i, "").trim()

type Status = "open" | "resolved" | "all"

interface GroupsData {
  timezone: string
  /** «open»: every open alert, whatever its day. «day»: the one day in `date`. */
  mode: "open" | "day"
  date: string | null
  today: string
  status: Status
  staleDays: number
  staleBefore: string
  canResolve: boolean
  truncated: boolean
  groups: MtmAlertDayGroup[]
  stale: { total: number; groups: MtmAlertDayGroup[] }
}

export default function MtmAlertsPage() {
  const { data: session } = useSession()
  const t = useTranslations("mtmAlertsPage")
  const tUnits = useTranslations("mtmMap.distanceUnits")
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const orgId = session?.user?.organizationId
  const tt = (key: string, values?: Record<string, string | number>) => t(key as never, values as never) as string

  // Filters live in the URL: /mtm/alerts?agentId=… is a deep link from the
  // map, the week and the agent card, and a reload keeps what was chosen.
  const agentId = searchParams.get("agentId")?.trim() || ""
  const typeParam = searchParams.get("type") || ""
  const type = ALERT_TYPES.includes(typeParam) ? typeParam : ""
  const statusParam = searchParams.get("status")
  const status: Status = statusParam === "resolved" || statusParam === "all" ? statusParam : "open"
  const dateParam = searchParams.get("date") || ""

  const [data, setData] = useState<GroupsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState<MtmAccessErrorKey | null>(null)
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [staleOpen, setStaleOpen] = useState(false)
  const [staleConfirm, setStaleConfirm] = useState(false)
  const [busyGroup, setBusyGroup] = useState<string | null>(null)
  // A group of several alerts is closed only after the count was shown.
  const [groupConfirm, setGroupConfirm] = useState<{ key: string; ids: string[] } | null>(null)
  // A whole day is closed only after its count was shown.
  const [dayConfirm, setDayConfirm] = useState<{ key: string; ids: string[] } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<MtmAlertDayItem | null>(null)

  const headers = useMemo(() => {
    const value: Record<string, string> = {}
    if (orgId) value["x-organization-id"] = String(orgId)
    return value
  }, [orgId])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ view: "groups", status })
    if (agentId) qs.set("agentId", agentId)
    if (type) qs.set("type", type)
    if (dateParam) qs.set("date", dateParam)
    try {
      const res = await fetch(`/api/v1/mtm/alerts?${qs}`, { headers })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.success) {
        setErrorKey(mtmAccessErrorKey(res.status, body))
        setData(null)
        return
      }
      setErrorKey(null)
      setData(body.data as GroupsData)
    } catch {
      setErrorKey("loadFailed")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [agentId, dateParam, headers, status, type])

  useEffect(() => { if (orgId) { setLoading(true); void load() } }, [orgId, load])

  // Employee filter from the scoped roster — a manager sees their own team.
  useEffect(() => {
    if (!orgId) return
    const controller = new AbortController()
    fetch("/api/v1/mtm/agents?limit=200", { headers, signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (controller.signal.aborted || !Array.isArray(result?.data?.agents)) return
        setAgents((result.data.agents as Array<{ id?: string; name?: string | null }>)
          .filter((agent): agent is { id: string; name?: string | null } => typeof agent.id === "string")
          .map((agent) => ({ id: agent.id, name: agent.name || "—" })))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [orgId, headers])

  const timezone = data?.timezone
  const hhmm = (at: string) => formatTime(at, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })
  const distance = (meters: number) => formatMtmDistance(meters, locale, (unit, value) => tUnits(unit, { value }))

  const kindLabel = (group: MtmAlertDayGroup) => {
    if (group.message.key === "routeDeviation") return t("groupRouteDeviation")
    if (group.message.key === "outOfZoneCheckIn") return t("groupOutOfZone")
    if (group.message.key === "visitStillOpen") return t("groupVisitOpen")
    return tt(`typeLabel_${group.alertType in alertTypeIcons ? group.alertType : "OTHER"}`)
  }
  const measure = (message: MtmAlertDayGroup["message"]) => {
    if (message.key === "routeDeviation") return t("distanceOffRoute", { distance: distance(message.distanceMeters) })
    if (message.key === "outOfZoneCheckIn") return t("distanceFromCustomer", { distance: distance(message.distanceMeters) })
    if (message.key === "visitStillOpen") return t("openMinutes", { minutes: Math.round(message.minutes) })
    return null
  }

  const resolveIds = async (ids: string[], groupKey: string) => {
    if (ids.length === 0) return
    setBusyGroup(groupKey)
    try {
      const res = await fetch("/api/v1/mtm/alerts/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ ids }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.success) {
        const key = mtmAccessErrorKey(res.status, body)
        toast.error(key === "loadFailed" ? t("resolveFailed") : tt(`accessError.${key}`))
        return
      }
      toast.success(t("resolveDone", { count: body.data.resolved }))
      await load()
    } catch {
      toast.error(t("resolveFailed"))
    } finally {
      setBusyGroup(null)
    }
  }

  const closeStale = async () => {
    const res = await fetch("/api/v1/mtm/alerts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        stale: true,
        ...(data?.staleBefore ? { staleBefore: data.staleBefore } : {}),
        ...(agentId ? { agentId } : {}),
        ...(type ? { type } : {}),
      }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.success) {
      const key = mtmAccessErrorKey(res.status, body)
      throw new Error(key === "loadFailed" ? t("resolveFailed") : tt(`accessError.${key}`))
    }
    toast.success(t("staleClosed", { count: body.data.resolved }))
    await load()
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/alerts/${deleteItem.id}`, { method: "DELETE", headers })
    if (!res.ok) throw new Error(t("deleteFailed"))
    await load()
  }

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const groups = data?.groups ?? []
  const openTotal = groups.reduce((sum, group) => sum + group.openCount, 0)
  const criticalGroups = groups.filter((group) => group.category === "CRITICAL").length
  const openMode = data?.mode === "open"
  // Every open alert, a day under another: newest day first, inside a day the
  // server's order (the most serious, then the latest).
  const days = useMemo(() => {
    const byDay = new Map<string, MtmAlertDayGroup[]>()
    for (const group of data?.mode === "open" ? data.groups : []) byDay.set(group.dateKey, [...(byDay.get(group.dateKey) ?? []), group])
    return [...byDay.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([dateKey, dayGroups]) => ({
        dateKey,
        groups: dayGroups,
        openIds: dayGroups.flatMap((group) => group.openIds),
      }))
  }, [data])
  const openAgents = new Set(groups.filter((group) => group.openCount > 0).map((group) => group.agentId)).size
  const dayLabel = (dateKey: string) => {
    if (data?.today === dateKey) return t("dayToday")
    if (data?.today && addDateKeyDays(data.today, -1) === dateKey) return t("dayYesterday")
    // A tenant-local day key, read at noon UTC so no zone moves it to the next or previous day.
    return formatDate(`${dateKey}T12:00:00.000Z`, locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
  }

  // Owner 2026-09-27: filters in one row. They were a card of labelled
  // selects under four stat cards; the counts are one line now.
  const filters = (
    <div className="space-y-2">
      <MtmFilterBar testId="mtm-alerts-filters">
        <Hint wrap text={t("hint.agent")}>
          <MtmFilterSelect testId="mtm-alerts-agent" label={t("filterAgent")} value={agentId} allLabel={t("allAgents")}
            options={[
              ...(agentId && !agents.some((agent) => agent.id === agentId) ? [{ value: agentId, label: agentId }] : []),
              ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
            ]}
            onChange={(value) => setFilter("agentId", value)} />
        </Hint>
        <Hint wrap text={t("hint.type")}>
          <MtmFilterSelect testId="mtm-alerts-type" label={t("filterType")} value={type} allLabel={t("allTypes")}
            options={ALERT_TYPES.map((value) => ({ value, label: tt(`typeLabel_${value}`) }))}
            onChange={(value) => setFilter("type", value)} />
        </Hint>
        <Hint wrap text={t("hint.status")}>
          <MtmFilterSelect testId="mtm-alerts-status" label={t("filterStatus")} value={status} emptyValue="open" showValue allLabel={t("statusOpen")}
            options={[{ value: "open", label: t("statusOpen") }, { value: "resolved", label: t("statusResolved") }, { value: "all", label: t("statusAll") }]}
            onChange={(value) => setFilter("status", value === "open" ? "" : value)} />
        </Hint>
        {openMode && data ? (
          // Every day is on screen; a day of its own is one click away.
          <Hint text={t("hint.pickDay")}>
            <Button data-testid="mtm-alerts-pick-day" variant="outline" size="sm" className="h-10 rounded-full" onClick={() => setFilter("date", data.today)}>
              <CalendarDays className="mr-1 h-4 w-4" aria-hidden="true" />{t("pickDay")}
            </Button>
          </Hint>
        ) : (
          <Hint wrap text={t("hint.date")}><MtmFilterDate testId="mtm-alerts-date" label={t("filterDate")} max={data?.today} value={dateParam || data?.today || ""} onChange={(value) => setFilter("date", value)} /></Hint>
        )}
        {dateParam && status === "open" && (
          <Hint text={t("hint.allOpen")}><Button data-testid="mtm-alerts-all-open" variant="outline" size="sm" className="h-10 rounded-full" onClick={() => setFilter("date", "")}>{t("allOpen")}</Button></Hint>
        )}
      </MtmFilterBar>
      {data && openMode ? (
        <MtmResultLine>
          {openTotal > 0 ? (
            <span data-testid="mtm-alerts-open-summary">
              <HintValue text={t("hint.openSummary")}><span className="font-semibold text-amber-700 dark:text-amber-400">{t("openSummary", { count: openTotal })}</span></HintValue>
              {" · "}{t("openDays", { count: days.length })}{" · "}{t("openAgents", { count: openAgents })}
              {criticalGroups > 0 ? <> · <span className="font-medium text-red-700 dark:text-red-400">{t("statCritical")}: {criticalGroups}</span></> : null}
            </span>
          ) : null}
          {data.stale.total > 0 && data.canResolve ? (
            <span className="ml-1">
              {" · "}{t("olderThanWeek", { count: data.stale.total, days: data.staleDays })}{" "}
              <Hint text={t("hint.closeAllStale")}>
                <button type="button" data-testid="mtm-alerts-close-stale" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setStaleConfirm(true)}>{t("closeThem")}</button>
              </Hint>
            </span>
          ) : null}
        </MtmResultLine>
      ) : data ? (
        <MtmResultLine>
          <HintValue text={t("hint.summary")}>{t("statGroups")}</HintValue>: {groups.length} · {t("statOpen")}: {openTotal} · <span className={criticalGroups > 0 ? "font-medium text-red-700 dark:text-red-400" : ""}>{t("statCritical")}: {criticalGroups}</span> · {t("statStale")}: {data.stale.total ?? 0}
        </MtmResultLine>
      ) : null}
    </div>
  )

  const header = (
    <MtmPageHeader title={t("title")} description={t("subtitle")} help="mtm-alerts" />
  )

  if (errorKey) {
    // #204: a web user without an employee card, or another team's agent in
    // the deep link, gets the reason in their language — never the server's
    // English sentence.
    return (
      <div className="space-y-4">
        {header}
        {errorKey === "agentOutOfScope" && filters}
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 p-4 text-sm sm:flex-row sm:items-center">
          <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{tt(`accessError.${errorKey}`)}</p>
          {errorKey === "loadFailed" && (
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); void load() }}>{tt("accessError.retry")}</Button>
          )}
        </div>
      </div>
    )
  }

  const renderGroup = (group: MtmAlertDayGroup, showDate: boolean) => {
    const TypeIcon = alertTypeIcons[group.alertType] || AlertTriangle
    const known = group.alertType in alertTypeIcons
    const hint = known ? tt(`typeHint_${group.alertType}`) : ""
    const cat = categoryColors[group.category] || categoryColors.INFO
    const isOpen = expanded.has(group.key)
    const span = group.firstAt === group.lastAt ? hhmm(group.firstAt) : t("timeRange", { from: hhmm(group.firstAt), to: hhmm(group.lastAt) })
    const detail = measure(group.message)
    const parts = [
      group.agentName,
      kindLabel(group),
      showDate ? `${formatDate(group.firstAt, locale, { day: "numeric", month: "long", timeZone: timezone })} ${span}` : span,
      t("times", { count: group.count }),
      ...(detail ? [detail] : []),
    ]
    return (
      <div key={group.key} className="rounded-lg border border-border bg-card text-foreground">
        <div className="flex flex-wrap items-start gap-2.5 p-2.5">
          <button
            type="button"
            onClick={() => toggle(group.key)}
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          >
            <ChevronDown className={`mt-1.5 h-4 w-4 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted ${cat}`}><TypeIcon className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-semibold">{parts.join(" · ")}</span>
              {group.openCount > 0 && group.openCount !== group.count && (
                <span className="mt-0.5 block text-xs opacity-80">{t("statusOpen")}: {group.openCount}</span>
              )}
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link href={group.historyHref}><Hint text={t("hint.openOnMap")}><MapPin className="mr-1 h-3.5 w-3.5" aria-hidden="true" /></Hint>{t("openOnMap")}</Link>
            </Button>
            {group.visitId && (
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link href={`/mtm/visits?visitId=${encodeURIComponent(group.visitId)}`}><Hint text={t("hint.openVisit")}><ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" /></Hint>{t("openVisit")}</Link>
              </Button>
            )}
            {data?.canResolve && group.openIds.length > 0 && (
              <Hint wrap text={t("hint.resolveGroup")}>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busyGroup === group.key} onClick={() => (group.openIds.length > 1 ? setGroupConfirm({ key: group.key, ids: group.openIds }) : resolveIds(group.openIds, group.key))}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("resolveGroup")}
                </Button>
              </Hint>
            )}
          </div>
        </div>
        {isOpen && (
          <div className="space-y-1.5 px-2.5 pb-2.5">
            {hint && group.openCount > 0 && (
              <div className="flex items-start gap-1 text-xs opacity-90">
                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span><span className="font-medium">{t("actionLabel")}</span> {hint}</span>
              </div>
            )}
            {group.items.map((item) => renderItem(item))}
          </div>
        )}
      </div>
    )
  }

  const renderItem = (item: MtmAlertDayItem) => {
    // A4: a row written after the dictionary carries what happened and with
    // which numbers; an older row has only the generator's English sentence —
    // shown rather than nothing, marked as predating translation.
    const stored = readMtmAlertMessage(item.metadata)
    const localized = stored.kind === "localized" ? tt(`messages.${stored.key}`, stored.params) : measure(item.message)
    const legacy = stripSeed(item.description) || stripSeed(item.title)
    return (
      <div key={item.id} className={`rounded-md bg-white/45 p-2 dark:bg-black/20 ${item.isResolved ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 text-xs font-semibold tabular-nums">{hhmm(item.at)}</span>
            {localized
              ? <span className="min-w-0 break-words text-xs opacity-90">{localized}</span>
              : <span className="min-w-0 break-words text-xs opacity-90">{legacy} <span className="opacity-60">({t("legacyBadge")})</span></span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.visitId && (
              <Link className="text-xs font-medium underline-offset-2 hover:underline" href={`/mtm/visits?visitId=${encodeURIComponent(item.visitId)}`}>{t("openVisit")}</Link>
            )}
            {item.isResolved
              ? <span className="rounded px-1.5 py-0.5 text-xs text-emerald-700">{t("resolved")}</span>
              : data?.canResolve && (
                  <Hint wrap text={t("hint.resolve")}>
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => resolveIds([item.id], item.id)} disabled={busyGroup === item.id}>
                      <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> {t("resolve")}
                    </Button>
                  </Hint>
                )}
            {data?.canResolve && (
              // C14: удаление оповещения — в «⋯», а не вплотную к кнопке
              // «решено», которую жмут каждый день.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t("moreActions")}><MoreHorizontal className="h-3 w-3" aria-hidden="true" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setDeleteItem(item); setDeleteOpen(true) }}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}

      {filters}

      {loading && !data ? (
        <div className="animate-pulse space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted" />)}</div>
      ) : openMode ? (
        days.length === 0 ? (
          <div data-testid="mtm-alerts-none-open" className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-4 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden="true" />
            <p className="text-sm font-semibold">{t("noneOpen")}</p>
            <Hint text={t("hint.showResolvedToday")}>
              <Button variant="outline" size="sm" onClick={() => setFilter("status", "resolved")}>{t("showResolvedToday")}</Button>
            </Hint>
          </div>
        ) : (
          <div className="space-y-5">
            {data?.truncated && <p className="text-xs text-muted-foreground">{t("truncated")}</p>}
            {days.map((day) => (
              <section key={day.dateKey} data-testid={`mtm-alerts-day-${day.dateKey}`} aria-labelledby={`mtm-alerts-day-title-${day.dateKey}`} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`mtm-alerts-day-title-${day.dateKey}`} className="text-sm font-semibold first-letter:uppercase">{dayLabel(day.dateKey)}</h2>
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">{t("openOfDay", { count: day.openIds.length })}</span>
                  {data?.canResolve && day.openIds.length > 0 ? (
                    <Hint text={t("hint.resolveDay")}>
                      <Button data-testid={`mtm-alerts-resolve-day-${day.dateKey}`} size="sm" variant="outline" className="ml-auto h-8" disabled={busyGroup === `day:${day.dateKey}`} onClick={() => (day.openIds.length > 1 ? setDayConfirm({ key: `day:${day.dateKey}`, ids: day.openIds }) : resolveIds(day.openIds, `day:${day.dateKey}`))}>
                        <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />{t("resolveDay")}
                      </Button>
                    </Hint>
                  ) : null}
                </div>
                {day.groups.map((group) => renderGroup(group, false))}
              </section>
            ))}
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">{t("emptyDay")}</div>
      ) : (
        <div className="space-y-2">
          {data?.truncated && <p className="text-xs text-muted-foreground">{t("truncated")}</p>}
          {groups.map((group) => renderGroup(group, false))}
        </div>
      )}

      {data && !openMode && data.stale.total > 0 && (
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <button type="button" onClick={() => setStaleOpen((open) => !open)} aria-expanded={staleOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left">
              <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${staleOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t("staleTitle", { count: data.stale.total })}</span>
                <span className="block text-xs text-muted-foreground">{t("staleHint", { days: data.staleDays })}</span>
              </span>
            </button>
            {data.canResolve && (
              <Hint text={t("hint.closeAllStale")}>
                <Button size="sm" variant="outline" onClick={() => setStaleConfirm(true)}>
                  <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />{t("closeAllStale")}
                </Button>
              </Hint>
            )}
          </div>
          {staleOpen && (
            <div className="space-y-2 px-3 pb-3">
              {data.stale.groups.reduce((sum, group) => sum + group.count, 0) < data.stale.total && (
                <p className="text-xs text-muted-foreground">
                  {t("staleMore", { shown: data.stale.groups.reduce((sum, group) => sum + group.count, 0), total: data.stale.total })}
                </p>
              )}
              {data.stale.groups.map((group) => renderGroup(group, true))}
            </div>
          )}
        </section>
      )}

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("delete")} itemName={deleteItem ? hhmm(deleteItem.at) : undefined} />
      <ConfirmDialog
        open={groupConfirm !== null}
        onOpenChange={(open) => { if (!open) setGroupConfirm(null) }}
        onConfirm={async () => { if (groupConfirm) await resolveIds(groupConfirm.ids, groupConfirm.key) }}
        title={t("resolveGroup")}
        description={t("resolveGroupConfirm", { count: groupConfirm?.ids.length ?? 0 })}
        confirmLabel={t("resolveGroup")}
        confirmVariant="default"
      />
      <ConfirmDialog
        open={dayConfirm !== null}
        onOpenChange={(open) => { if (!open) setDayConfirm(null) }}
        onConfirm={async () => { if (dayConfirm) await resolveIds(dayConfirm.ids, dayConfirm.key) }}
        title={t("resolveDay")}
        description={t("resolveDayConfirm", { count: dayConfirm?.ids.length ?? 0 })}
        confirmLabel={t("resolveDay")}
        confirmVariant="default"
      />
      <ConfirmDialog
        open={staleConfirm}
        onOpenChange={setStaleConfirm}
        onConfirm={closeStale}
        title={t("closeAllStale")}
        description={t("closeAllStaleConfirm", { count: data?.stale.total ?? 0 })}
        confirmLabel={t("closeAllStale")}
        confirmVariant="default"
      />
    </div>
  )
}
