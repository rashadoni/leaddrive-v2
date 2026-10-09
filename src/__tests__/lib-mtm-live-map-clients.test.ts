/**
 * The client base as a layer of the live map (owner, 2026-10-09: «бери почти
 * всё, чего у нас нет» — on the Navixy demo the places stand on the same map
 * as the vehicles).
 *
 * The rule that matters with thousands of points: the map draws a few hundred
 * nodes at most, and every client in view is still in exactly one of them.
 */
import { describe, expect, it } from "vitest"
import {
  LIVE_MAP_CLIENT_NODE_BUDGET,
  clusterLiveMapClients,
  liveMapClientColor,
  parseLiveMapClients,
  type LiveMapClient,
} from "@/lib/mtm/live-map-clients"

const BAKU = { north: 40.5, south: 40.3, east: 50.0, west: 49.7 }
const client = (id: string, latitude: number, longitude: number, extra: Partial<LiveMapClient> = {}): LiveMapClient =>
  ({ id, name: `Точка ${id}`, latitude, longitude, category: "B", objectType: "PHARMACY", geofenceRadius: null, ...extra })

/** A deterministic scatter over the view: no randomness, so a failure repeats. */
function scatter(count: number, view = BAKU): LiveMapClient[] {
  return Array.from({ length: count }, (_unused, index) => {
    const a = ((index * 7919) % 1000) / 1000
    const b = ((index * 104729) % 1000) / 1000
    return client(String(index), view.south + a * (view.north - view.south), view.west + b * (view.east - view.west))
  })
}
const represented = (nodes: ReturnType<typeof clusterLiveMapClients>["nodes"]) =>
  nodes.reduce((sum, node) => sum + (node.kind === "CLIENT" ? 1 : node.count), 0)

describe("the clients layer of the live map", () => {
  it("draws nothing until the map has said what it is looking at", () => {
    expect(clusterLiveMapClients(scatter(10), null, 12)).toEqual({ nodes: [], inView: 0 })
  })

  it("draws a base that fits one by one, whatever the zoom", () => {
    const base = scatter(120)
    for (const zoom of [6, 11, 16]) {
      const { nodes, inView } = clusterLiveMapClients(base, BAKU, zoom)
      expect(inView).toBe(120)
      expect(nodes.every((node) => node.kind === "CLIENT")).toBe(true)
      expect(nodes).toHaveLength(120)
    }
  })

  it("five thousand clients never become more nodes than the budget — and none is dropped", () => {
    const base = scatter(5_000)
    for (const zoom of [5, 9, 11, 13]) {
      const { nodes, inView } = clusterLiveMapClients(base, BAKU, zoom)
      expect(nodes.length).toBeLessThanOrEqual(LIVE_MAP_CLIENT_NODE_BUDGET)
      expect(inView).toBe(5_000)
      expect(represented(nodes)).toBe(5_000)
      // No two nodes claim the same place in the list.
      expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length)
    }
  })

  it("zooming in to a block shows its clients one by one though the base is large", () => {
    const base = scatter(5_000)
    const block = { north: 40.405, south: 40.4, east: 49.855, west: 49.85 }
    const { nodes, inView } = clusterLiveMapClients(base, block, 17)
    expect(inView).toBeGreaterThan(0)
    expect(inView).toBeLessThan(LIVE_MAP_CLIENT_NODE_BUDGET)
    expect(nodes.every((node) => node.kind === "CLIENT")).toBe(true)
  })

  it("a group stands where its clients are, and says how many", () => {
    const pile = Array.from({ length: 400 }, (_unused, index) => client(`p${index}`, 40.4 + (index % 20) * 0.00001, 49.85 + Math.floor(index / 20) * 0.00001))
    const { nodes } = clusterLiveMapClients(pile, BAKU, 10)
    const groups = nodes.filter((node) => node.kind === "GROUP")
    expect(groups.length).toBeGreaterThan(0)
    expect(represented(nodes)).toBe(400)
    for (const group of groups) {
      expect(group.latitude).toBeGreaterThan(40.399)
      expect(group.latitude).toBeLessThan(40.401)
      expect(group.longitude).toBeGreaterThan(49.849)
      expect(group.longitude).toBeLessThan(49.851)
    }
  })

  it("leaves out what is outside the view the map reports and what has no usable place", () => {
    const base = [
      client("in", 40.4, 49.85),
      client("on-the-edge", 40.5, 50.0),
      client("north", 40.51, 49.85),
      client("east", 40.4, 50.01),
      client("null-island", 0, 0),
      client("broken", 500, 49.85),
      client("nan", Number.NaN, 49.85),
    ]
    const { nodes, inView } = clusterLiveMapClients(base, BAKU, 12)
    expect(nodes.map((node) => node.id).sort()).toEqual(["client:in", "client:on-the-edge"])
    expect(inView).toBe(2)
  })

  it("a view across the 180th meridian keeps both of its sides", () => {
    const pacific = { north: -15, south: -20, east: -178, west: 177 }
    const base = [client("fiji-west", -17.7, 177.4), client("fiji-east", -16.8, -179.9), client("elsewhere", -17, 0)]
    expect(clusterLiveMapClients(base, pacific, 7).nodes.map((node) => node.id).sort()).toEqual(["client:fiji-east", "client:fiji-west"])
  })

  it("holds to a smaller budget when it is given one", () => {
    const { nodes } = clusterLiveMapClients(scatter(900), BAKU, 12, 40)
    expect(nodes.length).toBeLessThanOrEqual(40)
    expect(represented(nodes)).toBe(900)
  })

  it("colours by class and falls back to the quietest colour for a class it does not know", () => {
    expect(liveMapClientColor("VIP")).not.toBe(liveMapClientColor("A"))
    expect(liveMapClientColor("")).toBe(liveMapClientColor("D"))
    expect(liveMapClientColor("ZZ")).toBe(liveMapClientColor("D"))
  })

  it("reads the server's answer and refuses a malformed one rather than drawing made-up points", () => {
    expect(parseLiveMapClients(null)).toBeNull()
    expect(parseLiveMapClients({ total: 3 })).toBeNull()
    const answer = parseLiveMapClients({
      clients: [
        { id: "a", name: "Аптека", latitude: 40.4, longitude: 49.85, category: "A", objectType: "PHARMACY", geofenceRadius: 150 },
        { id: "b", name: "Без радиуса", latitude: 40.41, longitude: 49.86, category: "B", objectType: "CLINIC", geofenceRadius: null },
        { id: "bad", name: "Не число", latitude: "40.4", longitude: 49.85 },
        { id: "range", name: "Вне диапазона", latitude: 500, longitude: 49.85 },
        { name: "Без id", latitude: 40.4, longitude: 49.85 },
      ],
      total: 12, withoutCoordinates: 7, truncated: false,
    })
    expect(answer?.clients.map((row) => [row.id, row.geofenceRadius])).toEqual([["a", 150], ["b", null]])
    expect(answer).toMatchObject({ total: 12, withoutCoordinates: 7, truncated: false })
    // A total smaller than what arrived is not believed.
    expect(parseLiveMapClients({ clients: [{ id: "a", name: "A", latitude: 40.4, longitude: 49.85 }], total: 0 })?.total).toBe(1)
  })
})
