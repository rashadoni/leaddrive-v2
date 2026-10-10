"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { PageDescription } from "@/components/page-description"
import { MtmFilterBar, MtmFilterSearch, MtmFilterSelect } from "@/components/mtm/filter-bar"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import dynamic from "next/dynamic"
import { calculateDistance } from "@/lib/geo-utils"
import { LiveMapDaySteps } from "@/components/mtm/live-map-day-steps"
import { LiveMapLayersControl } from "@/components/mtm/live-map-layers-control"
import { DEFAULT_LIVE_MAP_BASE_MAP, liveMapBaseMaps, parseLiveMapBaseMap, type LiveMapBaseMapId } from "@/lib/mtm/live-map-base-maps"
import { LiveMapRoster } from "@/components/mtm/live-map-roster"
import { LiveMapTools } from "@/components/mtm/live-map-tools"
import { extendLiveMapTrails, outlineCrossesItself, pathLengthMeters, polygonAreaSquareMeters, type LiveMapTrails } from "@/lib/mtm/live-map-trails"
import {
  applyRosterFilters,
  parseRosterView,
  pickRosterStatus,
  ROSTER_DEFAULT_VIEW,
  ROSTER_VIEW_STORAGE_KEY,
  serializeRosterView,
  rosterDistanceToPoint,
  rosterStatusChipOn,
  rosterValue,
  sortRoster,
  withRosterFilter,
  type RosterFilters,
  type RosterSort,
  type RosterView,
} from "@/lib/mtm/live-map-roster"
import { liveMapDaySteps } from "@/lib/mtm/live-map-day-steps"
import { createDateFormatter, formatDateTime, formatTime } from "@/lib/format-date"
import { effectiveGeofenceRadius, formatMtmArea, formatMtmDistance } from "@/lib/mtm/visit-place-check"
import { mtmLiveFeedHistoryHref, type MtmLiveFeedAlertGroup } from "@/lib/mtm/live-feed-alerts"
import { LiveMapAgentEvents } from "@/components/mtm/live-map-agent-events"
import { LiveMapAgentDay } from "@/components/mtm/live-map-agent-day"
import { LiveMapAgentDevice } from "@/components/mtm/live-map-agent-device"
import { LiveMapAgentLinks } from "@/components/mtm/live-map-agent-links"
import { liveMapAgentLinks } from "@/lib/mtm/live-map-agent-links"
import { useMtmFeature } from "@/hooks/use-mtm-org-settings"
import { LiveMapCardBlocks, type LiveMapCardBlock } from "@/components/mtm/live-map-card-blocks"
import { CARD_LAYOUT_STORAGE_KEY, DEFAULT_CARD_LAYOUT, parseCardLayout, serializeCardLayout, type CardLayout } from "@/lib/mtm/live-map-card-layout"
import { LiveMapAgentPlace } from "@/components/mtm/live-map-agent-place"
import { liveMapAgentEventsRefreshKey } from "@/lib/mtm/live-map-agent-events"
import type { LiveMapPlaceStop } from "@/lib/mtm/live-map-place"
import { rosterExportFileName } from "@/lib/mtm/live-map-roster-export"
import { liveMapDuration, liveMapStateSince } from "@/lib/mtm/live-map-state-since"
import { parseLiveMapClients, type LiveMapClient, type LiveMapClientsAnswer } from "@/lib/mtm/live-map-clients"
import { LiveMapZoneForm, LiveMapZoneGone, liveMapZoneFormChange, type LiveMapZoneFormValues } from "@/components/mtm/live-map-zone-form"
import { LiveMapZonesCard } from "@/components/mtm/live-map-zones-card"
import { useLiveMapNoZonesWords } from "@/components/mtm/live-map-zone-list"
import { bringMapFrameIntoView } from "@/lib/mtm/live-map-frame-view"
import {
  liveMapZoneOutlineProblem,
  liveMapZoneShapeBody,
  liveMapZoneWriteProblem,
  parseLiveMapZone,
  parseLiveMapZones,
  sortLiveMapZones,
  withLiveMapZone,
  withoutLiveMapZone,
  type LiveMapZone,
  type LiveMapZoneChange,
  type LiveMapZoneShape,
  type LiveMapZonesAnswer,
  type LiveMapZoneWriteProblem,
} from "@/lib/mtm/live-map-zones"
import { summarizeMtmRouteExecution } from "@/lib/mtm/route-point-execution"
import { hasMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { saveRouteCache, loadRouteCache, routeCacheKey } from "@/lib/mtm/route-cache"
import type { LiveMapReferencePoint, RouteStop } from "@/components/mtm/live-map"
import type { MtmRoutePoint, MtmRouteRecord } from "@/components/mtm/route-types"
import { LocationHistoryPanel } from "@/components/mtm/location-history-panel"
import {
  MapPin, RefreshCw, Clock, WifiOff, Navigation,
  Radio, AlertTriangle, History,
  Battery, ShieldAlert, ArrowLeft, PauseCircle, Flag, Crosshair, Eye, Users,
} from "lucide-react"

const MtmLiveMap = dynamic(() => import("@/components/mtm/live-map"), { ssr: false })

// F-38: shared type — see src/lib/mtm-types.ts.
import type {
  LiveMapAgent,
  MtmDashboardAgent as AgentLocation,
  MtmLiveMapContract,
} from "@/lib/mtm-types"
import {
  isLiveMapAgentPositionVisible,
  isLiveMapPositionVisible,
  liveMapIdentityKey,
  liveMapRouteCacheScopeKey,
  parseMtmLiveMapContract,
  presentMtmDashboardAgent,
} from "@/lib/mtm-types"

interface LiveEvent {
  id: string
  type: string
  agent: string
  customer: string
  time: string
  agentId?: string
  visitId?: string
  /** Grouped, translatable alert (src/lib/mtm/live-feed-alerts.ts). */
  alert?: MtmLiveFeedAlertGroup["alert"]
}

const FEED_ALERT_TYPES = new Set([
  "GPS_ANOMALY", "LATE_START", "MISSED_VISIT", "LONG_BREAK", "GPS_SPOOFING", "OUT_OF_ZONE", "LOW_BATTERY", "OVERTIME",
])

interface LiveRosterSnapshot {
  identity: string
  agents: AgentLocation[]
  teams: Array<{ id: string; name: string }>
  liveFeed: LiveEvent[]
  contract: MtmLiveMapContract
  receivedAtMonotonicMs: number
}

interface ScopedRequest {
  id: number
  identity: string
  controller: AbortController | null
}

interface AgentRouteSnapshot {
  identity: string
  route: MtmRouteRecord | null
  fromCache: boolean
}

/**
 * How the map is drawn — remembered in the browser like the list's layout.
 * `areasList` rides with `areas`: whether the list of «Свои зоны», in its card
 * on the page, is unfolded.
 */
const MAP_LOOK_STORAGE_KEY = "leaddrive.mtm.live-map.look.v1"
const DEFAULT_MAP_LOOK = { labels: false, trails: true, glide: true, clients: false, areas: false, areasList: false, base: DEFAULT_LIVE_MAP_BASE_MAP as LiveMapBaseMapId }
/** The backgrounds this build can offer; the same list for as long as the page lives. */
const BASE_MAPS = liveMapBaseMaps()
/** With a point picked the list answers «who is nearest» — until another order is asked for. */
const NEAREST_FIRST: RosterSort = { column: "distance", direction: "asc" }

function parseMapLook(raw: string | null): typeof DEFAULT_MAP_LOOK {
  try {
    const stored = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    return {
      labels: typeof stored.labels === "boolean" ? stored.labels : DEFAULT_MAP_LOOK.labels,
      trails: typeof stored.trails === "boolean" ? stored.trails : DEFAULT_MAP_LOOK.trails,
      glide: typeof stored.glide === "boolean" ? stored.glide : DEFAULT_MAP_LOOK.glide,
      clients: typeof stored.clients === "boolean" ? stored.clients : DEFAULT_MAP_LOOK.clients,
      areas: typeof stored.areas === "boolean" ? stored.areas : DEFAULT_MAP_LOOK.areas,
      areasList: typeof stored.areasList === "boolean" ? stored.areasList : DEFAULT_MAP_LOOK.areasList,
      // A background this build no longer offers (the satellite contract ended) is not remembered.
      base: parseLiveMapBaseMap(stored.base, BASE_MAPS),
    }
  } catch {
    return DEFAULT_MAP_LOOK
  }
}

/** The «day route» layer switched off: one stable empty list, so the map does not refit on every render. */
const NO_ROUTE_STOPS: RouteStop[] = []
const NO_CLIENTS: readonly LiveMapClient[] = []
const NO_ZONES: readonly LiveMapZone[] = []
const EMPTY_STATUS_COUNTS = { total: 0, checkedIn: 0, onRoad: 0, stopped: 0, routeFinished: 0, late: 0, offline: 0 }
const EMPTY_FRESHNESS_COUNTS = { online: 0, delayed: 0, stale: 0, noLocation: 0 }
const EMPTY_WORKDAY_COUNTS = { active: 0, paused: 0, closed: 0, notStarted: 0 }

function requestStatus(error: unknown): number {
  return error != null && typeof error === "object" && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : 0
}

function isAbortError(error: unknown): boolean {
  return error != null && typeof error === "object" && "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
}

/**
 * The map and the list side by side on a wide screen: beside the map, as a
 * table, or the map alone. The table takes two thirds only where a third is
 * still a usable map (from 1360 px = 85rem); on a smaller laptop it stays the
 * list.
 *
 * The breakpoint is written in rem on purpose. Tailwind orders its width rules
 * by value, and cannot compare `lg` (64rem) with a breakpoint in px: written as
 * `min-[1360px]` the wide rule was emitted BEFORE the `lg` one and lost to it —
 * on production «Таблица» changed its own label and nothing else (2026-10-09).
 */
const CANVAS_COLUMNS = {
  narrow: "lg:grid-cols-[minmax(0,1fr)_400px]",
  wide: "lg:grid-cols-[minmax(0,1fr)_400px] min-[85rem]:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]",
  hidden: "lg:grid-cols-1",
} as const

/** A visit opened on an earlier day says its date too: «22:14» alone would read as today. */
function visitOpenedOnAnotherDay(openedAt: string, timeZone: string | undefined): boolean {
  const opened = new Date(openedAt)
  if (!Number.isFinite(opened.getTime())) return false
  const day = createDateFormatter("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  return day.format(opened) !== day.format(new Date())
}

function hasRenderableLivePosition(
  freshness: AgentLocation["freshness"],
  workdayState: LiveMapAgent["workdayState"],
  workforceEnabled: boolean,
): freshness is LiveMapAgent["freshness"] {
  return workforceEnabled
    ? isLiveMapAgentPositionVisible(freshness, workdayState)
    : isLiveMapPositionVisible(freshness)
}

function operationalWeekReturnHref(value: string | null): string | null {
  return value === "/mtm" || value?.startsWith("/mtm?") ? value : null
}

export default function MtmMapPage() {
  const { data: session, status: sessionStatus } = useSession()
  // Where «Профиль сотрудника» leads: his own section where the organization
  // keeps field contacts, the employees' list narrowed to him where it does not.
  const fieldContactsEnabled = useMtmFeature(session?.user, "fieldContactsEnabled").enabled
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations("nav")
  const tMap = useTranslations("mtmMap")
  const noZonesWords = useLiveMapNoZonesWords()
  const tf = useTranslations("mtmFilters")
  const tc = useTranslations("common")
  const tAlerts = useTranslations("mtmAlertsPage")
  const tUnits = useTranslations("mtmMap.distanceUnits")
  const [rosterSnapshot, setRosterSnapshot] = useState<LiveRosterSnapshot | null>(null)
  /**
   * Last known positions on the live map.
   *
   * A stale coordinate must never be presented as a current one — that rule
   * stays. But hiding it altogether answered the manager's only question,
   * "where is my agent", with an empty map: a phone that stopped reporting an
   * hour ago is exactly when someone looks. The marker is drawn grey and
   * square, the popup carries the time it was recorded, and the live counters
   * above still count it as stale.
   */
  const [showLastKnown, setShowLastKnown] = useState(true)
  const [teamFilter, setTeamFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("")
  const [debouncedEmployeeFilter, setDebouncedEmployeeFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshBlockedUntil, setRefreshBlockedUntil] = useState(0)
  const [loadError, setLoadError] = useState<{ identity: string; message: string } | null>(null)
  // The list's filters — one per column heading, as in a spreadsheet — and how
  // the list is laid out. The status chips above the map are the same status
  // filter under another hand. Filters live for the visit only; the layout is
  // remembered in the browser (see RosterView).
  const [rosterFilters, setRosterFilters] = useState<RosterFilters>({})
  const [rosterView, setRosterView] = useState<RosterView>(ROSTER_DEFAULT_VIEW)
  const [rosterHidden, setRosterHidden] = useState(false)
  const [showGeofence, setShowGeofence] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  // The stop of the selected employee's day that is in focus (its order in the
  // route), and whether the map keeps following him. Both belong to one
  // selection and are dropped with it.
  const [selectedStop, setSelectedStop] = useState<number | null>(null)
  const [followSelected, setFollowSelected] = useState(false)
  // What is drawn on the map (owner, 2026-10-09: «как убирать на карте
  // объекты, агентов»): whole layers — the markers, the selected employee's
  // route — and single employees, ticked or unticked on their card.
  const [showAgentMarkers, setShowAgentMarkers] = useState(true)
  const [showDayRoute, setShowDayRoute] = useState(true)
  const [hiddenAgentIds, setHiddenAgentIds] = useState<ReadonlySet<string>>(() => new Set())
  // How the markers are drawn (owner, 2026-10-09, of the tracker shown to him
  // as the model: «бери почти всё, чего нет у нас»): names beside them, the
  // tail of where each has just been, a glide instead of a jump.
  const [mapLook, setMapLook] = useState(DEFAULT_MAP_LOOK)
  // The card's blocks — folded, reordered, switched off — as this browser left them.
  const [cardLayout, setCardLayout] = useState<CardLayout>(DEFAULT_CARD_LAYOUT)
  const [trails, setTrails] = useState<LiveMapTrails>(() => new Map())
  // «Клиенты»: the client base as a layer. Read when the layer is switched on
  // and on «Обновить» — never on the roster's timer: a base does not move.
  // What is kept is the last base that was read for this viewer, and which
  // turn of reading has ended and how: a refresh that fails, or is still on
  // its way, never takes the points already on the map away.
  const [clientsRead, setClientsRead] = useState<{ identity: string; data: LiveMapClientsAnswer | null; settledKey: string; failed: boolean } | null>(null)
  const [clientsRevision, setClientsRevision] = useState(0)
  const clientsSettledRef = useRef<{ key: string; ok: boolean }>({ key: "", ok: false })
  const clientsRetriesRef = useRef(0)
  // «Свои зоны»: the areas the organization has drawn on this map and named.
  // Kept and read exactly like the client base above — when the layer is
  // switched on and on «Обновить», never on the roster's timer. One more thing
  // rides on the same answer: whether this viewer may draw zones at all. So it
  // is also asked for when the ruler or a point is taken up with the layer
  // off, and until it has come no «save as a zone» button is drawn.
  const [zonesRead, setZonesRead] = useState<{ identity: string; data: LiveMapZonesAnswer | null; settledKey: string; failed: boolean } | null>(null)
  const [zonesRevision, setZonesRevision] = useState(0)
  const zonesSettledRef = useRef<{ key: string; ok: boolean }>({ key: "", ok: false })
  const zonesRetriesRef = useRef(0)
  /** A read of the zones is on its way: what it brings was true before anything saved meanwhile. */
  const zonesReadOutRef = useRef(false)
  // The zone whose balloon on the map asked for a change, and which change.
  const [zoneEdit, setZoneEdit] = useState<{ zoneId: string; kind: LiveMapZoneChange["kind"] } | null>(null)
  // A rename or a colour that came too late: a colleague had removed the zone.
  // The zone goes from this map and its form goes with it, so why is said in
  // the place the form stood — above the list in the zones' card on the page
  // ("list"), or beside the tools for a form opened from the balloon ("map").
  // The second is inside the map's frame on purpose, and not a toast: with the
  // map on the whole screen the browser paints only that frame, and the form
  // simply closed and the zone vanished with nothing said — it read as
  // «renaming deleted my zone». (The card is outside the frame too, but so are
  // its rows: nothing can be asked from them while the map has the screen.)
  const [zoneGone, setZoneGone] = useState<"list" | "map" | null>(null)
  // «На карте» on a zone's row: which zone the map is asked to bring into
  // view, and which press it was — the same zone asked for again is a new turn.
  const [zoneAsked, setZoneAsked] = useState<{ zoneId: string; turn: number } | null>(null)
  // The tools on the map: a ruler, and a point — an address found or a place
  // pressed — that the list then measures everybody against.
  const [rulerActive, setRulerActive] = useState(false)
  const [rulerPoints, setRulerPoints] = useState<Array<{ latitude: number; longitude: number }>>([])
  const [pickingPoint, setPickingPoint] = useState(false)
  const [referencePoint, setReferencePoint] = useState<LiveMapReferencePoint | null>(null)
  const [nearestFirst, setNearestFirst] = useState(false)
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const [fullscreenSupported, setFullscreenSupported] = useState(false)
  const mapFrameRef = useRef<HTMLDivElement | null>(null)
  /** The order that is remembered in the browser — never the distance to a point. */
  const storedSortRef = useRef<RosterSort>(ROSTER_DEFAULT_VIEW.sort)
  const [routeSnapshot, setRouteSnapshot] = useState<AgentRouteSnapshot | null>(null)
  const [freshnessNow, setFreshnessNow] = useState<number | null>(null)
  const selectedAgentRef = useRef<string | null>(null)
  const rosterRequestRef = useRef<ScopedRequest>({ id: 0, identity: "", controller: null })
  const routeRequestRef = useRef<ScopedRequest>({ id: 0, identity: "", controller: null })
  const rosterSnapshotRef = useRef<LiveRosterSnapshot | null>(null)
  const lastRosterRequestStartedAtRef = useRef(0)
  const nextRosterRequestAllowedAtRef = useRef(0)
  const orgId = session?.user?.organizationId
  const viewerKey = String(session?.user?.id ?? session?.user?.email ?? "")
  const identityKey = liveMapIdentityKey(String(orgId ?? ""), viewerKey)
  // The URL is the one source of the mode. A local copy of it got out of step
  // with links (review of #205): after an alert link and a click on «İndi»,
  // the next alert link stayed in live mode and selected a stray employee.
  const mapMode: "live" | "history" = searchParams.get("mode") === "history" ? "history" : "live"
  const historyPanelKey = `${identityKey}::${searchParams.toString()}`
  // A link that names an employee (operational week, alerts, a colleague's
  // message) used to open the live map with nobody selected (audit 2026-09-14).
  const requestedAgentId = searchParams.get("agentId")?.trim() || ""
  const handledAgentParamRef = useRef("")
  const returnHref = operationalWeekReturnHref(searchParams.get("returnTo"))
  const roster = rosterSnapshot?.identity === identityKey ? rosterSnapshot : null
  const contract = roster?.contract ?? null
  const tenantToday = contract?.today ?? ""
  const presentationNow = freshnessNow ?? (contract ? Date.parse(contract.generatedAt) : 0)
  const agents = useMemo(
    () => (roster?.agents ?? []).map((agent) => {
      const presented = presentMtmDashboardAgent(agent, contract?.freshnessThresholds, presentationNow)
      if (!referencePoint) return presented
      // With a point picked on the map every row says how far its employee is
      // from it — measured only from a position the map itself would draw. A
      // workday that is closed, a signal gone stale: no marker, and no place
      // among «the nearest».
      const drawn = hasRenderableLivePosition(presented.freshness, presented.workdayState, contract?.workforceEnabled !== false)
      return { ...presented, distanceMeters: drawn ? rosterDistanceToPoint(presented, referencePoint) : null }
    }),
    [contract, presentationNow, referencePoint, roster?.agents],
  )
  const teams = roster?.teams ?? []
  const liveFeed = roster?.liveFeed ?? []
  const lastUpdate = contract ? new Date(contract.generatedAt) : null
  const visibleLoadError = loadError?.identity === identityKey ? loadError.message : null
  const routeIdentity = selectedAgent && tenantToday
    ? `${identityKey}::${encodeURIComponent(selectedAgent)}::${tenantToday}`
    : ""
  const visibleRouteSnapshot = routeSnapshot?.identity === routeIdentity ? routeSnapshot : null
  const agentRoute = visibleRouteSnapshot?.route ?? null
  const routeFromCache = visibleRouteSnapshot?.fromCache ?? false
  // Refs keep polling closures current without making a successful response
  // restart the polling effect.
  useEffect(() => { selectedAgentRef.current = selectedAgent }, [selectedAgent])
  useEffect(() => { rosterSnapshotRef.current = rosterSnapshot }, [rosterSnapshot])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedEmployeeFilter(employeeFilter.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [employeeFilter])
  // The layout of the list and the look of the map come back as they were left in this browser.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ROSTER_VIEW_STORAGE_KEY)
      if (stored) {
        const view = parseRosterView(stored)
        storedSortRef.current = view.sort
        setRosterView(view)
      }
      setMapLook(parseMapLook(window.localStorage.getItem(MAP_LOOK_STORAGE_KEY)))
      setCardLayout(parseCardLayout(window.localStorage.getItem(CARD_LAYOUT_STORAGE_KEY)))
    } catch { /* storage closed to the page: the defaults */ }
  }, [])
  const changeCardLayout = (next: CardLayout) => {
    setCardLayout(next)
    try {
      window.localStorage.setItem(CARD_LAYOUT_STORAGE_KEY, serializeCardLayout(next))
    } catch { /* not remembered; still applied */ }
  }
  const changeMapLook = (change: Partial<typeof DEFAULT_MAP_LOOK>) => {
    const next = { ...mapLook, ...change }
    setMapLook(next)
    try {
      window.localStorage.setItem(MAP_LOOK_STORAGE_KEY, JSON.stringify(next))
    } catch { /* not remembered; still applied */ }
  }
  // The whole screen for the map: the browser's own full screen, on the map's frame.
  useEffect(() => {
    setFullscreenSupported(typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function")
    const onChange = () => setMapFullscreen(document.fullscreenElement != null && document.fullscreenElement === mapFrameRef.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  const toggleMapFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void mapFrameRef.current?.requestFullscreen?.()?.catch?.(() => undefined)
  }, [])
  // The ruler measures while it is on; switched off, it forgets its points.
  const switchRuler = useCallback((on: boolean) => {
    setRulerActive(on)
    setRulerPoints([])
  }, [])
  const rulerMeters = useMemo(() => pathLengthMeters(rulerPoints), [rulerPoints])
  // The area inside the ruler's line, closed back to its first point — from
  // three points, and only for an outline that does not cross itself (a
  // figure of eight has no one area to read).
  const rulerSquareMeters = useMemo(
    () => (rulerPoints.length >= 3 && !outlineCrossesItself(rulerPoints) ? polygonAreaSquareMeters(rulerPoints) : null),
    [rulerPoints],
  )
  // A point picked: the list turns to «nearest first» until another order is asked for.
  const changeReferencePoint = useCallback((point: LiveMapReferencePoint | null) => {
    setReferencePoint(point)
    setNearestFirst(point != null)
    setPickingPoint(false)
    if (point) {
      // The answer to «who is nearest» is in the list: bring it back if it was put away.
      setRosterHidden(false)
      return
    }
    // The point gone, an order «by distance» has nothing to measure: back to
    // the remembered one. And a filter on the distance goes with it — left
    // behind, it would match nobody and empty the list and the map.
    setRosterView((view) => view.sort.column === "distance" ? { ...view, sort: storedSortRef.current } : view)
    setRosterFilters((filters) => withRosterFilter(filters, "distance", undefined))
  }, [])
  // A press on the map itself belongs to the tool that is waiting for it: the
  // ruler takes one more point, «point on the map» takes its one. With neither
  // on, the map does not report presses at all.
  const pickedPointLabel = tMap("tools.pointPicked")
  const handleMapPress = useCallback((latitude: number, longitude: number) => {
    if (rulerActive) setRulerPoints((points) => [...points, { latitude, longitude }])
    else if (pickingPoint) changeReferencePoint({ latitude, longitude, label: pickedPointLabel })
  }, [changeReferencePoint, pickedPointLabel, pickingPoint, rulerActive])
  const switchMapMode = useCallback((next: "live" | "history") => {
    const params = new URLSearchParams(searchParams.toString())
    // Live mode carries no history window and no employee from a history
    // link; only the way back to the operational week survives.
    for (const key of ["mode", "from", "to", "date", "agentId"]) params.delete(key)
    if (next === "history") {
      params.set("mode", "history")
      const focused = selectedAgentRef.current
      if (focused && tenantToday) {
        params.set("agentId", focused)
        params.set("date", tenantToday)
      }
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams, tenantToday])

  useEffect(() => {
    rosterRequestRef.current.controller?.abort()
    routeRequestRef.current.controller?.abort()
    rosterRequestRef.current = { id: rosterRequestRef.current.id + 1, identity: identityKey, controller: null }
    routeRequestRef.current = { id: routeRequestRef.current.id + 1, identity: identityKey, controller: null }
    rosterSnapshotRef.current = null
    lastRosterRequestStartedAtRef.current = 0
    nextRosterRequestAllowedAtRef.current = 0
    selectedAgentRef.current = null
    setRosterSnapshot(null)
    setRouteSnapshot(null)
    setSelectedAgent(null)
    setTeamFilter("")
    setEmployeeFilter("")
    setDebouncedEmployeeFilter("")
    // Another organization or viewer: its people are not the ones filtered or hidden here.
    setRosterFilters({})
    setHiddenAgentIds(new Set())
    setTrails(new Map())
    setReferencePoint(null)
    setNearestFirst(false)
    setPickingPoint(false)
    setRulerActive(false)
    setRulerPoints([])
    setZoneEdit(null)
    setZoneGone(null)
    setLoadError(null)
    setFreshnessNow(null)
    setRefreshBlockedUntil(0)
    setRefreshing(false)
    setLoading(Boolean(identityKey))
  }, [identityKey])

  const fetchAgentRoute = useCallback(async (agentId: string, today: string) => {
    if (!identityKey || !orgId || !viewerKey || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return
    routeRequestRef.current.controller?.abort()
    const requestId = routeRequestRef.current.id + 1
    const requestIdentity = `${identityKey}::${encodeURIComponent(agentId)}::${today}`
    const controller = new AbortController()
    routeRequestRef.current = { id: requestId, identity: requestIdentity, controller }
    const scopedAgentKey = liveMapRouteCacheScopeKey(String(orgId), viewerKey, agentId)
    const key = routeCacheKey(scopedAgentKey, today)
    const isCurrentRequest = () => !controller.signal.aborted &&
      routeRequestRef.current.id === requestId &&
      routeRequestRef.current.identity === requestIdentity &&
      routeRequestRef.current.controller === controller
    // Read again for the same employee and day (every refresh of the map does
    // it): what is on screen stays until the new answer arrives. Emptied each
    // time, the day's steps and «где сейчас» fell back to «загрузка» for a
    // moment every thirty seconds — for a man standing at a client. Another
    // employee's or another day's route is still dropped at once.
    setRouteSnapshot((shown) => (shown?.identity === requestIdentity ? shown : null))

    try {
      const res = await fetch(`/api/v1/mtm/routes?agentId=${encodeURIComponent(agentId)}&date=${today}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
        cache: "no-store",
        signal: controller.signal,
      })
      const r = await res.json().catch(() => null)
      if (!res.ok || !r?.success) {
        const failure = new Error(r?.error || `HTTP ${res.status}`)
        Object.assign(failure, { status: res.status })
        throw failure
      }
      if (!isCurrentRequest()) return
      const route = r.success && r.data?.routes?.length > 0 ? r.data.routes[0] : null
      setRouteSnapshot({ identity: requestIdentity, route, fromCache: false })
      // Online truth wins; cache the day-route so it survives a later dead zone.
      if (route) void saveRouteCache(key, route)
    } catch (error) {
      if (!isCurrentRequest() || isAbortError(error)) return
      const status = requestStatus(error)
      if (status === 401 || status === 403 || status === 404) {
        setRouteSnapshot({ identity: requestIdentity, route: null, fromCache: false })
        return
      }
      // Only the exact tenant + viewer + agent + tenant-day key may recover.
      const cached = await loadRouteCache<MtmRouteRecord>(key)
      if (!isCurrentRequest()) return
      if (cached) {
        setRouteSnapshot({ identity: requestIdentity, route: cached.data, fromCache: true })
      } else {
        setRouteSnapshot({ identity: requestIdentity, route: null, fromCache: false })
      }
    }
  }, [identityKey, orgId, viewerKey])

  const fetchLocations = useCallback(async () => {
    if (!identityKey || !orgId || !viewerKey) {
      setLoading(false)
      return
    }
    const params = new URLSearchParams()
    if (teamFilter) params.set("teamId", teamFilter)
    if (debouncedEmployeeFilter) params.set("employee", debouncedEmployeeFilter)
    const query = params.toString()
    const requestIdentity = `${identityKey}::${query}`
    const activeRequest = rosterRequestRef.current
    if (activeRequest.controller && !activeRequest.controller.signal.aborted && activeRequest.identity === requestIdentity) return
    activeRequest.controller?.abort()
    const requestId = activeRequest.id + 1
    const controller = new AbortController()
    rosterRequestRef.current = { id: requestId, identity: requestIdentity, controller }
    const isCurrentRequest = () => !controller.signal.aborted &&
      rosterRequestRef.current.id === requestId &&
      rosterRequestRef.current.identity === requestIdentity &&
      rosterRequestRef.current.controller === controller
    const hasCurrentRoster = rosterSnapshotRef.current?.identity === identityKey
    const requestStartedAt = Date.now()
    const minimumIntervalSeconds = rosterSnapshotRef.current?.identity === identityKey
      ? rosterSnapshotRef.current.contract.polling.minimumIntervalSeconds
      : 15
    lastRosterRequestStartedAtRef.current = requestStartedAt
    nextRosterRequestAllowedAtRef.current = requestStartedAt + minimumIntervalSeconds * 1_000
    setRefreshBlockedUntil(nextRosterRequestAllowedAtRef.current)
    setRefreshing(hasCurrentRoster)
    setLoading(!hasCurrentRoster)

    try {
      const response = await fetch(`/api/v1/mtm/locations${query ? `?${query}` : ""}`, {
        headers: { "x-organization-id": String(orgId) },
        cache: "no-store",
        signal: controller.signal,
      })
      const result = await response.json().catch(() => null)
      if (!isCurrentRequest()) return
      if (!response.ok || !result?.success) {
        if (response.status === 429) {
          const retryAfter = Number(result?.retryAfterSeconds)
          nextRosterRequestAllowedAtRef.current = Math.max(
            nextRosterRequestAllowedAtRef.current,
            Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 15) * 1_000,
          )
          setRefreshBlockedUntil(nextRosterRequestAllowedAtRef.current)
        }
        const failure = new Error(tMap("loadFailed"))
        Object.assign(failure, { status: response.status })
        throw failure
      }
      const nextContract = parseMtmLiveMapContract(result.data?.contract)
      if (!nextContract || !Array.isArray(result.data?.agentLocations) || !Array.isArray(result.data?.liveFeed)) {
        const failure = new Error(tMap("invalidResponse"))
        Object.assign(failure, { status: 502 })
        throw failure
      }
      nextRosterRequestAllowedAtRef.current = Math.max(
        nextRosterRequestAllowedAtRef.current,
        requestStartedAt + nextContract.polling.minimumIntervalSeconds * 1_000,
      )
      setRefreshBlockedUntil(nextRosterRequestAllowedAtRef.current)
      const nextAgents = result.data.agentLocations as AgentLocation[]
      const previousTeams = rosterSnapshotRef.current?.identity === identityKey
        ? rosterSnapshotRef.current.teams
        : []
      const nextSnapshot: LiveRosterSnapshot = {
        identity: identityKey,
        agents: nextAgents,
        teams: !teamFilter && !debouncedEmployeeFilter && Array.isArray(result.data.teams)
          ? result.data.teams
          : previousTeams,
        liveFeed: result.data.liveFeed,
        contract: nextContract,
        receivedAtMonotonicMs: window.performance.now(),
      }
      rosterSnapshotRef.current = nextSnapshot
      setRosterSnapshot(nextSnapshot)
      // «След»: one more position per employee, from this answer and no other
      // source — and only a position the map itself would draw at this moment.
      setTrails((current) => extendLiveMapTrails(
        current,
        nextAgents.filter((agent) => hasRenderableLivePosition(agent.freshness, agent.workdayState, nextContract.workforceEnabled)),
        Date.parse(nextContract.generatedAt),
      ))
      setFreshnessNow(Date.parse(nextContract.generatedAt))
      setLoadError(null)
      const focusedAgentId = selectedAgentRef.current
      if (focusedAgentId && nextAgents.some((agent) => agent.agentId === focusedAgentId)) {
        void fetchAgentRoute(focusedAgentId, nextContract.today)
      } else if (focusedAgentId) {
        selectedAgentRef.current = null
        routeRequestRef.current.controller?.abort()
        setSelectedAgent(null)
        setRouteSnapshot(null)
      }
    } catch (error) {
      if (!isCurrentRequest() || isAbortError(error)) return
      const status = requestStatus(error)
      if (status === 401 || status === 403) {
        routeRequestRef.current.controller?.abort()
        rosterSnapshotRef.current = null
        selectedAgentRef.current = null
        setRosterSnapshot(null)
        setRouteSnapshot(null)
        setSelectedAgent(null)
      }
      setLoadError({ identity: identityKey, message: error instanceof Error ? error.message : tMap("loadFailed") })
    } finally {
      if (isCurrentRequest()) {
        rosterRequestRef.current.controller = null
        setRefreshing(false)
        setLoading(false)
      }
    }
  }, [debouncedEmployeeFilter, fetchAgentRoute, identityKey, orgId, tMap, teamFilter, viewerKey])

  useEffect(() => {
    if (mapMode !== "live" || !identityKey) return
    void fetchLocations()
    const interval = window.setInterval(() => {
      const minimumIntervalMs = Math.max(
        15,
        rosterSnapshotRef.current?.identity === identityKey
          ? rosterSnapshotRef.current.contract.polling.minimumIntervalSeconds
          : 15,
      ) * 1_000
      if (document.visibilityState === "visible" &&
          Date.now() - lastRosterRequestStartedAtRef.current >= minimumIntervalMs &&
          Date.now() >= nextRosterRequestAllowedAtRef.current) {
        void fetchLocations()
      }
    }, 30_000)
    return () => {
      window.clearInterval(interval)
      rosterRequestRef.current.controller?.abort()
    }
  }, [fetchLocations, identityKey, mapMode])

  useEffect(() => {
    if (!roster || !contract) return
    let timer: number | null = null
    const updateFreshness = () => {
      // Anchor aging to the server response time and a monotonic client clock.
      // A misconfigured browser wall clock therefore cannot keep old GPS live.
      const now = Date.parse(contract.generatedAt) + Math.max(
        0,
        window.performance.now() - roster.receivedAtMonotonicMs,
      )
      setFreshnessNow(now)
      const boundaries = roster.agents.flatMap((agent) => {
        const recordedAt = agent.recordedAt ? Date.parse(agent.recordedAt) : Number.NaN
        const lastSeenAt = agent.lastSeenAt ? Date.parse(agent.lastSeenAt) : Number.NaN
        return [
          ...(Number.isFinite(recordedAt) && agent.freshness !== "NO_LOCATION" ? [
            recordedAt + contract.freshnessThresholds.onlineSeconds * 1_000 + 1,
            recordedAt + contract.freshnessThresholds.delayedSeconds * 1_000 + 1,
          ] : []),
          ...(agent.isOnline && Number.isFinite(lastSeenAt) ? [
            lastSeenAt + contract.freshnessThresholds.onlineSeconds * 1_000 + 1,
          ] : []),
        ].filter((boundary) => boundary > now)
      })
      const nextBoundary = boundaries.length ? Math.min(...boundaries) : null
      // With no threshold left the clock still moves once a minute: the list
      // shows how old each signal is, and it must go on ageing while polls fail.
      timer = window.setTimeout(
        updateFreshness,
        nextBoundary != null ? Math.min(60_000, Math.max(100, nextBoundary - now)) : 60_000,
      )
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") updateFreshness()
    }
    updateFreshness()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (timer != null) window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [contract, roster])

  // The client base for «Клиенты». The key names the viewer and the turn of
  // reading («Обновить», a retry): switching the layer off and on again asks
  // for nothing new — the base that was read is still the base.
  const clientsKey = mapLook.clients && mapMode === "live" && identityKey ? `${identityKey}::${clientsRevision}` : ""
  useEffect(() => {
    if (!clientsKey) return
    if (clientsSettledRef.current.key === clientsKey && clientsSettledRef.current.ok) return
    const controller = new AbortController()
    let retryTimer: number | null = null
    void fetch("/api/v1/mtm/locations/clients", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) as { data?: unknown } | null : null
        return parseLiveMapClients(body?.data)
      })
      .catch(() => null)
      .then((data) => {
        if (controller.signal.aborted) return
        clientsSettledRef.current = { key: clientsKey, ok: data !== null }
        setClientsRead((held) => ({
          identity: identityKey,
          // A read that failed keeps what this viewer was last given.
          data: data ?? (held?.identity === identityKey ? held.data : null),
          settledKey: clientsKey,
          failed: data === null,
        }))
        if (data !== null) {
          clientsRetriesRef.current = 0
        } else if (clientsRetriesRef.current < 3) {
          // Tried again by itself, a few times, a minute apart (the server
          // answers a handful of these a minute): a blip when the page opened
          // must not leave the layer empty until somebody thinks to refresh.
          clientsRetriesRef.current += 1
          retryTimer = window.setTimeout(() => setClientsRevision((turn) => turn + 1), 60_000)
        }
      })
    return () => {
      controller.abort()
      if (retryTimer != null) window.clearTimeout(retryTimer)
    }
  }, [clientsKey, identityKey])
  const clientsHeld = clientsRead && clientsRead.identity === identityKey ? clientsRead : null
  const clientsLoading = Boolean(clientsKey) && clientsHeld?.settledKey !== clientsKey
  const clientsFailed = Boolean(clientsKey) && clientsHeld?.settledKey === clientsKey && clientsHeld.failed
  const mapClients = clientsKey && clientsHeld?.data ? clientsHeld.data.clients : NO_CLIENTS
  const retryClients = useCallback(() => {
    clientsRetriesRef.current = 0
    setClientsRevision((turn) => turn + 1)
  }, [])
  // What the layer's line says: what it is, and — once read — what it shows
  // and what it cannot (a client without coordinates is not on any map).
  // The background chosen in «Слои»; null is the one every MTM map draws.
  const baseMap = useMemo(() => {
    const chosen = BASE_MAPS.find((map) => map.id === mapLook.base)
    return chosen?.tiles ? { id: chosen.id, ...chosen.tiles } : null
  }, [mapLook.base])
  const clientsHint = !clientsKey
    ? tMap("layers.clientsHint")
    : clientsHeld?.data
      ? [
        tMap("clients.onMap", { shown: clientsHeld.data.clients.length, total: clientsHeld.data.total }),
        clientsHeld.data.withoutCoordinates > 0 ? tMap("clients.withoutCoordinates", { count: clientsHeld.data.withoutCoordinates }) : "",
        clientsHeld.data.truncated ? tMap("clients.truncated") : "",
        clientsFailed ? tMap("clients.refreshFailed") : "",
      ].filter(Boolean).join(" · ")
      : clientsLoading ? tMap("clients.loading") : tMap("clients.failed")
  // The line above is inside «Слои». What must be seen with that panel closed
  // goes onto the map itself: a layer that is on and has nothing to show for
  // it, or shows only a part.
  const clientsAlert = !clientsKey || clientsLoading
    ? null
    : !clientsHeld?.data
      ? { text: tMap("clients.failedShort"), actionLabel: tMap("clients.retry"), onAction: retryClients }
      : clientsHeld.data.truncated
        ? { text: tMap("clients.truncated"), actionLabel: null, onAction: null }
        : null
  const nearestToClient = useCallback((client: LiveMapClient) => {
    changeReferencePoint({ latitude: client.latitude, longitude: client.longitude, label: client.name })
  }, [changeReferencePoint])

  // The organization's own zones. Wanted while their layer is on — and while
  // the ruler or a point is in hand, because what those two may offer («save
  // as a zone») is in the same answer. The key is the client base's: the
  // viewer and the turn of reading, so taking the ruler up a second time, or
  // switching the layer off and on, asks for nothing new.
  const zonesLayerOn = mapLook.areas && mapMode === "live" && Boolean(identityKey)
  const zonesKey = (mapLook.areas || rulerActive || pickingPoint || referencePoint != null) && mapMode === "live" && identityKey
    ? `${identityKey}::${zonesRevision}`
    : ""
  useEffect(() => {
    if (!zonesKey) return
    if (zonesSettledRef.current.key === zonesKey && zonesSettledRef.current.ok) return
    const controller = new AbortController()
    let retryTimer: number | null = null
    zonesReadOutRef.current = true
    void fetch("/api/v1/mtm/locations/zones", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) as { data?: unknown } | null : null
        return parseLiveMapZones(body?.data)
      })
      .catch(() => null)
      .then((data) => {
        if (controller.signal.aborted) return
        zonesReadOutRef.current = false
        zonesSettledRef.current = { key: zonesKey, ok: data !== null }
        setZonesRead((held) => ({
          identity: identityKey,
          // A read that failed keeps the zones this viewer was last given.
          data: data ?? (held?.identity === identityKey ? held.data : null),
          settledKey: zonesKey,
          failed: data === null,
        }))
        if (data !== null) {
          zonesRetriesRef.current = 0
        } else if (zonesRetriesRef.current < 3) {
          // Like the client base: tried again by itself a few times, a minute apart.
          zonesRetriesRef.current += 1
          retryTimer = window.setTimeout(() => setZonesRevision((turn) => turn + 1), 60_000)
        }
      })
    return () => {
      controller.abort()
      zonesReadOutRef.current = false
      if (retryTimer != null) window.clearTimeout(retryTimer)
    }
  }, [zonesKey, identityKey])
  const zonesHeld = zonesRead && zonesRead.identity === identityKey ? zonesRead : null
  const zonesAnswer = zonesHeld?.data ?? null
  const zonesLoading = Boolean(zonesKey) && zonesHeld?.settledKey !== zonesKey
  const zonesFailed = Boolean(zonesKey) && zonesHeld?.settledKey === zonesKey && zonesHeld.failed
  // Only what the server itself said: a viewer it has not answered about draws nothing.
  const zonesCanWrite = zonesAnswer?.canWrite === true
  // By name, as the viewer's language sorts: the server answers oldest first.
  const sortedZones = useMemo(() => (zonesAnswer ? sortLiveMapZones(zonesAnswer.zones, locale) : NO_ZONES), [zonesAnswer, locale])
  const mapZones = zonesLayerOn ? sortedZones : NO_ZONES
  const retryZones = useCallback(() => {
    zonesRetriesRef.current = 0
    setZonesRevision((turn) => turn + 1)
  }, [])
  // No zones yet, and nothing else to say of them: the line says how to draw
  // the first one (to a reader — who may), in the card's own words. The card
  // is put away with the employees' list and is outside the map's frame when
  // the map has the whole screen; this line is on the map in every mode.
  const areasHint = !zonesLayerOn
    ? tMap("layers.areasHint")
    : zonesAnswer
      ? zonesAnswer.zones.length === 0 && zonesAnswer.unreadable === 0 && !zonesFailed ? noZonesWords(zonesCanWrite) : [
        tMap("areas.onMap", { count: zonesAnswer.zones.length }),
        zonesAnswer.unreadable > 0 ? tMap("areas.unreadable", { count: zonesAnswer.unreadable }) : "",
        zonesFailed ? tMap("areas.refreshFailed") : "",
      ].filter(Boolean).join(" · ")
      : zonesLoading ? tMap("areas.loading") : tMap("areas.failed")
  // With «Слои» closed a layer that could not be read looks like «no zones here».
  const areasAlert = !zonesLayerOn || zonesLoading || zonesAnswer
    ? null
    : { text: tMap("areas.failedShort"), actionLabel: tMap("areas.retry"), onAction: retryZones, testId: "live-map-areas-alert" }
  // Whether what the ruler has outlined can be kept as it stands — and when it
  // cannot, why: too few points, a line that crosses itself, points that
  // enclose nothing. The reason and not a yes-or-no, because the tools say it
  // in words: a button that is merely missing explains nothing.
  const rulerOutlineProblem = useMemo(() => liveMapZoneOutlineProblem(rulerPoints), [rulerPoints])

  // One request about one zone. What comes back is what the server kept, or
  // why it did not: the page draws the first and says the second — it never
  // draws what it only hoped was saved.
  const sendZone = async (method: "POST" | "PUT" | "DELETE", zoneId: string | null, body?: unknown): Promise<{ kept: unknown } | { problem: LiveMapZoneWriteProblem }> => {
    try {
      const response = await fetch(`/api/v1/mtm/locations/zones${zoneId ? `/${encodeURIComponent(zoneId)}` : ""}`, {
        method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      })
      const answer = await response.json().catch(() => null) as { success?: unknown; data?: unknown; code?: unknown } | null
      if (!response.ok || answer?.success !== true) return { problem: liveMapZoneWriteProblem(response.status, answer?.code) }
      return { kept: answer?.data }
    } catch {
      return { problem: "network" }
    }
  }
  // The zones this viewer holds, after a change the server has kept. The
  // answer is put into the list in hand — the whole list is not read again
  // for one zone. Two cases do read it again: the server kept something this
  // page cannot draw back, and a read that was on its way while the change
  // was made (what it brings is the list as it was before).
  const zonesChanged = (identity: string, change: (answer: LiveMapZonesAnswer) => LiveMapZonesAnswer, readAgain = false) => {
    setZonesRead((held) => (held && held.identity === identity && held.data ? { ...held, data: change(held.data) } : held))
    if (readAgain || zonesReadOutRef.current) retryZones()
  }
  const createZone = async (kind: "outline" | "circle", values: LiveMapZoneFormValues): Promise<LiveMapZoneWriteProblem | null> => {
    const shape: LiveMapZoneShape | null = kind === "outline"
      ? { kind: "POLYGON", outline: rulerPoints }
      : referencePoint
        ? { kind: "CIRCLE", center: { latitude: referencePoint.latitude, longitude: referencePoint.longitude }, radiusMeters: values.radiusMeters }
        : null
    if (!shape) return "invalid"
    const identity = identityKey
    // Safe to send again: when the answer to a drawing is lost on its way back
    // and «Сохранить» is pressed once more, the server answers with the zone it
    // already kept (zones/route.ts) — which is then drawn here, once.
    const sent = await sendZone("POST", null, { name: values.name, color: values.color, ...liveMapZoneShapeBody(shape) })
    // «Not found» about a zone that does not exist yet is not «somebody removed it».
    if ("problem" in sent) return sent.problem === "gone" ? "failed" : sent.problem
    const zone = parseLiveMapZone(sent.kept)
    setZoneGone(null)
    zonesChanged(identity, (answer) => (zone ? withLiveMapZone(answer, zone) : answer), zone === null)
    // The new zone is seen at once: its layer comes on, and the ruler that outlined it is put down.
    if (!mapLook.areas) changeMapLook({ areas: true })
    if (kind === "outline") switchRuler(false)
    return null
  }
  const changeZone = async (zone: LiveMapZone, change: LiveMapZoneChange, askedFrom: "list" | "map"): Promise<LiveMapZoneWriteProblem | null> => {
    const identity = identityKey
    const sent = change.kind === "delete"
      ? await sendZone("DELETE", zone.id)
      : await sendZone("PUT", zone.id, change.kind === "rename" ? { name: change.name } : { color: change.color })
    if ("problem" in sent) {
      if (sent.problem !== "gone") return sent.problem
      // Somebody else removed it meanwhile. It is gone from this map too; a
      // rename or a colour that came too late is said — where the form was
      // (see zoneGone) — and a removal needs no saying.
      zonesChanged(identity, (answer) => withoutLiveMapZone(answer, zone.id))
      setZoneGone(change.kind === "delete" ? null : askedFrom)
      return null
    }
    // A change the server kept: whatever was said about another zone has been read.
    setZoneGone(null)
    if (change.kind === "delete") {
      zonesChanged(identity, (answer) => withoutLiveMapZone(answer, zone.id))
      return null
    }
    const saved = parseLiveMapZone(sent.kept)
    zonesChanged(identity, (answer) => (saved ? withLiveMapZone(answer, saved) : answer), saved === null)
    return null
  }
  const openZoneForm = useCallback((zoneId: string, kind: LiveMapZoneChange["kind"]) => {
    setZoneEdit({ zoneId, kind })
    setZoneGone(null)
  }, [])
  const showZoneOnMap = (zone: LiveMapZone) => {
    setZoneAsked((asked) => ({ zoneId: zone.id, turn: (asked?.turn ?? 0) + 1 }))
    // «Следить» would take the map back to the employee at his next position: the button pressed in words wins.
    setFollowSelected(false)
    // Under the map (a phone) the row pressed is a screen below it.
    bringMapFrameIntoView(mapFrameRef.current)
  }
  // Only a zone that is on the map now, for somebody who may change it.
  const editedZone = zoneEdit && zonesLayerOn && zonesCanWrite ? sortedZones.find((zone) => zone.id === zoneEdit.zoneId) ?? null : null
  const formatArea = (squareMeters: number) => formatMtmArea(squareMeters, locale, (unit, value) => tMap(`areaUnits.${unit}`, { value }))

  const manualRefresh = () => {
    const minimumIntervalSeconds = contract?.polling.minimumIntervalSeconds ?? 15
    const nextAllowedAt = Math.max(
      refreshBlockedUntil,
      nextRosterRequestAllowedAtRef.current,
      lastRosterRequestStartedAtRef.current + minimumIntervalSeconds * 1_000,
    )
    if (Date.now() < nextAllowedAt) {
      toast.info(tMap("refreshCooldown", {
        seconds: Math.max(1, Math.ceil((nextAllowedAt - Date.now()) / 1_000)),
      }))
      return
    }
    if (rosterRequestRef.current.controller && !rosterRequestRef.current.controller.signal.aborted) return
    void fetchLocations()
    // «Обновить» is also how a client added a minute ago gets onto the map.
    if (mapLook.clients) retryClients()
    // …and a zone a colleague has just drawn.
    if (mapLook.areas) retryZones()
  }

  const handleAgentClick = (agentId: string) => {
    setSelectedStop(null)
    setFollowSelected(false)
    if (selectedAgent === agentId) {
      selectedAgentRef.current = null
      routeRequestRef.current.controller?.abort()
      setSelectedAgent(null)
      setRouteSnapshot(null)
      return
    }
    if (!tenantToday) return
    selectedAgentRef.current = agentId
    setSelectedAgent(agentId)
    // Selecting somebody whose tick is off puts him back on the map: his route
    // would otherwise be drawn there without him.
    setHiddenAgentIds((current) => {
      if (!current.has(agentId)) return current
      const next = new Set(current)
      next.delete(agentId)
      return next
    })
    void fetchAgentRoute(agentId, tenantToday)
  }

  // A marker pressed on the map selects the employee like his card does. It
  // never deselects: a second press on the same marker is somebody reading
  // its balloon, not asking for the route to go away.
  const handleMapAgentSelect = (agentId: string) => {
    if (selectedAgentRef.current === agentId) return
    handleAgentClick(agentId)
  }

  // The tick on a card takes that one employee off the map, or puts him back.
  // Taking off the selected one would leave his route there with no marker, so
  // the selection goes with him.
  const toggleAgentOnMap = (agentId: string) => {
    const hide = !hiddenAgentIds.has(agentId)
    setHiddenAgentIds((current) => {
      const next = new Set(current)
      if (hide) next.add(agentId)
      else next.delete(agentId)
      return next
    })
    if (hide && selectedAgentRef.current === agentId) handleAgentClick(agentId)
  }
  // The tick above the list or above a group, «Все» and «Никого»: these
  // employees on the map, or off it, in one press. «Никого» is the starting
  // point for ticking just the few one wants to compare.
  const setAgentsOnMap = (agentIds: string[], onMap: boolean) => {
    setHiddenAgentIds((current) => {
      const next = new Set(current)
      for (const agentId of agentIds) {
        if (onMap) next.delete(agentId)
        else next.add(agentId)
      }
      return next
    })
    const selected = selectedAgentRef.current
    if (!onMap && selected && agentIds.includes(selected)) handleAgentClick(selected)
  }
  // «Only this one»: everybody else in the roster is taken off; he stays selected.
  const showOnlyAgentOnMap = (agentId: string) => {
    setShowAgentMarkers(true)
    setHiddenAgentIds(new Set(agents.filter((agent) => agent.agentId !== agentId).map((agent) => agent.agentId)))
  }

  useEffect(() => {
    if (mapMode !== "live" || !requestedAgentId || !tenantToday || !identityKey) return
    const handledKey = `${identityKey}::${requestedAgentId}`
    if (handledAgentParamRef.current === handledKey) return
    if (!agents.some((agent) => agent.agentId === requestedAgentId)) return
    handledAgentParamRef.current = handledKey
    if (selectedAgentRef.current === requestedAgentId) return
    selectedAgentRef.current = requestedAgentId
    setSelectedAgent(requestedAgentId)
    void fetchAgentRoute(requestedAgentId, tenantToday)
  }, [agents, fetchAgentRoute, identityKey, mapMode, requestedAgentId, tenantToday])

  const freshnessCounts = useMemo(() => agents.reduce((counts, agent) => {
    if (agent.freshness === "ONLINE") counts.online += 1
    else if (agent.freshness === "DELAYED") counts.delayed += 1
    else if (agent.freshness === "STALE") counts.stale += 1
    else counts.noLocation += 1
    return counts
  }, { ...EMPTY_FRESHNESS_COUNTS }), [agents])

  const presenceCounts = useMemo(() => agents.reduce((counts, agent) => {
    if (agent.isOnline) counts.online += 1
    else counts.offline += 1
    return counts
  }, { online: 0, offline: 0 }), [agents])

  const workdayCounts = useMemo(() => agents.reduce((counts, agent) => {
    if (agent.workdayState === "ACTIVE") counts.active += 1
    else if (agent.workdayState === "PAUSED") counts.paused += 1
    else if (agent.workdayState === "CLOSED") counts.closed += 1
    else counts.notStarted += 1
    return counts
  }, { ...EMPTY_WORKDAY_COUNTS }), [agents])
  const workforceEnabled = contract?.workforceEnabled !== false

  // The rows of the list: every column's filter, then the chosen order. The
  // name search is the server's (it narrows `agents` itself), so a roster too
  // long to load whole is searched whole. The map draws nobody outside these
  // rows; hiding somebody with his tick is about the map, not the list.
  // The order of the list. With a point picked on the map it is «nearest
  // first» until somebody asks for another order; with no point there is no
  // distance to sort by.
  const rosterSort: RosterSort = referencePoint && nearestFirst
    ? NEAREST_FIRST
    : rosterView.sort.column === "distance" && !referencePoint ? ROSTER_DEFAULT_VIEW.sort : rosterView.sort
  const filteredAgents = useMemo(
    () => sortRoster(applyRosterFilters(agents, rosterFilters), rosterSort, locale),
    // The order is two plain words; the object is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, locale, rosterFilters, rosterSort.column, rosterSort.direction],
  )
  const changeRosterView = (next: RosterView) => {
    // The list hands back the order it was shown. Only a different one is a choice.
    const sortChosen = next.sort.column !== rosterSort.column || next.sort.direction !== rosterSort.direction
    if (sortChosen) setNearestFirst(false)
    const view: RosterView = { ...next, sort: sortChosen ? next.sort : rosterView.sort }
    setRosterView(view)
    try {
      // The distance is never the remembered order: tomorrow there is no point to be near to.
      const stored: RosterView = view.sort.column === "distance" ? { ...view, sort: storedSortRef.current } : view
      storedSortRef.current = stored.sort
      window.localStorage.setItem(ROSTER_VIEW_STORAGE_KEY, serializeRosterView(stored))
    } catch { /* not remembered; still applied */ }
  }
  const hiddenOnMapCount = useMemo(
    () => agents.reduce((count, agent) => count + (hiddenAgentIds.has(agent.agentId) ? 1 : 0), 0),
    [agents, hiddenAgentIds],
  )

  // The status chips above the map are the «Статус» column's filter under
  // another hand, and count what pressing them would leave: the same people the
  // «Статус» menu counts, inside whatever the other columns have filtered.
  const statusFilter = rosterFilters.status
  const statusChipOn = (status: string) => rosterStatusChipOn(rosterFilters, status)
  const pickStatus = (status: string | null) => setRosterFilters((current) => pickRosterStatus(current, status))
  const statusCounts = useMemo(() => applyRosterFilters(agents, rosterFilters, "status").reduce((counts, agent) => {
    const status = rosterValue(agent, "status")
    counts.total += 1
    if (status === "CHECKED_IN") counts.checkedIn += 1
    else if (status === "ON_ROAD") counts.onRoad += 1
    else if (status === "STOPPED") counts.stopped += 1
    else if (status === "ROUTE_FINISHED") counts.routeFinished += 1
    else if (status === "LATE") counts.late += 1
    else counts.offline += 1
    return counts
  }, { ...EMPTY_STATUS_COUNTS }), [agents, rosterFilters])

  // A filter narrows the list and the map together, and so does the roster
  // itself: a poll brings another status, a signal ages past «fresh». A
  // selection that has left the list would leave a route on the map that
  // belongs to nobody on screen, so the selection goes with it.
  const selectedShown = selectedAgent == null || filteredAgents.some((agent) => agent.agentId === selectedAgent)
  useEffect(() => {
    if (selectedShown) return
    selectedAgentRef.current = null
    routeRequestRef.current.controller?.abort()
    setSelectedAgent(null)
    setRouteSnapshot(null)
  }, [selectedShown])

  // The stop in focus and «follow» belong to one selection.
  useEffect(() => {
    setSelectedStop(null)
    if (!selectedAgent) setFollowSelected(false)
  }, [selectedAgent])

  // An employee chosen on the map may be below the fold of the list — or the
  // list may be put away; a selection brings it back, because his day is in
  // it. What is brought into view is his day (the row is the line above it):
  // only on a new selection or when the list comes back, never on a poll.
  const selectedDetailRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (selectedAgent) setRosterHidden(false)
  }, [selectedAgent])
  useEffect(() => {
    if (!selectedAgent || rosterHidden) return
    selectedDetailRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [selectedAgent, rosterHidden])

  // Employees without an admissible coordinate remain in the roster, but the
  // map only receives finite, bounded coordinates with an evidence timestamp.
  const mapAgents: LiveMapAgent[] = filteredAgents.flatMap((agent) => {
    if (!showAgentMarkers || hiddenAgentIds.has(agent.agentId)) return []
    const freshness = agent.freshness
    const lastKnown = showLastKnown && freshness === "STALE"
    if ((!hasRenderableLivePosition(freshness, agent.workdayState, workforceEnabled) && !lastKnown) ||
        typeof agent.latitude !== "number" || !Number.isFinite(agent.latitude) ||
        agent.latitude < -90 || agent.latitude > 90 ||
        typeof agent.longitude !== "number" || !Number.isFinite(agent.longitude) ||
        agent.longitude < -180 || agent.longitude > 180 ||
        typeof agent.recordedAt !== "string" || !Number.isFinite(Date.parse(agent.recordedAt))) return []
    return [{ ...agent, freshness, latitude: agent.latitude, longitude: agent.longitude, recordedAt: agent.recordedAt }]
  })
  const stalePositions = filteredAgents.filter((agent) => agent.freshness === "STALE").length

  // Plan versus fact for the selected employee's day. The same summary feeds
  // the numbered map markers and the stop list under the employee card.
  const routeExecution = useMemo(() => {
    if (!agentRoute || !Array.isArray(agentRoute.points)) return null
    return summarizeMtmRouteExecution(agentRoute.points)
  }, [agentRoute])

  // Transform route points to RouteStop[] for the map
  const routeStops: RouteStop[] = useMemo(() => {
    if (!agentRoute?.points) return []
    const points = [...agentRoute.points].sort((a: MtmRoutePoint, b: MtmRoutePoint) => a.orderIndex - b.orderIndex)
    const firstPendingOrder = points.find((p) => p.status === "PENDING")?.orderIndex
    const facts = new Map((routeExecution?.points ?? []).map((fact) => [fact.pointId, fact]))
    return points.flatMap((p): RouteStop[] => {
      const customer = p.customer
      if (!hasMtmCoordinates(customer)) return []
      const fact = facts.get(p.id)
      return [{
        orderIndex: p.orderIndex,
        status: p.status === "VISITED" ? "VISITED" :
                p.status === "SKIPPED" ? "SKIPPED" :
                p.orderIndex === firstPendingOrder ? "NEXT" : "PENDING",
        latitude: customer.latitude,
        longitude: customer.longitude,
        name: customer.name,
        address: customer.address ?? undefined,
        visitedAt: p.visitedAt ?? undefined,
        plannedTime: p.plannedTime ?? null,
        checkInAt: fact?.checkInAt ?? null,
        checkOutAt: fact?.visit ? fact.checkOutAt : null,
        visitId: fact?.visit?.id ?? null,
        zoneRadiusMeters: effectiveGeofenceRadius(customer.geofenceRadius, contract?.geofenceRadiusMeters),
      }]
    })
  }, [agentRoute, routeExecution, contract?.geofenceRadiusMeters])
  // The same day as steps for the list under the card: what each stop is right
  // now (visited, visit in progress, next, planned, skipped), its times, and
  // whether it is overdue. `presentationNow` is the server-anchored clock.
  const daySteps = useMemo(
    () => liveMapDaySteps(agentRoute?.points ?? [], routeExecution?.points ?? [], presentationNow),
    [agentRoute, routeExecution, presentationNow],
  )
  const routeStopsWithoutCoordinates = (agentRoute?.points ?? [])
    .filter((point) => !hasMtmCoordinates(point.customer)).length
  // The same stops for «где сейчас»: the one he is in a visit at, and the
  // circles his coordinate can be inside. A stop without coordinates still
  // counts for the visit — he pressed «начать визит» there.
  const placeStops: LiveMapPlaceStop[] = useMemo(() => {
    const inVisit = new Set(daySteps.filter((step) => step.state === "IN_VISIT").map((step) => step.pointId))
    return (agentRoute?.points ?? []).flatMap((point: MtmRoutePoint): LiveMapPlaceStop[] => {
      const customer = point.customer
      if (!customer?.name) return []
      const placed = hasMtmCoordinates(customer)
      return [{
        name: customer.name,
        address: customer.address ?? null,
        latitude: placed ? customer.latitude : Number.NaN,
        longitude: placed ? customer.longitude : Number.NaN,
        zoneRadiusMeters: effectiveGeofenceRadius(customer.geofenceRadius, contract?.geofenceRadiusMeters),
        inVisit: inVisit.has(point.id),
      }]
    })
  }, [agentRoute, daySteps, contract?.geofenceRadiusMeters])
  // One formatted clock per moment: the list asks for five hundred of them on
  // every render, and building a formatter each time is what would be felt.
  const clockCacheRef = useRef<{ key: string; values: Map<string, string> }>({ key: "", values: new Map() })
  const formatTenantTime = (value: string | null | undefined) => {
    if (!value) return ""
    const key = `${locale}|${contract?.timezone ?? ""}`
    if (clockCacheRef.current.key !== key || clockCacheRef.current.values.size > 5_000) clockCacheRef.current = { key, values: new Map() }
    const known = clockCacheRef.current.values.get(value)
    if (known != null) return known
    const text = formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: contract?.timezone })
    clockCacheRef.current.values.set(value, text)
    return text
  }
  const feedAlertText = (alert: NonNullable<LiveEvent["alert"]>) => {
    const message = alert.message
    if (message.key === "routeDeviation" || message.key === "outOfZoneCheckIn") {
      return tMap(`feed.${message.key}`, { distance: formatMtmDistance(message.distanceMeters, locale, (unit, value) => tUnits(unit, { value })) })
    }
    if (message.key === "visitStillOpen") return tMap("feed.visitStillOpen", { minutes: Math.round(message.minutes) })
    return tAlerts(`typeLabel_${FEED_ALERT_TYPES.has(message.alertType) ? message.alertType : "OTHER"}`)
  }

  // ETA calculation: distance to next stop / speed
  const etaSeconds = useMemo(() => {
    if (!selectedAgent || !routeStops.length) return null
    const nextStop = routeStops.find(s => s.status === "NEXT")
    if (!nextStop) return null
    const agent = agents.find(a => a.agentId === selectedAgent)
    if (agent?.latitude == null || agent.longitude == null ||
        !Number.isFinite(agent.latitude) || !Number.isFinite(agent.longitude)) return null
    const distMeters = calculateDistance(agent.latitude, agent.longitude, nextStop.latitude, nextStop.longitude)
    const speedKmh = (agent.speed && agent.speed > 2) ? agent.speed : 30 // fallback 30 km/h
    return Math.round((distMeters / 1000) / speedKmh * 3600)
  }, [selectedAgent, routeStops, agents])
  const showRosterLoading = sessionStatus === "loading" || (Boolean(identityKey) && loading && !roster)

  const formatVisitOpened = (value: string) => formatDateTime(value, locale, visitOpenedOnAnotherDay(value, contract?.timezone)
    ? { dateStyle: "medium", timeStyle: "short", timeZone: contract?.timezone }
    : { timeStyle: "short", timeZone: contract?.timezone })

  // What opens under the selected employee's row. The row itself says what he
  // is doing and how old his signal is; here is the rest in words — the
  // application, the GPS, the workday — then his day, stop by stop.
  const renderAgentDetail = (agent: AgentLocation) => {
    const appPresent = agent.isOnline
    const hasFreshGps = agent.freshness === "ONLINE"
    const workdayTone = agent.workdayState === "ACTIVE"
      ? "font-medium text-emerald-700 dark:text-emerald-400"
      : agent.workdayState === "PAUSED"
        ? "font-medium text-amber-700 dark:text-amber-300"
        : "text-muted-foreground"
    // The card's blocks: each under a heading that folds it, in the order the
    // dispatcher chose (src/lib/mtm/live-map-card-layout.ts). A folded block
    // is not rendered, so it asks the server for nothing.
    const cardBlocks: LiveMapCardBlock[] = [
      {
        id: "events",
        title: tMap("events.title"),
        render: () => (
          <LiveMapAgentEvents
            key={`events-${agent.agentId}`}
            agentId={agent.agentId}
            refreshKey={liveMapAgentEventsRefreshKey(agent, presentationNow)}
            workdayStartedAt={workforceEnabled && !agent.workdayCarryover ? agent.workdayStartedAt ?? null : null}
            formatTime={formatTenantTime}
            alertText={feedAlertText}
            isEarlierDay={(value) => visitOpenedOnAnotherDay(value, contract?.timezone)}
            framed={false}
          />
        ),
      },
      {
        id: "route",
        title: tMap("routeStop.title"),
        render: () => (
          <div data-testid="mtm-map-selected-route">
            {!visibleRouteSnapshot ? (
              <div className="text-muted-foreground">{tMap("routeStop.loading")}</div>
            ) : !agentRoute || !routeExecution || routeExecution.totalCount === 0 ? (
              <div className="text-muted-foreground">{tMap("routeStop.none")}</div>
            ) : (
              <LiveMapDaySteps
                steps={daySteps}
                selectedOrder={selectedStop}
                onSelect={setSelectedStop}
                formatTime={formatTenantTime}
              />
            )}
            {routeStopsWithoutCoordinates > 0 ? (
              <div className="mt-1 text-amber-700 dark:text-amber-300">{tMap("routeStop.missingCoordinates", { count: routeStopsWithoutCoordinates })}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: "day",
        title: tMap("day.title"),
        render: () => (
          <LiveMapAgentDay
            key={`day-${agent.agentId}`}
            agentId={agent.agentId}
            // Counted on the server from the day's GPS: asked again on a change
            // of his state or every two minutes, never on the list's own timer.
            refreshKey={liveMapAgentEventsRefreshKey(agent, presentationNow)}
            formatDistance={(meters) => formatMtmDistance(meters, locale, (unit, value) => tUnits(unit, { value }))}
          />
        ),
      },
      {
        id: "device",
        title: tMap("device.title"),
        render: () => (
          <LiveMapAgentDevice
            key={`device-${agent.agentId}`}
            agent={agent}
            // What the phone registered with changes rarely: asked again when the shift or the app's presence flips.
            refreshKey={`${agent.workdayState}|${agent.isOnline ? 1 : 0}`}
            // With the date when the moment is not today: last week's contact must not read as this morning's.
            formatTime={formatVisitOpened}
          />
        ),
      },
    ]
    return (
      <div className="space-y-2 text-[11px]" data-testid="live-map-agent-detail">
        {/* On a phone the row has room for about fifteen letters of a name. */}
        <div className="text-xs font-semibold text-foreground sm:hidden">{agent.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={appPresent ? "font-medium text-green-600" : "text-muted-foreground"}>
            {tMap("appPresence")}: {tMap(`presence.${appPresent ? "online" : "offline"}`)}
          </span>
          <span className={hasFreshGps ? "font-medium text-blue-600" : agent.freshness === "DELAYED" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
            {tMap("gpsFreshness")}: {tMap(`freshness.${agent.freshness.toLowerCase()}`)}
          </span>
          {workforceEnabled ? <span className={workdayTone}>
            {tMap(`workday.${agent.workdayState.toLowerCase()}`)}
          </span> : null}
          {agent.recordedAt ? (
            // With the date when it is not today's — as the «Телефон и приложение» block below says the same moment.
            <span className="text-muted-foreground">{tMap("recordedAt")}: {formatVisitOpened(agent.recordedAt)}</span>
          ) : null}
        </div>
        {/* Since when — only for what was recorded when it began: the visit, the break, the closed shift. */}
        {liveMapStateSince(agent)
          // The break and the closing of the shift are Workforce facts: without
          // the module the card says nothing of the workday anywhere else either.
          // The visit and standing still are Route & Field's own.
          .filter((fact) => fact.basis === "VISIT" || fact.basis === "STANDING" || workforceEnabled)
          .map((fact) => {
          const lasted = fact.ongoing ? liveMapDuration(fact.since, presentationNow) : null
          return (
            <div key={fact.basis} className="text-muted-foreground" data-testid={`live-map-since-${fact.basis}`}>
              {tMap(`since.${fact.basis}`, { time: formatVisitOpened(fact.since) })}
              {lasted ? <span className="font-medium text-foreground"> · {tMap(`since.duration.${lasted.unit}`, { ...lasted })}</span> : null}
            </div>
          )
        })}
        <LiveMapAgentPlace
          key={`place-${agent.agentId}`}
          position={agent.latitude != null && agent.longitude != null
            && hasRenderableLivePosition(agent.freshness, agent.workdayState, workforceEnabled)
            ? { latitude: agent.latitude, longitude: agent.longitude, accuracy: agent.accuracy ?? null }
            : null}
          inVisit={agent.fieldStatus === "CHECKED_IN"}
          stops={placeStops}
          stopsReady={Boolean(visibleRouteSnapshot)}
          delayed={agent.freshness === "DELAYED"}
          formatDistance={(meters) => formatMtmDistance(meters, locale, (unit, value) => tUnits(unit, { value }))}
        />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          {agent.teamName ? <span>{tMap("teamFilter")}: {agent.teamName}</span> : null}
          {/* The list has room for it only as a column somebody switched on; here it is always said. */}
          {agent.managerName ? <span data-testid="live-map-agent-manager">{tMap("roster.columns.manager")}: {agent.managerName}</span> : null}
          {/* The labels a manager put on him — the list shows them only as a column somebody switched on. */}
          {agent.tags?.length ? <span data-testid="live-map-agent-tags">{tMap("roster.columns.tags")}: {agent.tags.join(", ")}</span> : null}
          {agent.speed != null && agent.speed > 0 ? <span>{tMap("roster.kmh", { value: agent.speed.toFixed(0) })}</span> : null}
          {agent.routeCompletion > 0 ? <span><Navigation className="inline h-3 w-3" /> {agent.routeCompletion}%</span> : null}
          {agent.accuracy != null ? <span>±{Math.round(agent.accuracy)} m</span> : null}
          {agent.battery != null ? <span className="inline-flex items-center"><Battery className="mr-0.5 h-3 w-3" />{Math.round(agent.battery)}%</span> : null}
        </div>
        {etaSeconds != null && etaSeconds > 0 ? (
          <div className="font-semibold text-blue-600">
            {tMap("eta.label")}: {etaSeconds < 60
              ? tMap("eta.lessThanMinute")
              : etaSeconds < 3600
                ? tMap("eta.minutes", { count: Math.round(etaSeconds / 60) })
                : tMap("eta.hours", { count: (etaSeconds / 3600).toFixed(1) })}
          </div>
        ) : null}
        {agent.locationState !== "AVAILABLE" ? (
          <div className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
            {tMap(`locationState.${agent.locationState.toLowerCase()}`)}
          </div>
        ) : null}
        {/* What can be done with him — in words, not icons (owner, 2026-09-22). */}
        <div className="flex flex-wrap items-center gap-1.5">
          {tenantToday ? (
            <Link
              href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agent.agentId)}&date=${tenantToday}`}
              aria-label={tMap("openEmployeeHistory", { name: agent.name })}
              data-testid="live-map-open-history"
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-300 px-2.5 text-[11px] font-medium text-foreground hover:bg-muted dark:border-zinc-600 [@media(pointer:coarse)]:min-h-11"
            >
              <History className="h-3 w-3" aria-hidden="true" />{tMap("roster.historyToday")}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => showOnlyAgentOnMap(agent.agentId)}
            data-testid="live-map-only-this"
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-zinc-300 px-2.5 text-[11px] font-medium text-foreground hover:bg-muted dark:border-zinc-600 [@media(pointer:coarse)]:min-h-11"
          >
            <Eye className="h-3 w-3" aria-hidden="true" />{tMap("layers.onlyThis")}
          </button>
          <button
            type="button"
            aria-pressed={followSelected}
            title={tMap("followHint")}
            onClick={() => setFollowSelected((on) => !on)}
            data-testid="live-map-follow"
            className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors [@media(pointer:coarse)]:min-h-11 ${followSelected
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-zinc-300 text-foreground hover:bg-muted dark:border-zinc-600"}`}
          >
            <Crosshair className="h-3 w-3" aria-hidden="true" />{tMap("follow")}
          </button>
        </div>
        {/* The other screens, already narrowed to him. «История за день» is the pill above. */}
        <LiveMapAgentLinks
          agentName={agent.name}
          links={liveMapAgentLinks({ agentId: agent.agentId, tenantToday, fieldContactsEnabled }).filter((link) => link.id !== "history")}
        />
        <LiveMapCardBlocks blocks={cardBlocks} layout={cardLayout} onLayoutChange={changeCardLayout} />
      </div>
    )
  }

  return (
    // C15: на планшете (834 px) фильтры и чипы статусов занимали два ряда
    // выше карты, и менеджер открывал карту, не видя карты. Flex вместо
    // отступов нужен, чтобы порядок можно было задать только для узких
    // экранов; на lg+ порядок остаётся прежним.
    <div className="flex flex-col gap-3">
      {/* G — offline: the day-route below is served from the on-device cache */}
      {mapMode === "live" && routeFromCache && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5 shrink-0" /> {tMap("offlineCachedRoute")}
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PageDescription
            icon={mapMode === "live" ? MapPin : History}
            title={t("mtmMap")}
            description={mapMode === "live" ? tMap("subtitle") : tMap("history.subtitle")}
          />
          <HelpButton slug="mtm-map" variant="label" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {returnHref ? (
            <Button asChild variant="outline" size="sm" className="min-h-11">
              <Link href={returnHref}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                {tMap("returnToOperationalWeek")}
              </Link>
            </Button>
          ) : null}
          <div className="flex rounded-md border bg-muted/40 p-0.5" role="tablist" aria-label={tMap("modeLabel")}>
            <Button
              data-testid="mtm-map-mode-live"
              type="button"
              role="tab"
              aria-selected={mapMode === "live"}
              variant={mapMode === "live" ? "default" : "ghost"}
              size="sm"
              className="min-h-11"
              onClick={() => switchMapMode("live")}
            >
              <Radio className="mr-1.5 h-3.5 w-3.5" />{tMap("liveMode")}
            </Button>
            <Button
              data-testid="mtm-map-mode-history"
              type="button"
              role="tab"
              aria-selected={mapMode === "history"}
              variant={mapMode === "history" ? "default" : "ghost"}
              size="sm"
              className="min-h-11"
              onClick={() => switchMapMode("history")}
            >
              <History className="mr-1.5 h-3.5 w-3.5" />{tMap("historyMode")}
            </Button>
          </div>
          {mapMode === "live" && lastUpdate && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {tMap("lastUpdate")}: {formatDateTime(lastUpdate, locale, { timeStyle: "short", timeZone: contract?.timezone })}
            </span>
          )}
          {mapMode === "live" && <Button className="min-h-11" variant="outline" size="sm" onClick={manualRefresh} disabled={refreshing || loading} data-testid="mtm-map-refresh">
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> {tc("refresh")}
          </Button>}
        </div>
      </div>

      {mapMode === "history" ? <LocationHistoryPanel key={historyPanelKey} /> : (
      <>
      {/* The filters are in the list now, one in every column heading. What
          stays up here is for a roster too long to load whole (over 500): the
          server narrows it by team before the list can. */}
      {contract?.rosterTruncated || teamFilter ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {contract?.rosterTruncated ? <span>{tMap("rosterTruncated", { shown: contract.returnedAgents })}</span> : null}
          {teams.length > 0 ? (
            <MtmFilterSelect testId="mtm-map-team-filter" label={tMap("teamFilter")} value={teamFilter} allLabel={tMap("allTeams")}
              options={teams.map((team) => ({ value: team.id, label: team.name }))}
              onChange={setTeamFilter} />
          ) : null}
        </div>
      ) : null}
      {visibleLoadError ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <div>{visibleLoadError}</div>
          {roster ? <div className="mt-1 text-xs">{tMap("refreshFailedAging")}</div> : null}
        </div>
      ) : null}
      {/* Status filter tabs */}
      <div className="-mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={tc("status")}>
          <Button className="min-h-11 shrink-0" variant={statusFilter ? "outline" : "default"} size="sm" aria-pressed={!statusFilter} data-testid="mtm-map-status-chip-all" onClick={() => pickStatus(null)}>
          {tc("all")} ({statusCounts.total})
        </Button>
        <Button variant={statusChipOn("CHECKED_IN") ? "default" : "outline"} size="sm" aria-pressed={statusChipOn("CHECKED_IN")} data-testid="mtm-map-status-chip-CHECKED_IN" onClick={() => pickStatus("CHECKED_IN")}
          className={`min-h-11 shrink-0 ${statusChipOn("CHECKED_IN") ? "" : "text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/20"}`}>
          <MapPin className="h-3 w-3 mr-1" /> {tMap("fieldStatus.checkedIn")} ({statusCounts.checkedIn})
        </Button>
        <Button variant={statusChipOn("ON_ROAD") ? "default" : "outline"} size="sm" aria-pressed={statusChipOn("ON_ROAD")} data-testid="mtm-map-status-chip-ON_ROAD" onClick={() => pickStatus("ON_ROAD")}
          className={`min-h-11 shrink-0 ${statusChipOn("ON_ROAD") ? "" : "text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950/20"}`}>
          <Navigation className="h-3 w-3 mr-1" /> {tMap("fieldStatus.onRoad")} ({statusCounts.onRoad})
        </Button>
        <Button variant={statusChipOn("STOPPED") ? "default" : "outline"} size="sm" aria-pressed={statusChipOn("STOPPED")} data-testid="mtm-map-status-chip-STOPPED" onClick={() => pickStatus("STOPPED")}
          className={`min-h-11 shrink-0 ${statusChipOn("STOPPED") ? "" : "text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-950/20"}`}>
          <PauseCircle className="h-3 w-3 mr-1" /> {tMap("fieldStatus.stopped")} ({statusCounts.stopped})
        </Button>
        <Button variant={statusChipOn("ROUTE_FINISHED") ? "default" : "outline"} size="sm" aria-pressed={statusChipOn("ROUTE_FINISHED")} data-testid="mtm-map-status-chip-ROUTE_FINISHED" onClick={() => pickStatus("ROUTE_FINISHED")}
          className={`min-h-11 shrink-0 ${statusChipOn("ROUTE_FINISHED") ? "" : "text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:hover:bg-emerald-950/20"}`}>
          <Flag className="h-3 w-3 mr-1" /> {tMap("fieldStatus.routeFinished")} ({statusCounts.routeFinished})
        </Button>
        <Button variant={statusChipOn("LATE") ? "default" : "outline"} size="sm" aria-pressed={statusChipOn("LATE")} data-testid="mtm-map-status-chip-LATE" onClick={() => pickStatus("LATE")}
          className={`min-h-11 shrink-0 ${statusChipOn("LATE") ? "" : "text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/20"}`}>
          <AlertTriangle className="h-3 w-3 mr-1" /> {tMap("fieldStatus.late")} ({statusCounts.late})
        </Button>
        <Button variant={statusChipOn("OFFLINE") ? "default" : "outline"} size="sm" aria-pressed={statusChipOn("OFFLINE")} data-testid="mtm-map-status-chip-OFFLINE" onClick={() => pickStatus("OFFLINE")}
          className={`min-h-11 shrink-0 ${statusChipOn("OFFLINE") ? "" : "text-muted-foreground"}`}>
          <WifiOff className="h-3 w-3 mr-1" /> {tMap("fieldStatus.offline")} ({statusCounts.offline})
        </Button>
      </div>

      <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
        <span className="font-semibold">{tMap("agents")}: {agents.length}</span>
        <span className="flex flex-wrap items-center gap-x-2">
          <strong>{tMap("appPresence")}:</strong>
          <span className="text-green-700 dark:text-green-400">{tMap("presence.online")} {presenceCounts.online}</span>
          <span className="text-muted-foreground">{tMap("presence.offline")} {presenceCounts.offline}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <strong>{tMap("gpsFreshness")}:</strong>
          <span className="text-blue-700 dark:text-blue-400">{tMap("freshness.online")} {freshnessCounts.online}</span>
          <span className="text-amber-700 dark:text-amber-300">{tMap("freshness.delayed")} {freshnessCounts.delayed}</span>
          <span className="text-muted-foreground">{tMap("freshness.stale")} {freshnessCounts.stale}</span>
          <span className="text-muted-foreground">{tMap("freshness.noLocation")} {freshnessCounts.noLocation}</span>
        </span>
        {workforceEnabled ? <span className="flex flex-wrap items-center gap-x-2">
          <strong>{tMap("workdayState")}:</strong>
          <span className="text-emerald-700 dark:text-emerald-400">{tMap("workday.active")} {workdayCounts.active}</span>
          <span className="text-amber-700 dark:text-amber-300">{tMap("workday.paused")} {workdayCounts.paused}</span>
          <span className="text-muted-foreground">{tMap("workday.closed")} {workdayCounts.closed}</span>
          <span className="text-muted-foreground">{tMap("workday.not_started")} {workdayCounts.notStarted}</span>
        </span> : null}
      </div>

      {/* Main: Map + Right sidebar */}
      {stalePositions > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-muted/40 px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">
          <History className="h-3.5 w-3.5 shrink-0" />
          {showLastKnown
            ? tMap("lastKnownShown", { count: stalePositions })
            : tMap("stalePositionsHidden", { count: stalePositions })}
          <button
            type="button"
            onClick={() => setShowLastKnown((value) => !value)}
            className="font-semibold text-foreground underline underline-offset-2"
          >
            {showLastKnown ? tMap("hideLastKnown") : tMap("showLastKnown")}
          </button>
        </div>
      ) : null}
      {/* Owner rule (audit 2026-09-14): the page scrolls as one. The employee
          list grows with the roster instead of showing two or three names in a
          small scrolling frame; on wide screens the map stays in view beside
          it as a sticky column. */}
      <div data-testid="mtm-map-canvas" data-roster={rosterHidden ? "hidden" : rosterView.width} className={`grid gap-3 max-lg:order-first ${CANVAS_COLUMNS[rosterHidden ? "hidden" : rosterView.width]} lg:items-start`} style={{ minHeight: 480 }}>
        {/* Map. `isolate` keeps Leaflet's own layer order (its panes go up to
            z-index 1000) inside the map: a menu opened from the list — above the
            map on a phone, where the list stands under it — is not drawn behind it. */}
        <div ref={mapFrameRef} data-testid="mtm-map-frame" className="relative isolate order-1 h-[54vh] min-h-[360px] overflow-hidden rounded-lg border border-zinc-200 bg-card lg:sticky lg:top-3 lg:h-[calc(100vh-7rem)] lg:min-h-[480px] dark:border-zinc-700">
          {showRosterLoading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{tMap("loadingMap")}</div>
          ) : (
            <MtmLiveMap
              agents={mapAgents}
              baseMap={baseMap}
              showGeofence={showGeofence}
              showHeatmap={showHeatmap}
              plannedRoute={showDayRoute ? routeStops : NO_ROUTE_STOPS}
              focusAgentId={selectedAgent}
              etaSeconds={etaSeconds}
              timeZone={contract?.timezone}
              showWorkdayStatus={workforceEnabled}
              onAgentSelect={handleMapAgentSelect}
              focusStopOrder={selectedStop}
              onStopSelect={setSelectedStop}
              followAgent={followSelected}
              showLabels={mapLook.labels}
              trails={mapLook.trails ? trails : null}
              glideMarkers={mapLook.glide}
              pressMode={rulerActive ? "ruler" : pickingPoint ? "point" : null}
              onMapPress={handleMapPress}
              rulerPoints={rulerPoints}
              referencePoint={referencePoint}
              clients={mapClients}
              onClientNearest={nearestToClient}
              zones={mapZones}
              canEditZones={zonesCanWrite}
              onZoneAction={openZoneForm}
              focusZone={zoneAsked}
              geofenceRadius={effectiveGeofenceRadius(null, contract?.geofenceRadiusMeters)}
            />
          )}
          {showRosterLoading ? null : (
            <LiveMapLayersControl
              closeTurn={zoneAsked?.turn ?? 0}
              baseMaps={{
                value: mapLook.base,
                options: BASE_MAPS.map((map) => ({ id: map.id, label: tMap(`layers.baseMap.${map.id}`) })),
                onChange: (id) => changeMapLook({ base: parseLiveMapBaseMap(id, BASE_MAPS) }),
              }}
              layers={[
                { id: "agents", label: tMap("layers.agents"), hint: tMap("layers.agentsHint"), on: showAgentMarkers, onToggle: () => setShowAgentMarkers((on) => !on), shownByDefault: true },
                { id: "route", label: tMap("layers.route"), hint: tMap("layers.routeHint"), on: showDayRoute, onToggle: () => setShowDayRoute((on) => !on), shownByDefault: true },
                { id: "labels", label: tMap("layers.labels"), hint: tMap("layers.labelsHint"), on: mapLook.labels, onToggle: () => changeMapLook({ labels: !mapLook.labels }) },
                { id: "trails", label: tMap("layers.trails"), hint: tMap("layers.trailsHint"), on: mapLook.trails, onToggle: () => changeMapLook({ trails: !mapLook.trails }), shownByDefault: true },
                { id: "glide", label: tMap("layers.glide"), hint: tMap("layers.glideHint"), on: mapLook.glide, onToggle: () => changeMapLook({ glide: !mapLook.glide }) },
                { id: "clients", label: tMap("layers.clients"), hint: clientsHint, on: mapLook.clients, onToggle: () => changeMapLook({ clients: !mapLook.clients }) },
                { id: "zones", label: tMap("layers.zones"), hint: tMap("layers.zonesHint"), on: showGeofence, onToggle: () => setShowGeofence((on) => !on) },
                { id: "heat", label: tMap("layers.heat"), hint: tMap("layers.heatHint"), on: showHeatmap, onToggle: () => setShowHeatmap((current) => !current), testId: "mtm-map-heatmap-toggle" },
                // The switch and how many there are; the zones themselves are listed on the page, above the employees (LiveMapZonesCard).
                { id: "areas", label: tMap("layers.areas"), hint: areasHint, on: mapLook.areas, onToggle: () => { changeMapLook({ areas: !mapLook.areas }); setZoneEdit(null); setZoneGone(null) } },
              ]}
              hiddenAgentCount={hiddenOnMapCount}
              onShowAllAgents={() => setHiddenAgentIds(new Set())}
              note={tMap("historyOnlyExplicit")}
              alert={[clientsAlert, areasAlert]}
            />
          )}
          {showRosterLoading ? null : (
            <LiveMapTools
              near={mapAgents[0] ? { latitude: mapAgents[0].latitude, longitude: mapAgents[0].longitude } : null}
              referencePoint={referencePoint}
              onReferencePointChange={changeReferencePoint}
              pickingPoint={pickingPoint}
              onPickingPointChange={(picking) => { setPickingPoint(picking); if (picking) switchRuler(false) }}
              rulerActive={rulerActive}
              onRulerToggle={() => { switchRuler(!rulerActive); setPickingPoint(false) }}
              rulerMeters={rulerMeters}
              rulerPointCount={rulerPoints.length}
              rulerArea={rulerSquareMeters != null
                ? formatMtmArea(rulerSquareMeters, locale, (unit, value) => tMap(`areaUnits.${unit}`, { value }))
                : null}
              onRulerUndo={() => setRulerPoints((points) => points.slice(0, -1))}
              formatDistance={(meters) => formatMtmDistance(meters, locale, (unit, value) => tUnits(unit, { value }))}
              fullscreen={mapFullscreen}
              onFullscreenToggle={toggleMapFullscreen}
              fullscreenSupported={fullscreenSupported}
              zoneDrawing={zonesCanWrite ? { outlineProblem: rulerOutlineProblem, onCreate: createZone } : null}
              zoneEditor={editedZone && zoneEdit ? (
                <LiveMapZoneForm
                  key={`${zoneEdit.kind}:${editedZone.id}`}
                  className="shadow-lg"
                  task={{ kind: zoneEdit.kind, zone: editedZone }}
                  onCancel={() => setZoneEdit(null)}
                  onSubmit={async (values) => {
                    const refused = await changeZone(editedZone, liveMapZoneFormChange(zoneEdit.kind, values), "map")
                    if (!refused) setZoneEdit(null)
                    return refused
                  }}
                />
              ) : zoneGone === "map" && zonesLayerOn ? (
                <LiveMapZoneGone className="shadow-lg" onClose={() => setZoneGone(null)} />
              ) : null}
            />
          )}
          {/* The list put away leaves the whole width to the map; this brings it
              back. Its filters go on narrowing the map while it is away, so the
              button says so. Only where the two stand side by side: under the
              map on a phone the list is never put away. */}
          {rosterHidden && !showRosterLoading ? (
            <button
              type="button"
              onClick={() => setRosterHidden(false)}
              data-testid="live-map-roster-show"
              className="absolute left-14 top-3 z-[1100] hidden min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-card px-3 text-sm font-medium shadow-md lg:inline-flex dark:border-zinc-600"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              {filteredAgents.length !== agents.length || debouncedEmployeeFilter
                ? tMap("roster.showFiltered", { shown: filteredAgents.length, total: agents.length })
                : tMap("roster.show", { count: agents.length })}
            </button>
          ) : null}
        </div>

        {/* The employees' column: put away, or made the wide table, as one —
            the zones' card goes wherever the list goes. Under the map (a
            phone) the card stands between the map and the list. */}
        <div data-testid="mtm-map-side" className={`order-2 flex min-w-0 flex-col gap-3 ${rosterHidden ? "lg:hidden" : ""}`}>
        {/* «Свои зоны» as a list: in the page's own flow, where a long list
            costs nothing — in «Слои», bounded by the map's frame, two zones
            were enough to make the panel scroll inside itself. Drawn exactly
            when the layer is on and the zones have been read. */}
        {zonesLayerOn && zonesAnswer && !showRosterLoading ? (
          <LiveMapZonesCard
            zones={sortedZones}
            canWrite={zonesCanWrite}
            unfolded={mapLook.areasList}
            onUnfoldedChange={(unfolded) => changeMapLook({ areasList: unfolded })}
            gone={zoneGone === "list"}
            onGoneClose={() => setZoneGone(null)}
            formatArea={formatArea}
            onChange={(zone, change) => changeZone(zone, change, "list")}
            onShowOnMap={showZoneOnMap}
          />
        ) : null}
        {/* The employee list: one line per person, a filter in every column
            heading. Detail appears only after an explicit selection. */}
        <LiveMapRoster
            hiddenOnWide={rosterHidden}
            agents={agents}
            rows={filteredAgents}
            searchSlot={
              // Owner 2026-09-27: filters in one row, not a card of labelled fields.
              <MtmFilterBar testId="mtm-map-filters">
                <MtmFilterSearch testId="mtm-map-employee-filter" value={employeeFilter} onChange={setEmployeeFilter} delayMs={0} placeholder={tMap("employeePlaceholder")} label={tMap("employeeFilter")} clearLabel={tf("clearSearch")} />
              </MtmFilterBar>
            }
            filters={rosterFilters}
            onFiltersChange={setRosterFilters}
            view={{ ...rosterView, sort: rosterSort }}
            onViewChange={changeRosterView}
            onHide={() => setRosterHidden(true)}
            hiddenAgentIds={hiddenAgentIds}
            onToggleAgentOnMap={toggleAgentOnMap}
            onSetAgentsOnMap={setAgentsOnMap}
            selectedAgentId={selectedAgent}
            onSelect={handleAgentClick}
            selectedDetailRef={selectedDetailRef}
            renderDetail={renderAgentDetail}
            nowMs={presentationNow}
            workforceEnabled={workforceEnabled}
            formatClock={formatTenantTime}
            formatVisitOpened={formatVisitOpened}
            isEarlierDay={(value) => visitOpenedOnAnotherDay(value, contract?.timezone)}
            formatDistance={(meters) => formatMtmDistance(meters, locale, (unit, value) => tUnits(unit, { value }))}
            exportFileName={() => rosterExportFileName(contract?.today, new Date(), contract?.timezone)}
            printTitle={() => `${t("mtmMap")} · ${formatDateTime(new Date(), locale, { dateStyle: "medium", timeStyle: "short", timeZone: contract?.timezone })}`}
            // What the server itself narrowed the list by: the sheet must not read as the whole team.
            printNote={() => [
              debouncedEmployeeFilter ? tMap("roster.print.search", { query: debouncedEmployeeFilter }) : "",
              teamFilter ? `${tMap("teamFilter")}: ${teams.find((team) => team.id === teamFilter)?.name ?? teamFilter}` : "",
              contract?.rosterTruncated ? tMap("rosterTruncated", { shown: contract.returnedAgents }) : "",
            ].filter(Boolean).join(" · ")}
          />
        </div>
      </div>

      <section data-testid="mtm-map-live-feed" className="rounded-lg border bg-card p-3" aria-labelledby="mtm-map-live-feed-title">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 id="mtm-map-live-feed-title" className="text-xs font-semibold uppercase text-muted-foreground">{tMap("liveFeed")}</h4>
          <span className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Radio className="h-2 w-2" /> {tMap("latestEvents")}
          </span>
          <span className="text-[11px] text-muted-foreground">{tMap("feed.hint")}</span>
        </div>
        {liveFeed.length > 0 ? (
          <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {liveFeed.map((event) => {
              const isAlert = event.type === "ALERT"
              const timeLabel = event.alert && event.alert.count > 1
                ? `${tMap("feed.timeRange", { from: formatTenantTime(event.alert.firstAt), to: formatTenantTime(event.alert.lastAt) })} · ${tMap("feed.repeated", { count: event.alert.count })}`
                : formatDateTime(event.time, locale, { timeStyle: "short", timeZone: contract?.timezone })
              const href = isAlert && event.agentId && event.alert && contract?.timezone
                ? mtmLiveFeedHistoryHref({
                    agentId: event.agentId,
                    firstAt: event.alert.firstAt,
                    lastAt: event.alert.lastAt,
                    timezone: contract.timezone,
                  })
                : !isAlert && (event.visitId ?? event.id)
                  ? `/mtm/visits?visitId=${encodeURIComponent(event.visitId ?? event.id)}`
                  : null
              const body = (
                <>
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${event.type === "CHECK_IN" ? "bg-green-500" : isAlert ? "bg-red-500" : "bg-blue-500"}`} />
                  <span className="min-w-0">
                    <span className="font-medium">{event.agent}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      {isAlert
                        ? (event.alert ? feedAlertText(event.alert) : event.customer)
                        : `${tMap(event.type === "CHECK_IN" ? "feed.checkIn" : "feed.checkOut")} · ${event.customer}`}
                    </span>
                    <span className="block text-muted-foreground">{timeLabel}</span>
                  </span>
                </>
              )
              return (
                <li key={event.id}>
                  {href ? (
                    <Link
                      href={href}
                      aria-label={isAlert ? tMap("feed.openHistoryAt", { name: event.agent }) : tMap("feed.openVisit", { name: event.agent })}
                      className="flex min-h-11 items-start gap-1.5 rounded-md bg-muted/30 p-2 text-[11px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 items-start gap-1.5 rounded-md bg-muted/30 p-2 text-[11px]">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="py-3 text-center text-xs text-muted-foreground">{tMap("waitingForEvents")}</div>
        )}
      </section>


      </>
      )}
    </div>
  )
}
