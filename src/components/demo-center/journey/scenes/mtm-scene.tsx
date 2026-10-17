"use client"

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, BellRing, CheckCircle2, ChevronLeft, ChevronRight, Clock, GripVertical, History, MapPin, MessageSquare, Radio, Route as RouteIcon, Send, Sparkles, TrendingUp, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HomeAttentionCard } from "@/components/mtm/home-attention-card"
import { HomeCard, HomeKpi, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { LiveMapDaySteps } from "@/components/mtm/live-map-day-steps"
import { LiveMapLayersControl } from "@/components/mtm/live-map-layers-control"
import { LiveMapRoster, ROSTER_STATUS_DOT_CLASS } from "@/components/mtm/live-map-roster"
import { LiveMapTools } from "@/components/mtm/live-map-tools"
import { MtmFilterBar, MtmFilterSearch } from "@/components/mtm/filter-bar"
import { VisitPhotoGrid } from "@/components/mtm/visit-photo-grid"
import { VisitPlaceBadge } from "@/components/mtm/visit-place-badge"
import { createDateFormatter } from "@/lib/format-date"
import { FIELD_STATUS_LABEL_KEYS, isLiveMapAgentPositionVisible, type LiveMapAgent, type MtmFieldStatus } from "@/lib/mtm-types"
import { applyRosterFilters, foldRosterText, ROSTER_DEFAULT_VIEW, sortRoster, type RosterFilters, type RosterView } from "@/lib/mtm/live-map-roster"
import {
  routePlannerDayMinutes,
  routePlannerLengthKm,
  routePlannerNextSlot,
  routePlannerPlaces,
  suggestRoutePlannerStops,
  type RoutePlannerCandidate,
} from "@/lib/mtm/route-planner"
import { mtmPlanTone } from "@/lib/mtm/team-results"
import { mtmVisitOpenFor } from "@/lib/mtm/visit-left-open"
import { visitPlaceSummary } from "@/lib/mtm/visit-place-check"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_TARGET_ATTRIBUTE, demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import {
  MTM_DEMO_AGENTS,
  MTM_DEMO_CLOCK,
  MTM_DEMO_PLAN_AGENT,
  MTM_DEMO_TIMEZONE,
  addDays,
  mtmDemoAt,
  mtmDemoAttention,
  mtmDemoElvinRoute,
  mtmDemoElvinSteps,
  mtmDemoLeftOpen,
  mtmDemoRosterAgents,
  mtmDemoPlaceRequest,
  mtmDemoPlannerCandidates,
  mtmDemoToday,
  mtmDemoVisit,
  mtmDemoWeekSoFar,
} from "./mtm-demo-data"

/**
 * Route & Field (MTM): a module of its own, beside the lead story.
 *
 * Owner, 2026-10-13/17: the modules people ask for need a demo of their own,
 * shown at their best. Every screen here is drawn by the product's own MTM
 * components — HomeKpi, HomeAttentionCard, the route planner's map and its
 * «suggest a route», the live map, «day by step», the visit's place verdict
 * and photos, the «client is here» map — fed an invented field team
 * (`mtm-demo-data.ts`) instead of a tenant's API. Shells that fetch in the
 * product (the planner, the visit card, the request queue, the results
 * table) are redrawn here from the same parts and the same words.
 *
 * Nothing leaves the demo: the product's links inside these components lead
 * to tenant pages, so a click on one is caught here and explained instead.
 */

const MtmLiveMap = dynamic(() => import("@/components/mtm/live-map"), { ssr: false })
const RoutePlannerMap = dynamic(() => import("@/components/mtm/route-planner-map"), { ssr: false })
const CustomerLocationRequestMap = dynamic(() => import("@/components/mtm/customer-location-request-map"), { ssr: false })

type MtmScreen = "today" | "plan" | "live" | "visit" | "place" | "results"

const SCREEN_OF: Record<string, MtmScreen> = {
  "mtm-today": "today",
  "mtm-plan": "plan",
  "mtm-live": "live",
  "mtm-visit": "visit",
  "mtm-place": "place",
  "mtm-results": "results",
}

/** The module's own menu (MTM_PRIMARY_NAVIGATION) and the screen each lights up. */
const NAV: ReadonlyArray<{ key: "today" | "routes" | "calendar" | "map" | "visits" | "results"; screens: readonly MtmScreen[] }> = [
  { key: "today", screens: ["today"] },
  { key: "routes", screens: ["plan", "place"] },
  { key: "calendar", screens: [] },
  { key: "map", screens: ["live"] },
  { key: "visits", screens: ["visit"] },
  { key: "results", screens: ["results"] },
]

const PLAN_TONE: Record<ReturnType<typeof mtmPlanTone>, HomeTone> = { good: "green", warn: "amber", bad: "red", none: "zinc" }

export function MtmScene(props: DemoSceneProps) {
  const { section, hint } = props
  const t = useTranslations("mtmModuleNavigation")
  const screen = SCREEN_OF[section.id] ?? "today"

  // The product's own cards link to tenant pages; in the demo a link explains itself instead.
  const keepInDemo = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element | null)?.closest?.("a[href]")
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }

  return (
    <div data-testid="demo-scene-mtm" className="space-y-4" onClickCapture={keepInDemo}>
      <nav aria-label={t("primaryNavigationLabel")} className="flex flex-wrap gap-1 rounded-2xl border border-zinc-200 bg-card p-1 dark:border-zinc-700">
        {NAV.map((item) => {
          const active = item.screens.includes(screen)
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => (active ? undefined : hint(S.mtmTabHint))}
              className={cn(
                "rounded-xl px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(item.key)}
            </button>
          )
        })}
      </nav>
      {screen === "today" && <TodayScreen {...props} />}
      {screen === "plan" && <PlanScreen {...props} />}
      {screen === "live" && <LiveScreen {...props} />}
      {screen === "visit" && <VisitScreen {...props} />}
      {screen === "place" && <PlaceScreen {...props} />}
      {screen === "results" && <ResultsScreen />}
    </div>
  )
}

function useBakuFormat() {
  const locale = useLocale()
  return useMemo(() => {
    const clock = createDateFormatter(locale, { timeZone: MTM_DEMO_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    const day = createDateFormatter(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    const short = createDateFormatter(locale, { timeZone: MTM_DEMO_TIMEZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    return {
      // The product's day steps pass a stop without a time as null.
      clock: (iso: string | null | undefined) => (iso ? clock.format(new Date(iso)) : ""),
      day: (dateKey: string) => day.format(new Date(`${dateKey}T12:00:00.000Z`)),
      short: (iso: string) => short.format(new Date(iso)),
    }
  }, [locale])
}

/* ── «Bu gün» ─────────────────────────────────────────────────────────── */

function TodayScreen({ snapshot }: DemoSceneProps) {
  const t = useTranslations("mtmDashboardPage.home")
  const today = mtmDemoToday(snapshot.startedAt)
  const format = useBakuFormat()
  const attention = useMemo(() => mtmDemoAttention(today), [today])

  const inField = MTM_DEMO_AGENTS.filter((agent) => agent.status !== "PAUSED").length
  const atCustomer = MTM_DEMO_AGENTS.filter((agent) => agent.status === "CHECKED_IN").length
  const onRoad = MTM_DEMO_AGENTS.filter((agent) => agent.status === "ON_ROAD").length
  const planned = MTM_DEMO_AGENTS.reduce((sum, agent) => sum + agent.total, 0)
  const done = MTM_DEMO_AGENTS.reduce((sum, agent) => sum + agent.visited, 0)
  const weekPlanned = MTM_DEMO_AGENTS.reduce((sum, agent) => sum + mtmDemoWeekSoFar(agent).planned, 0)
  const weekDone = MTM_DEMO_AGENTS.reduce((sum, agent) => sum + mtmDemoWeekSoFar(agent).done, 0)
  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
  const weekPercent = percent(weekDone, weekPlanned)
  const requests = attention.items.filter((item) => item.kind !== "photosPendingReview").reduce((sum, item) => sum + item.count, 0)
  const photos = attention.items.find((item) => item.kind === "photosPendingReview")?.count ?? 0
  const waiting = attention.items.length + (attention.nextWorkday && attention.nextWorkday.withoutRoute > 0 ? 1 : 0)

  return (
    <div data-testid="mtm-home" className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight first-letter:uppercase">{format.day(today)}</h2>
        <p className="text-sm text-muted-foreground">{t("workingDay")} · {S.mtmAsOf(MTM_DEMO_CLOCK)}</p>
      </div>

      <div data-tour-id="mtm-home-kpis" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HomeKpi
          testId="mtm-home-kpi-field"
          label={t("kpiInField")}
          hint={t("hint.kpiInField")}
          icon={<MapPin className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone="green"
          value={String(inField)}
          unit={t("kpiInFieldUnit", { total: MTM_DEMO_AGENTS.length })}
          pill={t("pillAtCustomer", { count: atCustomer })}
          sub={[t("partHeading", { count: onRoad }), S.mtmOnBreakCount(1)].join(" · ")}
        />
        <HomeKpi
          testId="mtm-home-kpi-plan"
          label={t("kpiTodayPlan")}
          hint={t("hint.kpiTodayPlan")}
          icon={<CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone="amber"
          value={String(done)}
          unit={t("kpiPointsUnit", { total: planned })}
          pill={`${percent(done, planned)}%`}
          progress={percent(done, planned)}
          sub={t("todayVisits", { count: done })}
        />
        <HomeKpi
          testId="mtm-home-kpi-week"
          label={t("kpiWeekPlan")}
          hint={t("hint.kpiWeekPlan")}
          icon={<TrendingUp className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={PLAN_TONE[mtmPlanTone(weekPercent)]}
          value={String(weekDone)}
          unit={t("kpiPointsUnit", { total: weekPlanned })}
          pill={`${weekPercent}%`}
          progress={weekPercent}
          sub={t("weekDeltaUp", { percent: weekPercent - 4, delta: 4 })}
        />
        <HomeKpi
          testId="mtm-home-kpi-attention"
          label={t("kpiAttention")}
          hint={t("hint.kpiAttention")}
          icon={<BellRing className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone="amber"
          value={String(waiting)}
          unit={t("issuesUnit", { count: waiting })}
          sub={[t("shortRequests", { count: requests }), t("shortPhotos", { count: photos }), t("shortNextDay")].join(" · ")}
        />
      </div>

      <div className="grid gap-4 min-[1400px]:grid-cols-2">
        <div data-tour-id="mtm-home-attention">
          <HomeAttentionCard state={{ data: attention, failed: false, retry: () => {} }} />
        </div>
        <TeamWeekCard />
      </div>
    </div>
  )
}

/** «Komanda · bu həftə»: each agent's week so far, day by day. */
function TeamWeekCard() {
  const t = useTranslations("mtmDashboardPage.home")
  const tMap = useTranslations("mtmMap")
  return (
    <HomeCard testId="mtm-home-team" titleId="mtm-home-team-title" icon={<Users className="h-4 w-4" aria-hidden="true" />} tone="blue" title={t("teamTitle")}>
      <ul className="divide-y divide-zinc-100 py-1 dark:divide-zinc-800">
        {MTM_DEMO_AGENTS.map((agent) => {
          const week = mtmDemoWeekSoFar(agent)
          const percent = Math.round((week.done / week.planned) * 100)
          return (
            <li key={agent.id} className="flex items-center gap-3 py-2 text-sm">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", agent.status === "PAUSED" ? "bg-violet-400" : ROSTER_STATUS_DOT_CLASS[agent.status])} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{agent.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{statusLabel(agent.status, tMap)}</span>
              </span>
              <span className="flex items-end gap-1" aria-hidden="true">
                {week.days.map(([dayDone, dayPlanned], index) => (
                  <span key={index} className="flex h-7 w-3 items-end overflow-hidden rounded-sm bg-muted">
                    <span className={cn("w-full", dayDone >= dayPlanned ? "bg-emerald-500" : "bg-amber-500")} style={{ height: `${Math.round((dayDone / dayPlanned) * 100)}%` }} />
                  </span>
                ))}
              </span>
              <HomePill tone={PLAN_TONE[mtmPlanTone(percent)]}>{percent}%</HomePill>
            </li>
          )
        })}
      </ul>
    </HomeCard>
  )
}

function statusLabel(status: MtmFieldStatus | "PAUSED", tMap: (key: string) => string): string {
  return status === "PAUSED" ? S.mtmOnBreak : tMap(`fieldStatus.${FIELD_STATUS_LABEL_KEYS[status]}`)
}

/* ── Marşrut xəritədə ─────────────────────────────────────────────────── */

interface PlannedStop {
  readonly key: string
  readonly name: string
  readonly placeName: string
  readonly address: string | null
  readonly contactId: string | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly plannedTime: string
}

function stopsFrom(candidates: readonly RoutePlannerCandidate[]): PlannedStop[] {
  let previous: string | null = null
  return candidates.map((candidate) => {
    const plannedTime = routePlannerNextSlot(previous)
    previous = plannedTime
    return { key: candidate.key, name: candidate.name, placeName: candidate.placeName, address: candidate.address, contactId: candidate.contactId, latitude: candidate.latitude, longitude: candidate.longitude, plannedTime }
  })
}

/** Times follow the order, as the product's planner re-times a moved stop. */
function retimed(stops: readonly PlannedStop[]): PlannedStop[] {
  let previous: string | null = null
  return stops.map((stop) => {
    const plannedTime = routePlannerNextSlot(previous)
    previous = plannedTime
    return { ...stop, plannedTime }
  })
}

function PlanScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("mtmRoutePlanner")
  const locale = useLocale()
  const format = useBakuFormat()
  const today = mtmDemoToday(snapshot.startedAt)
  const day = addDays(today, 1)
  const candidates = useMemo(() => mtmDemoPlannerCandidates(), [])
  const places = useMemo(() => routePlannerPlaces(candidates), [candidates])
  const suggestion = useMemo(() => stopsFrom(suggestRoutePlannerStops({ candidates, route: [] })), [candidates])
  const suggested = snapshot.ui["mtm.planSuggested"] === true
  const published = snapshot.ui["mtm.planPublished"] === true
  const [order, setOrder] = useState<PlannedStop[] | null>(null)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const stops = suggested ? order ?? suggestion : []
  const agent = MTM_DEMO_AGENTS.find((candidate) => candidate.id === MTM_DEMO_PLAN_AGENT)!
  const monthLabel = createDateFormatter(locale, { timeZone: "UTC", month: "long" }).format(new Date(`${day}T12:00:00.000Z`))
  const due = places.filter((place) => place.dueThisMonth).length
  const lengthKm = routePlannerLengthKm(stops)
  const dayMinutes = routePlannerDayMinutes(stops.map((stop) => stop.plannedTime))

  const press = (stepId: string, path: string) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== stepId) {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path, value: true })
  }
  const publish = () => {
    if (!suggested) {
      hint(t("needStops"))
      return
    }
    press("mtm-plan-publish", "mtm.planPublished")
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length || from === to) return
    const next = [...stops]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrder(retimed(next))
  }

  return (
    <div className="space-y-3" data-testid="mtm-route-planner">
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-9 items-center gap-1 rounded-full border border-zinc-200 bg-card px-3 text-sm font-medium dark:border-zinc-700"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("back")}</span>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <HomePill tone={published ? "green" : "amber"}>{published ? S.mtmPublishedBadge : t("draftBadge")}</HomePill>
        <span className="inline-flex h-9 items-center rounded-full border border-zinc-200 bg-card px-3 text-sm font-semibold dark:border-zinc-700">{agent.name}</span>
        <span className="inline-flex h-9 items-center gap-1 rounded-full border border-zinc-200 bg-card px-2 text-sm dark:border-zinc-700">
          <ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold first-letter:uppercase">{format.day(day)}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => hint(S.demoButtonHint)}>{t("save")}</Button>
          <Button onClick={publish} disabled={published} {...(suggested && !published ? demoTarget("mtm-plan-publish") : {})}>
            <Send aria-hidden="true" />{t("publish")}
          </Button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div data-tour-id="mtm-plan-map" className="relative h-[460px] overflow-hidden rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
          <RoutePlannerMap
            places={places}
            stops={stops.map((stop) => ({ key: stop.key, latitude: stop.latitude, longitude: stop.longitude }))}
            selectedPlaceId={selectedPlaceId}
            focusPlaceId={null}
            onSelectPlace={setSelectedPlaceId}
            onAdd={() => hint(S.demoButtonHint)}
            words={{
              label: t("mapLabel"),
              dueThisMonth: t("legendDue", { month: monthLabel }),
              visitedThisMonth: t("legendVisited"),
              inRoute: t("inRoute"),
              placeVisit: t("placeVisit"),
              add: () => t("addStop", { position: stops.length + 1 }),
              candidateLine: (candidate) => [
                candidate.specialtyName,
                candidate.monthlyVisitCount === 0 ? t("notVisitedThisMonth", { month: monthLabel }) : t("visitedThisMonth", { count: candidate.monthlyVisitCount }),
              ].filter(Boolean).join(" · "),
            }}
          />
          <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-wrap gap-2">
            <span className="h-9 rounded-full bg-orange-500 px-3 text-sm font-semibold leading-9 text-white shadow-sm">{t("onlyDue", { month: monthLabel, count: due })}</span>
            <span className="h-9 rounded-full border border-zinc-200 bg-white px-3 text-sm font-semibold leading-9 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">{t("all", { count: places.length })}</span>
          </div>
          <div className="absolute bottom-3 left-3 z-[500] flex flex-wrap items-center gap-3 rounded-full bg-white/95 px-3 py-1.5 text-xs shadow-sm dark:bg-zinc-900/95">
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />{t("legendDue", { month: monthLabel })}</span>
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-400" />{t("legendVisited")}</span>
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-zinc-900" />{t("inRoute")}</span>
          </div>
        </div>

        <aside data-tour-id="mtm-plan-route" className="flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-[15px] font-semibold first-letter:uppercase">{t("routeOf", { day: format.day(day) })}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <HomePill tone={stops.length > 0 ? "green" : "zinc"}>{t("stops", { count: stops.length })}</HomePill>
              {stops.length > 1 ? <HomePill tone="zinc">{t("km", { km: lengthKm.toLocaleString(locale, { maximumFractionDigits: 1 }) })}</HomePill> : null}
              {dayMinutes !== null && stops.length > 0 ? (
                <HomePill tone="zinc">{dayMinutes % 60 === 0 ? t("durationHours", { hours: dayMinutes / 60 }) : t("duration", { hours: Math.floor(dayMinutes / 60), minutes: dayMinutes % 60 })}</HomePill>
              ) : null}
            </div>
          </div>
          {stops.length === 0 ? (
            <p className="flex-1 px-4 py-6 text-sm text-muted-foreground">{t("emptyRoute")}</p>
          ) : (
            <ol className="flex-1 space-y-1.5 p-3">
              {stops.map((stop, index) => (
                <li
                  key={stop.key}
                  draggable={!published}
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event: DragEvent<HTMLLIElement>) => event.preventDefault()}
                  onDrop={(event: DragEvent<HTMLLIElement>) => {
                    event.preventDefault()
                    if (dragIndex !== null) move(dragIndex, index)
                    setDragIndex(null)
                  }}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-card px-2 py-2 dark:border-zinc-700"
                >
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[12px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{stop.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{stop.contactId ? stop.placeName : stop.address}</span>
                  </span>
                  <span className="h-7 rounded-full bg-muted px-2 text-[11px] font-semibold leading-7 tabular-nums">{stop.plannedTime}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
            <Button
              variant="outline"
              className="w-full border-primary/50 bg-primary/5 font-semibold text-primary"
              onClick={() => press("mtm-plan-suggest", "mtm.planSuggested")}
              disabled={suggested}
              {...(suggested ? {} : demoTarget("mtm-plan-suggest"))}
            >
              <Sparkles aria-hidden="true" />{t("suggest")}
            </Button>
            <p className="text-center text-[11px] leading-4 text-muted-foreground">{t("suggestNote", { month: monthLabel })}</p>
            {published ? <p role="status" className="rounded-xl bg-emerald-50 p-2 text-center text-xs font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{t("published")}</p> : null}
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ── Canlı xəritə ─────────────────────────────────────────────────────── */

/**
 * The live map as `/mtm/map` lays it out (owner, 2026-10-17: «на проде
 * отличается от того, который ты показал»): the status chips and the
 * one-line count above, the grey «last known position» notice, the map with
 * its «Laylar» and its tools, and beside it the product's own employee table
 * (`LiveMapRoster`) — one row per person, a tick for the map, status and
 * signal. The rows are the roster the server would send for this team
 * (`mtmDemoRosterAgents`); a click on a name opens his day under the row.
 */
const LIVE_STATUS_CHIPS = [
  { status: "CHECKED_IN", key: "checkedIn", tone: "text-green-600 border-green-200 dark:border-green-800" },
  { status: "ON_ROAD", key: "onRoad", tone: "text-blue-600 border-blue-200 dark:border-blue-800" },
  { status: "STOPPED", key: "stopped", tone: "text-amber-700 border-amber-200 dark:text-amber-300 dark:border-amber-800" },
  { status: "ROUTE_FINISHED", key: "routeFinished", tone: "text-emerald-700 border-emerald-200 dark:text-emerald-300 dark:border-emerald-800" },
  { status: "LATE", key: "late", tone: "text-red-600 border-red-200 dark:border-red-800" },
  { status: "OFFLINE", key: "offline", tone: "text-muted-foreground" },
] as const

/** The page's tools that reach the server or the browser's full screen: explained here instead. */
const LIVE_SIMULATED_CONTROLS = [
  "live-map-roster-export",
  "live-map-roster-print",
  "live-map-roster-hide",
  "live-map-tool-point",
  "live-map-tool-ruler",
  "live-map-tool-fullscreen",
  "mtm-map-mode-history",
].map((id) => `[data-testid="${id}"]`).join(",")

function LiveScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tMap = useTranslations("mtmMap")
  const tNav = useTranslations("nav")
  const tc = useTranslations("common")
  const tf = useTranslations("mtmFilters")
  const format = useBakuFormat()
  const today = mtmDemoToday(snapshot.startedAt)
  const nowMs = Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK))
  const agents = useMemo(() => mtmDemoRosterAgents(today), [today])
  const route = useMemo(() => mtmDemoElvinRoute(today), [today])
  const steps = useMemo(() => mtmDemoElvinSteps(today), [today])
  const chosen = typeof snapshot.ui["mtm.liveAgent"] === "string" ? (snapshot.ui["mtm.liveAgent"] as string) : null
  const [selected, setSelected] = useState<string | null>(chosen)
  const [stopOrder, setStopOrder] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<RosterFilters>({})
  const [view, setView] = useState<RosterView>(ROSTER_DEFAULT_VIEW)
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set())
  const [showLastKnown, setShowLastKnown] = useState(true)
  const [layers, setLayers] = useState({ agents: true, route: true, labels: true })
  const rosterRef = useRef<HTMLDivElement>(null)

  const searched = useMemo(() => {
    const query = foldRosterText(search.trim())
    return query ? agents.filter((agent) => foldRosterText(agent.name).includes(query)) : agents
  }, [agents, search])
  const rows = useMemo(() => sortRoster(applyRosterFilters(searched, filters), view.sort, "az"), [searched, filters, view.sort])
  // The page's own rule: a live position while the workday runs, and the
  // last known one — grey — when the signal is old, never a point from a break.
  const mapAgents: LiveMapAgent[] = rows.flatMap((agent) => {
    if (!layers.agents || hiddenIds.has(agent.agentId)) return []
    const lastKnown = showLastKnown && agent.freshness === "STALE"
    if ((!isLiveMapAgentPositionVisible(agent.freshness, agent.workdayState) && !lastKnown) || agent.latitude === undefined || agent.longitude === undefined || !agent.recordedAt) return []
    return [{ ...agent, freshness: agent.freshness as LiveMapAgent["freshness"], latitude: agent.latitude, longitude: agent.longitude, recordedAt: agent.recordedAt }]
  })
  const stalePositions = rows.filter((agent) => agent.freshness === "STALE").length
  const count = (status: string) => agents.filter((agent) => agent.fieldStatus === status).length

  // The guide's arrow points at Elvin's name in the product's own row.
  useEffect(() => {
    const name = rosterRef.current?.querySelector<HTMLElement>('[data-testid="live-map-agent-card-agent-elvin"] button[aria-pressed]')
    if (!name) return
    if (selected === "agent-elvin") name.removeAttribute(DEMO_TARGET_ATTRIBUTE)
    else for (const [attribute, value] of Object.entries(demoTarget("mtm-live-agent"))) name.setAttribute(attribute, value)
  })

  const choose = (agentId: string) => {
    setSelected((current) => (current === agentId ? null : agentId))
    setStopOrder(null)
    if (!reviewMode && step?.id === "mtm-live-agent" && agentId === "agent-elvin") dispatch({ type: "ui", path: "mtm.liveAgent", value: agentId })
  }
  const simulated = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element | null)?.closest?.(LIVE_SIMULATED_CONTROLS)) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }
  const layer = (id: keyof typeof layers, label: string, layerHint: string) => ({ id, label, hint: layerHint, on: layers[id], onToggle: () => setLayers((current) => ({ ...current, [id]: !current[id] })), shownByDefault: true })

  return (
    <div className="space-y-3" onClickCapture={simulated}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{tNav("mtmMap")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border bg-muted/40 p-0.5" role="tablist" aria-label={tMap("modeLabel")}>
            <Button type="button" role="tab" aria-selected size="sm" className="min-h-9"><Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{tMap("liveMode")}</Button>
            <Button type="button" role="tab" aria-selected={false} variant="ghost" size="sm" className="min-h-9" data-testid="mtm-map-mode-history"><History className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{tMap("historyMode")}</Button>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" aria-hidden="true" />{tMap("lastUpdate")}: {S.mtmAsOf(MTM_DEMO_CLOCK)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={tc("status")}>
        <Button size="sm" className="min-h-9" onClick={() => setFilters({})}>{tc("all")} ({agents.length})</Button>
        {LIVE_STATUS_CHIPS.map((chip) => (
          <Button key={chip.status} size="sm" variant="outline" className={cn("min-h-9", chip.tone)} onClick={() => hint(S.demoButtonHint)}>
            {tMap(`fieldStatus.${chip.key}`)} ({count(chip.status)})
          </Button>
        ))}
      </div>

      <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
        <span className="font-semibold">{tMap("agents")}: {agents.length}</span>
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-bold">{tMap("appPresence")}:</span>
          <span className="text-green-700 dark:text-green-400">{tMap("presence.online")} {agents.filter((agent) => agent.isOnline).length}</span>
          <span className="text-muted-foreground">{tMap("presence.offline")} {agents.filter((agent) => !agent.isOnline).length}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-bold">{tMap("gpsFreshness")}:</span>
          <span className="text-blue-700 dark:text-blue-400">{tMap("freshness.online")} {agents.filter((agent) => agent.freshness === "ONLINE").length}</span>
          <span className="text-amber-700 dark:text-amber-300">{tMap("freshness.delayed")} {agents.filter((agent) => agent.freshness === "DELAYED").length}</span>
          <span className="text-muted-foreground">{tMap("freshness.stale")} {agents.filter((agent) => agent.freshness === "STALE").length}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-bold">{tMap("workdayState")}:</span>
          <span className="text-emerald-700 dark:text-emerald-400">{tMap("workday.active")} {agents.filter((agent) => agent.workdayState === "ACTIVE").length}</span>
          <span className="text-amber-700 dark:text-amber-300">{tMap("workday.paused")} {agents.filter((agent) => agent.workdayState === "PAUSED").length}</span>
        </span>
      </div>

      {stalePositions > 0 ? (
        <div role="status" data-testid="mtm-live-last-known" className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-muted/40 px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {showLastKnown ? tMap("lastKnownShown", { count: stalePositions }) : tMap("stalePositionsHidden", { count: stalePositions })}
          <button type="button" onClick={() => setShowLastKnown((value) => !value)} className="font-semibold text-foreground underline underline-offset-2">
            {showLastKnown ? tMap("hideLastKnown") : tMap("showLastKnown")}
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div data-tour-id="mtm-live-map" className="relative isolate h-[54vh] min-h-[360px] overflow-hidden rounded-lg border border-zinc-200 bg-card lg:h-[560px] dark:border-zinc-700">
          <MtmLiveMap
            agents={mapAgents}
            plannedRoute={layers.route && selected === "agent-elvin" ? route : undefined}
            focusAgentId={selected}
            onAgentSelect={choose}
            focusStopOrder={stopOrder}
            onStopSelect={setStopOrder}
            showLabels={layers.labels}
            showWorkdayStatus
            timeZone={MTM_DEMO_TIMEZONE}
          />
          <LiveMapLayersControl
            layers={[
              layer("agents", tMap("layers.agents"), tMap("layers.agentsHint")),
              layer("route", tMap("layers.route"), tMap("layers.routeHint")),
              layer("labels", tMap("layers.labels"), tMap("layers.labelsHint")),
            ]}
            hiddenAgentCount={hiddenIds.size}
            onShowAllAgents={() => setHiddenIds(new Set())}
            note={tMap("historyOnlyExplicit")}
          />
          <LiveMapTools
            near={mapAgents[0] ? { latitude: mapAgents[0].latitude, longitude: mapAgents[0].longitude } : null}
            referencePoint={null}
            onReferencePointChange={() => hint(S.demoButtonHint)}
            pickingPoint={false}
            onPickingPointChange={() => hint(S.demoButtonHint)}
            rulerActive={false}
            onRulerToggle={() => hint(S.demoButtonHint)}
            rulerMeters={0}
            rulerPointCount={0}
            onRulerUndo={() => undefined}
            formatDistance={(meters) => `${Math.round(meters)} m`}
            fullscreen={false}
            onFullscreenToggle={() => hint(S.demoButtonHint)}
            fullscreenSupported
          />
        </div>
        <div data-tour-id="mtm-live-roster" ref={rosterRef} className="min-w-0">
          <LiveMapRoster
            agents={searched}
            rows={rows}
            searchSlot={
              <MtmFilterBar testId="mtm-map-filters">
                <MtmFilterSearch value={search} onChange={setSearch} delayMs={0} placeholder={tMap("employeePlaceholder")} label={tMap("employeeFilter")} clearLabel={tf("clearSearch")} />
              </MtmFilterBar>
            }
            filters={filters}
            onFiltersChange={setFilters}
            view={view}
            onViewChange={setView}
            onHide={() => hint(S.demoButtonHint)}
            hiddenAgentIds={hiddenIds}
            onToggleAgentOnMap={(agentId) => setHiddenIds((current) => {
              const next = new Set(current)
              if (next.has(agentId)) next.delete(agentId)
              else next.add(agentId)
              return next
            })}
            onSetAgentsOnMap={(agentIds, onMap) => setHiddenIds((current) => {
              const next = new Set(current)
              for (const agentId of agentIds) if (onMap) next.delete(agentId)
              else next.add(agentId)
              return next
            })}
            selectedAgentId={selected}
            onSelect={choose}
            renderDetail={(agent) => agent.agentId === "agent-elvin" ? (
              <LiveMapDaySteps steps={steps} selectedOrder={stopOrder} onSelect={setStopOrder} formatTime={format.clock} />
            ) : agent.workdayState === "PAUSED" ? (
              <p className="text-xs leading-relaxed text-violet-900 dark:text-violet-200">{S.mtmBreakPrivate}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{S.mtmOtherAgentDay}</p>
            )}
            nowMs={nowMs}
            workforceEnabled
            formatClock={format.clock}
            formatVisitOpened={(value) => format.clock(value)}
            isEarlierDay={() => false}
            exportFileName={() => "leaddrive-demo-xerite"}
            printTitle={() => `${tNav("mtmMap")} · ${MTM_DEMO_CLOCK}`}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Vizitin sübutu ───────────────────────────────────────────────────── */

function VisitScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tVisits = useTranslations("mtmVisitsPage")
  const format = useBakuFormat()
  const today = mtmDemoToday(snapshot.startedAt)
  const visit = useMemo(() => mtmDemoVisit(today), [today])
  const leftOpen = useMemo(() => mtmDemoLeftOpen(today), [today])
  const place = useMemo(() => visitPlaceSummary(visit.placeInput), [visit])
  const reminded = snapshot.ui["mtm.reminded"] === true
  const minutes = Math.round((Date.parse(visit.checkOutAt) - Date.parse(visit.checkInAt)) / 60_000)
  const openMinutes = Math.round((Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK)) - Date.parse(leftOpen.since)) / 60_000)
  const openFor = mtmVisitOpenFor(openMinutes)
  const openForText = tVisits(openFor.unit === "days" ? "openForDays" : openFor.unit === "hours" ? "openForHours" : "openForMinutes", { count: openFor.value })

  const remind = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "mtm-visit-remind") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path: "mtm.reminded", value: true })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel className="space-y-4 p-4">
        <div data-tour-id="mtm-visit-card" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{visit.place}</h2>
              <p className="text-sm text-muted-foreground">{visit.doctor} · {visit.specialty} · {visit.address}</p>
              <p className="mt-1 text-sm">{visit.agent}</p>
            </div>
            <HomePill tone="green">{S.mtmVisitClosed}</HomePill>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Fact label={tVisits("colCheckIn")} value={format.clock(visit.checkInAt)} />
            <Fact label={tVisits("colCheckOut")} value={format.clock(visit.checkOutAt)} />
            <Fact label={S.mtmDuration} value={S.mtmMinutes(minutes)} />
          </dl>
          <VisitPlaceBadge place={place} showDistanceDetail />
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{S.mtmPhotos}</h3>
            <VisitPhotoGrid
              photos={visit.photos}
              formatTime={(value) => format.clock(value)}
              openLabel={(index) => S.mtmPhotoOpen(index + 1)}
              titleLabel={(index) => S.mtmPhotoOpen(index + 1)}
            />
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{S.mtmPresentationTitle}</h3>
              <p className="mt-1 text-sm font-medium">{visit.presentation.title}</p>
              <p className="text-xs text-muted-foreground">{S.mtmPresentationShown(visit.presentation.slides, visit.presentation.minutes)}</p>
            </section>
            <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{S.mtmSignature}</h3>
              {/* eslint-disable-next-line @next/next/no-img-element -- a static sample, not a tenant upload */}
              <img src={visit.signature} alt={S.mtmSignature} className="mt-1 h-16 w-auto" />
            </section>
          </div>
          <section className="rounded-xl bg-muted/40 p-3 text-sm">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{S.mtmNote}</h3>
            <p className="mt-1">{visit.note}</p>
          </section>
        </div>
      </Panel>

      <Panel className="h-fit p-4">
        <div data-tour-id="mtm-visit-left-open" className="space-y-3">
          <h3 className="text-[15px] font-semibold">{tVisits("leftOpenTitle", { count: 1 })}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{tVisits("leftOpenHint")}</p>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <p className="font-medium">{leftOpen.agent}</p>
            <p className="text-xs text-muted-foreground">{leftOpen.place} · {leftOpen.doctor}</p>
            <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">{tVisits("leftOpenSince", { since: format.short(leftOpen.since), openFor: openForText })}</p>
          </div>
          {reminded ? (
            <p role="status" className="rounded-xl bg-emerald-50 p-2 text-center text-xs font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{tVisits("reminded")}</p>
          ) : (
            <Button className="w-full" onClick={remind} {...demoTarget("mtm-visit-remind")}>
              <BellRing aria-hidden="true" />{tVisits("remindAgent")}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}

/** A card in the MTM home screen's own frame (home-parts.tsx CARD). */
function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-zinc-200 bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-zinc-700", className)}>{children}</div>
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/* ── «Müştəri buradadır» ──────────────────────────────────────────────── */

function PlaceScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("mtmRoutesPage")
  const format = useBakuFormat()
  const today = mtmDemoToday(snapshot.startedAt)
  const request = useMemo(() => mtmDemoPlaceRequest(today), [today])
  const approved = snapshot.ui["mtm.placeApproved"] === true

  const approve = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (step?.id !== "mtm-place-approve") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    dispatch({ type: "ui", path: "mtm.placeApproved", value: true })
  }

  return (
    <Panel className="p-4">
      <div data-tour-id="mtm-place-request" className="space-y-3">
        <h2 className="text-[15px] font-semibold">{t("locationQueueTitle")}</h2>
        <div>
          <p className="font-medium">{t("locationHeadline", { customer: request.customer })}</p>
          <p className="text-xs text-muted-foreground">{t("locationSentBy", { agent: request.agent, when: format.clock(request.sentAt) })}</p>
          <p className="text-xs text-muted-foreground">{t("locationAddress", { address: request.address })}</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative h-[320px] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
            <CustomerLocationRequestMap
              previous={approved ? null : request.previous}
              proposed={request.proposed}
              agentFix={request.agentFix}
              labels={{ previous: t("locationMapPrevious"), proposed: t("locationMapProposed") }}
            />
          </div>
          <div className="space-y-2 text-sm">
            <dl className="space-y-1.5">
              <PlaceFact label={t("locationFactMoved")} value={t("locationMeters", { meters: request.movedMeters })} />
              <PlaceFact label={t("locationFactAccuracy")} value={t("locationAccuracyValue", { meters: request.agentFix.accuracyMeters })} />
              <PlaceFact label={t("locationFactAgentDistance")} value={t("locationMeters", { meters: request.agentToProposedMeters })} />
            </dl>
            <div className="rounded-xl bg-muted/40 p-2.5">
              <p className="text-xs font-semibold text-muted-foreground">{t("locationAgentComment")}</p>
              <p className="mt-0.5">{request.comment}</p>
            </div>
            {approved ? (
              <p role="status" className="rounded-xl bg-emerald-50 p-2.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                {t("locationAccepted")} {S.mtmPlaceVisitInZone}
              </p>
            ) : (
              <div className="flex gap-2">
                <Button className="flex-1" onClick={approve} {...demoTarget("mtm-place-approve")}>
                  <CheckCircle2 aria-hidden="true" />{t("locationAccept")}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => hint(S.demoButtonHint)}>{t("locationReject")}</Button>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">{S.mtmPlaceGuard}</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function PlaceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-1.5 dark:border-zinc-800">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/* ── Nəticələr ────────────────────────────────────────────────────────── */

/** Last week, whole: a finished week reads cleaner than one cut at Thursday noon. */
function ResultsScreen() {
  const t = useTranslations("mtmTeamResults")
  const rows = [...MTM_DEMO_AGENTS]
    .map((agent) => ({ agent, done: agent.lastWeek[0], planned: agent.lastWeek[1], percent: Math.round((agent.lastWeek[0] / agent.lastWeek[1]) * 100) }))
    // Behind the plan first, as the product's table orders them.
    .sort((left, right) => left.percent - right.percent)
  const planned = rows.reduce((sum, row) => sum + row.planned, 0)
  const done = rows.reduce((sum, row) => sum + row.done, 0)
  const percent = Math.round((done / planned) * 100)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("period")}:</span>
        {(["thisWeek", "lastWeek", "thisMonth"] as const).map((preset) => (
          <span key={preset} className={cn("rounded-full px-3 py-1 text-sm font-medium", preset === "lastWeek" ? "bg-foreground text-background" : "border border-zinc-200 text-muted-foreground dark:border-zinc-700")}>
            {t(`preset.${preset}`)}
          </span>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <HomeKpi
          testId="mtm-results-plan"
          label={t("cardPlan")}
          icon={<RouteIcon className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={PLAN_TONE[mtmPlanTone(percent)]}
          value={`${percent}%`}
          progress={percent}
          sub={t("cardPlanDetail", { planned, done })}
        />
        <HomeKpi
          testId="mtm-results-visits"
          label={t("cardVisits")}
          icon={<CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone="blue"
          value={String(done)}
          sub={t("cardVisitsDetail")}
        />
      </div>
      <Panel className="p-4">
        <div data-tour-id="mtm-results-team">
          <h3 className="text-[15px] font-semibold">{t("tableTitle")}</h3>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">{t("colAgent")}</th>
                <th className="py-1.5 font-medium">{t("colPlan")}</th>
                <th className="py-1.5 text-right font-medium">{t("colPercent")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ agent, done: agentDone, planned: agentPlanned, percent: agentPercent }) => (
                <tr key={agent.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 font-medium">{agent.name}</td>
                  <td className="py-2 tabular-nums text-muted-foreground">{t("doneOfPlanned", { planned: agentPlanned, done: agentDone })}</td>
                  <td className="py-2 text-right"><HomePill tone={PLAN_TONE[mtmPlanTone(agentPercent)]}>{agentPercent}%</HomePill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
