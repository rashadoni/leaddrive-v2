/**
 * Shared MTM front-end types.
 *
 * Two pages historically each declared their own `AgentLocation` interface
 * with slightly different fields, which TypeScript reads as nominally
 * unrelated types ("Two different types with this name exist, but they
 * are unrelated") — F-38, introduced in the F-24 Leaflet rewrite.
 *
 * Single source of truth lives here. `LiveMapAgent` is the live-map
 * component's prop shape; `MtmDashboardAgent` is the dashboard's view
 * model (adds routeCompletion). Component-side fields stay optional to
 * tolerate sparse rows from older mtm_agent_locations entries.
 */

export type MtmGpsFreshness = "ONLINE" | "DELAYED" | "STALE" | "NO_LOCATION"
export type MtmCoordinateFreshness = Exclude<MtmGpsFreshness, "NO_LOCATION">

export interface MtmLiveMapFreshnessThresholds {
  onlineSeconds: number
  delayedSeconds: number
}

export interface MtmLiveMapContract {
  scope: "TEAM_OR_REGION" | "ORGANIZATION"
  today: string
  timezone: string
  maxRosterSize: number
  returnedAgents: number
  rosterTruncated: boolean
  markerCount: number
  workforceEnabled: boolean
  generatedAt: string
  polling: { minimumIntervalSeconds: number }
  freshnessThresholds: MtmLiveMapFreshnessThresholds
  maxAccuracyMeters: number
}

export interface LiveMapAgent {
  agentId: string
  name: string
  isOnline: boolean
  fieldStatus?: string
  latitude: number
  longitude: number
  accuracy?: number | null
  speed?: number | null
  battery?: number | null
  recordedAt: string
  freshness: MtmCoordinateFreshness
  workdayState: "ACTIVE" | "PAUSED" | "CLOSED" | "NOT_STARTED"
  teamId?: string | null
  teamName?: string | null
  /** Optional — dashboard passes it for the route-completion ring overlay. */
  routeCompletion?: number
}

export interface MtmDashboardAgent extends Omit<LiveMapAgent, "latitude" | "longitude" | "recordedAt" | "freshness"> {
  fieldStatus: string
  routeCompletion: number
  freshness: MtmGpsFreshness
  // Dashboard rows can be missing GPS when an agent has no recent ping.
  latitude?: number
  longitude?: number
  recordedAt?: string
  locationState: "AVAILABLE" | "NO_LOCATION_REPORTED" | "PERMISSION_NOT_GRANTED"
  lastSeenAt?: string | null
  workdayDate?: string | null
  workdayStartedAt?: string | null
  workdayCarryover?: boolean
}

export interface LiveMapViewportBounds {
  north: number
  south: number
  east: number
  west: number
}

export const LIVE_MAP_MAX_RENDERED_AGENTS = 120

const FALLBACK_FRESHNESS_THRESHOLDS: MtmLiveMapFreshnessThresholds = {
  onlineSeconds: 300,
  delayedSeconds: 600,
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Fail closed when an older or malformed response omits the live-map contract. */
export function parseMtmLiveMapContract(value: unknown): MtmLiveMapContract | null {
  const input = record(value)
  const polling = record(input.polling)
  const thresholds = record(input.freshnessThresholds)
  const onlineSeconds = finiteNumber(thresholds.onlineSeconds)
  const delayedSeconds = finiteNumber(thresholds.delayedSeconds)
  const minimumIntervalSeconds = finiteNumber(polling.minimumIntervalSeconds)
  const maxRosterSize = finiteNumber(input.maxRosterSize)
  const returnedAgents = finiteNumber(input.returnedAgents)
  const markerCount = finiteNumber(input.markerCount)
  const maxAccuracyMeters = finiteNumber(input.maxAccuracyMeters)
  const generatedAt = typeof input.generatedAt === "string" ? input.generatedAt : ""
  const today = typeof input.today === "string" ? input.today : ""
  const timezone = typeof input.timezone === "string" ? input.timezone : ""
  const rosterTruncated = typeof input.rosterTruncated === "boolean" ? input.rosterTruncated : null
  // Old cached responses came from the bundled MTM product where Workforce
  // was always present. New Routes-only responses state the split explicitly.
  const workforceEnabled = typeof input.workforceEnabled === "boolean" ? input.workforceEnabled : true
  const scope = input.scope

  if ((scope !== "TEAM_OR_REGION" && scope !== "ORGANIZATION") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
      !timezone ||
      !generatedAt || !Number.isFinite(Date.parse(generatedAt)) ||
      rosterTruncated == null ||
      maxRosterSize == null || maxRosterSize < 1 ||
      returnedAgents == null || returnedAgents < 0 || returnedAgents > maxRosterSize ||
      markerCount == null || markerCount < 0 || markerCount > returnedAgents ||
      maxAccuracyMeters == null || maxAccuracyMeters < 0 ||
      minimumIntervalSeconds == null || minimumIntervalSeconds < 1 ||
      onlineSeconds == null || onlineSeconds < 1 ||
      delayedSeconds == null || delayedSeconds < onlineSeconds) {
    return null
  }

  return {
    scope,
    today,
    timezone,
    maxRosterSize,
    returnedAgents,
    rosterTruncated,
    markerCount,
    workforceEnabled,
    generatedAt,
    polling: { minimumIntervalSeconds },
    freshnessThresholds: { onlineSeconds, delayedSeconds },
    maxAccuracyMeters,
  }
}

export function liveMapIdentityKey(organizationId: string, viewerId: string): string {
  if (!organizationId || !viewerId) return ""
  return `${encodeURIComponent(organizationId)}::${encodeURIComponent(viewerId)}`
}

/** Agent portion of the IndexedDB key; the route date remains a separate key segment. */
export function liveMapRouteCacheScopeKey(
  organizationId: string,
  viewerId: string,
  agentId: string,
): string {
  const identity = liveMapIdentityKey(organizationId, viewerId)
  return identity && agentId ? `${identity}::${encodeURIComponent(agentId)}` : ""
}

function normalizedThresholds(
  value: MtmLiveMapFreshnessThresholds | null | undefined,
): MtmLiveMapFreshnessThresholds {
  if (!value || !Number.isFinite(value.onlineSeconds) || value.onlineSeconds < 1 ||
      !Number.isFinite(value.delayedSeconds) || value.delayedSeconds < value.onlineSeconds) {
    return FALLBACK_FRESHNESS_THRESHOLDS
  }
  return value
}

/**
 * Re-evaluate GPS freshness from the coordinate timestamp on the client.
 * Server state is a lower bound: a delayed/stale coordinate is never upgraded
 * because of clock skew, while an old successful response continues to age
 * after a polling/network failure.
 */
export function presentMtmGpsFreshness(
  serverFreshness: MtmGpsFreshness,
  recordedAt: string | null | undefined,
  thresholds: MtmLiveMapFreshnessThresholds | null | undefined,
  nowMs: number,
): MtmGpsFreshness {
  if (serverFreshness === "NO_LOCATION") return "NO_LOCATION"
  const recordedAtMs = recordedAt ? Date.parse(recordedAt) : Number.NaN
  if (!Number.isFinite(recordedAtMs)) return "STALE"
  const policy = normalizedThresholds(thresholds)
  const ageMs = Math.max(0, nowMs - recordedAtMs)
  const calculated: MtmCoordinateFreshness = ageMs <= policy.onlineSeconds * 1_000
    ? "ONLINE"
    : ageMs <= policy.delayedSeconds * 1_000
      ? "DELAYED"
      : "STALE"
  const rank: Record<MtmCoordinateFreshness, number> = { ONLINE: 0, DELAYED: 1, STALE: 2 }
  return rank[serverFreshness] > rank[calculated] ? serverFreshness : calculated
}

export function presentMtmDashboardAgent(
  agent: MtmDashboardAgent,
  thresholds: MtmLiveMapFreshnessThresholds | null | undefined,
  nowMs: number,
): MtmDashboardAgent {
  const freshness = presentMtmGpsFreshness(agent.freshness, agent.recordedAt, thresholds, nowMs)
  const policy = normalizedThresholds(thresholds)
  const lastSeenAtMs = agent.lastSeenAt ? Date.parse(agent.lastSeenAt) : Number.NaN
  const appPresent = agent.isOnline && Number.isFinite(lastSeenAtMs) &&
    Math.max(0, nowMs - lastSeenAtMs) <= policy.onlineSeconds * 1_000
  return {
    ...agent,
    isOnline: appPresent,
    freshness,
    fieldStatus: freshness === "STALE" || freshness === "NO_LOCATION" ? "OFFLINE" : agent.fieldStatus,
  }
}

/** Live mode must never present historical evidence as a current position. */
export function isLiveMapPositionVisible(freshness: MtmGpsFreshness): freshness is "ONLINE" | "DELAYED" {
  return freshness === "ONLINE" || freshness === "DELAYED"
}

/** A recent coordinate is live only while the employee still has an open workday. */
export function isLiveWorkdayPositionVisible(state: LiveMapAgent["workdayState"]): boolean {
  return state === "ACTIVE" || state === "PAUSED"
}

export function isLiveMapAgentPositionVisible(
  freshness: MtmGpsFreshness,
  workdayState: LiveMapAgent["workdayState"],
): freshness is "ONLINE" | "DELAYED" {
  return isLiveMapPositionVisible(freshness) && isLiveWorkdayPositionVisible(workdayState)
}

function validAgentCoordinate(agent: LiveMapAgent): boolean {
  return Number.isFinite(agent.latitude) && agent.latitude >= -90 && agent.latitude <= 90 &&
    Number.isFinite(agent.longitude) && agent.longitude >= -180 && agent.longitude <= 180
}

function isInsideViewport(agent: LiveMapAgent, viewport: LiveMapViewportBounds): boolean {
  if (agent.latitude < viewport.south || agent.latitude > viewport.north) return false
  return viewport.west <= viewport.east
    ? agent.longitude >= viewport.west && agent.longitude <= viewport.east
    : agent.longitude >= viewport.west || agent.longitude <= viewport.east
}

export interface LiveMapViewportSelection {
  agents: LiveMapAgent[]
  eligibleCount: number
  truncated: boolean
}

export interface LiveMapAgentMarker {
  kind: "AGENT"
  id: string
  latitude: number
  longitude: number
  agent: LiveMapAgent
}

export interface LiveMapClusterMarker {
  kind: "CLUSTER"
  id: string
  latitude: number
  longitude: number
  agents: LiveMapAgent[]
  freshnessCounts: Record<MtmCoordinateFreshness, number>
}

export type LiveMapMarker = LiveMapAgentMarker | LiveMapClusterMarker

export interface LiveMapClusterSelection {
  markers: LiveMapMarker[]
  eligibleCount: number
  representedCount: number
  truncated: boolean
}

/**
 * Structural large-team contract: Leaflet receives at most 120 employee DOM
 * markers, and—once bounds are known—only coordinates in the padded viewport.
 * A focused employee is retained even when a pan temporarily moves them out.
 */
export function selectLiveMapViewportAgents(
  agents: LiveMapAgent[],
  viewport: LiveMapViewportBounds | null,
  focusedAgentId: string | null,
  limit = LIVE_MAP_MAX_RENDERED_AGENTS,
): LiveMapViewportSelection {
  const safeLimit = Math.max(1, Math.min(LIVE_MAP_MAX_RENDERED_AGENTS, Math.floor(limit) || 1))
  const validAgents = agents.filter(validAgentCoordinate)
  const inViewport = viewport ? validAgents.filter((agent) => isInsideViewport(agent, viewport)) : validAgents
  const focused = focusedAgentId ? validAgents.find((agent) => agent.agentId === focusedAgentId) ?? null : null
  const eligible = focused && !inViewport.some((agent) => agent.agentId === focused.agentId)
    ? [focused, ...inViewport]
    : focused
      ? [focused, ...inViewport.filter((agent) => agent.agentId !== focused.agentId)]
      : inViewport

  return {
    agents: eligible.slice(0, safeLimit),
    eligibleCount: eligible.length,
    truncated: eligible.length > safeLimit,
  }
}

function liveMapEligibleAgents(
  agents: LiveMapAgent[],
  viewport: LiveMapViewportBounds | null,
  focusedAgentId: string | null,
): LiveMapAgent[] {
  const validAgents = agents.filter(validAgentCoordinate)
  const inViewport = viewport ? validAgents.filter((agent) => isInsideViewport(agent, viewport)) : validAgents
  const focused = focusedAgentId ? validAgents.find((agent) => agent.agentId === focusedAgentId) ?? null : null
  return focused
    ? [focused, ...inViewport.filter((agent) => agent.agentId !== focused.agentId)]
    : inViewport
}

function agentMarker(agent: LiveMapAgent): LiveMapAgentMarker {
  return {
    kind: "AGENT",
    id: `agent:${agent.agentId}`,
    latitude: agent.latitude,
    longitude: agent.longitude,
    agent,
  }
}

function projectedGridCell(agent: LiveMapAgent, zoom: number, gridSize: number): string {
  const worldSize = 256 * (2 ** zoom)
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, agent.latitude))
  const sinLatitude = Math.sin(latitude * Math.PI / 180)
  const x = ((agent.longitude + 180) / 360) * worldSize
  const y = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize
  return `${Math.floor(x / gridSize)}:${Math.floor(y / gridSize)}`
}

function meanLongitude(agents: LiveMapAgent[]): number {
  const sum = agents.reduce((accumulator, agent) => {
    const radians = agent.longitude * Math.PI / 180
    return {
      sin: accumulator.sin + Math.sin(radians),
      cos: accumulator.cos + Math.cos(radians),
    }
  }, { sin: 0, cos: 0 })
  if (Math.abs(sum.sin) < Number.EPSILON && Math.abs(sum.cos) < Number.EPSILON) {
    return agents[0]?.longitude ?? 0
  }
  return Math.atan2(sum.sin, sum.cos) * 180 / Math.PI
}

/**
 * Country-scale live-map contract. Nearby employees are grouped in Web
 * Mercator screen-space so the 500-person roster remains represented without
 * mounting hundreds of Leaflet nodes. The focused employee is always kept as
 * an individual marker, even when it sits outside the current viewport.
 */
export function clusterLiveMapViewportAgents(
  agents: LiveMapAgent[],
  viewport: LiveMapViewportBounds | null,
  zoom: number,
  focusedAgentId: string | null,
  markerLimit = LIVE_MAP_MAX_RENDERED_AGENTS,
  inputLimit = 500,
): LiveMapClusterSelection {
  const safeMarkerLimit = Math.max(1, Math.min(LIVE_MAP_MAX_RENDERED_AGENTS, Math.floor(markerLimit) || 1))
  const safeInputLimit = Math.max(1, Math.min(500, Math.floor(inputLimit) || 1))
  const safeZoom = Math.max(0, Math.min(22, Number.isFinite(zoom) ? zoom : 0))
  const eligible = liveMapEligibleAgents(agents, viewport, focusedAgentId)
  const input = eligible.slice(0, safeInputLimit)
  const focused = focusedAgentId ? input.find((agent) => agent.agentId === focusedAgentId) ?? null : null
  const remaining = focused ? input.filter((agent) => agent.agentId !== focused.agentId) : input
  let markers: LiveMapMarker[]

  if (safeZoom >= 14) {
    markers = [
      ...(focused ? [agentMarker(focused)] : []),
      ...remaining.map(agentMarker),
    ]
  } else {
    const groups = new Map<string, LiveMapAgent[]>()
    for (const agent of remaining) {
      const key = projectedGridCell(agent, safeZoom, 64)
      const group = groups.get(key)
      if (group) group.push(agent)
      else groups.set(key, [agent])
    }
    const groupedMarkers: LiveMapMarker[] = Array.from(groups, ([cell, group]) => {
      if (group.length === 1) return agentMarker(group[0])
      const freshnessCounts: Record<MtmCoordinateFreshness, number> = {
        ONLINE: 0,
        DELAYED: 0,
        STALE: 0,
      }
      for (const agent of group) freshnessCounts[agent.freshness] += 1
      return {
        kind: "CLUSTER",
        id: `cluster:${Math.floor(safeZoom)}:${cell}`,
        latitude: group.reduce((sum, agent) => sum + agent.latitude, 0) / group.length,
        longitude: meanLongitude(group),
        agents: group,
        freshnessCounts,
      } satisfies LiveMapClusterMarker
    })
    markers = [...(focused ? [agentMarker(focused)] : []), ...groupedMarkers]
  }

  const renderedMarkers = markers.slice(0, safeMarkerLimit)
  const representedCount = renderedMarkers.reduce(
    (count, marker) => count + (marker.kind === "AGENT" ? 1 : marker.agents.length),
    0,
  )
  return {
    markers: renderedMarkers,
    eligibleCount: eligible.length,
    representedCount,
    truncated: eligible.length > safeInputLimit || markers.length > safeMarkerLimit,
  }
}

/**
 * Field-status enum. Derived UI value (not a Prisma column) — computed
 * from check-in state, last-seen-at, and route adherence in the agent
 * locations endpoint. Union-typed so any typo in keys/maps below fails
 * compile rather than silently rendering the literal string at runtime.
 */
export type MtmFieldStatus = "CHECKED_IN" | "ON_ROAD" | "LATE" | "OFFLINE"

/**
 * Single source of truth for MTM field-status → i18n label key mapping.
 * Both `live-map.tsx` (module-level Record) and `map/page.tsx`
 * (statusConfig with dot-class) consume this — previously each kept its
 * own copy, drift waiting to happen.
 *
 * Resolved at render-time via `t(\`mtmMap.fieldStatus.\${key}\`)`.
 */
export const FIELD_STATUS_LABEL_KEYS: Record<MtmFieldStatus, string> = {
  CHECKED_IN: "checkedIn",
  ON_ROAD: "onRoad",
  LATE: "late",
  OFFLINE: "offline",
}
