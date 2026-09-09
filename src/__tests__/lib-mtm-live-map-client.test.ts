import { describe, expect, it } from "vitest"
import { routeCacheKey } from "@/lib/mtm/route-cache"
import type { LiveMapAgent, MtmDashboardAgent, MtmLiveMapContract } from "@/lib/mtm-types"
import {
  clusterLiveMapViewportAgents,
  LIVE_MAP_MAX_RENDERED_AGENTS,
  liveMapIdentityKey,
  liveMapRouteCacheScopeKey,
  isLiveMapAgentPositionVisible,
  isLiveMapPositionVisible,
  parseMtmLiveMapContract,
  presentMtmDashboardAgent,
  presentMtmGpsFreshness,
  selectLiveMapViewportAgents,
} from "@/lib/mtm-types"

const CONTRACT: MtmLiveMapContract = {
  scope: "TEAM_OR_REGION",
  today: "2026-08-01",
  timezone: "Asia/Baku",
  maxRosterSize: 500,
  returnedAgents: 2,
  rosterTruncated: false,
  markerCount: 1,
  workforceEnabled: true,
  generatedAt: "2026-08-01T12:00:00.000Z",
  polling: { minimumIntervalSeconds: 15 },
  freshnessThresholds: { onlineSeconds: 300, delayedSeconds: 600 },
  maxAccuracyMeters: 100,
}

function agent(id: string, latitude: number, longitude: number): LiveMapAgent {
  return {
    agentId: id,
    name: `Employee ${id}`,
    isOnline: true,
    fieldStatus: "ON_ROAD",
    latitude,
    longitude,
    recordedAt: "2026-08-01T12:00:00.000Z",
    freshness: "ONLINE",
    workdayState: "ACTIVE",
  }
}

describe("SWM-12 live-map response contract", () => {
  it("accepts the complete server-owned safety contract", () => {
    expect(parseMtmLiveMapContract(CONTRACT)).toEqual(CONTRACT)
  })

  it("preserves the explicit Routes-only marker policy", () => {
    expect(parseMtmLiveMapContract({ ...CONTRACT, workforceEnabled: false }))
      .toMatchObject({ workforceEnabled: false })
  })

  it.each([
    { ...CONTRACT, today: "2026-8-1" },
    { ...CONTRACT, generatedAt: "not-a-date" },
    { ...CONTRACT, returnedAgents: 501 },
    { ...CONTRACT, markerCount: 3 },
    { ...CONTRACT, freshnessThresholds: { onlineSeconds: 601, delayedSeconds: 600 } },
    { ...CONTRACT, polling: { minimumIntervalSeconds: 0 } },
  ])("fails closed for a malformed contract", (value) => {
    expect(parseMtmLiveMapContract(value)).toBeNull()
  })
})

describe("SWM-12 tenant and viewer cache identity", () => {
  it("separates the same employee and tenant-day by organization and viewer", () => {
    const key = (organizationId: string, viewerId: string) => routeCacheKey(
      liveMapRouteCacheScopeKey(organizationId, viewerId, "employee-1"),
      CONTRACT.today,
    )

    expect(liveMapIdentityKey("org-1", "manager-1")).toBe("org-1::manager-1")
    expect(key("org-1", "manager-1")).not.toBe(key("org-1", "manager-2"))
    expect(key("org-1", "manager-1")).not.toBe(key("org-2", "manager-1"))
  })

  it("refuses to build an identity when either security principal is absent", () => {
    expect(liveMapIdentityKey("", "manager-1")).toBe("")
    expect(liveMapIdentityKey("org-1", "")).toBe("")
    expect(liveMapRouteCacheScopeKey("org-1", "manager-1", "")).toBe("")
  })
})

describe("SWM-12 local GPS freshness aging", () => {
  const recordedAt = "2026-08-01T12:00:00.000Z"
  const recordedAtMs = Date.parse(recordedAt)
  const thresholds = CONTRACT.freshnessThresholds

  it("ages ONLINE to DELAYED and STALE at the exact tenant thresholds", () => {
    expect(presentMtmGpsFreshness("ONLINE", recordedAt, thresholds, recordedAtMs + 300_000)).toBe("ONLINE")
    expect(presentMtmGpsFreshness("ONLINE", recordedAt, thresholds, recordedAtMs + 300_001)).toBe("DELAYED")
    expect(presentMtmGpsFreshness("ONLINE", recordedAt, thresholds, recordedAtMs + 600_000)).toBe("DELAYED")
    expect(presentMtmGpsFreshness("ONLINE", recordedAt, thresholds, recordedAtMs + 600_001)).toBe("STALE")
  })

  it("never upgrades server evidence and preserves NO_LOCATION", () => {
    expect(presentMtmGpsFreshness("DELAYED", recordedAt, thresholds, recordedAtMs + 1_000)).toBe("DELAYED")
    expect(presentMtmGpsFreshness("STALE", recordedAt, thresholds, recordedAtMs + 1_000)).toBe("STALE")
    expect(presentMtmGpsFreshness("NO_LOCATION", null, thresholds, recordedAtMs)).toBe("NO_LOCATION")
  })

  it("does not keep a locally stale employee visually live", () => {
    const dashboardAgent: MtmDashboardAgent = {
      ...agent("employee-1", 40.4, 49.8),
      fieldStatus: "ON_ROAD",
      routeCompletion: 25,
      locationState: "AVAILABLE",
      lastSeenAt: recordedAt,
    }
    expect(presentMtmDashboardAgent(dashboardAgent, thresholds, recordedAtMs + 600_001)).toMatchObject({
      freshness: "STALE",
      fieldStatus: "OFFLINE",
      isOnline: false,
    })
  })

  it("separates app presence from GPS freshness", () => {
    const dashboardAgent: MtmDashboardAgent = {
      ...agent("employee-1", 40.4, 49.8),
      fieldStatus: "OFFLINE",
      routeCompletion: 0,
      freshness: "STALE",
      locationState: "AVAILABLE",
      lastSeenAt: new Date(recordedAtMs + 590_000).toISOString(),
    }

    expect(presentMtmDashboardAgent(dashboardAgent, thresholds, recordedAtMs + 600_001)).toMatchObject({
      isOnline: true,
      freshness: "STALE",
      fieldStatus: "OFFLINE",
    })
  })

  it("keeps stale and missing coordinates off the live map", () => {
    expect(isLiveMapPositionVisible("ONLINE")).toBe(true)
    expect(isLiveMapPositionVisible("DELAYED")).toBe(true)
    expect(isLiveMapPositionVisible("STALE")).toBe(false)
    expect(isLiveMapPositionVisible("NO_LOCATION")).toBe(false)
  })

  it("keeps the final coordinate out of live mode after the workday ends", () => {
    expect(isLiveMapAgentPositionVisible("ONLINE", "ACTIVE")).toBe(true)
    expect(isLiveMapAgentPositionVisible("DELAYED", "PAUSED")).toBe(true)
    expect(isLiveMapAgentPositionVisible("ONLINE", "CLOSED")).toBe(false)
    expect(isLiveMapAgentPositionVisible("ONLINE", "NOT_STARTED")).toBe(false)
  })
})

describe("SWM-12 bounded viewport marker contract", () => {
  it("never sends more than the structural marker cap to Leaflet", () => {
    const employees = Array.from({ length: 500 }, (_, index) =>
      agent(`employee-${index}`, 40 + (index % 10) * 0.001, 49 + (index % 10) * 0.001),
    )
    const selection = selectLiveMapViewportAgents(employees, null, null)

    expect(selection.agents).toHaveLength(LIVE_MAP_MAX_RENDERED_AGENTS)
    expect(selection.eligibleCount).toBe(500)
    expect(selection.truncated).toBe(true)
  })

  it("supports a viewport that crosses the international date line", () => {
    const selection = selectLiveMapViewportAgents([
      agent("east", 0, 179),
      agent("west", 0, -179),
      agent("middle", 0, 0),
    ], { north: 10, south: -10, west: 170, east: -170 }, null)

    expect(selection.agents.map((value) => value.agentId)).toEqual(["east", "west"])
    expect(selection.truncated).toBe(false)
  })

  it("does not create a marker for an invalid coordinate", () => {
    const selection = selectLiveMapViewportAgents([
      agent("valid", 40.4, 49.8),
      agent("invalid-latitude", 91, 49.8),
      agent("invalid-longitude", 40.4, 181),
    ], null, null)

    expect(selection.agents.map((value) => value.agentId)).toEqual(["valid"])
    expect(selection.eligibleCount).toBe(1)
  })

  it("retains the focused employee outside the current viewport and the cap", () => {
    const selection = selectLiveMapViewportAgents([
      agent("inside", 40.4, 49.8),
      agent("focused", 41.7, 50.7),
    ], { north: 41, south: 40, west: 49, east: 50 }, "focused", 1)

    expect(selection.agents.map((value) => value.agentId)).toEqual(["focused"])
    expect(selection.eligibleCount).toBe(2)
    expect(selection.truncated).toBe(true)
  })
})

describe("SWM-12 country-scale marker clustering", () => {
  it("represents nearby employees as one deterministic low-zoom cluster", () => {
    const delayed = { ...agent("delayed", 40.4, 49.8), freshness: "DELAYED" as const }
    const stale = { ...agent("stale", 40.4, 49.8), freshness: "STALE" as const }
    const selection = clusterLiveMapViewportAgents([
      agent("online", 40.4, 49.8),
      delayed,
      stale,
    ], null, 6, null)

    expect(selection.markers).toHaveLength(1)
    expect(selection.markers[0]).toMatchObject({
      kind: "CLUSTER",
      freshnessCounts: { ONLINE: 1, DELAYED: 1, STALE: 1 },
    })
    expect(selection.representedCount).toBe(3)
    expect(selection.truncated).toBe(false)
  })

  it("keeps the focused employee separate from an otherwise shared cluster", () => {
    const selection = clusterLiveMapViewportAgents([
      agent("focused", 40.4, 49.8),
      agent("second", 40.4, 49.8),
      agent("third", 40.4, 49.8),
    ], null, 6, "focused")

    expect(selection.markers).toHaveLength(2)
    expect(selection.markers[0]).toMatchObject({ kind: "AGENT", agent: { agentId: "focused" } })
    expect(selection.markers[1]).toMatchObject({ kind: "CLUSTER", agents: [{ agentId: "second" }, { agentId: "third" }] })
    expect(selection.representedCount).toBe(3)
  })

  it("retains the focused employee when the current viewport no longer contains it", () => {
    const selection = clusterLiveMapViewportAgents([
      agent("inside", 40.4, 49.8),
      agent("focused", 41.7, 50.7),
    ], { north: 41, south: 40, west: 49, east: 50 }, 8, "focused")

    expect(selection.markers[0]).toMatchObject({ kind: "AGENT", agent: { agentId: "focused" } })
    expect(selection.eligibleCount).toBe(2)
  })

  it("expands clusters into individual markers at street-level zoom", () => {
    const selection = clusterLiveMapViewportAgents([
      agent("first", 40.4, 49.8),
      agent("second", 40.4, 49.8),
    ], null, 14, null)

    expect(selection.markers.map((marker) => marker.kind)).toEqual(["AGENT", "AGENT"])
  })

  it("represents the complete 500-person server roster with one Leaflet node when colocated", () => {
    const employees = Array.from({ length: 500 }, (_, index) => agent(`employee-${index}`, 40.4, 49.8))
    const selection = clusterLiveMapViewportAgents(employees, null, 6, null)

    expect(selection.markers).toHaveLength(1)
    expect(selection.representedCount).toBe(500)
    expect(selection.eligibleCount).toBe(500)
    expect(selection.truncated).toBe(false)
  })
})
