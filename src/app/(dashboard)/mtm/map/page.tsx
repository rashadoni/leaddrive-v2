"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import dynamic from "next/dynamic"
import { calculateDistance } from "@/lib/geo-utils"
import { formatDateTime } from "@/lib/format-date"
import { saveRouteCache, loadRouteCache, routeCacheKey } from "@/lib/mtm/route-cache"
import type { RouteStop } from "@/components/mtm/live-map"
import { LocationHistoryPanel } from "@/components/mtm/location-history-panel"
import {
  MapPin, RefreshCw, Clock, WifiOff, Navigation,
  Radio, AlertTriangle, Circle, Flame, History,
  Search, Battery, ShieldAlert, ArrowLeft, SlidersHorizontal,
} from "lucide-react"

const MtmLiveMap = dynamic(() => import("@/components/mtm/live-map"), { ssr: false })

// F-38: shared type — see src/lib/mtm-types.ts.
import type {
  LiveMapAgent,
  MtmDashboardAgent as AgentLocation,
  MtmLiveMapContract,
} from "@/lib/mtm-types"
import {
  FIELD_STATUS_LABEL_KEYS,
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
}

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
  route: any
  fromCache: boolean
}

const EMPTY_STATUS_COUNTS = { total: 0, checkedIn: 0, onRoad: 0, late: 0, offline: 0 }
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

// Field-status meta. `labelKey` comes from FIELD_STATUS_LABEL_KEYS so the
// list stays in lockstep with live-map.tsx. Dot-classes are page-local
// (only this page renders the status dot in the sidebar).
const STATUS_DOT_CLASS: Record<string, string> = {
  CHECKED_IN: "bg-green-500",
  ON_ROAD: "bg-blue-500",
  LATE: "bg-red-500",
  OFFLINE: "bg-muted-foreground/50",
}
const statusConfig: Record<string, { labelKey: string; dotClass: string }> = Object.fromEntries(
  Object.entries(FIELD_STATUS_LABEL_KEYS).map(([k, labelKey]) => [k, { labelKey, dotClass: STATUS_DOT_CLASS[k] || "bg-muted" }])
)

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
  const searchParams = useSearchParams()
  const locale = useLocale()
  const t = useTranslations("nav")
  const tMap = useTranslations("mtmMap")
  const tc = useTranslations("common")
  const [mapMode, setMapMode] = useState<"live" | "history">("live")
  const [rosterSnapshot, setRosterSnapshot] = useState<LiveRosterSnapshot | null>(null)
  const [teamFilter, setTeamFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("")
  const [debouncedEmployeeFilter, setDebouncedEmployeeFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshBlockedUntil, setRefreshBlockedUntil] = useState(0)
  const [loadError, setLoadError] = useState<{ identity: string; message: string } | null>(null)
  const [activeFilter, setActiveFilter] = useState("all")
  const [showGeofence, setShowGeofence] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
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
  const requestedMode = searchParams.get("mode")
  const returnHref = operationalWeekReturnHref(searchParams.get("returnTo"))
  const roster = rosterSnapshot?.identity === identityKey ? rosterSnapshot : null
  const contract = roster?.contract ?? null
  const tenantToday = contract?.today ?? ""
  const presentationNow = freshnessNow ?? (contract ? Date.parse(contract.generatedAt) : 0)
  const agents = useMemo(
    () => (roster?.agents ?? []).map((agent) => presentMtmDashboardAgent(
      agent,
      contract?.freshnessThresholds,
      presentationNow,
    )),
    [contract, presentationNow, roster?.agents],
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
  useEffect(() => {
    if (requestedMode === "history") setMapMode("history")
  }, [requestedMode])

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
    setRouteSnapshot(null)

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
      const cached = await loadRouteCache(key)
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
      if (nextBoundary != null) {
        timer = window.setTimeout(updateFreshness, Math.min(60_000, Math.max(100, nextBoundary - now)))
      }
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
  }

  const handleAgentClick = (agentId: string) => {
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
    void fetchAgentRoute(agentId, tenantToday)
  }

  const statusCounts = useMemo(() => agents.reduce((counts, agent) => {
    counts.total += 1
    if (agent.fieldStatus === "CHECKED_IN") counts.checkedIn += 1
    else if (agent.fieldStatus === "ON_ROAD") counts.onRoad += 1
    else if (agent.fieldStatus === "LATE") counts.late += 1
    else counts.offline += 1
    return counts
  }, { ...EMPTY_STATUS_COUNTS }), [agents])

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

  const filteredAgents = agents.filter(a => {
    if (activeFilter === "all") return true
    if (activeFilter === "checked_in") return a.fieldStatus === "CHECKED_IN"
    if (activeFilter === "on_road") return a.fieldStatus === "ON_ROAD"
    if (activeFilter === "late") return a.fieldStatus === "LATE"
    if (activeFilter === "offline") return a.fieldStatus === "OFFLINE"
    return true
  })

  // Employees without an admissible coordinate remain in the roster, but the
  // map only receives finite, bounded coordinates with an evidence timestamp.
  const mapAgents: LiveMapAgent[] = filteredAgents.flatMap((agent) => {
    const freshness = agent.freshness
    if (!hasRenderableLivePosition(freshness, agent.workdayState, workforceEnabled) ||
        typeof agent.latitude !== "number" || !Number.isFinite(agent.latitude) ||
        agent.latitude < -90 || agent.latitude > 90 ||
        typeof agent.longitude !== "number" || !Number.isFinite(agent.longitude) ||
        agent.longitude < -180 || agent.longitude > 180 ||
        typeof agent.recordedAt !== "string" || !Number.isFinite(Date.parse(agent.recordedAt))) return []
    return [{ ...agent, freshness, latitude: agent.latitude, longitude: agent.longitude, recordedAt: agent.recordedAt }]
  })
  const hiddenStalePositions = filteredAgents.filter((agent) => agent.freshness === "STALE").length

  // Transform route points to RouteStop[] for the map
  const routeStops: RouteStop[] = useMemo(() => {
    if (!agentRoute?.points) return []
    const points = [...agentRoute.points].sort((a: any, b: any) => a.orderIndex - b.orderIndex)
    const firstPendingOrder = points.find((p: any) => p.status === "PENDING")?.orderIndex
    return points
      .filter((p: any) => Number.isFinite(p.customer?.latitude) && p.customer.latitude >= -90 && p.customer.latitude <= 90 &&
        Number.isFinite(p.customer?.longitude) && p.customer.longitude >= -180 && p.customer.longitude <= 180)
      .map((p: any) => ({
        orderIndex: p.orderIndex,
        status: p.status === "VISITED" ? "VISITED" as const :
                p.status === "SKIPPED" ? "SKIPPED" as const :
                p.orderIndex === firstPendingOrder ? "NEXT" as const : "PENDING" as const,
        latitude: p.customer.latitude,
        longitude: p.customer.longitude,
        name: p.customer.name,
        address: p.customer.address,
        visitedAt: p.visitedAt,
      }))
  }, [agentRoute])

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
              onClick={() => setMapMode("live")}
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
              onClick={() => setMapMode("history")}
            >
              <History className="mr-1.5 h-3.5 w-3.5" />{tMap("historyMode")}
            </Button>
          </div>
          {mapMode === "live" && lastUpdate && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {tMap("lastUpdate")}: {formatDateTime(lastUpdate, locale, { timeStyle: "short", timeZone: contract?.timezone })}
            </span>
          )}
          {mapMode === "live" && <Button className="min-h-11" variant="outline" size="sm" onClick={manualRefresh} disabled={refreshing || loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> {tc("refresh")}
          </Button>}
        </div>
      </div>

      {mapMode === "history" ? <LocationHistoryPanel key={identityKey} /> : (
      <>
      <div className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[220px_minmax(240px,1fr)_auto]">
        <label className="grid gap-1 text-xs font-medium">
          {tMap("teamFilter")}
          <select className="h-11 rounded-md border bg-background px-3 text-sm" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="">{tMap("allTeams")}</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {tMap("employeeFilter")}
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <input data-testid="mtm-map-employee-filter" className="h-11 w-full rounded-md border bg-background pl-9 pr-3 text-sm" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} placeholder={tMap("employeePlaceholder")} />
          </span>
        </label>
        <div className="flex items-end text-xs text-muted-foreground">{tMap("lastPositionContract")}</div>
      </div>
      {contract?.rosterTruncated ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {tMap("rosterTruncated", { shown: contract.returnedAgents })}
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
          <Button className="min-h-11 shrink-0" variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>
          {tc("all")} ({statusCounts.total})
        </Button>
        <Button variant={activeFilter === "checked_in" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("checked_in")}
          className={`min-h-11 shrink-0 ${activeFilter === "checked_in" ? "" : "text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-950/20"}`}>
          <MapPin className="h-3 w-3 mr-1" /> {tMap("fieldStatus.checkedIn")} ({statusCounts.checkedIn})
        </Button>
        <Button variant={activeFilter === "on_road" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("on_road")}
          className={`min-h-11 shrink-0 ${activeFilter === "on_road" ? "" : "text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950/20"}`}>
          <Navigation className="h-3 w-3 mr-1" /> {tMap("fieldStatus.onRoad")} ({statusCounts.onRoad})
        </Button>
        <Button variant={activeFilter === "late" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("late")}
          className={`min-h-11 shrink-0 ${activeFilter === "late" ? "" : "text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/20"}`}>
          <AlertTriangle className="h-3 w-3 mr-1" /> {tMap("fieldStatus.late")} ({statusCounts.late})
        </Button>
        <Button variant={activeFilter === "offline" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("offline")}
          className={`min-h-11 shrink-0 ${activeFilter === "offline" ? "" : "text-muted-foreground"}`}>
          <WifiOff className="h-3 w-3 mr-1" /> {tMap("fieldStatus.offline")} ({statusCounts.offline})
        </Button>
      </div>

      <div role="status" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs">
        <span className="font-semibold">{tMap("agents")}: {statusCounts.total}</span>
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
      {hiddenStalePositions > 0 ? (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-muted/40 px-3 py-2 text-xs text-muted-foreground dark:border-zinc-700">
          <History className="h-3.5 w-3.5 shrink-0" />
          {tMap("stalePositionsHidden", { count: hiddenStalePositions })}
        </div>
      ) : null}
      <div data-testid="mtm-map-canvas" className="grid gap-3 max-lg:order-first lg:grid-cols-[minmax(0,1fr)_320px]" style={{ minHeight: 480 }}>
        {/* Map */}
        <div className="order-1 h-[54vh] min-h-[360px] overflow-hidden rounded-lg border border-zinc-200 bg-card lg:h-[calc(100vh-340px)] lg:min-h-[480px] dark:border-zinc-700 relative">
          {showRosterLoading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{tMap("loadingMap")}</div>
          ) : (
            <MtmLiveMap
              agents={mapAgents}
              showGeofence={showGeofence}
              showHeatmap={showHeatmap}
              plannedRoute={routeStops}
              focusAgentId={selectedAgent}
              etaSeconds={etaSeconds}
              timeZone={contract?.timezone}
              showWorkdayStatus={workforceEnabled}
            />
          )}
        </div>

        {/* Compact employee list. Detail appears only after an explicit selection. */}
        <aside className="order-2 min-h-0 rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700 lg:max-h-[calc(100vh-340px)]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">{tMap("agents")} ({filteredAgents.length})</h4>
              <span className="text-[11px] text-muted-foreground">{tMap("selectForDetails")}</span>
            </div>
            <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-410px)]">
              {filteredAgents.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">{tMap("noAgentsMatch")}</div>
              ) : (
                filteredAgents.map(agent => {
                  const cfg = statusConfig[agent.fieldStatus] || statusConfig.OFFLINE
                  const hasFreshGps = agent.freshness === "ONLINE"
                  const appPresent = agent.isOnline
                  const avatarBg = hasFreshGps
                    ? "bg-blue-500 text-white"
                    : agent.freshness === "DELAYED"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                      : "bg-muted text-muted-foreground"
                  const workdayTone = agent.workdayState === "ACTIVE"
                    ? "font-medium text-emerald-700 dark:text-emerald-400"
                    : agent.workdayState === "PAUSED"
                      ? "font-medium text-amber-700 dark:text-amber-300"
                      : "text-muted-foreground"
                  const isSelected = selectedAgent === agent.agentId
                  return (
                    <div key={agent.agentId} className={`flex items-stretch gap-1 rounded-lg border p-1 ${isSelected ? "border-blue-300 bg-blue-50/80 dark:border-blue-800 dark:bg-blue-950/30" : "border-transparent"}`}>
                      <button
                        type="button"
                        className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-pressed={isSelected}
                        aria-label={tMap("selectEmployee", { name: agent.name })}
                        onClick={() => handleAgentClick(agent.agentId)}
                      >
                        <span className="relative mt-0.5 flex-shrink-0">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold ${avatarBg}`}>
                            {agent.name?.charAt(0)?.toUpperCase()}
                          </span>
                          {appPresent && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{agent.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <span className={appPresent ? "font-medium text-green-600" : "text-muted-foreground"}>
                              {tMap(`presence.${appPresent ? "online" : "offline"}`)}
                            </span>
                            <span className={hasFreshGps ? "font-medium text-blue-600" : agent.freshness === "DELAYED" ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
                              {tMap(`freshness.${agent.freshness.toLowerCase()}`)}
                            </span>
                            {workforceEnabled ? <span className={workdayTone}>
                              {tMap(`workday.${agent.workdayState.toLowerCase()}`)}
                            </span> : null}
                            {agent.recordedAt ? (
                              <span className="text-muted-foreground">{formatDateTime(agent.recordedAt, locale, { timeStyle: "short", timeZone: contract?.timezone })}</span>
                            ) : null}
                          </span>
                          {isSelected ? (
                            <span className="mt-2 block rounded-md bg-background/80 p-2 text-[11px] text-muted-foreground">
                              <span className="flex flex-wrap gap-x-3 gap-y-1">
                                <span className="inline-flex items-center gap-1">
                                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
                                  {tMap(`fieldStatus.${cfg.labelKey}`)}
                                </span>
                                {agent.speed != null && agent.speed > 0 ? <span>{agent.speed.toFixed(0)} km/h</span> : null}
                                {agent.routeCompletion > 0 ? <span><Navigation className="inline h-3 w-3" /> {agent.routeCompletion}%</span> : null}
                                {agent.accuracy != null ? <span>±{Math.round(agent.accuracy)} m</span> : null}
                                {agent.battery != null ? <span className="inline-flex items-center"><Battery className="mr-0.5 h-3 w-3" />{Math.round(agent.battery)}%</span> : null}
                              </span>
                              {etaSeconds != null && etaSeconds > 0 ? (
                                <span className="mt-1 block font-semibold text-blue-600">
                                  {tMap("eta.label")}: {etaSeconds < 60
                                    ? tMap("eta.lessThanMinute")
                                    : etaSeconds < 3600
                                      ? tMap("eta.minutes", { count: Math.round(etaSeconds / 60) })
                                      : tMap("eta.hours", { count: (etaSeconds / 3600).toFixed(1) })}
                                </span>
                              ) : null}
                              {agent.locationState !== "AVAILABLE" ? (
                                <span className="mt-1 flex items-start gap-1 text-amber-700 dark:text-amber-300">
                                  <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                                  {tMap(`locationState.${agent.locationState.toLowerCase()}`)}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      {tenantToday ? (
                        <Button variant="ghost" size="sm" className="h-auto min-h-11 min-w-11 shrink-0 px-2 text-[10px]" asChild>
                          <Link
                            href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agent.agentId)}&date=${tenantToday}`}
                            aria-label={tMap("openEmployeeHistory", { name: agent.name })}
                          >
                            <History className="h-3 w-3 xl:mr-1" />
                            <span className="hidden xl:inline">{tMap("openHistory")}</span>
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
        </aside>
      </div>

      <details className="group rounded-lg border bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{tMap("additionalControls")}</span>
            <span className="block text-xs text-muted-foreground">{tMap("additionalControlsHint")}</span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="grid gap-3 border-t p-3 md:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex flex-wrap content-start gap-2">
            <Button className="min-h-11" variant={showGeofence ? "default" : "outline"} size="sm" onClick={() => setShowGeofence(!showGeofence)}>
              <Circle className="mr-1 h-3.5 w-3.5" /> {tMap("geofence")}
            </Button>
            <Button
              data-testid="mtm-map-heatmap-toggle"
              type="button"
              aria-pressed={showHeatmap}
              className="min-h-11"
              variant={showHeatmap ? "default" : "outline"}
              size="sm"
              onClick={() => setShowHeatmap((current) => !current)}
            >
              <Flame className="mr-1 h-3.5 w-3.5" /> {tMap("heatmap")}
            </Button>
            <div className="flex basis-full items-start gap-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {tMap("historyOnlyExplicit")}
            </div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">{tMap("liveFeed")}</h4>
              <span className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Radio className="h-2 w-2" /> {tMap("latestEvents")}
              </span>
            </div>
            {liveFeed.length > 0 ? (
              <div className="grid max-h-[180px] gap-1.5 overflow-y-auto sm:grid-cols-2">
                {liveFeed.map((event) => (
                  <div key={event.id} className="flex items-start gap-1.5 rounded-md bg-muted/30 p-2 text-[11px]">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${event.type === "CHECK_IN" ? "bg-green-500" : event.type === "ALERT" ? "bg-red-500" : "bg-blue-500"}`} />
                    <div className="min-w-0">
                      <span className="font-medium">{event.agent}</span>
                      <span className="text-muted-foreground"> {event.type === "ALERT" ? "⚠ " : "→ "}{event.customer}</span>
                      <div className="text-muted-foreground">{formatDateTime(event.time, locale, { timeStyle: "short", timeZone: contract?.timezone })}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-3 text-center text-xs text-muted-foreground">{tMap("waitingForEvents")}</div>
            )}
          </div>
        </div>
      </details>

      </>
      )}
    </div>
  )
}
