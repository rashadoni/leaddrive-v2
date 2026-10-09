import type { LiveMapViewportBounds } from "@/lib/mtm-types"

/**
 * The client base as a layer of the live map.
 *
 * Owner, 2026-10-09, of the Navixy demo: «бери почти всё, чего у нас нет» —
 * there the places stand on the same map as the vehicles. Here the
 * institutions do: where the employees are is read against where the clients
 * are.
 *
 * A base is thousands of points and the map draws a few hundred nodes at
 * most, so what is in view is gathered into groups on a screen grid — coarser
 * until it fits — and drawn one by one only when it fits as it is. Every
 * client in view is in exactly one node: a group says how many it stands for,
 * and nothing is dropped to meet the budget.
 *
 * Kept apart from the employees' own grouping (mtm-types.ts): clients have
 * their own budget, so a dense base can never push an employee off the map.
 *
 * Pure: no React, no Leaflet.
 */

export interface LiveMapClient {
  id: string
  name: string
  latitude: number
  longitude: number
  /** VIP, A, B, C, D. */
  category: string
  /** PHARMACY, CLINIC, STORE, OTHER. */
  objectType: string
  /** The client's own check-in radius; null — the organization's. */
  geofenceRadius: number | null
}

export type LiveMapClientNode =
  | { kind: "CLIENT"; id: string; latitude: number; longitude: number; client: LiveMapClient }
  | { kind: "GROUP"; id: string; latitude: number; longitude: number; count: number }

export interface LiveMapClientSelection {
  nodes: LiveMapClientNode[]
  /** Clients inside the view, all of them represented by the nodes. */
  inView: number
}

/** Nodes the layer may draw. Beyond it the map stops answering a finger. */
export const LIVE_MAP_CLIENT_NODE_BUDGET = 300
const FIRST_GRID_PX = 64

function usable(client: LiveMapClient): boolean {
  return Number.isFinite(client.latitude) && Number.isFinite(client.longitude)
    && Math.abs(client.latitude) <= 90 && Math.abs(client.longitude) <= 180
    && !(client.latitude === 0 && client.longitude === 0)
}

/**
 * The view is what the map reports (live-map.tsx, ViewportReporter): already
 * a little wider than the screen, so a pan does not open onto an empty edge.
 */
function insideView(client: LiveMapClient, view: LiveMapViewportBounds): boolean {
  if (client.latitude > view.north || client.latitude < view.south) return false
  // A view across the antimeridian has its west edge east of its east edge.
  if (view.west > view.east) return client.longitude >= view.west || client.longitude <= view.east
  return client.longitude >= view.west && client.longitude <= view.east
}

function gridCell(client: LiveMapClient, zoom: number, gridPx: number): string {
  const worldSize = 256 * (2 ** zoom)
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, client.latitude))
  const sinLatitude = Math.sin(latitude * Math.PI / 180)
  const x = ((client.longitude + 180) / 360) * worldSize
  const y = (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize
  return `${Math.floor(x / gridPx)}:${Math.floor(y / gridPx)}`
}

export function clusterLiveMapClients(
  clients: readonly LiveMapClient[],
  view: LiveMapViewportBounds | null,
  zoom: number,
  budget: number = LIVE_MAP_CLIENT_NODE_BUDGET,
): LiveMapClientSelection {
  // Until the map has said what it is looking at, nothing is drawn.
  if (!view) return { nodes: [], inView: 0 }
  const safeBudget = Math.max(1, Math.floor(budget) || 1)
  const safeZoom = Math.max(0, Math.min(22, Number.isFinite(zoom) ? zoom : 0))
  const visible = clients.filter((client) => usable(client) && insideView(client, view))
  const single = (client: LiveMapClient): LiveMapClientNode =>
    ({ kind: "CLIENT", id: `client:${client.id}`, latitude: client.latitude, longitude: client.longitude, client })

  if (visible.length <= safeBudget) return { nodes: visible.map(single), inView: visible.length }

  // Coarser and coarser until what is in view fits the budget. The grid
  // doubles, so this ends: at the size of the world everything is one cell.
  for (let gridPx = FIRST_GRID_PX; ; gridPx *= 2) {
    const cells = new Map<string, LiveMapClient[]>()
    for (const client of visible) {
      const key = gridCell(client, safeZoom, gridPx)
      const members = cells.get(key)
      if (members) members.push(client)
      else cells.set(key, [client])
    }
    if (cells.size > safeBudget && gridPx < 256 * (2 ** 23)) continue
    const nodes: LiveMapClientNode[] = []
    for (const [cell, members] of cells) {
      if (members.length === 1) {
        nodes.push(single(members[0]))
        continue
      }
      nodes.push({
        kind: "GROUP",
        id: `clients:${Math.floor(safeZoom)}:${gridPx}:${cell}`,
        latitude: members.reduce((sum, client) => sum + client.latitude, 0) / members.length,
        longitude: members.reduce((sum, client) => sum + client.longitude, 0) / members.length,
        count: members.length,
      })
    }
    return { nodes, inView: visible.length }
  }
}

/** Marker colour by class: the classes a manager plans by, strongest first. */
export const LIVE_MAP_CLIENT_CLASS_COLORS: Record<string, string> = {
  VIP: "#7c3aed",
  A: "#059669",
  B: "#0284c7",
  C: "#ca8a04",
  D: "#64748b",
}

export function liveMapClientColor(category: string): string {
  return LIVE_MAP_CLIENT_CLASS_COLORS[category] ?? LIVE_MAP_CLIENT_CLASS_COLORS.D
}

/** What the server says about the base behind the points. */
export interface LiveMapClientsAnswer {
  clients: LiveMapClient[]
  total: number
  withoutCoordinates: number
  truncated: boolean
}

/** Fail closed on a malformed answer: a layer with made-up points is worse than no layer. */
export function parseLiveMapClients(value: unknown): LiveMapClientsAnswer | null {
  if (!value || typeof value !== "object") return null
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.clients)) return null
  const clients: LiveMapClient[] = []
  for (const row of data.clients) {
    if (!row || typeof row !== "object") continue
    const client = row as Record<string, unknown>
    if (typeof client.id !== "string" || typeof client.name !== "string") continue
    if (typeof client.latitude !== "number" || typeof client.longitude !== "number") continue
    const parsed: LiveMapClient = {
      id: client.id,
      name: client.name,
      latitude: client.latitude,
      longitude: client.longitude,
      category: typeof client.category === "string" ? client.category : "",
      objectType: typeof client.objectType === "string" ? client.objectType : "",
      geofenceRadius: typeof client.geofenceRadius === "number" && Number.isFinite(client.geofenceRadius) && client.geofenceRadius > 0
        ? client.geofenceRadius
        : null,
    }
    if (usable(parsed)) clients.push(parsed)
  }
  const count = (input: unknown) => (typeof input === "number" && Number.isFinite(input) && input >= 0 ? Math.floor(input) : 0)
  return {
    clients,
    total: Math.max(count(data.total), clients.length),
    withoutCoordinates: count(data.withoutCoordinates),
    truncated: data.truncated === true,
  }
}
