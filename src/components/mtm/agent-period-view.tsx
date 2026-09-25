"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, MapPinned } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { dateInputValueInTimezone, formatInTimezone, localDateTimeToUtc } from "@/lib/timezone"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"

/**
 * Owner 2026-09-25: «a manager wants to see what one field agent was doing
 * over a period — here there is only a week, not intuitive, not interactive».
 * One agent, any period up to a month: day by day, the route with how many
 * stops were done, the visits with their times, and the day's track on the map.
 * Everything comes from the routes and visits APIs as they are.
 */
export const AGENT_PERIOD_MAX_DAYS = 31

type Agent = { id: string; name: string }
type Route = { id: string; name: string; date: string; status: string; totalPoints: number; visitedPoints: number }
type Visit = { id: string; checkInAt: string; checkOutAt: string | null; status: string; customer?: { name: string } | null }

function addDays(dateKey: string, count: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** The period the reader asked for, clamped to a month and never reversed. */
export function agentPeriodRange(from: string, to: string): { from: string; to: string } {
  const end = to && from && to < from ? from : to
  const start = end && from && addDays(from, AGENT_PERIOD_MAX_DAYS - 1) < end ? addDays(end, -(AGENT_PERIOD_MAX_DAYS - 1)) : from
  return { from: start, to: end }
}

export function MtmAgentPeriodView({ timezone, initialAgentId }: { timezone: string; initialAgentId?: string | null }) {
  const t = useTranslations("mtmAgentPeriod")
  const statusT = useTranslations("mtmStatus")
  const locale = useLocale()
  const today = dateInputValueInTimezone(new Date(), timezone)
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState(initialAgentId ?? "")
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [routes, setRoutes] = useState<Route[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [error, setError] = useState("")
  const range = agentPeriodRange(from, to)
  // Loading is derived: the shown data belongs to an older request.
  const requestKey = `${agentId}|${range.from}|${range.to}`
  const [loadedKey, setLoadedKey] = useState("")
  const loading = Boolean(agentId) && loadedKey !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/mtm/agents?limit=200", { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => {
        const list: Agent[] = (body?.data?.agents ?? body?.data ?? []).map((agent: Agent) => ({ id: agent.id, name: agent.name }))
        setAgents(list)
        setAgentId((current) => current || list[0]?.id || "")
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!agentId || !range.from || !range.to) return
    const controller = new AbortController()
    const key = `${agentId}|${range.from}|${range.to}`
    const routeQuery = new URLSearchParams({ agentId, start: range.from, endExclusive: addDays(range.to, 1), limit: "200" })
    const visitQuery = new URLSearchParams({
      agentId,
      from: localDateTimeToUtc(`${range.from}T00:00`, timezone).toISOString(),
      to: new Date(localDateTimeToUtc(`${addDays(range.to, 1)}T00:00`, timezone).getTime() - 1).toISOString(),
      limit: "200",
    })
    Promise.all([
      fetch(`/api/v1/mtm/routes?${routeQuery}`, { signal: controller.signal }).then((response) => response.json()),
      fetch(`/api/v1/mtm/visits?${visitQuery}`, { signal: controller.signal }).then((response) => response.json()),
    ])
      .then(([routeBody, visitBody]) => {
        if (!routeBody?.success || !visitBody?.success) throw new Error("load")
        setRoutes(routeBody.data.routes ?? [])
        setVisits(visitBody.data.visits ?? [])
        setError("")
        setLoadedKey(key)
      })
      .catch((cause) => {
        if ((cause as Error).name === "AbortError") return
        setError(t("loadFailed"))
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [agentId, range.from, range.to, t, timezone])

  const days = useMemo(() => {
    const byDay = new Map<string, { routes: Route[]; visits: Visit[] }>()
    const slot = (day: string) => {
      if (!byDay.has(day)) byDay.set(day, { routes: [], visits: [] })
      return byDay.get(day)!
    }
    for (const route of routes) slot(route.date.slice(0, 10)).routes.push(route)
    for (const visit of visits) slot(dateInputValueInTimezone(new Date(visit.checkInAt), timezone)).visits.push(visit)
    for (const day of byDay.values()) day.visits.sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [routes, timezone, visits])

  const planned = routes.reduce((sum, route) => sum + (route.totalPoints ?? 0), 0)
  const done = routes.reduce((sum, route) => sum + (route.visitedPoints ?? 0), 0)
  const clock = (value: string) => formatInTimezone(value, timezone, { hour: "2-digit", minute: "2-digit" }, locale)
  const dayTitle = (day: string) => formatInTimezone(`${day}T12:00:00.000Z`, "UTC", { weekday: "short", day: "numeric", month: "long" }, locale)

  return (
    <section data-testid="mtm-agent-period" className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">
          <span>{t("agent")}</span>
          <Select data-testid="mtm-agent-period-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} className="min-h-11 min-w-56">
            {!agentId ? <option value="">{t("chooseAgent")}</option> : null}
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          <span>{t("from")}</span>
          <Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="min-h-11" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          <span>{t("to")}</span>
          <Input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="min-h-11" />
        </label>
        {[7, 30].map((count) => (
          <Button key={count} type="button" variant="outline" className="min-h-11" onClick={() => { setTo(today); setFrom(addDays(today, -(count - 1))) }}>
            {t("lastDays", { count })}
          </Button>
        ))}
      </div>

      {range.from !== from ? <p className="text-xs text-muted-foreground">{t("clamped", { days: AGENT_PERIOD_MAX_DAYS })}</p> : null}

      {/* Prod 2026-09-26: with the employee list not yet loaded the page said
          «no routes and no visits» — a claim about nobody. */}
      {!agentId ? <p className="text-sm text-muted-foreground">{t("chooseAgentHint")}</p> : (
        <p data-testid="mtm-agent-period-summary" className="text-sm">
          {t("summary", { routes: routes.length, done, planned, visits: visits.length, days: days.length })}
        </p>
      )}

      {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {loading && !days.length ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary motion-reduce:animate-none" aria-label={t("loading")} /></div> : null}
      {agentId && !loading && !error && !days.length ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}

      <ol className={`divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700 ${loading ? "opacity-60" : ""}`}>
        {days.map(([day, entry]) => (
          <li key={day} className="grid gap-2 p-3 md:grid-cols-[10rem_minmax(0,1fr)_auto] md:items-start">
            <div className="font-medium">{dayTitle(day)}</div>
            <div className="min-w-0 space-y-1.5 text-sm">
              {entry.routes.map((route) => (
                <div key={route.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/mtm/routes?routeId=${encodeURIComponent(route.id)}`} className="font-medium hover:text-primary hover:underline">{route.name}</Link>
                  <span className="tabular-nums text-muted-foreground">{t("stops", { done: route.visitedPoints ?? 0, planned: route.totalPoints ?? 0 })}</span>
                  <Badge variant="outline">{mtmStatusLabel(statusT, "route", route.status)}</Badge>
                </div>
              ))}
              {entry.visits.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {entry.visits.map((visit) => (
                    <li key={visit.id}>
                      <Link href={`/mtm/visits?visitId=${encodeURIComponent(visit.id)}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 text-xs hover:bg-muted dark:border-zinc-700">
                        <span className="tabular-nums text-muted-foreground">{clock(visit.checkInAt)}{visit.checkOutAt ? `–${clock(visit.checkOutAt)}` : ""}</span>
                        <span>{visit.customer?.name ?? "—"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted-foreground">{t("noVisits")}</p>}
            </div>
            <Button asChild variant="outline" size="sm" className="min-h-10 justify-self-start">
              <Link href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agentId)}&date=${day}`}><MapPinned className="mr-1 h-4 w-4" />{t("dayOnMap")}</Link>
            </Button>
          </li>
        ))}
      </ol>
    </section>
  )
}
