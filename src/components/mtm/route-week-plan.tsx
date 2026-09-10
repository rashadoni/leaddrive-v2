"use client"

import { useEffect, useMemo, useReducer, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight, MapPin, Plus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MtmRouteRecord } from "@/components/mtm/route-types"
import { fetchMtmRoutesInRange } from "@/lib/mtm/route-range-client"
import { formatDate } from "@/lib/format-date"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { visibleWeekPlanAgents } from "@/lib/mtm/week-plan-agents"

interface RouteWeekPlanProps {
  orgId?: string
  locale: string
  refreshVersion: number
  initialDate?: string | null
  onSelectRoute: (route: MtmRouteRecord) => void
  onDateChange?: (date: string) => void
  canCreateRoutes: boolean
  canManageAssignments: boolean
  selfAgentId: string | null
  onCreateRoute: (input: { date: string; agentId: string }) => void
}

interface RouteAgent {
  id: string
  name: string
  /**
   * Carried by all three sources of this grid's rows (audit C7). Without it on
   * every source, filtering by team would drop the agents who reached the week
   * through a route rather than through the agent list — silently, which is
   * the worst way for a filter to be wrong.
   */
  teamId?: string | null
  team?: { id: string; name: string } | null
}

interface AgentsState {
  agents: RouteAgent[]
  loading: boolean
}

type AgentsAction =
  | { type: "loading" }
  | { type: "loaded"; agents: RouteAgent[] }
  | { type: "failed" }

function agentsReducer(state: AgentsState, action: AgentsAction): AgentsState {
  switch (action.type) {
    case "loading":
      return { agents: [], loading: true }
    case "loaded":
      return { agents: action.agents, loading: false }
    case "failed":
      return { agents: [], loading: false }
    default:
      return state
  }
}

interface RouteRangeState {
  routes: MtmRouteRecord[]
  loading: boolean
  error: boolean
}

type RouteRangeAction =
  | { type: "loading" }
  | { type: "loaded"; routes: MtmRouteRecord[] }
  | { type: "failed" }

function routeRangeReducer(state: RouteRangeState, action: RouteRangeAction): RouteRangeState {
  switch (action.type) {
    case "loading":
      return { routes: [], loading: true, error: false }
    case "loaded":
      return { routes: action.routes, loading: false, error: false }
    case "failed":
      return { ...state, loading: false, error: true }
    default:
      return state
  }
}


function startOfWeek(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return date
}

function dateKey(value: Date | string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function dateFromKey(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date()
}

export function MtmRouteWeekPlan({
  orgId,
  locale,
  refreshVersion,
  initialDate,
  onSelectRoute,
  onDateChange,
  canCreateRoutes,
  canManageAssignments,
  selfAgentId,
  onCreateRoute,
}: RouteWeekPlanProps) {
  const t = useTranslations("mtmRoutesPage")
  const statusT = useTranslations("mtmStatus")
  const [weekStart, setWeekStart] = useState(() => startOfWeek(initialDate ? dateFromKey(initialDate) : new Date()))
  const [agentsState, dispatchAgents] = useReducer(agentsReducer, { agents: [], loading: true })
  const [rangeState, dispatchRange] = useReducer(routeRangeReducer, { routes: [], loading: true, error: false })
  const [rangeRetryVersion, setRangeRetryVersion] = useState(0)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + index)
    return date
  }), [weekStart])

  useEffect(() => {
    if (!initialDate || !/^\d{4}-\d{2}-\d{2}$/.test(initialDate)) return
    const nextWeekStart = startOfWeek(dateFromKey(initialDate))
    setWeekStart((current) => dateKey(current) === dateKey(nextWeekStart) ? current : nextWeekStart)
  }, [initialDate])

  useEffect(() => {
    const controller = new AbortController()
    dispatchAgents({ type: "loading" })
    fetch("/api/v1/mtm/agents?limit=200", {
      headers: orgId ? { "x-organization-id": orgId } : {},
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.success) dispatchAgents({ type: "loaded", agents: result.data?.agents ?? [] })
        else dispatchAgents({ type: "failed" })
      })
      .catch(() => {
        if (!controller.signal.aborted) dispatchAgents({ type: "failed" })
      })
    return () => controller.abort()
  }, [orgId])

  useEffect(() => {
    const controller = new AbortController()
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 7)
    dispatchRange({ type: "loading" })
    fetchMtmRoutesInRange({
      start: dateKey(weekStart),
      endExclusive: dateKey(end),
      orgId,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) dispatchRange({ type: "loaded", routes: result })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && (error as { name?: string })?.name !== "AbortError") {
          dispatchRange({ type: "failed" })
        }
      })
    return () => controller.abort()
  }, [orgId, rangeRetryVersion, refreshVersion, weekStart])

  const [agentSearch, setAgentSearch] = useState("")
  const [agentTeamId, setAgentTeamId] = useState("")
  const { agents: availableAgents, loading: agentsLoading } = agentsState
  const { routes: routesForWeek, loading: rangeLoading, error: rangeError } = rangeState

  const allAgents = useMemo(() => {
    const byId = new Map<string, RouteAgent>()
    for (const agent of availableAgents) byId.set(agent.id, agent)
    for (const route of routesForWeek) {
      if (route.agent?.id) byId.set(route.agent.id, route.agent)
      for (const assignment of route.assignments ?? []) {
        if (assignment.agent?.id) byId.set(assignment.agent.id, assignment.agent)
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [availableAgents, routesForWeek])

  // C7: QA-аккаунты занимали строки между живыми людьми, а найти одного
  // сотрудника среди сорока можно было только прокруткой (RUX-602).
  const agents = useMemo(
    () => visibleWeekPlanAgents(allAgents, { search: agentSearch, teamId: agentTeamId || null }),
    [agentSearch, agentTeamId, allAgents],
  )

  // Only teams that actually have a row here: offering a team with nobody in
  // this week would answer "nobody matches" to a question the manager never
  // really asked.
  const teams = useMemo(() => {
    const byId = new Map<string, string>()
    for (const agent of allAgents) {
      if (agent.team?.id && agent.team.name) byId.set(agent.team.id, agent.team.name)
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allAgents])
  const hiddenCount = allAgents.length - agents.length

  const routesByAgentAndDate = useMemo(() => {
    const result = new Map<string, MtmRouteRecord[]>()
    for (const route of routesForWeek) {
      const agentIds = new Set<string>()
      if (route.agentId) agentIds.add(route.agentId)
      for (const assignment of route.assignments ?? []) agentIds.add(assignment.agentId)
      for (const agentId of agentIds) {
        const key = `${agentId}:${dateKey(route.date)}`
        result.set(key, [...(result.get(key) ?? []), route])
      }
    }
    return result
  }, [routesForWeek])

  function moveWeek(direction: -1 | 1) {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + direction * 7)
    setWeekStart(next)
    onDateChange?.(dateKey(next))
  }

  return (
    <section data-testid="mtm-route-week-plan" className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("weekPlanTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("weekPlanHint")}</p>
          {rangeLoading ? <p role="status" className="mt-1 text-xs text-muted-foreground">{t("weekLoading")}</p> : null}
          {rangeError ? (
            <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <span>{t("weekLoadFailed")}</span>
              <Button variant="link" className="h-auto min-h-11 px-1 text-xs" onClick={() => setRangeRetryVersion((current) => current + 1)}>{t("retry")}</Button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
          <input
            type="search"
            data-testid="mtm-week-agent-search"
            value={agentSearch}
            onChange={(event) => setAgentSearch(event.target.value)}
            placeholder={t("weekAgentSearch")}
            aria-label={t("weekAgentSearch")}
            className="min-h-11 w-full rounded-lg border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700 sm:w-56"
          />
          {teams.length > 1 ? (
            <select
              data-testid="mtm-week-team-filter"
              value={agentTeamId}
              onChange={(event) => setAgentTeamId(event.target.value)}
              aria-label={t("weekTeamFilter")}
              className="min-h-11 w-full rounded-lg border border-zinc-200 bg-background px-3 text-sm dark:border-zinc-700 sm:w-44"
            >
              <option value="">{t("weekTeamAll")}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          ) : null}
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => moveWeek(-1)} title={t("previousWeek")} aria-label={t("previousWeek")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-36 text-center text-sm font-semibold">{t("weekOf", { date: formatDate(weekStart, locale) })}</div>
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => moveWeek(1)} title={t("nextWeek")} aria-label={t("nextWeek")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/*
        C7 tail: at tablet width Saturday and Sunday were cut off with nothing
        saying so, and a manager read the week as five days. `scroll-hint-x`
        uncovers a shadow only on the side that actually has more — see the
        utility in globals.css for why it needs no listener.
      */}
      <div data-testid="mtm-week-scroller" className="scroll-hint-x overflow-x-auto">
        <div className="min-w-[880px]">
          <div className="grid grid-cols-[180px_repeat(7,minmax(100px,1fr))] border-b border-zinc-200 bg-muted/30 text-xs dark:border-zinc-700">
            <div className="sticky left-0 z-20 flex items-center gap-2 border-r border-zinc-200 bg-muted px-3 py-2 font-medium dark:border-zinc-700">
              <Users className="h-4 w-4" /> {t("agent")}
            </div>
            {days.map((day) => (
              <div key={dateKey(day)} className="border-r border-zinc-200 px-2 py-2 text-center last:border-r-0 dark:border-zinc-700">
                <div className="font-medium">{formatDate(day, locale, { weekday: "short" })}</div>
                <div className="text-muted-foreground">{formatDate(day, locale, { day: "2-digit", month: "2-digit" })}</div>
              </div>
            ))}
          </div>

          {agents.map((agent) => (
            <div key={agent.id} className="grid min-h-16 grid-cols-[180px_repeat(7,minmax(100px,1fr))] border-b border-zinc-200 last:border-b-0 dark:border-zinc-700">
              <div className="sticky left-0 z-10 border-r border-zinc-200 bg-card px-3 py-2 text-sm font-medium dark:border-zinc-700">{agent.name}</div>
              {days.map((day) => {
                const dayRoutes = routesByAgentAndDate.get(`${agent.id}:${dateKey(day)}`) ?? []
                const canCreateForAgent = canCreateRoutes && (canManageAssignments || !selfAgentId || selfAgentId === agent.id)
                return (
                  <div key={dateKey(day)} className="space-y-1 border-r border-zinc-200 p-1.5 last:border-r-0 dark:border-zinc-700">
                    {dayRoutes.map((route) => (
                      <button
                        key={route.id}
                        type="button"
                        onClick={() => onSelectRoute(route)}
                        className="block min-h-11 w-full rounded-lg border border-zinc-200 bg-muted/60 px-2 py-1.5 text-left hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"
                      >
                        <span className="block truncate text-xs font-medium">{route.name || route.agent?.name}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <MapPin className="h-3 w-3" /> {route.totalPoints} {t("points")} · {mtmStatusLabel(statusT, "route", route.status)}
                        </span>
                      </button>
                    ))}
                    {dayRoutes.length === 0 ? (
                      <button
                        type="button"
                        data-testid="mtm-week-empty-cell-action"
                        className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-zinc-300 disabled:hover:bg-transparent disabled:hover:text-muted-foreground dark:border-zinc-700"
                        onClick={() => onCreateRoute({ date: dateKey(day), agentId: agent.id })}
                        disabled={!canCreateForAgent}
                        title={canCreateForAgent
                          ? t("planRouteForAgentOnDate", { employee: agent.name, date: formatDate(day, locale) })
                          : t("selfPlanningDisabled")}
                        aria-label={t("planRouteForAgentOnDate", { employee: agent.name, date: formatDate(day, locale) })}
                      >
                        <Plus className="h-3.5 w-3.5" />{t("planRoute")}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}

          {agents.length > 0 && hiddenCount > 0 ? (
            <div className="border-t border-zinc-200 px-3 py-1.5 text-xs text-muted-foreground dark:border-zinc-700">
              {t("weekAgentsHidden", { count: hiddenCount })}
            </div>
          ) : null}
          {agents.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">{agentsLoading ? t("loading") : t("weekNoAgents")}</div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
