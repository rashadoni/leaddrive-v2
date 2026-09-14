"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { ConfirmDialog, DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  AlertTriangle, CheckCircle2, Trash2, MoreHorizontal, Bell, Lightbulb, Satellite, AlarmClock, CalendarX2, Coffee,
  ShieldAlert, Navigation, BatteryLow, Timer, ChevronDown, MapPin, ExternalLink, Archive, Lock, type LucideIcon,
} from "lucide-react"
import { formatDate, formatTime } from "@/lib/format-date"
import { readMtmAlertMessage } from "@/lib/mtm/alert-messages"
import { mtmAccessErrorKey, type MtmAccessErrorKey } from "@/lib/mtm/access-error"
import { formatMtmDistance } from "@/lib/mtm/visit-geofence-state"
import type { MtmAlertDayGroup, MtmAlertDayItem } from "@/lib/mtm/alert-day-groups"

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
 */

const categoryColors: Record<string, string> = { CRITICAL: "bg-red-100 text-red-700 border-red-200", WARNING: "bg-amber-100 text-amber-700 border-amber-200", INFO: "bg-blue-100 text-blue-700 border-blue-200" }

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
  date: string
  today: string
  status: Status
  staleDays: number
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<MtmAlertDayItem | null>(null)

  const headers = useMemo<Record<string, string>>(() => (orgId ? { "x-organization-id": String(orgId) } : {}), [orgId])

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
      body: JSON.stringify({ stale: true, ...(agentId ? { agentId } : {}), ...(type ? { type } : {}) }),
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

  const filters = (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3">
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        {t("filterAgent")}
        <Select value={agentId} onChange={(e) => setFilter("agentId", e.target.value)} className="w-48 max-w-full">
          <option value="">{t("allAgents")}</option>
          {agentId && !agents.some((agent) => agent.id === agentId) && <option value={agentId}>{agentId}</option>}
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </Select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        {t("filterType")}
        <Select value={type} onChange={(e) => setFilter("type", e.target.value)} className="w-44 max-w-full">
          <option value="">{t("allTypes")}</option>
          {ALERT_TYPES.map((value) => <option key={value} value={value}>{tt(`typeLabel_${value}`)}</option>)}
        </Select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        {t("filterStatus")}
        <Select value={status} onChange={(e) => setFilter("status", e.target.value === "open" ? "" : e.target.value)} className="w-36 max-w-full">
          <option value="open">{t("statusOpen")}</option>
          <option value="resolved">{t("statusResolved")}</option>
          <option value="all">{t("statusAll")}</option>
        </Select>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        {t("filterDate")}
        <Input type="date" value={dateParam || data?.today || ""} max={data?.today} onChange={(e) => setFilter("date", e.target.value === data?.today ? "" : e.target.value)} className="w-40 max-w-full" />
      </label>
      {dateParam && dateParam !== data?.today && (
        <Button variant="outline" size="sm" onClick={() => setFilter("date", "")}>{t("today")}</Button>
      )}
    </div>
  )

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <PageDescription icon={AlertTriangle} title={t("title")} description={t("subtitle")} />
        <HelpButton slug="mtm-alerts" variant="label" />
      </div>
    </div>
  )

  if (errorKey) {
    // #204: a web user without an employee card, or another team's agent in
    // the deep link, gets the reason in their language — never the server's
    // English sentence.
    return (
      <div className="space-y-4">
        {header}
        {errorKey === "agentOutOfScope" && filters}
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center">
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
      <div key={group.key} className={`rounded-lg border ${cat}`}>
        <div className="flex flex-wrap items-start gap-2.5 p-2.5">
          <button
            type="button"
            onClick={() => toggle(group.key)}
            aria-expanded={isOpen}
            className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          >
            <ChevronDown className={`mt-1.5 h-4 w-4 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-black/25"><TypeIcon className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-semibold">{parts.join(" · ")}</span>
              {group.openCount > 0 && group.openCount !== group.count && (
                <span className="mt-0.5 block text-[11px] opacity-80">{t("statusOpen")}: {group.openCount}</span>
              )}
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button asChild size="sm" variant="outline" className="h-7 bg-white/50 text-xs hover:bg-white/80 dark:bg-black/20">
              <Link href={group.historyHref}><MapPin className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("openOnMap")}</Link>
            </Button>
            {group.visitId && (
              <Button asChild size="sm" variant="outline" className="h-7 bg-white/50 text-xs hover:bg-white/80 dark:bg-black/20">
                <Link href={`/mtm/visits?visitId=${encodeURIComponent(group.visitId)}`}><ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("openVisit")}</Link>
              </Button>
            )}
            {data?.canResolve && group.openIds.length > 0 && (
              <Button size="sm" variant="outline" className="h-7 bg-white/50 text-xs hover:bg-white/80 dark:bg-black/20" disabled={busyGroup === group.key} onClick={() => resolveIds(group.openIds, group.key)}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("resolveGroup")}
              </Button>
            )}
          </div>
        </div>
        {isOpen && (
          <div className="space-y-1.5 px-2.5 pb-2.5">
            {hint && group.openCount > 0 && (
              <div className="flex items-start gap-1 text-[11px] opacity-90">
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
              <Link className="text-[11px] font-medium underline-offset-2 hover:underline" href={`/mtm/visits?visitId=${encodeURIComponent(item.visitId)}`}>{t("openVisit")}</Link>
            )}
            {item.isResolved
              ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">{t("resolved")}</span>
              : data?.canResolve && (
                  <Button size="sm" variant="outline" className="h-6 bg-white/50 text-[10px] hover:bg-white/80" onClick={() => resolveIds([item.id], item.id)} disabled={busyGroup === item.id}>
                    <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> {t("resolve")}
                  </Button>
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

      <div className="grid grid-cols-2 gap-3 stagger-children sm:grid-cols-4">
        <ColorStatCard label={t("statGroups")} value={groups.length} icon={<Bell className="h-4 w-4" />} hint={t("hintGroups")} />
        <ColorStatCard label={t("statOpen")} value={openTotal} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintOpen")} />
        <ColorStatCard label={t("statCritical")} value={criticalGroups} icon={<ShieldAlert className="h-4 w-4" />} hint={t("hintCritical")} />
        <ColorStatCard label={t("statStale")} value={data?.stale.total ?? 0} icon={<Archive className="h-4 w-4" />} hint={t("hintStale", { days: data?.staleDays ?? 7 })} />
      </div>

      {filters}

      {loading && !data ? (
        <div className="animate-pulse space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted" />)}</div>
      ) : groups.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-zinc-200 bg-card text-muted-foreground dark:border-zinc-700">{t("emptyDay")}</div>
      ) : (
        <div className="space-y-2">
          {data?.truncated && <p className="text-xs text-muted-foreground">{t("truncated")}</p>}
          {groups.map((group) => renderGroup(group, false))}
        </div>
      )}

      {data && data.stale.total > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <button type="button" onClick={() => setStaleOpen((open) => !open)} aria-expanded={staleOpen} className="flex min-w-0 flex-1 items-start gap-2 text-left">
              <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${staleOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t("staleTitle", { count: data.stale.total })}</span>
                <span className="block text-xs text-muted-foreground">{t("staleHint", { days: data.staleDays })}</span>
              </span>
            </button>
            {data.canResolve && (
              <Button size="sm" variant="outline" onClick={() => setStaleConfirm(true)}>
                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />{t("closeAllStale")}
              </Button>
            )}
          </div>
          {staleOpen && (
            <div className="space-y-2 px-3 pb-3">
              {data.stale.groups.length < data.stale.total && (
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
