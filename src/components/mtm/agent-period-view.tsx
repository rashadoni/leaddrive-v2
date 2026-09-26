"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, MapPinned } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"
import type { AgentPeriod, AgentPeriodDayStatus } from "@/lib/mtm/agent-period"

/**
 * Owner 2026-09-25: «a manager wants to see what one field agent did over a
 * period»; the first version showed only days with something in them and
 * read as noise. Approved mockup: agent and ready periods, four numbers, then
 * every day of the period with a verdict; a click unfolds the day's route
 * from the GPS history.
 */
type Agent = { id: string; name: string }

export const AGENT_PERIOD_PRESETS = ["thisWeek", "lastWeek", "thisMonth", "last30"] as const
type Preset = (typeof AGENT_PERIOD_PRESETS)[number]

function addDays(dateKey: string, count: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Ready periods, Monday-based weeks, never past today. */
export function agentPeriodPreset(preset: Preset, today: string): { from: string; to: string } {
  const weekday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7
  const monday = addDays(today, -weekday)
  if (preset === "thisWeek") return { from: monday, to: today }
  if (preset === "lastWeek") return { from: addDays(monday, -7), to: addDays(monday, -1) }
  if (preset === "thisMonth") return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: addDays(today, -29), to: today }
}

const STATUS_TONE: Record<AgentPeriodDayStatus, string> = {
  FULL: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  PARTIAL: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  NOT_WORKED: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  UNPLANNED: "bg-muted text-muted-foreground",
  DAY_OFF: "bg-transparent text-muted-foreground",
  UPCOMING: "bg-transparent text-muted-foreground",
  SHIFT_OPEN: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  GPS_ONLY: "bg-muted text-muted-foreground",
}


export function MtmAgentPeriodView({ timezone, initialAgentId }: { timezone: string; initialAgentId?: string | null }) {
  const t = useTranslations("mtmAgentPeriod")
  const locale = useLocale()
  const today = dateInputValueInTimezone(new Date(), timezone)
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState(initialAgentId ?? "")
  const [preset, setPreset] = useState<Preset | null>("thisWeek")
  const [range, setRange] = useState(() => agentPeriodPreset("thisWeek", today))
  const [period, setPeriod] = useState<AgentPeriod | null>(null)
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const requestKey = `${agentId}|${range.from}|${range.to}`
  const loading = Boolean(agentId) && loadedKey !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/mtm/agents?limit=200", { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => {
        const list: Agent[] = (body?.data?.agents ?? []).map((agent: Agent) => ({ id: agent.id, name: agent.name }))
        setAgents(list)
        setAgentId((current) => current || list[0]?.id || "")
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!agentId || !range.from || !range.to || range.to < range.from) return
    const controller = new AbortController()
    const key = `${agentId}|${range.from}|${range.to}`
    fetch(`/api/v1/mtm/agent-period?${new URLSearchParams({ agentId, from: range.from, to: range.to })}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => {
        if (!body?.success) throw new Error("load")
        setPeriod(body.data as AgentPeriod)
        setError("")
        setLoadedKey(key)
      })
      .catch((cause) => {
        if ((cause as Error).name === "AbortError") return
        setError(t("loadFailed"))
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [agentId, range.from, range.to, t])


  const duration = (seconds: number) => {
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? t("minutes", { minutes }) : t("hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }
  const km = (meters: number) => meters < 1_000 ? `${Math.round(meters / 10) * 10} m` : `${Math.round(meters / 1_000)} km`
  const clock = (value: string) => formatInTimezone(value, timezone, { hour: "2-digit", minute: "2-digit" }, locale)
  const dayTitle = (day: string) => formatInTimezone(`${day}T12:00:00.000Z`, "UTC", { weekday: "short", day: "numeric", month: "short" }, locale)
  const summary = period?.summary
  const pastDays = period?.days.filter((day) => day.status !== "UPCOMING").length ?? 0


  return (
    <section data-testid="mtm-agent-period" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select data-testid="mtm-agent-period-agent" aria-label={t("agent")} value={agentId} onChange={(event) => setAgentId(event.target.value)} className="min-h-11 min-w-56">
          {!agentId ? <option value="">{t("chooseAgent")}</option> : null}
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </Select>
        {AGENT_PERIOD_PRESETS.map((value) => (
          <Button key={value} type="button" variant={preset === value ? "default" : "outline"} aria-pressed={preset === value} className="min-h-11" onClick={() => { setPreset(value); setRange(agentPeriodPreset(value, today)) }}>
            {t(`presets.${value}`)}
          </Button>
        ))}
        <span className="inline-flex items-center gap-1">
          <Input type="date" aria-label={t("from")} value={range.from} max={range.to} onChange={(event) => { setPreset(null); setRange((current) => ({ ...current, from: event.target.value })) }} className="min-h-11 w-40" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" aria-label={t("to")} value={range.to} min={range.from} max={today} onChange={(event) => { setPreset(null); setRange((current) => ({ ...current, to: event.target.value })) }} className="min-h-11 w-40" />
        </span>
      </div>

      {!agentId ? <p className="text-sm text-muted-foreground">{t("chooseAgentHint")}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {agentId && !period && loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary motion-reduce:animate-none" aria-label={t("loading")} /></div> : null}

      {summary && period ? (
        <div className={loading ? "space-y-4 opacity-60 transition-opacity" : "space-y-4 transition-opacity"} aria-busy={loading}>
          <div data-testid="mtm-agent-period-cards" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: t("cards.workDays"), value: `${summary.workedDays}`, extra: `/ ${summary.plannedDays || pastDays}` },
              { label: t("cards.inField"), value: duration(summary.fieldSeconds), extra: "" },
              { label: t("cards.visitsPlan"), value: `${summary.visits}`, extra: summary.planned ? `/ ${summary.planned} · ${Math.round((summary.visitedPoints / summary.planned) * 100)}%` : "" },
              { label: t("cards.distance"), value: km(summary.distanceMeters), extra: "" },
            ].map((card) => (
              <div key={card.label} className="rounded-lg bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">{card.label}</div>
                <div className="text-xl font-semibold tabular-nums">{card.value} <span className="text-sm font-normal text-muted-foreground">{card.extra}</span></div>
              </div>
            ))}
          </div>

          {/* Owner 2026-09-26: «make it expanded, more informative, fonts you
              can tell apart — who he met on which date and how long». Every
              day is open: the date and verdict in bold, the day's numbers in a
              quiet line, then each visit with its time and length. A day with
              nothing in it is one pale line. */}
          <ol data-testid="mtm-agent-period-days" className="space-y-3">
            {period.days.map((day) => {
              const quiet = day.status === "DAY_OFF" || day.status === "UPCOMING"
              const facts = [
                day.workday
                  ? day.workday.carriedOver
                    ? t("openSince", { date: formatInTimezone(day.workday.startedAt, timezone, { day: "numeric", month: "short" }, locale) })
                    : t("workdayFact", { from: clock(day.workday.startedAt), to: day.workday.completedAt ? clock(day.workday.completedAt) : t("open") })
                  : null,
                day.fieldSeconds ? t("fieldFact", { duration: duration(day.fieldSeconds) }) : null,
                day.distanceMeters ? t("distanceFact", { distance: km(day.distanceMeters) }) : null,
                day.planned ? t("planFact", { visits: day.visits, planned: day.planned }) : null,
                !day.visits && day.firstPointAt && day.lastPointAt ? t("signalFact", { from: clock(day.firstPointAt), to: clock(day.lastPointAt) }) : null,
              ].filter(Boolean)
              if (quiet) {
                return (
                  <li key={day.date} className="flex items-baseline gap-3 px-1 text-sm text-muted-foreground">
                    <span className="w-40 shrink-0">{dayTitle(day.date)}</span>
                    <span>{t(`statuses.${day.status}`, { count: day.remaining })}</span>
                  </li>
                )
              }
              return (
                <li key={day.date} className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-foreground">{dayTitle(day.date)}</h3>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[day.status]}`}>{t(`statuses.${day.status}`, { count: day.remaining })}</span>
                  </div>
                  {facts.length ? <p className="mt-1 text-sm text-muted-foreground">{facts.join(" · ")}</p> : null}
                  {day.visitList.length ? (
                    <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
                      {day.visitList.map((visit) => (
                        <li key={visit.id}>
                          <Link href={`/mtm/visits?visitId=${encodeURIComponent(visit.id)}`} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-baseline gap-3 rounded-md px-1 py-2 hover:bg-muted/50">
                            <span className="text-sm tabular-nums text-muted-foreground">{clock(visit.checkInAt)}{visit.checkOutAt ? `–${clock(visit.checkOutAt)}` : ""}</span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">{visit.customerName}</span>
                              {visit.contactName ? <span className="block truncate text-xs text-muted-foreground">{visit.contactName}</span> : null}
                            </span>
                            <span className="text-sm tabular-nums text-foreground">{visit.durationSeconds != null ? duration(visit.durationSeconds) : t("visitOpen")}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-sm text-muted-foreground">{t("noVisits")}</p>}
                  <Link href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agentId)}&date=${day.date}`} className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <MapPinned className="h-4 w-4" />{t("openOnMap")}
                  </Link>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
