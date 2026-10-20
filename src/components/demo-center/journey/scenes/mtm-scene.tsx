"use client"

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { Activity, AlertTriangle, ArrowLeft, ArrowUpRight, BarChart3, BellRing, Check, CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Clock3, Download, FileSpreadsheet, Flag, Grid2X2, GripVertical, History, Layers3, List, LocateFixed, MapPin, Navigation, Pause, PauseCircle, PhoneIncoming, Play, Plus, Radio, RefreshCw, RotateCcw, Route as RouteIcon, Satellite, Search, Send, Sparkles, TrendingUp, WifiOff, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { HintValue } from "@/components/hint"
import { ADVISOR_RECORD_COPY } from "@/components/ai/advisor-record-widget"
import { MTM_TAB_ROW, mtmChipClass, mtmTabClass } from "@/components/mtm/calm-classes"
import { DayTripLedger, type DayTripFocus } from "@/components/mtm/day-trip-ledger"
import type { LiveMapReferencePoint } from "@/components/mtm/live-map"
import { HomeAttentionCard, attentionRowCount } from "@/components/mtm/home-attention-card"
import { HomeBaseCard, HomeQualityCard } from "@/components/mtm/home-insight-cards"
import { HomeTeamCard } from "@/components/mtm/home-team-card"
import { HomeKpi, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { LiveMapDaySteps } from "@/components/mtm/live-map-day-steps"
import { LiveMapLayersControl } from "@/components/mtm/live-map-layers-control"
import { LiveMapRoster } from "@/components/mtm/live-map-roster"
import { LiveMapTools } from "@/components/mtm/live-map-tools"
import { MtmFilterBar, MtmFilterDate, MtmFilterSearch, MtmFilterSelect, MtmResultLine } from "@/components/mtm/filter-bar"
import { VisitReviewView, visitStatusClasses } from "@/app/(dashboard)/mtm/visits/visit-review-panel"
import { useOpenForText } from "@/app/(dashboard)/mtm/visits/visit-left-open"
import { PageDescription } from "@/components/page-description"
import { AGENT_PERIOD_PRESETS, agentPeriodPreset } from "@/components/mtm/agent-period-view"
import { MtmTeamResultsView } from "@/components/mtm/team-results"
import { VisitPlaceBadge } from "@/components/mtm/visit-place-badge"
import { createDateFormatter, formatDate, formatDateTime } from "@/lib/format-date"
import { MTM_ROUTE_TIME_SLOTS } from "@/lib/mtm/route-time-slots"
import { isLiveMapAgentPositionVisible, type LiveMapAgent, type MtmDashboardAgent } from "@/lib/mtm-types"
import { defaultWeek, fieldNow, finishedDaysPercent, homeTeam, percentOf, planCard, todayPlan, weekComparison, weekTotals } from "@/lib/mtm/home-dashboard"
import { buildHomeBase } from "@/lib/mtm/home-insights"
import { buildExplainableKpi } from "@/lib/mtm/explainable-kpi"
import { applyRosterFilters, foldRosterText, rosterDistanceToPoint, ROSTER_DEFAULT_VIEW, sortRoster, withRosterFilter, type RosterFilters, type RosterSort, type RosterView } from "@/lib/mtm/live-map-roster"
import type { LiveMapClient } from "@/lib/mtm/live-map-clients"
import { extendLiveMapTrails, type LiveMapTrails } from "@/lib/mtm/live-map-trails"
import { HISTORY_MAP_COLORS } from "@/lib/mtm/history-path"
import { MAX_RANGE_DAYS } from "@/lib/mtm/history-range"
import { mtmSpeedKmh } from "@/lib/mtm/gps-speed"
import { formatInTimezone } from "@/lib/timezone"
import {
  routePlannerDayMinutes,
  routePlannerLengthKm,
  routePlannerNextSlot,
  routePlannerPlaces,
  suggestRoutePlannerStops,
  type RoutePlannerCandidate,
} from "@/lib/mtm/route-planner"
import { isMtmNavigationItemActive, MTM_PRIMARY_NAVIGATION } from "@/lib/mtm/navigation"
import { mtmPlanTone } from "@/lib/mtm/team-results"
import { medianVisitDurationMinutes } from "@/lib/mtm/visit-duration-median"
import { visitStatusKey } from "@/lib/mtm/visit-review"
import { visitPlaceSummary } from "@/lib/mtm/visit-place-check"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_TARGET_ATTRIBUTE, demoTarget } from "../demo-target"
import { DemoHelpButton } from "./demo-help-button"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import {
  MTM_DEMO_AGENTS,
  MTM_DEMO_CLOCK,
  MTM_DEMO_EVENING,
  MTM_DEMO_FRESHNESS,
  MTM_DEMO_PLAN_AGENT,
  MTM_DEMO_TIMEZONE,
  addDays,
  mtmDemoAt,
  mtmDemoAttention,
  mtmDemoElvinRoute,
  mtmDemoElvinSteps,
  mtmDemoHome,
  mtmDemoKpiFacts,
  mtmDemoLeftOpen,
  mtmDemoMapClients,
  mtmDemoRosterAgents,
  mtmDemoPlaceRequest,
  mtmDemoPlannerCandidates,
  mtmDemoToday,
  mtmDemoVisitHistory,
  mtmDemoVisitReview,
  type MtmDemoHistoryVisit,
} from "./mtm-demo-data"
import { mtmDemoElvinHistoryView } from "./mtm-demo-day"

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
const LocationHistoryMap = dynamic(() => import("@/components/mtm/location-history-map"), { ssr: false })
const RoutePlannerMap = dynamic(() => import("@/components/mtm/route-planner-map"), { ssr: false })
const CustomerLocationRequestMap = dynamic(() => import("@/components/mtm/customer-location-request-map"), { ssr: false })

type MtmScreen = "today" | "plan" | "live" | "visit" | "place" | "history" | "results"

const SCREEN_OF: Record<string, MtmScreen> = {
  "mtm-today": "today",
  "mtm-place": "place",
  "mtm-plan": "plan",
  "mtm-live": "live",
  "mtm-visit": "visit",
  "mtm-history": "history",
  "mtm-results": "results",
}

/** The page each screen is in the product: the module's menu lights up as it does there. */
const PATH_OF: Record<MtmScreen, string> = {
  today: "/mtm",
  plan: "/mtm/routes/plan",
  live: "/mtm/map",
  visit: "/mtm/visits",
  place: "/mtm/routes",
  history: "/mtm/map",
  results: "/mtm/analytics",
}

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
      {/* The product's MtmModuleNavigation, drawn from its own list (it reads the
          session to filter the tools): one menu with an underline, the chosen
          page dark text over an orange line (owner-approved colours, 2026-10-18). */}
      <div className="mb-6 border-b border-zinc-200/80 dark:border-zinc-700/80">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <nav aria-label={t("primaryNavigationLabel")} className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 sm:flex-1">
            {MTM_PRIMARY_NAVIGATION.map((item) => {
              const active = isMtmNavigationItemActive(item.href, PATH_OF[screen])
              const Icon = item.icon
              return (
                <button
                  key={item.href}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => (active ? undefined : hint(S.mtmTabHint))}
                  className={cn(
                    "-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium outline-none transition-[border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-primary/35",
                    active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </button>
              )
            })}
          </nav>
          {/* None of the demo's pages is one of the tools, so the button keeps its grey edge. */}
          <button type="button" onClick={() => hint(S.mtmTabHint)} className="mb-2 flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-card px-4 text-sm font-semibold text-foreground outline-none transition-[background-color,border-color,color,transform] duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 active:scale-[0.98] sm:w-auto dark:border-zinc-700">
            <Grid2X2 className="h-4 w-4" aria-hidden="true" />
            <span>{t("allTools")}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      </div>
      {screen === "today" && <TodayScreen {...props} />}
      {screen === "plan" && <PlanScreen {...props} />}
      {screen === "live" && <LiveScreen {...props} />}
      {screen === "visit" && <VisitScreen {...props} />}
      {screen === "place" && <PlaceScreen {...props} />}
      {screen === "history" && <HistoryScreen {...props} />}
      {screen === "results" && <ResultsScreen {...props} />}
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

/**
 * «Bu gün» as `MtmHomeDashboard` draws it: the date and «İş günü · 12:10
 * üzrə», the team filter, four figures, what waits, the team with a strip of
 * the week, and below it the base and the visits judged. The product's
 * dashboard reads three answers itself; here the same answers come from
 * `mtmDemoHome` and every figure is the product's own arithmetic over them
 * (`src/lib/mtm/home-dashboard.ts`, `buildHomeBase`), «than last week»
 * included — none is typed in.
 */
function TodayScreen({ snapshot, hint }: DemoSceneProps) {
  const t = useTranslations("mtmDashboardPage.home")
  const tw = useTranslations("mtmDashboardPage.operationalWeek")
  const today = mtmDemoToday(snapshot.startedAt)
  const format = useBakuFormat()
  const attention = useMemo(() => mtmDemoAttention(today), [today])
  const home = useMemo(() => mtmDemoHome(today), [today])

  const entries = homeTeam(home.rows, true)
  const now = fieldNow(entries)
  const plan = todayPlan(entries)
  const weekDays = attention.week.length === 7 ? attention.week : defaultWeek(today)
  const totals = weekTotals(home.facts, { from: weekDays[0].date, to: today })
  const comparison = weekComparison(totals, home.previous)
  const card = planCard({ today, plan, nextWorkday: attention.nextWorkday ?? null })
  const waiting = attentionRowCount(attention) ?? 0
  const base = buildHomeBase(home.base)

  const lastVisitParts = [
    now.heading > 0 ? t("partHeading", { count: now.heading }) : null,
    now.notStarted > 0 ? t("partNotStarted", { count: now.notStarted }) : null,
    now.planDone > 0 ? t("partPlanDone", { count: now.planDone }) : null,
    now.idle > 0 ? t("partIdle", { count: now.idle }) : null,
  ].filter(Boolean).join(" · ")
  const planPercent = card.kind === "today" ? percentOf(card.done, card.planned) : null
  const weekPercent = percentOf(totals.done, totals.planned)
  const finishedPercent = finishedDaysPercent(home.facts, { from: weekDays[0].date, today })
  const weekTone: HomeTone = weekPercent === null ? "zinc" : finishedPercent === null ? (weekPercent >= 95 ? "green" : "amber") : PLAN_TONE[mtmPlanTone(finishedPercent)]
  const weekSub = totals.planned === 0
    ? t("weekNoPlan")
    : comparison.kind === "delta"
      ? comparison.delta > 0
        ? t("weekDeltaUp", { percent: comparison.previousPercent, delta: comparison.delta })
        : comparison.delta < 0
          ? t("weekDeltaDown", { percent: comparison.previousPercent, delta: Math.abs(comparison.delta) })
          : t("weekDeltaSame", { percent: comparison.previousPercent })
      : comparison.kind === "no-plan" ? t("weekNoPlanLastWeek") : totals.planned > totals.done ? t("weekRemaining", { count: totals.planned - totals.done }) : t("weekAllDone")
  const countOf = (...kinds: string[]) => attention.items.filter((item) => kinds.includes(item.kind)).reduce((sum, item) => sum + item.count, 0)
  const requests = countOf("customerLocationRequests", "contactCreateRequests", "customerCreateRequests", "routeChangeRequests")
  const waitingParts = [
    requests > 0 ? t("shortRequests", { count: requests }) : null,
    countOf("routesAwaitingPublish") > 0 ? t("shortDrafts", { count: countOf("routesAwaitingPublish") }) : null,
    countOf("olderAlerts") > 0 ? t("shortAlerts", { count: countOf("olderAlerts") }) : null,
    countOf("photosPendingReview") > 0 ? t("shortPhotos", { count: countOf("photosPendingReview") }) : null,
    attention.nextWorkday && attention.nextWorkday.withoutRoute > 0 ? t("shortNextDay") : null,
  ].filter(Boolean).join(" · ")

  return (
    <div data-testid="mtm-home" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight first-letter:uppercase">{format.day(today)}</h2>
          <p className="min-h-5 text-sm text-muted-foreground">{[t(attention.todayIsWorkingDay ? "workingDay" : "dayOff"), tw("summaryAsOf", { time: MTM_DEMO_CLOCK }), S.mtmSampleDayNote].join(" · ")}</p>
        </div>
        {/* The page's own controls: «Kömək», then the team, the employee and the refresh in one row. */}
        <div className="flex flex-wrap items-center gap-2">
          <DemoHelpButton variant="label" onClick={() => hint(S.demoButtonHint)} />
          <MtmFilterBar testId="mtm-week-filters">
            <MtmFilterSelect testId="mtm-week-team" label={tw("team")} value="" allLabel={tw("allTeams")} options={[{ value: "team-center", label: "Bakı — Mərkəz" }, { value: "team-south", label: "Bakı — Cənub" }]} onChange={() => hint(S.demoButtonHint)} />
            <MtmFilterSelect testId="mtm-week-employee" label={tw("employee")} value="" allLabel={tw("chooseEmployee")} options={MTM_DEMO_AGENTS.map((agent) => ({ value: agent.id, label: agent.name }))} onChange={() => hint(S.mtmTabHint)} />
            <Button type="button" variant="outline" size="icon" className="h-11 w-11" aria-label={tw("refresh")} onClick={() => hint(S.demoButtonHint)}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
          </MtmFilterBar>
        </div>
      </div>

      <div data-tour-id="mtm-home-kpis" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HomeKpi
          testId="mtm-home-kpi-field"
          label={t("kpiInField")}
          hint={t("hint.kpiInField")}
          icon={<MapPin className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={now.inField > 0 ? "green" : "zinc"}
          value={String(now.inField)}
          unit={t("kpiInFieldUnit", { total: now.total })}
          pill={now.atCustomer > 0 ? t("pillAtCustomer", { count: now.atCustomer }) : null}
          sub={lastVisitParts || null}
        />
        <HomeKpi
          testId="mtm-home-kpi-plan"
          label={t("kpiTodayPlan")}
          hint={t("hint.kpiTodayPlan")}
          icon={<CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={planPercent !== null && planPercent >= 95 ? "green" : "amber"}
          value={card.kind === "today" ? String(card.done) : null}
          unit={card.kind === "today" ? t("kpiPointsUnit", { total: card.planned }) : null}
          pill={planPercent !== null ? `${planPercent}%` : null}
          progress={planPercent}
          sub={card.kind === "today" ? t("todayVisits", { count: card.visits }) : null}
        />
        <HomeKpi
          testId="mtm-home-kpi-week"
          label={t("kpiWeekPlan")}
          hint={t("hint.kpiWeekPlan")}
          icon={<TrendingUp className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={weekTone}
          value={totals.planned > 0 ? String(totals.done) : null}
          unit={totals.planned > 0 ? t("kpiPointsUnit", { total: totals.planned }) : null}
          pill={weekPercent !== null ? `${weekPercent}%` : null}
          progress={weekPercent}
          sub={weekSub}
        />
        <HomeKpi
          testId="mtm-home-kpi-attention"
          label={t("kpiAttention")}
          hint={t("hint.kpiAttention")}
          icon={<BellRing className="h-[18px] w-[18px]" aria-hidden="true" />}
          tone={waiting > 0 ? "amber" : "green"}
          value={String(waiting)}
          unit={waiting ? t("issuesUnit", { count: waiting }) : null}
          sub={waiting === 0 ? t("attentionClear") : waitingParts}
        />
      </div>

      <div className="grid gap-4 min-[1400px]:grid-cols-2">
        <div data-tour-id="mtm-home-attention">
          <HomeAttentionCard state={{ data: attention, failed: false, retry: () => {} }} />
        </div>
        <HomeTeamCard
          team={entries}
          hasCards
          loading={false}
          failed={false}
          today={today}
          timezone={MTM_DEMO_TIMEZONE}
          week={weekDays}
          facts={home.facts}
          weekFailed={false}
          totals={totals}
          recentVisits={home.recentVisits}
          onRetry={() => {}}
          onRetryWeek={() => {}}
          onOpenAgent={() => hint(S.mtmTabHint)}
        />
      </div>

      <div className="grid gap-4 min-[1400px]:grid-cols-2">
        <HomeBaseCard base={base} monthStart={home.monthStart} />
        <HomeQualityCard quality={home.quality} />
      </div>
    </div>
  )
}

/* ── Marşrut xəritədə ─────────────────────────────────────────────────── */

/**
 * «Yeni marşrut» as `MtmRoutePlanner` draws it, with its rules: the map opens
 * on the clients nobody has seen this month, a point on the map adds its
 * client, «Marşrut təklif et» adds the nearest of those not yet in the route
 * (`suggestRoutePlannerStops`), a moved stop takes the time of the place it
 * lands on, every time can be changed and every stop removed. The planner
 * saves through the API, so its frame is drawn here with its words.
 */
interface PlannedStop {
  readonly key: string
  readonly customerId: string
  readonly contactId: string | null
  readonly name: string
  readonly placeName: string
  readonly address: string | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly plannedTime: string
}

function plannedStop(candidate: RoutePlannerCandidate, plannedTime: string): PlannedStop {
  return { key: candidate.key, customerId: candidate.customerId, contactId: candidate.contactId, name: candidate.contactId ? candidate.name : candidate.placeName, placeName: candidate.placeName, address: candidate.address, latitude: candidate.latitude, longitude: candidate.longitude, plannedTime }
}

/** The planner's own rule: times stay with the positions. */
function retimed(order: readonly PlannedStop[], times: readonly string[]): PlannedStop[] {
  const slots = [...times].sort()
  return order.map((stop, index) => ({ ...stop, plannedTime: slots[index] ?? routePlannerNextSlot(slots[slots.length - 1]) }))
}

/** The planner's map chips (route-planner.tsx): the chosen one outlined dark with an inset ring, the rest white. */
const PLANNER_CHIP_ON = "border border-foreground bg-white text-foreground ring-1 ring-inset ring-foreground dark:bg-zinc-900"
const PLANNER_CHIP_OFF = "border border-zinc-200 bg-white text-foreground dark:border-zinc-700 dark:bg-zinc-900"

function PlanScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("mtmRoutePlanner")
  const locale = useLocale()
  const today = mtmDemoToday(snapshot.startedAt)
  const day = addDays(today, 1)
  const placeApproved = snapshot.ui["mtm.placeApproved"] === true
  const candidates = useMemo(() => mtmDemoPlannerCandidates(placeApproved), [placeApproved])
  const allPlaces = useMemo(() => routePlannerPlaces(candidates), [candidates])
  const categories = useMemo(() => [...new Set(candidates.map((candidate) => candidate.category).filter((value): value is string => Boolean(value)))].sort(), [candidates])
  const [onlyDue, setOnlyDue] = useState(true)
  const [category, setCategory] = useState("")
  const [query, setQuery] = useState("")
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [focusPlaceId, setFocusPlaceId] = useState<string | null>(null)
  const [stops, setStops] = useState<PlannedStop[]>(() => snapshot.ui["mtm.planSuggested"] === true
    ? (() => { let previous: string | undefined; return suggestRoutePlannerStops({ candidates, route: [] }).map((candidate) => { previous = routePlannerNextSlot(previous); return plannedStop(candidate, previous) }) })()
    : [])
  const dragIndex = useRef<number | null>(null)
  const agent = MTM_DEMO_AGENTS.find((candidate) => candidate.id === MTM_DEMO_PLAN_AGENT)!
  const monthLabel = formatDate(`${day}T12:00:00.000Z`, locale, { month: "long", timeZone: "UTC" })
  const dayLabel = formatDate(`${day}T12:00:00.000Z`, locale, { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" })
  const routeDayLabel = formatDate(`${day}T12:00:00.000Z`, locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
  const places = useMemo(() => allPlaces.filter((place) => (!onlyDue || place.dueThisMonth)
    && (!category || place.candidates.some((candidate) => candidate.category === category))), [allPlaces, category, onlyDue])
  const duePlaces = allPlaces.filter((place) => place.dueThisMonth).length
  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    if (needle.length < 2) return []
    return allPlaces.filter((place) => [place.name, place.address ?? "", ...place.candidates.map((candidate) => candidate.name)]
      .some((text) => text.toLocaleLowerCase(locale).includes(needle))).slice(0, 8)
  }, [allPlaces, locale, query])
  const lengthKm = routePlannerLengthKm(stops)
  const dayMinutes = routePlannerDayMinutes(stops.map((stop) => stop.plannedTime))

  const addCandidates = (added: readonly RoutePlannerCandidate[]) => setStops((current) => {
    const next = [...current]
    for (const candidate of added) {
      if (next.some((stop) => stop.key === candidate.key)) continue
      next.push(plannedStop(candidate, routePlannerNextSlot(next[next.length - 1]?.plannedTime)))
    }
    return next
  })
  const moveStop = (from: number, to: number) => setStops((current) => {
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current
    const order = [...current]
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    return retimed(order, current.map((stop) => stop.plannedTime))
  })
  const removeStop = (key: string) => setStops((current) => {
    const left = current.filter((stop) => stop.key !== key)
    return retimed(left, left.map((stop) => stop.plannedTime))
  })
  const suggest = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    const picked = suggestRoutePlannerStops({ candidates, route: stops })
    if (picked.length === 0) {
      toast.info(t("suggestNothing", { month: monthLabel }))
      return
    }
    addCandidates(picked)
    toast.success(t("suggestAdded", { count: picked.length }))
    if (step?.id === "mtm-plan-suggest") dispatch({ type: "ui", path: "mtm.planSuggested", value: true })
  }
  const publish = () => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (stops.length === 0) {
      hint(t("needStops"))
      return
    }
    if (step?.id !== "mtm-plan-publish") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    toast.success(t("published"))
    dispatch({ type: "ui", path: "mtm.planPublished", value: true })
  }

  return (
    <div className="space-y-3" data-testid="mtm-route-planner">
      <header className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => hint(S.mtmTabHint)} className="inline-flex h-9 items-center gap-1 rounded-full border border-zinc-200 bg-card px-3 text-sm font-medium hover:bg-muted/60 dark:border-zinc-700"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("back")}</button>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <HomePill tone="amber">{t("draftBadge")}</HomePill>
        <label className="inline-flex h-9 items-center rounded-full border border-zinc-200 bg-card pl-3 pr-1 text-sm dark:border-zinc-700">
          <span className="sr-only">{t("agent")}</span>
          <select value={agent.id} onChange={() => hint(S.demoButtonHint)} className="h-8 max-w-[220px] bg-transparent pr-1 font-semibold outline-none">
            {MTM_DEMO_AGENTS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
        <div className="inline-flex h-9 items-center gap-0.5 rounded-full border border-zinc-200 bg-card px-1 text-sm dark:border-zinc-700">
          <button type="button" aria-label={t("prevDay")} onClick={() => hint(S.demoButtonHint)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <span className="px-1 font-semibold first-letter:uppercase">{dayLabel}</span>
          <button type="button" aria-label={t("nextDay")} onClick={() => hint(S.demoButtonHint)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => hint(S.demoButtonHint)}>{t("save")}</Button>
          <Button onClick={publish} {...(stops.length > 0 && snapshot.ui["mtm.planPublished"] !== true ? demoTarget("mtm-plan-publish") : {})}><Send aria-hidden="true" />{t("publish")}</Button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div data-tour-id="mtm-plan-map" className="relative h-[560px] overflow-hidden rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
          <RoutePlannerMap
            places={places}
            stops={stops.map((stop) => ({ key: stop.key, latitude: stop.latitude, longitude: stop.longitude }))}
            selectedPlaceId={selectedPlaceId}
            focusPlaceId={focusPlaceId}
            onSelectPlace={setSelectedPlaceId}
            onAdd={(candidate) => addCandidates([candidate])}
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
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start gap-2">
            <div className="pointer-events-auto relative">
              <label className="flex h-10 w-[300px] max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">{t("search")}</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} className="min-w-0 flex-1 bg-transparent outline-none" />
              </label>
              {searchResults.length > 0 ? (
                <ul className="absolute left-0 right-0 top-11 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {searchResults.map((place) => (
                    <li key={place.customerId}>
                      <button type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { setFocusPlaceId(place.customerId); setSelectedPlaceId(place.customerId); setQuery("") }}>
                        <span className="block truncate font-medium">{place.name}</span>
                        {place.address ? <span className="block truncate text-xs text-muted-foreground">{place.address}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {/* The chosen chip is outlined dark, never filled (owner-approved colours, 2026-10-18). */}
            <button type="button" aria-pressed={onlyDue} onClick={() => setOnlyDue(true)} className={cn("pointer-events-auto h-9 rounded-full px-3 text-sm font-semibold shadow-sm", onlyDue ? PLANNER_CHIP_ON : PLANNER_CHIP_OFF)}>
              {t("onlyDue", { month: monthLabel, count: duePlaces })}
            </button>
            <button type="button" aria-pressed={!onlyDue} onClick={() => setOnlyDue(false)} className={cn("pointer-events-auto h-9 rounded-full px-3 text-sm font-semibold shadow-sm", !onlyDue ? PLANNER_CHIP_ON : PLANNER_CHIP_OFF)}>
              {t("all", { count: allPlaces.length })}
            </button>
            {categories.map((value) => (
              <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory((current) => (current === value ? "" : value))} className={cn("pointer-events-auto h-9 rounded-full px-3 text-sm font-medium shadow-sm", category === value ? PLANNER_CHIP_ON : PLANNER_CHIP_OFF)}>
                {t("category", { category: value })}
              </button>
            ))}
          </div>
          <div className="absolute bottom-3 left-3 z-[500] flex flex-wrap items-center gap-3 rounded-full bg-white/95 px-3 py-1.5 text-xs shadow-sm dark:bg-zinc-900/95">
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />{t("legendDue", { month: monthLabel })}</span>
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-400" />{t("legendVisited")}</span>
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-zinc-900" />{t("inRoute")}</span>
          </div>
        </div>

        <aside data-tour-id="mtm-plan-route" className="flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-[15px] font-semibold first-letter:uppercase">{t("routeOf", { day: routeDayLabel })}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <HomePill tone={stops.length > 0 ? "green" : "zinc"}>{t("stops", { count: stops.length })}</HomePill>
              {stops.length > 1 ? <HintValue text={t("hint.length")}><HomePill tone="zinc">{t("km", { km: lengthKm.toLocaleString(locale, { maximumFractionDigits: 1 }) })}</HomePill></HintValue> : null}
              {dayMinutes !== null ? <HintValue text={t("hint.duration")}><HomePill tone="zinc">{dayMinutes % 60 === 0 ? t("durationHours", { hours: dayMinutes / 60 }) : t("duration", { hours: Math.floor(dayMinutes / 60), minutes: dayMinutes % 60 })}</HomePill></HintValue> : null}
            </div>
          </div>
          {stops.length === 0 ? (
            <p className="flex-1 px-4 py-6 text-sm text-muted-foreground">{t("emptyRoute")}</p>
          ) : (
            <ol className="flex-1 space-y-1.5 p-3">
              {stops.map((stop, index) => (
                <li
                  key={stop.key}
                  draggable
                  tabIndex={0}
                  onDragStart={() => { dragIndex.current = index }}
                  onDragOver={(event: DragEvent<HTMLLIElement>) => event.preventDefault()}
                  onDrop={(event: DragEvent<HTMLLIElement>) => {
                    event.preventDefault()
                    if (dragIndex.current !== null) moveStop(dragIndex.current, index)
                    dragIndex.current = null
                  }}
                  aria-label={t("stopAria", { position: index + 1, name: stop.name })}
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-card px-2 py-2 dark:border-zinc-700"
                >
                  <span className="cursor-grab text-muted-foreground"><GripVertical className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[12px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{stop.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{stop.contactId ? stop.placeName : stop.address}</span>
                  </span>
                  <select aria-label={t("time")} value={stop.plannedTime} onChange={(event) => setStops((current) => current.map((item) => (item.key === stop.key ? { ...item, plannedTime: event.target.value } : item)))} className="h-7 rounded-full bg-muted px-2 text-[11px] font-semibold tabular-nums outline-none">
                    {MTM_ROUTE_TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </select>
                  <button type="button" aria-label={t("remove")} onClick={() => removeStop(stop.key)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
                </li>
              ))}
            </ol>
          )}
          <div className="space-y-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
            <Button variant="outline" className="w-full border-primary/50 font-semibold text-primary" onClick={suggest} {...(snapshot.ui["mtm.planSuggested"] === true ? {} : demoTarget("mtm-plan-suggest"))}>
              <Sparkles aria-hidden="true" />{t("suggest")}
            </Button>
            <p className="text-center text-[11px] leading-4 text-muted-foreground">{t("suggestNote", { month: monthLabel })}</p>
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
 *
 * The page asks the server again every thirty seconds; here each answer comes
 * every two seconds, so somebody on the way visibly moves down his street and
 * leaves the product's own trail behind him (`extendLiveMapTrails`), for ten
 * minutes of the sample day. «Kim daha yaxındır» is the product's: from a
 * client's balloon on the map, or from the sample call above it, the list
 * measures everyone from that client (`rosterDistanceToPoint`) and puts the
 * nearest first; nobody on a break is measured.
 */
/** The page's status chips (map/page.tsx): outlined, each in its status colour as text, the chosen one outlined dark. */
const LIVE_STATUS_CHIPS = [
  { status: "CHECKED_IN", key: "checkedIn", tone: "text-green-700 dark:text-green-400", icon: MapPin },
  { status: "ON_ROAD", key: "onRoad", tone: "text-blue-700 dark:text-blue-400", icon: Navigation },
  { status: "STOPPED", key: "stopped", tone: "text-amber-700 dark:text-amber-300", icon: PauseCircle },
  { status: "ROUTE_FINISHED", key: "routeFinished", tone: "text-emerald-700 dark:text-emerald-300", icon: Flag },
  { status: "LATE", key: "late", tone: "text-red-600 dark:text-red-400", icon: AlertTriangle },
  { status: "OFFLINE", key: "offline", tone: "text-muted-foreground", icon: WifiOff },
] as const

/** The map and the list side by side as the page sets them, by the list's own width (map/page.tsx `CANVAS_COLUMNS`). */
const LIVE_CANVAS_COLUMNS = {
  narrow: "lg:grid-cols-[minmax(0,1fr)_400px]",
  wide: "lg:grid-cols-[minmax(0,1fr)_400px] min-[85rem]:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]",
} as const

/** The page's tools that reach the server or the browser's full screen: explained here instead. */
const LIVE_SIMULATED_CONTROLS = [
  "live-map-roster-export",
  "live-map-roster-print",
  "live-map-roster-hide",
  "live-map-tool-point",
  "live-map-tool-ruler",
  "live-map-tool-fullscreen",
].map((id) => `[data-testid="${id}"]`).join(",")

/** One answer of the roster per this many milliseconds of the demo, for this many answers. */
const LIVE_TICK_MS = 2_000
const LIVE_TICK_SECONDS = 30
/** Twenty sample minutes: Nərmin is still on her way (she arrives at 12:36). */
const LIVE_TICKS = 40
const NEAREST_FIRST: RosterSort = { column: "distance", direction: "asc" }
/** The client the sample call is from. */
const NEAREST_CLIENT_ID = "pl-nar"

function LiveScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const tMap = useTranslations("mtmMap")
  const tNav = useTranslations("nav")
  const tc = useTranslations("common")
  const tf = useTranslations("mtmFilters")
  const format = useBakuFormat()
  const today = mtmDemoToday(snapshot.startedAt)
  const startMs = Date.parse(mtmDemoAt(today, MTM_DEMO_CLOCK))
  const [tick, setTick] = useState(0)
  const nowMs = startMs + tick * LIVE_TICK_SECONDS * 1_000
  const roster = useMemo(() => mtmDemoRosterAgents(today, nowMs), [today, nowMs])
  const route = useMemo(() => mtmDemoElvinRoute(today), [today])
  const steps = useMemo(() => mtmDemoElvinSteps(today), [today])
  const placeApproved = snapshot.ui["mtm.placeApproved"] === true
  const clients = useMemo(() => mtmDemoMapClients(placeApproved), [placeApproved])
  const chosen = typeof snapshot.ui["mtm.liveAgent"] === "string" ? (snapshot.ui["mtm.liveAgent"] as string) : null
  const [selected, setSelected] = useState<string | null>(chosen)
  const [stopOrder, setStopOrder] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<RosterFilters>({})
  const [view, setView] = useState<RosterView>(ROSTER_DEFAULT_VIEW)
  // With a point picked the list is «nearest first» until somebody asks for another order (the page's own rule).
  const [nearestFirst, setNearestFirst] = useState(snapshot.ui["mtm.nearestShown"] === true)
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set())
  const [showLastKnown, setShowLastKnown] = useState(true)
  // The page's own defaults: names over the markers and the client base are off until asked for.
  const [layers, setLayers] = useState({ agents: true, route: true, labels: false, trails: true, glide: true, clients: false })
  const [referencePoint, setReferencePoint] = useState<LiveMapReferencePoint | null>(() => {
    const client = snapshot.ui["mtm.nearestShown"] === true ? clients.find((candidate) => candidate.id === NEAREST_CLIENT_ID) : null
    return client ? { latitude: client.latitude, longitude: client.longitude, label: client.name } : null
  })
  // The trail the page would have drawn since it opened: the answers of the
  // last few minutes, of the positions it draws (never one from a break).
  const [trails, setTrails] = useState<LiveMapTrails>(() => {
    let seeded: LiveMapTrails = new Map()
    for (let at = startMs - 6 * 60_000; at <= startMs; at += LIVE_TICK_SECONDS * 1_000) seeded = extendLiveMapTrails(seeded, drawnPositions(mtmDemoRosterAgents(today, at)), at)
    return seeded
  })
  const rosterRef = useRef<HTMLDivElement>(null)

  // The next answer of the roster, until the sample's ten minutes are up.
  useEffect(() => {
    if (tick >= LIVE_TICKS) return
    const timer = setTimeout(() => setTick((current) => current + 1), LIVE_TICK_MS)
    return () => clearTimeout(timer)
  }, [tick])
  useEffect(() => {
    if (tick > 0) setTrails((current) => extendLiveMapTrails(current, drawnPositions(roster), nowMs))
  }, [tick, roster, nowMs])

  // With a point picked every row says how far its employee is from it — only
  // from a position the map itself would draw (the page's own rule).
  const agents = useMemo(() => roster.map((agent) => referencePoint
    ? { ...agent, distanceMeters: isLiveMapAgentPositionVisible(agent.freshness, agent.workdayState) ? rosterDistanceToPoint(agent, referencePoint) : null }
    : agent), [referencePoint, roster])
  const searched = useMemo(() => {
    const query = foldRosterText(search.trim())
    return query ? agents.filter((agent) => foldRosterText(agent.name).includes(query)) : agents
  }, [agents, search])
  const sort = referencePoint && nearestFirst ? NEAREST_FIRST : view.sort.column === "distance" && !referencePoint ? ROSTER_DEFAULT_VIEW.sort : view.sort
  const rows = useMemo(() => sortRoster(applyRosterFilters(searched, filters), sort, "az"), [searched, filters, sort])
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
  const nearestStep = step?.id === "mtm-live-nearest"

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
  const changePoint = (point: LiveMapReferencePoint | null) => {
    setReferencePoint(point)
    setNearestFirst(point != null)
    // The point gone, a filter on the distance would match nobody (the page's own rule).
    if (!point) setFilters((current) => withRosterFilter(current, "distance", undefined))
  }
  const nearestTo = (client: LiveMapClient) => {
    changePoint({ latitude: client.latitude, longitude: client.longitude, label: client.name })
    if (!reviewMode && nearestStep) dispatch({ type: "ui", path: "mtm.nearestShown", value: true })
  }
  const changeView = (next: RosterView) => {
    // The list hands back the order it was shown; only a different one is a choice.
    if (next.sort.column !== sort.column || next.sort.direction !== sort.direction) setNearestFirst(false)
    setView(next)
  }
  const simulated = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null
    if (!target?.closest?.(LIVE_SIMULATED_CONTROLS)) return
    event.preventDefault()
    event.stopPropagation()
    hint(S.demoButtonHint)
  }
  const layer = (id: keyof typeof layers, label: string, layerHint: string, shownByDefault?: true) => ({ id, label, hint: layerHint, on: layers[id], onToggle: () => setLayers((current) => ({ ...current, [id]: !current[id] })), shownByDefault })
  // The organization's limits as the page says them in its hints — the product's defaults here.
  const freshMinutes = Math.round(MTM_DEMO_FRESHNESS.onlineSeconds / 60)
  const delayedMinutes = Math.round(MTM_DEMO_FRESHNESS.delayedSeconds / 60)
  const appPresenceHint = tMap("hint.appPresence", { online: tMap("presence.online"), minutes: freshMinutes })
  const gpsFreshnessHint = tMap("hint.gpsFreshness", { fresh: tMap("freshness.online"), freshMinutes, delayed: tMap("freshness.delayed"), delayedMinutes, stale: tMap("freshness.stale") })
  const callFrom = clients.find((client) => client.id === NEAREST_CLIENT_ID)!

  return (
    <div className="flex flex-col gap-3" onClickCapture={simulated}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PageDescription icon={MapPin} title={tNav("mtmMap")} description={tMap("subtitle")} />
          <DemoHelpButton variant="label" onClick={() => hint(S.demoButtonHint)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={MTM_TAB_ROW} role="tablist" aria-label={tMap("modeLabel")}>
            <Button type="button" role="tab" aria-selected variant="ghost" size="sm" className={mtmTabClass(true)}><Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{tMap("liveMode")}</Button>
            <Button type="button" role="tab" aria-selected={false} variant="ghost" size="sm" className={mtmTabClass(false)} data-testid="mtm-map-mode-history" onClick={() => hint(S.mtmTabHint)}><History className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{tMap("historyMode")}</Button>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" aria-hidden="true" />{tMap("lastUpdate")}: <HintValue text={tMap("hint.lastUpdate")}>{S.mtmAsOf(format.clock(new Date(nowMs).toISOString()))}</HintValue></span>
          <Button className="min-h-11" variant="outline" size="sm" onClick={() => hint(S.demoButtonHint)}><RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {tc("refresh")}</Button>
        </div>
      </div>

      <div className="-mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={tc("status")}>
        <Button className={`min-h-11 shrink-0 ${mtmChipClass(true)}`} variant="outline" size="sm" aria-pressed onClick={() => setFilters({})}>{tc("all")} ({agents.length})</Button>
        {LIVE_STATUS_CHIPS.map((chip) => (
          <Button key={chip.status} variant="outline" size="sm" aria-pressed={false} className={`min-h-11 shrink-0 ${mtmChipClass(false, chip.tone)}`} onClick={() => hint(S.demoButtonHint)}>
            <chip.icon className="mr-1 h-3 w-3" aria-hidden="true" /> {tMap(`fieldStatus.${chip.key}`)} ({count(chip.status)})
          </Button>
        ))}
      </div>

      {/* The page's count line, every group as it prints it (zeros included), and the demo's own note on its clock. */}
      <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
        <HintValue className="font-semibold" text={tMap("hint.agents")}>{tMap("agents")}: {agents.length}</HintValue>
        <span className="flex flex-wrap items-center gap-x-2">
          <HintValue className="font-bold" text={appPresenceHint}>{tMap("appPresence")}:</HintValue>
          <span className="text-green-700 dark:text-green-400">{tMap("presence.online")} {agents.filter((agent) => agent.isOnline).length}</span>
          <span className="text-muted-foreground">{tMap("presence.offline")} {agents.filter((agent) => !agent.isOnline).length}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <HintValue className="font-bold" text={gpsFreshnessHint}>{tMap("gpsFreshness")}:</HintValue>
          <span className="text-blue-700 dark:text-blue-400">{tMap("freshness.online")} {agents.filter((agent) => agent.freshness === "ONLINE").length}</span>
          <span className="text-amber-700 dark:text-amber-300">{tMap("freshness.delayed")} {agents.filter((agent) => agent.freshness === "DELAYED").length}</span>
          <span className="text-muted-foreground">{tMap("freshness.stale")} {agents.filter((agent) => agent.freshness === "STALE").length}</span>
          <span className="text-muted-foreground">{tMap("freshness.noLocation")} {agents.filter((agent) => agent.freshness === "NO_LOCATION").length}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <HintValue className="font-bold" text={tMap("hint.workday")}>{tMap("workdayState")}:</HintValue>
          <span className="text-emerald-700 dark:text-emerald-400">{tMap("workday.active")} {agents.filter((agent) => agent.workdayState === "ACTIVE").length}</span>
          <span className="text-amber-700 dark:text-amber-300">{tMap("workday.paused")} {agents.filter((agent) => agent.workdayState === "PAUSED").length}</span>
          <span className="text-muted-foreground">{tMap("workday.closed")} {agents.filter((agent) => agent.workdayState === "CLOSED").length}</span>
          <span className="text-muted-foreground">{tMap("workday.not_started")} {agents.filter((agent) => agent.workdayState === "NOT_STARTED" || !agent.workdayState).length}</span>
        </span>
        <span className="text-muted-foreground">{S.mtmLiveMovingNote}</span>
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

      {/* The sample's own call: a client wants somebody today. «Kim daha yaxındır» is the button of the
          client's balloon on the map; here a notice of the page's kind — white, with a coloured edge. */}
      {nearestStep || referencePoint ? (
        <div data-tour-id="mtm-live-call" data-testid="mtm-live-call" className="flex flex-wrap items-center gap-3 rounded-lg border border-l-4 border-zinc-200 border-l-amber-500 bg-card px-3 py-2 text-sm text-foreground dark:border-zinc-700 dark:border-l-amber-500">
          <PhoneIncoming className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="font-semibold">{S.mtmNearestCallTitle}:</span> {S.mtmNearestCall}</span>
          <Button type="button" size="sm" className="min-h-9 shrink-0" onClick={() => nearestTo(callFrom)} {...(nearestStep && snapshot.ui["mtm.nearestShown"] !== true ? demoTarget("mtm-live-nearest") : {})}>
            <MapPin aria-hidden="true" />{tMap("clients.nearest")}
          </Button>
        </div>
      ) : null}

      {/* The page's canvas: the map as tall as the window and staying in view beside a long list. */}
      <div className={`grid gap-3 max-lg:order-first ${LIVE_CANVAS_COLUMNS[view.width]} lg:items-start`} style={{ minHeight: 480 }}>
        <div data-tour-id="mtm-live-map" className="relative isolate order-1 h-[54vh] min-h-[360px] overflow-hidden rounded-lg border border-zinc-200 bg-card lg:sticky lg:top-3 lg:h-[calc(100vh-7rem)] lg:min-h-[480px] dark:border-zinc-700">
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
            trails={layers.trails ? trails : null}
            glideMarkers={layers.glide}
            referencePoint={referencePoint}
            clients={layers.clients ? clients : undefined}
            onClientNearest={nearestTo}
          />
          <LiveMapLayersControl
            layers={[
              layer("agents", tMap("layers.agents"), tMap("layers.agentsHint"), true),
              layer("route", tMap("layers.route"), tMap("layers.routeHint"), true),
              layer("labels", tMap("layers.labels"), tMap("layers.labelsHint")),
              layer("trails", tMap("layers.trails"), tMap("layers.trailsHint"), true),
              layer("glide", tMap("layers.glide"), tMap("layers.glideHint")),
              layer("clients", tMap("layers.clients"), tMap("layers.clientsHint")),
            ]}
            hiddenAgentCount={hiddenIds.size}
            onShowAllAgents={() => setHiddenIds(new Set())}
            note={tMap("historyOnlyExplicit")}
          />
          <LiveMapTools
            near={mapAgents[0] ? { latitude: mapAgents[0].latitude, longitude: mapAgents[0].longitude } : null}
            referencePoint={referencePoint}
            onReferencePointChange={changePoint}
            pickingPoint={false}
            onPickingPointChange={() => hint(S.demoButtonHint)}
            rulerActive={false}
            onRulerToggle={() => hint(S.demoButtonHint)}
            rulerMeters={0}
            rulerPointCount={0}
            onRulerUndo={() => undefined}
            formatDistance={formatMeters}
            fullscreen={false}
            onFullscreenToggle={() => hint(S.demoButtonHint)}
            fullscreenSupported
          />
        </div>
        <div data-tour-id="mtm-live-roster" ref={rosterRef} className="order-2 flex min-w-0 flex-col gap-3">
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
            view={{ ...view, sort }}
            onViewChange={changeView}
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
            formatDistance={formatMeters}
            exportFileName={() => "leaddrive-demo-xerite"}
            printTitle={() => `${tNav("mtmMap")} · ${MTM_DEMO_CLOCK}`}
          />
        </div>
      </div>
    </div>
  )
}

/** The positions the live map draws — a live one while the workday runs; nothing from a break. */
function drawnPositions(agents: readonly MtmDashboardAgent[]): MtmDashboardAgent[] {
  return agents.filter((agent) => isLiveMapAgentPositionVisible(agent.freshness, agent.workdayState))
}

/** «450 m», «7,8 km» — the roster's distance to the picked point. */
function formatMeters(meters: number): string {
  return meters < 1_000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1_000).toLocaleString("az", { maximumFractionDigits: 1 })} km`
}

/* ── Axşam: günün yolu ────────────────────────────────────────────────── */

/**
 * «Tarixçə» on `/mtm/map`, as `LocationHistoryPanel` lays it out once its
 * answer has loaded: the filters and «Göstər», the six figures, the layers,
 * the replay, the product's own history map (`LocationHistoryMap`) and the
 * day told as legs (`DayTripLedger`). The panel fetches; its answer here is
 * Elvin's day run through the product's own history functions
 * (`mtm-demo-day.ts`), read in the evening. A break is a leg with its
 * length and nothing else — where he was is not recorded.
 */
function HistoryScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("mtmMap.history")
  const tMap = useTranslations("mtmMap")
  const tNav = useTranslations("nav")
  const locale = useLocale()
  const today = mtmDemoToday(snapshot.startedAt)
  const data = useMemo(() => mtmDemoElvinHistoryView(today), [today])
  const shown = snapshot.ui["mtm.historyShown"] === true
  const [loaded, setLoaded] = useState(shown)
  const [layers, setLayers] = useState({ planned: true, actual: true, stops: true, visits: true, gaps: true, roads: true })
  const [playbackIndex, setPlaybackIndex] = useState(data.points.length - 1)
  const [playing, setPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [tripFocus, setTripFocus] = useState<DayTripFocus | null>(null)
  const lastIndex = data.points.length - 1
  const formatMoment = (value: string, options?: Intl.DateTimeFormatOptions) =>
    formatInTimezone(value, MTM_DEMO_TIMEZONE, options ?? { dateStyle: "short", timeStyle: "short" }, locale)
  const formatDuration = (seconds: number) => {
    const minutes = Math.round(seconds / 60)
    return minutes < 60 ? t("durationMinutes", { minutes }) : t("durationHoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }

  // The panel's own replay: one fix after another.
  useEffect(() => {
    if (!playing || playbackIndex >= lastIndex) return
    const timer = setTimeout(() => {
      setPlaybackIndex((index) => Math.min(index + 1, lastIndex))
      if (playbackIndex + 1 >= lastIndex) setPlaying(false)
    }, 60 / playbackRate)
    return () => clearTimeout(timer)
  }, [lastIndex, playbackIndex, playbackRate, playing])

  const show = () => {
    setLoaded(true)
    if (reviewMode) return
    if (step?.id === "mtm-history-show") dispatch({ type: "ui", path: "mtm.historyShown", value: true })
  }
  // A break is its length only: its row brings no stretch of track forward —
  // the map would join the fix before it to the one after.
  const focusLeg = (focus: DayTripFocus | null) => {
    const entry = focus ? data.trip.entries.find((candidate) => candidate.id === focus.id) : null
    setTripFocus(entry?.kind === "GAP" && entry.reason === "WORKDAY_PAUSED" ? null : focus)
  }
  const playbackPoint = data.points[Math.min(playbackIndex, lastIndex)]
  const playbackSpeedKmh = mtmSpeedKmh(playbackPoint.speed)
  const distance = data.summary.distanceMeters
  const metrics = [
    { icon: RouteIcon, label: t("distance"), value: distance < 1_000 ? `${distance} m` : `${(distance / 1_000).toFixed(2)} km`, hint: t("hint.historyDistanceRoads") },
    { icon: LocateFixed, label: t("acceptedPoints"), value: String(data.summary.acceptedPointCount), hint: t("hint.historyAcceptedPoints", { accuracy: data.policy.maxAccuracyMeters }) },
    { icon: MapPin, label: t("stops"), value: String(data.summary.stopCount), hint: t("hint.historyStops", { minutes: data.policy.stopMinimumMinutes, radius: data.policy.stopRadiusMeters }) },
    { icon: CheckCircle2, label: t("visits"), value: String(data.summary.visitCount), hint: t("hint.historyVisits") },
    { icon: WifiOff, label: t("gaps"), value: String(data.summary.gapCount), hint: t("hint.historyGaps", { minutes: Math.round(data.policy.gapThresholdSeconds / 6) / 10 }) },
    { icon: Activity, label: t("anomalies"), value: String(data.summary.anomalyCount), hint: t("hint.historyAnomalies", { accuracy: data.policy.maxAccuracyMeters }) },
  ]

  return (
    <div className="space-y-3" data-testid="mtm-history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PageDescription icon={History} title={tNav("mtmMap")} description={t("subtitle")} />
          <DemoHelpButton variant="label" onClick={() => hint(S.demoButtonHint)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={MTM_TAB_ROW} role="tablist" aria-label={tMap("modeLabel")}>
            <Button type="button" role="tab" aria-selected={false} variant="ghost" size="sm" className={mtmTabClass(false)} onClick={() => hint(S.mtmTabHint)}><Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{tMap("liveMode")}</Button>
            <Button type="button" role="tab" aria-selected variant="ghost" size="sm" className={mtmTabClass(true)}><History className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{tMap("historyMode")}</Button>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" aria-hidden="true" />{S.mtmEveningAsOf(MTM_DEMO_EVENING)}</span>
        </div>
      </div>

      <form
        data-testid="mtm-location-history-filter-form"
        data-tour-id="mtm-history-filter"
        className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700"
        onSubmit={(event) => {
          event.preventDefault()
          show()
        }}
      >
        <MtmFilterBar testId="mtm-location-history-filters">
          <MtmFilterSelect testId="mtm-location-history-agent" label={t("agent")} value="agent-elvin" emptyValue="__none__" showValue clearable={false} allLabel={t("noAgents")}
            options={MTM_DEMO_AGENTS.map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.team === "center" ? "Bakı — Mərkəz" : "Bakı — Cənub"}` }))}
            onChange={() => hint(S.demoButtonHint)} />
          <MtmFilterDate testId="mtm-location-history-date-from" label={t("dateFrom")} value={today} onChange={() => hint(S.demoButtonHint)} />
          <MtmFilterDate testId="mtm-location-history-date-to" label={t("dateTo")} value={today} onChange={() => hint(S.demoButtonHint)} />
          <MtmFilterDate type="time" label={t("from")} value="00:00" onChange={() => hint(S.demoButtonHint)} />
          <MtmFilterDate type="time" label={t("to")} value={MTM_DEMO_EVENING} onChange={() => hint(S.demoButtonHint)} />
          <MtmFilterSelect testId="mtm-location-history-accuracy" label={t("accuracyFilter")} value="100" emptyValue="100" showValue clearable={false} allLabel="≤ 100 m"
            options={[25, 50, 100, 200, 500].map((value) => ({ value: String(value), label: `≤ ${value} m` }))}
            onChange={() => hint(S.demoButtonHint)} />
          <Button data-testid="mtm-location-history-submit" type="submit" className="h-10 rounded-full px-4" {...(loaded ? {} : demoTarget("mtm-history-show"))}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("show")}
          </Button>
        </MtmFilterBar>
        <p className="mt-2 text-xs text-muted-foreground">{t("timezoneHint", { timezone: MTM_DEMO_TIMEZONE })} {t("rangeHint", { days: MAX_RANGE_DAYS })}</p>
      </form>

      {!loaded ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Satellite className="mx-auto mb-2 h-7 w-7" aria-hidden="true" />
          {t("chooseRange")}
        </div>
      ) : (
        <>
          <div data-testid="mtm-location-history-results" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                <metric.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                  <div className="text-lg font-semibold tabular-nums"><HintValue text={metric.hint}>{metric.value}</HintValue></div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-card p-2 dark:border-zinc-700">
            <div className="flex flex-wrap items-center gap-1.5" aria-label={t("layers")}>
              <span className="mr-1 inline-flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground"><Layers3 className="h-3.5 w-3.5" aria-hidden="true" />{t("layers")}</span>
              {(Object.keys(layers) as Array<keyof typeof layers>).filter((key) => key !== "roads" || Boolean(data.matchedTrack)).map((key) => (
                <button key={key} type="button" aria-pressed={layers[key]} onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))} className={`min-h-11 rounded-md border px-3 py-2 text-xs transition-colors ${layers[key] ? "border-foreground font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {t(`layer.${key}`)}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => hint(S.demoButtonHint)} className="inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted">
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("exportCsv")}
            </button>
          </div>

          <section data-testid="mtm-location-history-replay" className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700" aria-labelledby="day-replay-title">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id="day-replay-title" className="flex items-center gap-2 text-sm font-semibold"><Play className="h-4 w-4 text-primary" aria-hidden="true" />{t("replayTitle")}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("replayHint")}</p>
              </div>
              <div className="text-right text-xs" aria-live="polite">
                <div className="font-medium tabular-nums">{formatMoment(playbackPoint.recordedAt)}</div>
                <div className="text-muted-foreground">{t("pointProgress", { current: playbackIndex + 1, total: data.points.length })}</div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[auto_auto_minmax(180px,1fr)_110px] md:items-center">
              <Button data-testid="mtm-location-history-play" type="button" variant={playing ? "secondary" : "default"} className="min-h-11" onClick={() => {
                if (playing) return setPlaying(false)
                if (playbackIndex >= lastIndex) setPlaybackIndex(0)
                setPlaying(true)
              }}>
                {playing ? <Pause className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {playing ? t("pause") : playbackIndex >= lastIndex ? t("replayFromStart") : t("play")}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" disabled={playbackIndex === 0} onClick={() => { setPlaying(false); setPlaybackIndex(0) }}>
                <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("restart")}
              </Button>
              <label className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                <span className="sr-only">{t("replayPosition")}</span>
                <input type="range" min={0} max={lastIndex} step={1} value={playbackIndex} aria-label={t("replayPosition")} onChange={(event) => { setPlaying(false); setPlaybackIndex(Number(event.target.value)) }} className="h-2 w-full cursor-pointer accent-primary" />
              </label>
              <label className="space-y-1 text-xs font-medium">
                <span className="sr-only">{t("playbackRate")}</span>
                <Select className="min-h-11" value={String(playbackRate)} aria-label={t("playbackRate")} onChange={(event) => setPlaybackRate(Number(event.target.value))}>
                  {[0.5, 1, 2, 4].map((rate) => <option key={rate} value={rate}>{t("playbackRateValue", { rate })}</option>)}
                </Select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t("accuracy")}: <HintValue text={playbackPoint.accuracy == null ? null : t("hint.historyPointAccuracy")}>{playbackPoint.accuracy == null ? "—" : `${Math.round(playbackPoint.accuracy)} m`}</HintValue></span>
              <span>{t("battery")}: {playbackPoint.battery == null ? "—" : `${Math.round(playbackPoint.battery)}%`}</span>
              <span>{t("gpsSpeed")}: <HintValue text={playbackSpeedKmh == null ? null : t("hint.historyPointSpeed")}>{playbackSpeedKmh == null ? "—" : tMap("roster.kmh", { value: playbackSpeedKmh })}</HintValue></span>
              <HintValue text={t("hint.historyPointMoving")}>{playbackPoint.isMoving ? t("moving") : t("stationary")}</HintValue>
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="space-y-2 xl:sticky xl:top-3">
              <div data-tour-id="mtm-history-map" className="relative isolate h-[56vh] min-h-[420px] overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-700">
                <LocationHistoryMap
                  points={data.points}
                  stops={data.stops}
                  visits={data.visits}
                  workday={data.workday}
                  plannedRoutes={data.plannedRoutes}
                  gaps={data.gaps}
                  layers={layers}
                  locale={locale}
                  timezone={MTM_DEMO_TIMEZONE}
                  playbackIndex={playbackIndex}
                  focus={tripFocus}
                  matchedTrack={data.matchedTrack}
                />
              </div>
              <ul data-testid="mtm-history-map-legend" className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-zinc-200 bg-card px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-1 w-6 rounded-full" style={{ background: HISTORY_MAP_COLORS.track }} />{data.matchedTrack && layers.roads ? t("legendRoads") : t("legendTrack")}</li>
                {data.matchedTrack && layers.roads ? <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-2 border-dotted" style={{ borderColor: HISTORY_MAP_COLORS.raw }} />{t("legendRaw")}</li> : null}
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-[3px] border-dotted" style={{ borderColor: HISTORY_MAP_COLORS.gap }} />{t("legendGap")}</li>
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block w-6 border-t-[3px] border-dashed" style={{ borderColor: HISTORY_MAP_COLORS.plan }} />{t("legendPlan")}</li>
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: HISTORY_MAP_COLORS.stop }} />{t("legendStop")}</li>
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: HISTORY_MAP_COLORS.visit }} />{t("legendVisit")}</li>
                <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ background: HISTORY_MAP_COLORS.current }} />{t("legendCurrent")}</li>
              </ul>
            </div>
            <aside data-tour-id="mtm-history-trip" className="space-y-3">
              <DayTripLedger
                trip={data.trip}
                multiDay={false}
                focusId={tripFocus?.id ?? null}
                onFocus={focusLeg}
                formatMoment={formatMoment}
                formatDuration={formatDuration}
                roadsMatched
              />
              <section className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" aria-hidden="true" />{t("workday")}</h3>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">{t("status")}</dt><dd>{t("workdayStatus.COMPLETED")}</dd>
                  <dt className="text-muted-foreground">{t("workdayStart")}</dt><dd>{formatMoment(data.workday.startedAt)}</dd>
                  <dt className="text-muted-foreground">{t("workdayEnd")}</dt><dd>{formatMoment(data.workday.completedAt)}</dd>
                </dl>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Vizitlər ─────────────────────────────────────────────────────────── */

/**
 * «Vizitlər» as `/mtm/visits` lays it out for a manager with a visit opened:
 * the page heading, the product's own review card (`VisitReviewView`, the
 * very component the page draws once its answer has loaded), the visits
 * going on now, the ones the agents left open, and today's history. Only the
 * reminder is the demo's: the product's button sends a real message.
 */
function VisitScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("mtmVisitsPage")
  const tFilters = useTranslations("mtmFilters")
  const locale = useLocale()
  const today = mtmDemoToday(snapshot.startedAt)
  const now = useMemo(() => new Date(mtmDemoAt(today, MTM_DEMO_CLOCK)), [today])
  const review = useMemo(() => mtmDemoVisitReview(today), [today])
  const history = useMemo(() => mtmDemoVisitHistory(today), [today])
  const leftOpen = useMemo(() => mtmDemoLeftOpen(today), [today])
  const openForText = useOpenForText()
  const reminded = snapshot.ui["mtm.reminded"] === true
  const active = history.filter((visit) => visit.status === "CHECKED_IN")
  const median = medianVisitDurationMinutes(history)
  const confirmed = history.filter((visit) => visitPlaceSummary(visit.place).verdict === "at_point").length
  const dateTime = (value: string) => formatDateTime(value, locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: MTM_DEMO_TIMEZONE }) || "—"
  const since = (value: string) => formatDateTime(value, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: MTM_DEMO_TIMEZONE }) || "—"

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
    <div className="space-y-6" data-testid="mtm-visits-guided-history">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <PageDescription icon={CheckSquare} title={t("title")} description={t("subtitle")} />
          <DemoHelpButton variant="label" onClick={() => hint(S.demoButtonHint)} />
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button className="min-h-11" onClick={() => hint(S.demoButtonHint)}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />{t("add")}</Button>
        </div>
      </div>

      {/* The page's grid: the visit's card and, beside it on a wide screen or under it here, its AI notes. */}
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div data-tour-id="mtm-visit-card">
          <VisitReviewView data={review} closeHref="/mtm/visits" now={now} />
        </div>
        <AdvisorQuietCard title={t("advisorRisk")} />
      </div>

      {active.length > 0 ? (
        <section className="rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800" aria-labelledby="team-active-visits-title">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-950" aria-hidden="true" />
              <h2 id="team-active-visits-title" className="font-semibold text-foreground">{t("teamActiveTitle", { count: active.length })}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("teamActiveHint")}</p>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {active.map((visit) => (
              <li key={visit.id}>
                <button type="button" onClick={() => hint(S.demoButtonHint)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{visit.customer}</span>
                    <span className="block truncate text-sm text-muted-foreground">{visit.agent} · {t("activeSince", { time: dateTime(visit.checkInAt) })}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section data-tour-id="mtm-visit-left-open" data-testid="mtm-visits-left-open" className="rounded-2xl border border-l-4 border-zinc-200 border-l-amber-500 bg-card text-foreground dark:border-zinc-700 dark:border-l-amber-500 shadow-sm" aria-labelledby="left-open-visits-title">
        <div className="border-b border-amber-200 p-4 dark:border-amber-900 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
            <h2 id="left-open-visits-title" className="font-semibold text-foreground">{t("leftOpenTitle", { count: 1 })}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("leftOpenHint")}</p>
        </div>
        <ul className="divide-y divide-amber-200 dark:divide-amber-900">
          <li className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{leftOpen.place}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {leftOpen.agent} · <span className="font-medium text-amber-800 dark:text-amber-300">{t("leftOpenSince", { since: since(leftOpen.since), openFor: openForText(leftOpen.since, now) })}</span>
              </span>
            </span>
            {/* The product's RemindAgentButton, drawn: the real one sends a message to the agent's phone. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reminded}
              onClick={remind}
              {...(reminded ? {} : demoTarget("mtm-visit-remind"))}
              className="min-h-9 shrink-0 border-zinc-200 bg-white text-amber-700 hover:bg-muted dark:border-zinc-700 dark:bg-transparent dark:text-amber-300"
            >
              {reminded ? <Check aria-hidden="true" /> : <BellRing aria-hidden="true" />}
              {reminded ? t("reminded") : t("remindAgent")}
            </Button>
          </li>
        </ul>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800" aria-labelledby="visit-history-title">
        <header className="space-y-4 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
          <h2 id="visit-history-title" className="text-lg font-semibold text-foreground">{t("historyTitle")}</h2>
          <MtmFilterBar testId="mtm-visits-filters">
            <MtmFilterSearch value="" onChange={() => hint(S.demoButtonHint)} delayMs={0} placeholder={t("searchPlaceholder")} label={t("searchPlaceholder")} clearLabel={tFilters("clearSearch")} />
            <MtmFilterSelect testId="mtm-visits-range" label={t("rangeLabel")} value="today" emptyValue="today" showValue allLabel={t("rangeToday")} options={[{ value: "today", label: t("rangeToday") }]} onChange={() => hint(S.demoButtonHint)} />
            <MtmFilterSelect testId="mtm-visits-status" label={t("statusFilterLabel")} value="all" emptyValue="all" allLabel={t("all")} options={[{ value: "all", label: `${t("all")} (${history.length})` }]} onChange={() => hint(S.demoButtonHint)} />
            <MtmFilterSelect testId="mtm-visits-sort" label={tFilters("sort")} value="date_desc" emptyValue="date_desc" showValue clearable={false} allLabel={t("sortDateDesc")} options={[{ value: "date_desc", label: t("sortDateDesc") }]} onChange={() => hint(S.demoButtonHint)} />
          </MtmFilterBar>
          <MtmResultLine aside={<span>{t("statTotal")}: {history.length} · {t("statCheckedOut")}: {history.length - active.length} · {t("statMedianDuration")}: {median == null ? "—" : `${median} ${t("min")}`} · {t("statGpsConfirmed")}: {confirmed}</span>}>
            <span role="status" className="font-medium text-foreground">{t("resultCount", { count: history.length })}</span>
          </MtmResultLine>
        </header>
        <div className="p-3 sm:p-5">
          <div className="hidden overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 xl:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 font-medium">{t("colCustomer")}</th>
                  <th className="px-4 py-3 font-medium">{t("colAgent")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="px-4 py-3 font-medium">{t("colTiming")}</th>
                  <th className="px-4 py-3 font-medium">{t("colDuration")}</th>
                  <th className="px-4 py-3 font-medium">{t("colGps")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((visit) => (
                  <tr key={visit.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-foreground">{visit.customer}</span>
                      <p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground">{visit.address}</p>
                    </td>
                    <td className="px-4 py-3 text-foreground">{visit.agent}</td>
                    <td className="px-4 py-3"><VisitStatusPill status={visit.status} /></td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{dateTime(visit.checkInAt)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{visit.checkOutAt ? t("finishedAt", { time: dateTime(visit.checkOutAt) }) : t("notFinished")}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{visit.duration != null ? `${visit.duration} ${t("min")}` : "—"}</td>
                    <td className="px-4 py-3"><VisitGps visit={visit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 xl:hidden">
            {history.map((visit) => (
              <article key={visit.id} className="rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-foreground">{visit.customer}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{visit.agent} · {dateTime(visit.checkInAt)}</p>
                  </div>
                  <VisitStatusPill status={visit.status} />
                </div>
                <div className="mt-3"><VisitGps visit={visit} /></div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

/** The history's status pill, as the page's own `statusBadge` draws it. */
function VisitStatusPill({ status }: { status: string }) {
  const t = useTranslations("mtmVisitsPage")
  const Icon = status === "CHECKED_IN" ? Clock : CheckCircle2
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${visitStatusClasses(status)}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(visitStatusKey(status))}
    </span>
  )
}

/** The history's GPS cell: the product's place badge, and «Ünvan yoxlanılır» while the agent's report on the pin waits. */
function VisitGps({ visit }: { visit: MtmDemoHistoryVisit }) {
  const t = useTranslations("mtmVisitsPage")
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <VisitPlaceBadge place={visitPlaceSummary(visit.place)} />
      {visit.locationRequest === "SUBMITTED" ? (
        <span tabIndex={0} data-testid="mtm-visit-location-request" className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{t("locationRequestWaiting")}</span>
      ) : null}
    </span>
  )
}

/**
 * The visit page's «Ziyarət üzrə AI qeydləri» (`AdvisorRecordWidget`) as it
 * reads for a visit the Advisor raised nothing about: its title, the way to
 * the Advisor centre and its own «no risk» line. The widget asks the server;
 * the demo has nothing to ask, so its quiet answer is drawn with its words.
 */
function AdvisorQuietCard({ title }: { title: string }) {
  const locale = useLocale()
  const copy = ADVISOR_RECORD_COPY[locale === "ru" || locale === "en" ? locale : "az"]
  return (
    <section data-testid="mtm-visit-advisor" className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="truncate text-sm font-semibold">{title}</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2" title={copy.openAdvisorCenter} aria-label={copy.openAdvisorCenter} asChild>
          <a href="/dashboard"><ArrowUpRight className="h-3.5 w-3.5" /></a>
        </Button>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
        {copy.noRisk}
      </div>
    </section>
  )
}

/* ── «Müştəri buradadır» ──────────────────────────────────────────────── */

/**
 * «Marşrutlar → Təsdiqlər» as `/mtm/routes?view=approvals` shows it: the
 * routes heading and its tabs, and the queue of `MtmCustomerLocationRequestQueue`
 * — one card per request, the map beside the facts, the visit the agent
 * already checked in from there, and the two worded buttons. Approving
 * removes the card, as in the product; the queue fetches and decides through
 * the API, so its frame is drawn here with its words.
 */
function PlaceScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("mtmRoutesPage")
  const locale = useLocale()
  const today = mtmDemoToday(snapshot.startedAt)
  const request = useMemo(() => mtmDemoPlaceRequest(today), [today])
  const approved = snapshot.ui["mtm.placeApproved"] === true
  const when = createDateFormatter(locale, { dateStyle: "medium", timeStyle: "short", timeZone: MTM_DEMO_TIMEZONE })
  const clock = createDateFormatter(locale, { timeStyle: "short", timeZone: MTM_DEMO_TIMEZONE })
  const facts: Array<[string, string]> = [
    [t("locationFactMoved"), t("locationMeters", { meters: request.movedMeters })],
    [t("locationFactAccuracy"), t("locationAccuracyValue", { meters: request.agentFix.accuracyMeters })],
    [t("locationFactAgentDistance"), request.agentToProposedMeters <= 5 ? t("locationAgentOnPoint") : t("locationMeters", { meters: request.agentToProposedMeters })],
    [t("locationFactOutOfZone", { days: 90 }), request.outsideVisitsHere90Days > 0 ? String(request.outsideVisitsHere90Days) : t("locationOutOfZoneNone")],
  ]

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
    toast.success(t("locationAccepted"))
  }

  return (
    <div className="space-y-3">
      <header data-testid="mtm-route-header" className="flex flex-col gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <RouteIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-6 text-foreground">{t("title")}</h1>
          </div>
          <DemoHelpButton className="shrink-0" onClick={() => hint(S.demoButtonHint)} />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-center">
          {/* The page's own tabs: an underline on one grey rule, the count a neutral chip. */}
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label={t("primaryViews")}>
            <div className={MTM_TAB_ROW} role="group" aria-label={t("primaryViews")}>
              <Button aria-pressed={false} variant="ghost" size="sm" className={mtmTabClass(false)} onClick={() => hint(S.mtmTabHint)}><List className="mr-1 h-4 w-4" aria-hidden="true" />{t("viewList")}</Button>
              <Button aria-pressed variant="ghost" size="sm" className={mtmTabClass(true)}>
                <ClipboardCheck className="mr-1 h-4 w-4" aria-hidden="true" />{t("viewApprovals")}
                {approved ? null : <span className="ml-1.5 min-w-5 rounded-full border border-zinc-300 px-1.5 text-center text-[11px] font-semibold leading-5 text-foreground dark:border-zinc-600">1</span>}
              </Button>
            </div>
          </nav>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button variant="outline" className="min-h-11 whitespace-nowrap px-3 lg:min-h-10" onClick={() => hint(S.demoButtonHint)}><FileSpreadsheet className="mr-1 h-4 w-4" aria-hidden="true" />{t("excelExchange")}</Button>
            <Button className="min-h-11 flex-1 whitespace-nowrap px-4 sm:flex-none lg:min-h-10" onClick={() => hint(S.demoButtonHint)}><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("add")}</Button>
          </div>
        </div>
      </header>

      {approved ? (
        // As the page says it when nothing is left to decide (`mtm-approvals-empty`); the card itself went with a toast.
        <div role="status" data-testid="mtm-place-approved" className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-card px-4 py-4 text-sm dark:border-zinc-700">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {t("needsAttentionClearDescription")}
        </div>
      ) : (
        <section data-tour-id="mtm-place-request" className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700" aria-labelledby="customer-location-heading">
          <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-4 dark:border-zinc-700 sm:px-5">
            <h2 id="customer-location-heading" className="flex items-center gap-2 text-base font-semibold">
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("locationQueueTitle")}
            </h2>
            <span className="text-sm font-medium text-muted-foreground">· {t("pendingApprovalsCount", { count: 1 })}</span>
          </header>
          <article className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
            <div className="relative isolate h-64 overflow-hidden rounded-lg border border-zinc-200 bg-muted xl:h-full xl:min-h-72 dark:border-zinc-700">
              <CustomerLocationRequestMap
                previous={request.previous}
                proposed={request.proposed}
                agentFix={request.agentFix}
                labels={{ previous: t("locationMapPrevious"), proposed: t("locationMapProposed") }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <h3 className="text-lg font-semibold leading-tight text-balance">{t("locationHeadline", { customer: request.customer })}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("locationSentBy", { agent: request.agent, when: when.format(new Date(request.sentAt)) })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{t("locationAddress", { address: `${request.address}, Bakı` })}</p>
              </div>
              <dl className="grid grid-cols-2 gap-2">
                {facts.map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-zinc-200 bg-card px-3 py-2 dark:border-zinc-700">
                    <dt className="text-[11px] text-muted-foreground"><HintValue text={t("hint.locationFacts")}>{label}</HintValue></dt>
                    <dd className="text-sm font-semibold text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                <span className="block text-[11px] text-muted-foreground">{t("locationAgentComment")}</span>
                {request.comment}
              </p>
              <p data-testid="mtm-customer-location-visits" className="rounded-lg border border-l-4 border-zinc-200 border-l-amber-500 bg-card px-3 py-2 text-sm text-foreground dark:border-zinc-700 dark:border-l-amber-500">
                {t("locationVisitsNote", { count: 1, time: clock.format(new Date(request.checkedInFromHereAt)) })}
              </p>
              <div className="mt-auto space-y-2">
                <Textarea readOnly placeholder={t("locationRejectComment")} aria-label={t("locationRejectComment")} rows={2} onClick={() => hint(S.demoButtonHint)} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" onClick={approve} {...demoTarget("mtm-place-approve")}><Check className="mr-2 h-4 w-4" aria-hidden="true" />{t("locationAccept")}</Button>
                  <Button type="button" variant="outline" onClick={() => hint(S.demoButtonHint)}><X className="mr-2 h-4 w-4" aria-hidden="true" />{t("locationReject")}</Button>
                </div>
              </div>
            </div>
          </article>
        </section>
      )}
    </div>
  )
}

/* ── Nəticələr ────────────────────────────────────────────────────────── */

/**
 * «Nəticələr» as `/mtm/analytics` shows it: the heading, the product's own
 * results (`MtmTeamResultsView` — the component the page draws once its
 * report has loaded) and the folded «how the figures are counted». The report
 * is the product's KPI registry (`buildExplainableKpi`) over five weeks of
 * the invented team's plan points and visits, so every period and team the
 * prospect picks shows the product's arithmetic. It opens on «Bu ay», as the
 * page does; the guide asks for «Keçən həftə» — the week that is whole.
 */
function ResultsScreen({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const ta = useTranslations("mtmAnalytics")
  const tr = useTranslations("mtmTeamResults")
  const today = mtmDemoToday(snapshot.startedAt)
  const facts = useMemo(() => mtmDemoKpiFacts(today), [today])
  const chosenPeriod = snapshot.ui["mtm.resultsPeriod"] === "lastWeek" ? "lastWeek" : null
  const [preset, setPreset] = useState<(typeof AGENT_PERIOD_PRESETS)[number]>(chosenPeriod ?? "thisMonth")
  const resultsRef = useRef<HTMLDivElement>(null)
  const lastWeekLabel = tr("preset.lastWeek")
  // The guide's arrow points at the product's own «Keçən həftə».
  useEffect(() => {
    const button = Array.from(resultsRef.current?.querySelectorAll<HTMLElement>("button[aria-pressed]") ?? []).find((candidate) => candidate.textContent?.trim() === lastWeekLabel)
    if (!button) return
    if (preset === "lastWeek" || step?.id !== "mtm-results-team") button.removeAttribute(DEMO_TARGET_ATTRIBUTE)
    else for (const [attribute, value] of Object.entries(demoTarget("mtm-results-team"))) button.setAttribute(attribute, value)
  })
  const choosePreset = (next: (typeof AGENT_PERIOD_PRESETS)[number]) => {
    setPreset(next)
    if (!reviewMode && step?.id === "mtm-results-team" && next === "lastWeek") dispatch({ type: "ui", path: "mtm.resultsPeriod", value: "lastWeek" })
  }
  const [teamId, setTeamId] = useState("")
  const range = agentPeriodPreset(preset, today)
  const report = useMemo(() => {
    const inScope = (item: { agentId: string; date: string }) => item.date >= range.from && item.date <= range.to
      && (!teamId || MTM_DEMO_AGENTS.find((agent) => agent.id === item.agentId)?.team === (teamId === "team-center" ? "center" : "south"))
    return buildExplainableKpi({
      planPoints: facts.planPoints.filter(inScope),
      visits: facts.visits.filter(inScope),
      visitType: "ALL",
      brandId: null,
      generatedAt: new Date(mtmDemoAt(today, MTM_DEMO_CLOCK)),
    })
  }, [facts, range.from, range.to, teamId, today])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PageDescription icon={BarChart3} title={ta("title")} />
        <DemoHelpButton variant="label" onClick={() => hint(S.demoButtonHint)} />
      </div>
      <div data-tour-id="mtm-results-team" ref={resultsRef}>
        <MtmTeamResultsView
          preset={preset}
          onPresetChange={choosePreset}
          teams={[{ id: "team-center", name: "Bakı — Mərkəz" }, { id: "team-south", name: "Bakı — Cənub" }]}
          teamId={teamId}
          onTeamChange={setTeamId}
          from={range.from}
          to={range.to}
          loading={false}
          failed={false}
          onRetry={() => {}}
          report={report}
          truncated={false}
        />
      </div>
      <button type="button" onClick={() => hint(S.demoButtonHint)} className="flex min-h-12 w-full items-center rounded-xl border border-zinc-200 bg-card px-4 py-3 text-left text-sm font-medium text-muted-foreground hover:text-foreground dark:border-zinc-700">
        {tr("formulasTitle")}
      </button>
    </div>
  )
}
