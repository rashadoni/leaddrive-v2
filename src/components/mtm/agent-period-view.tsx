"use client"

import { Fragment, useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, Loader2, MapPinned } from "lucide-react"
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
type TripEntry = {
  kind: "START" | "END" | "STAY" | "MOVE" | "GAP"
  at?: string
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
  distanceMeters?: number
  reason?: string
  source?: string
  visit?: { customerName: string } | null
}

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

/** A silence or break shorter than this is part of the day, not a line in its story. */
const STORY_GAP_SECONDS = 30 * 60

/**
 * Prod 2026-09-26: on a real phone the day unfolded into a wall of «stop
 * 3 min → on the road 2 min, 240 m → …». The story keeps what a manager asks:
 * when it began, each customer with times, long silences, when it ended; the
 * driving is one total. Every leg stays on the map.
 */
export function dayStory(entries: readonly TripEntry[]) {
  const lines = entries.filter((entry) =>
    entry.kind === "START" || entry.kind === "END"
    || (entry.kind === "STAY" && entry.visit)
    || (entry.kind === "GAP" && (entry.durationSeconds ?? 0) >= STORY_GAP_SECONDS))
  const moves = entries.filter((entry) => entry.kind === "MOVE")
  return {
    lines,
    drivingSeconds: moves.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0),
    drivingMeters: moves.reduce((sum, entry) => sum + (entry.distanceMeters ?? 0), 0),
    otherStops: entries.filter((entry) => entry.kind === "STAY" && !entry.visit).length,
  }
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
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [trips, setTrips] = useState<Record<string, TripEntry[] | "none" | "error">>({})
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
        setOpenDay(null)
        setTrips({})
        setLoadedKey(key)
      })
      .catch((cause) => {
        if ((cause as Error).name === "AbortError") return
        setError(t("loadFailed"))
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [agentId, range.from, range.to, t])

  const toggleDay = (day: string) => {
    if (openDay === day) { setOpenDay(null); return }
    setOpenDay(day)
    if (trips[day]) return
    fetch(`/api/v1/mtm/location-history?${new URLSearchParams({ agentId, date: day })}`)
      .then((response) => response.json())
      .then((body) => {
        const entries: TripEntry[] = body?.data?.trip?.entries ?? []
        setTrips((current) => ({ ...current, [day]: entries.length ? entries : "none" }))
      })
      .catch(() => setTrips((current) => ({ ...current, [day]: "error" })))
  }

  const duration = (seconds: number) => {
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? t("minutes", { minutes }) : t("hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }
  const km = (meters: number) => meters < 1_000 ? `${Math.round(meters / 10) * 10} m` : `${Math.round(meters / 1_000)} km`
  const clock = (value: string) => formatInTimezone(value, timezone, { hour: "2-digit", minute: "2-digit" }, locale)
  const dayTitle = (day: string) => formatInTimezone(`${day}T12:00:00.000Z`, "UTC", { weekday: "short", day: "numeric", month: "short" }, locale)
  const summary = period?.summary
  const pastDays = period?.days.filter((day) => day.status !== "UPCOMING").length ?? 0

  const tripText = (entry: TripEntry) => {
    switch (entry.kind) {
      case "START": return `${clock(entry.at!)} ${t(entry.source === "WORKDAY" ? "started" : "firstSignal")}`
      case "END": return `${clock(entry.at!)} ${t(entry.source === "WORKDAY" ? "ended" : "lastSignal")}`
      case "MOVE": return t("onRoad", { duration: duration(entry.durationSeconds ?? 0), distance: km(entry.distanceMeters ?? 0) })
      case "GAP": return t(entry.reason === "WORKDAY_PAUSED" ? "pause" : "noSignal", { duration: duration(entry.durationSeconds ?? 0) })
      case "STAY": return entry.visit
        ? `${entry.visit.customerName} ${clock(entry.startedAt!)}–${clock(entry.endedAt!)}`
        : t("stop", { duration: duration(entry.durationSeconds ?? 0) })
    }
  }

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

          <div className="overflow-x-auto">
          <table data-testid="mtm-agent-period-days" className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">{t("columns.day")}</th>
                <th className="px-2 py-2 font-medium">{t("columns.workday")}</th>
                <th className="px-2 py-2 font-medium">{t("columns.visits")}</th>
                <th className="px-2 py-2 font-medium">{t("columns.distance")}</th>
                <th className="px-2 py-2 font-medium">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
              {period.days.map((day) => {
                const quiet = day.status === "DAY_OFF" || day.status === "UPCOMING"
                const open = openDay === day.date
                const trip = trips[day.date]
                return (
                  <Fragment key={day.date}>
                    <tr className={`cursor-pointer transition-colors hover:bg-muted/40 ${open ? "bg-muted/40" : ""} ${quiet ? "text-muted-foreground" : ""}`} onClick={() => toggleDay(day.date)} aria-expanded={open}>
                      <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}{dayTitle(day.date)}</span></td>
                      <td className="px-2 py-2.5 tabular-nums">{!day.workday ? "—"
                        : day.workday.carriedOver ? t("openSince", { date: formatInTimezone(day.workday.startedAt, timezone, { day: "numeric", month: "short" }, locale) })
                          : `${clock(day.workday.startedAt)}–${day.workday.completedAt ? clock(day.workday.completedAt) : t("open")}`}</td>
                      <td className="px-2 py-2.5 tabular-nums">{day.planned ? `${day.visits} / ${day.planned}` : day.visits || "—"}</td>
                      <td className="px-2 py-2.5 tabular-nums">{day.distanceMeters ? km(day.distanceMeters) : "—"}</td>
                      <td className="px-2 py-2.5"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_TONE[day.status]}`}>{t(`statuses.${day.status}`, { count: day.remaining })}</span></td>
                    </tr>
                    {open ? (
                      <tr className="bg-muted/40">
                        <td colSpan={5} className="px-8 pb-3 pt-1 text-sm leading-7 text-muted-foreground">
                          {!trip ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label={t("loading")} />
                            : trip === "none" ? t("noTrack")
                              : trip === "error" ? t("loadFailed")
                                : (() => {
                                  const story = dayStory(trip)
                                  return (
                                    <>
                                      {story.lines.map((entry, index) => (
                                        <Fragment key={index}>{index ? " → " : ""}<span className={entry.kind === "STAY" ? "text-foreground" : ""}>{tripText(entry)}</span></Fragment>
                                      ))}
                                      <span className="block text-xs">{t("storyTotals", { duration: duration(story.drivingSeconds), distance: km(story.drivingMeters), stops: story.otherStops })}</span>
                                    </>
                                  )
                                })()}
                          {" "}
                          <Link href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agentId)}&date=${day.date}`} className="ml-2 inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
                            <MapPinned className="h-4 w-4" />{t("openOnMap")}
                          </Link>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
