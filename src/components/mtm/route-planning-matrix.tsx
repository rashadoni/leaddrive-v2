"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  MapPin,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { formatDate } from "@/lib/format-date"
import { dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"
import {
  normalizeMtmRouteTimeSlot,
} from "@/lib/mtm/route-time-slots"
import {
  coerceMtmRouteTargetTypes,
  routeTargetLabel,
  type MtmRouteTargetDirection,
  type MtmRouteTargetType,
} from "@/lib/mtm/route-target-types"
import type { MtmRoutePlannerContextPatch } from "@/lib/mtm/route-planner-context"

type Direction = MtmRouteTargetDirection
type Period = "5_DAYS" | "7_DAYS" | "MONTH"
type Agent = { id: string; name: string }
type Candidate = {
  id: string
  kind: Direction
  customerId: string
  contactId: string | null
  name: string
  code: string | null
  category: string
  specialtyName: string | null
  lastVisitAt: string | null
  coverage: {
    uncoveredMoi: string
    explanation: { summary: { ru: string; az: string; en: string } }
  } | null
  customer: {
    id: string
    name: string
    address?: string | null
    objectType?: string | null
    organizationKind?: string | null
  }
}
type RoutePoint = {
  id: string
  customerId: string
  contactId: string | null
  orderIndex: number
  plannedTime: string | null
  customer: {
    id: string
    name: string
    address: string | null
    objectType: string
    organizationKind: string | null
  }
  contact: { id: string; displayName: string; specialtyName: string | null } | null
}
type PlanningRoute = {
  id: string
  status: "DRAFT" | "PLANNED" | "IN_PROGRESS"
  version: number
  points: RoutePoint[]
}
type PlanningDay = {
  date: string
  kind: string
  routePlanningAllowed: boolean
  name: string | null
  routeCount: number
  plannedStops: number
  hasRouteConflict: boolean
  routes: PlanningRoute[]
}
type MatrixData = {
  agent: Agent
  candidates: Candidate[]
  total: number
  limited: boolean
  planningDays: PlanningDay[]
}
type DayStopSnapshot = {
  key: string
  customerId: string
  contactId: string | null
  name: string
  detail: string
  address: string | null
  plannedTime: string | null
}
type DaySnapshot = {
  date: string
  routeId: string | null
  locked: boolean
  multipleDrafts: boolean
  stops: DayStopSnapshot[]
}
type DayPlannerLaunch = {
  date: string
  agentId: string | null
  direction: Direction
  search: string
  routeId: string | null
}

function targetKey(target: { customerId: string; contactId?: string | null }) {
  return target.contactId ? `contact:${target.contactId}` : `customer:${target.customerId}`
}

function addDays(dateKey: string, count: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function dayLabel(date: string, locale: string) {
  return formatDate(`${date}T00:00:00.000Z`, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
}

function compactDayLabel(date: string, locale: string) {
  return formatDate(`${date}T00:00:00.000Z`, locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
}

function buildDaySnapshot(day: PlanningDay, timezone: string): DaySnapshot {
  const drafts = day.routes.filter((route) => route.status === "DRAFT")
  const route = drafts[0] ?? day.routes[0] ?? null
  const stops = (route?.points ?? []).map((point): DayStopSnapshot => ({
    key: targetKey(point),
    customerId: point.customerId,
    contactId: point.contactId,
    name: point.contact?.displayName ?? point.customer.name,
    detail: point.contact?.specialtyName ?? point.customer.organizationKind ?? point.customer.objectType,
    address: point.customer.address,
    plannedTime: point.plannedTime
      ? normalizeMtmRouteTimeSlot(formatInTimezone(point.plannedTime, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).slice(0, 5))
      : null,
  }))
  return {
    date: day.date,
    routeId: route?.id ?? null,
    locked: !day.routePlanningAllowed || day.hasRouteConflict,
    multipleDrafts: drafts.length > 1,
    stops,
  }
}

export function MtmRoutePlanningMatrix({
  orgId,
  timezone,
  preferredAgentId,
  preferredStartDate,
  preferredDirection,
  canManageAssignments,
  canCreateRoutes,
  selfAgentId,
  onPlannerContextChange,
  onOpenDayPlanner,
}: {
  orgId?: string
  timezone: string
  preferredAgentId?: string | null
  preferredStartDate?: string | null
  preferredPeriod?: Period | null
  preferredDirection?: Direction | null
  canManageAssignments: boolean
  canCreateRoutes: boolean
  selfAgentId: string | null
  onPlannerContextChange?: (patch: MtmRoutePlannerContextPatch) => void
  onOpenDayPlanner?: (input: DayPlannerLaunch) => void
}) {
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const coverageLocale = locale === "az" ? "az" : locale === "en" ? "en" : "ru"
  const headers = useMemo<Record<string, string>>(() => orgId ? { "x-organization-id": orgId } : {}, [orgId])
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState("")
  const [weekStart, setWeekStart] = useState(() => preferredStartDate || dateInputValueInTimezone(new Date(), timezone))
  const [targetTypes, setTargetTypes] = useState<MtmRouteTargetType[]>(() => coerceMtmRouteTargetTypes(null))
  const [dayTargetTypes, setDayTargetTypes] = useState<Record<string, string>>({})
  const [searchByDay, setSearchByDay] = useState<Record<string, string>>({})
  const [activeDay, setActiveDay] = useState("")
  const [data, setData] = useState<MatrixData | null>(null)
  const [daySnapshots, setDaySnapshots] = useState<Record<string, DaySnapshot>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const initializedIdentity = useRef("")

  const enabledTargetTypes = useMemo(() => targetTypes.filter((target) => target.enabled), [targetTypes])
  const defaultTargetType = useMemo(() => {
    const preferred = preferredDirection
      ? enabledTargetTypes.find((target) => target.direction === preferredDirection)
      : null
    return preferred ?? enabledTargetTypes[0] ?? null
  }, [enabledTargetTypes, preferredDirection])

  useEffect(() => {
    if (preferredStartDate) setWeekStart(preferredStartDate)
  }, [preferredStartDate])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetch("/api/v1/mtm/agents?limit=200", { headers, signal: controller.signal }).then((response) => response.json()),
      fetch("/api/v1/mtm/settings", { headers, signal: controller.signal }).then((response) => response.json()),
    ]).then(([agentResult, settingsResult]) => {
      const rows = (agentResult.data?.agents ?? []) as Agent[]
      const visibleAgents = !canManageAssignments && selfAgentId
        ? rows.filter((agent) => agent.id === selfAgentId)
        : rows
      setAgents(visibleAgents)
      setAgentId((current) => {
        if (current && visibleAgents.some((agent) => agent.id === current)) return current
        return visibleAgents.find((agent) => agent.id === preferredAgentId)?.id ?? visibleAgents[0]?.id ?? ""
      })
      if (settingsResult.success) setTargetTypes(coerceMtmRouteTargetTypes(settingsResult.data?.routeTargetTypes))
    }).catch((loadError: unknown) => {
      if ((loadError as { name?: string })?.name !== "AbortError") setError(t("matrixLoadFailed"))
    })
    return () => controller.abort()
  }, [canManageAssignments, headers, preferredAgentId, selfAgentId, t])

  useEffect(() => {
    initializedIdentity.current = ""
    setData(null)
    setDaySnapshots({})
    setActiveDay("")
    setError("")
  }, [agentId, weekStart])

  const queryDay = activeDay || weekStart
  const activeTargetId = dayTargetTypes[queryDay] ?? defaultTargetType?.id ?? ""
  const activeTarget = enabledTargetTypes.find((target) => target.id === activeTargetId) ?? defaultTargetType
  const activeSearch = searchByDay[queryDay] ?? ""

  useEffect(() => {
    if (!agentId || !weekStart || !activeTarget) return
    onPlannerContextChange?.({
      date: queryDay,
      agentId,
      direction: activeTarget.direction,
      search: activeSearch,
    })
  }, [activeSearch, activeTarget, agentId, onPlannerContextChange, queryDay, weekStart])

  useEffect(() => {
    if (!agentId || !activeTarget) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError("")
      try {
        const query = new URLSearchParams({
          agentId,
          startDate: weekStart,
          period: "7_DAYS",
          direction: activeTarget.direction,
          sort: "NAME",
        })
        if (activeTarget.objectType) query.set("objectType", activeTarget.objectType)
        if (activeTarget.organizationKind) query.set("organizationKind", activeTarget.organizationKind)
        if (activeSearch.trim()) query.set("search", activeSearch.trim())
        const response = await fetch(`/api/v1/mtm/routes/candidates?${query}`, { headers, signal: controller.signal })
        const result = await response.json()
        if (!response.ok || !result.success) throw new Error(result.error || t("matrixLoadFailed"))
        const nextData = result.data as MatrixData
        setData(nextData)

        const identity = `${agentId}:${weekStart}`
        if (initializedIdentity.current !== identity) {
          initializedIdentity.current = identity
          const nextSnapshots = Object.fromEntries(nextData.planningDays.map((day) => [day.date, buildDaySnapshot(day, timezone)]))
          const firstDay = nextData.planningDays.find((day) => day.routePlanningAllowed)?.date ?? nextData.planningDays[0]?.date ?? ""
          setDaySnapshots(nextSnapshots)
          setActiveDay(firstDay)
          setDayTargetTypes(Object.fromEntries(nextData.planningDays.map((day) => [day.date, defaultTargetType?.id ?? activeTarget.id])))
          setSearchByDay({})
        }
      } catch (requestError) {
        if ((requestError as { name?: string })?.name !== "AbortError") {
          setError(requestError instanceof Error ? requestError.message : t("matrixLoadFailed"))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [activeSearch, activeTarget, agentId, defaultTargetType, headers, t, timezone, weekStart])

  function openPlannerForDay(
    day: PlanningDay,
    snapshot: DaySnapshot,
    target: MtmRouteTargetType | null | undefined,
    search = "",
  ) {
    if (!canCreateRoutes || !onOpenDayPlanner || snapshot.locked || snapshot.multipleDrafts) return
    onOpenDayPlanner({
      date: day.date,
      agentId,
      direction: target?.direction ?? "ORGANIZATION",
      search,
      routeId: snapshot.routeId,
    })
  }

  return (
    <section
      data-testid="mtm-route-planning-matrix"
      data-loaded-agent-id={data?.agent.id ?? ""}
      className="border-y border-zinc-200 bg-card dark:border-zinc-700"
      aria-busy={loading}
    >
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">{t("weekPlannerTitle")}</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("weekPlannerSubtitle")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_minmax(260px,1fr)]">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("primaryAgent")}</span>
              <Select data-testid="mtm-matrix-agent-select" value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={loading}>
                <option value="">{t("selectAgent")}</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </Select>
            </label>
            <div className="space-y-1 text-xs">
              <span className="text-muted-foreground">{t("weekPlannerWeekStarts")}</span>
              <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
                <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11" onClick={() => setWeekStart(addDays(weekStart, -7))} disabled={loading} aria-label={t("weekPlannerPreviousWeek")}><ChevronLeft className="h-4 w-4" /></Button>
                <Input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} disabled={loading} aria-label={t("weekPlannerWeekStarts")} />
                <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11" onClick={() => setWeekStart(addDays(weekStart, 7))} disabled={loading} aria-label={t("weekPlannerNextWeek")}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {error ? <div role="alert" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div> : null}
      {!agentId ? (
        <div className="grid min-h-52 place-items-center px-4 py-8 text-center">
          <div><MapPin className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">{t("weekPlannerChooseAgent")}</p></div>
        </div>
      ) : !data ? (
        <div className="grid min-h-52 place-items-center px-4 py-8"><Loader2 className="h-7 w-7 animate-spin text-primary motion-reduce:animate-none" aria-label={t("loading")} /></div>
      ) : (
        <div data-testid="mtm-week-day-list" className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {data.planningDays.map((day, index) => {
            const snapshot = daySnapshots[day.date]
            if (!snapshot) return null
            const expanded = activeDay === day.date
            const selectedTargetId = dayTargetTypes[day.date] ?? defaultTargetType?.id ?? ""
            const selectedTarget = enabledTargetTypes.find((target) => target.id === selectedTargetId) ?? activeTarget
            const canOpenDayPlanner = !snapshot.locked && !snapshot.multipleDrafts && canCreateRoutes && Boolean(onOpenDayPlanner)
            return (
              <article key={day.date} data-testid={`mtm-week-planner-day-${day.date}`} className={expanded ? "bg-muted/20" : "bg-card"}>
                <button
                  type="button"
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => setActiveDay(expanded ? "" : day.date)}
                  aria-expanded={expanded}
                >
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${expanded ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold capitalize">{dayLabel(day.date, locale)}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {snapshot.stops.length > 0
                        ? t("weekPlannerDaySummary", { count: snapshot.stops.length, first: snapshot.stops[0]?.plannedTime ?? "—", last: snapshot.stops[snapshot.stops.length - 1]?.plannedTime ?? "—" })
                        : t("weekPlannerDayEmpty")}
                    </span>
                  </span>
                  {snapshot.locked || snapshot.multipleDrafts ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t("weekPlannerLocked")} /> : null}
                  <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>

                {expanded ? (
                  <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
                    {canOpenDayPlanner ? (
                      <div className="mb-3 flex flex-col gap-2 border-b border-zinc-200 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700">
                        <p className="text-xs text-muted-foreground">{t("weekPlannerOpenDayHint")}</p>
                        <Button
                          data-testid="mtm-week-planner-open-day"
                          type="button"
                          variant="outline"
                          className="min-h-11 shrink-0"
                          onClick={() => openPlannerForDay(day, snapshot, selectedTarget, searchByDay[day.date] ?? "")}
                          aria-label={`${t("openDayPlanner")}: ${dayLabel(day.date, locale)}`}
                        >
                          <CalendarDays className="mr-2 h-4 w-4" />{t("openDayPlanner")}
                        </Button>
                      </div>
                    ) : null}
                    {snapshot.locked || snapshot.multipleDrafts ? (
                      <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{snapshot.multipleDrafts ? t("weekPlannerMultipleDrafts", { date: compactDayLabel(day.date, locale) }) : t("weekPlannerPublishedLocked")}</p>
                      </div>
                    ) : (
                      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
                        <section aria-labelledby={`stops-${day.date}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 id={`stops-${day.date}`} className="font-semibold">{t("weekPlannerStopsTitle")}</h3>
                              <p className="mt-0.5 text-xs text-muted-foreground">{t("weekPlannerStopsHint")}</p>
                            </div>
                            <span className="text-sm font-medium tabular-nums">{snapshot.stops.length}</span>
                          </div>
                          <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                            {snapshot.stops.map((stop, stopIndex) => (
                              <div key={stop.key} className="grid min-h-16 grid-cols-[32px_minmax(0,1fr)] items-center gap-3 py-2 sm:grid-cols-[32px_minmax(0,1fr)_auto]">
                                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-semibold">{stopIndex + 1}</span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">{stop.name}</p>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{[stop.detail, stop.address].filter(Boolean).join(" · ")}</p>
                                </div>
                                <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-auto">
                                  {stop.plannedTime ? `${t("plannedTime")}: ${stop.plannedTime}` : `— ${t("plannedTime")} —`}
                                </span>
                              </div>
                            ))}
                            {snapshot.stops.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("weekPlannerNoStops")}</p> : null}
                          </div>
                        </section>

                        <section aria-labelledby={`picker-${day.date}`}>
                          <h3 id={`picker-${day.date}`} className="font-semibold">{t("weekPlannerAddTitle")}</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">{t("weekPlannerAddHint")}</p>
                          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("weekPlannerTargetType")}>
                            {enabledTargetTypes.map((target) => (
                              <Button
                                key={target.id}
                                type="button"
                                variant={selectedTargetId === target.id ? "default" : "outline"}
                                size="sm"
                                className="min-h-11"
                                disabled={loading}
                                onClick={() => {
                                  setDayTargetTypes((current) => ({ ...current, [day.date]: target.id }))
                                  setSearchByDay((current) => ({ ...current, [day.date]: "" }))
                                }}
                              >{routeTargetLabel(target, locale)}</Button>
                            ))}
                          </div>
                          <div className="relative mt-3">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={searchByDay[day.date] ?? ""} onChange={(event) => setSearchByDay((current) => ({ ...current, [day.date]: event.target.value }))} placeholder={t("weekPlannerSearchPlaceholder")} className="pl-9" disabled={loading} />
                          </div>
                          <div className="mt-3 max-h-80 divide-y divide-zinc-200 overflow-y-auto border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                            {loading ? <div className="grid min-h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" /></div> : null}
                            {!loading && data.candidates.slice(0, 60).map((candidate) => {
                              return (
                                <button
                                  key={candidate.id}
                                  data-testid="mtm-matrix-candidate"
                                  type="button"
                                  disabled={!canOpenDayPlanner}
                                  className="flex min-h-16 w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => openPlannerForDay(day, snapshot, selectedTarget, candidate.name)}
                                  aria-label={`${t("openDayPlanner")}: ${candidate.name}`}
                                >
                                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CalendarDays className="h-4 w-4" /></span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold">{candidate.name}</span>
                                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[candidate.specialtyName, candidate.customer.name, candidate.customer.address].filter(Boolean).join(" · ")}</span>
                                    {candidate.coverage ? (
                                      <span
                                        data-testid="mtm-matrix-coverage-preview"
                                        className="mt-1 block truncate text-[11px] font-medium text-amber-800 dark:text-amber-300"
                                        title={candidate.coverage.explanation.summary[coverageLocale]}
                                      >
                                        {t("candidateCoverageGap", { value: candidate.coverage.uncoveredMoi })}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="hidden shrink-0 text-xs font-medium text-primary sm:inline">{t("openDayPlanner")}</span>
                                </button>
                              )
                            })}
                            {!loading && data.candidates.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t("weekPlannerNoCandidates")}</p> : null}
                          </div>
                          {data.total > 60 ? <p className="mt-2 text-xs text-muted-foreground">{t("weekPlannerSearchMore", { total: data.total })}</p> : null}
                        </section>
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <footer className="sticky bottom-0 z-10 border-t border-zinc-200 bg-card/95 px-4 py-3 backdrop-blur dark:border-zinc-700">
        <div className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("weekPlannerReadOnlyHint")}</span>
        </div>
      </footer>
    </section>
  )
}
