/**
 * The roads between a day's stops, from the self-hosted OSRM the history map
 * already uses (map-matching.ts: same host, same switch). Two questions:
 *
 * - `roadTable` — seconds and metres from every stop to every other one, for
 *   choosing the order (route-order.ts);
 * - `roadPath` — the line along the streets through the stops in one order,
 *   for drawing it.
 *
 * Nothing about a client goes out: OSRM is on the production host itself and
 * hears coordinates only. No OSRM, or no answer — null, and the planner draws
 * and offers nothing it cannot back with roads.
 */
import { mapMatchingBaseUrl } from "@/lib/mtm/map-matching"

const TIMEOUT_MS = 5_000

export interface RoadPoint {
  latitude: number
  longitude: number
}

function coordinates(points: readonly RoadPoint[]): string {
  // OSRM speaks longitude first.
  return points.map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(";")
}

async function ask(path: string, fetcher: typeof fetch): Promise<Record<string, unknown> | null> {
  const base = mapMatchingBaseUrl()
  if (!base) return null
  try {
    const response = await fetcher(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) return null
    const body = await response.json() as Record<string, unknown>
    return body?.code === "Ok" ? body : null
  } catch {
    return null
  }
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** Seconds and metres between every two stops; null when OSRM is not there or does not answer. */
export async function roadTable(points: readonly RoadPoint[], fetcher: typeof fetch = fetch): Promise<{
  seconds: Array<Array<number | null>>
  metres: Array<Array<number | null>>
} | null> {
  if (points.length < 2) return null
  const body = await ask(`/table/v1/driving/${coordinates(points)}?annotations=duration,distance`, fetcher)
  const durations = body?.durations
  const distances = body?.distances
  if (!Array.isArray(durations) || !Array.isArray(distances) || durations.length !== points.length || distances.length !== points.length) return null
  const read = (rows: unknown[]) => rows.map((row) => (Array.isArray(row) && row.length === points.length ? row.map(finite) : points.map(() => null)))
  return { seconds: read(durations), metres: read(distances) }
}

/** The line along the streets through the stops in this order, as [latitude, longitude]. */
export async function roadPath(points: readonly RoadPoint[], fetcher: typeof fetch = fetch): Promise<Array<[number, number]> | null> {
  if (points.length < 2) return null
  const body = await ask(`/route/v1/driving/${coordinates(points)}?overview=full&geometries=geojson&steps=false`, fetcher)
  const routes = body?.routes
  const line = Array.isArray(routes) ? (routes[0] as { geometry?: { coordinates?: unknown } } | undefined)?.geometry?.coordinates : null
  if (!Array.isArray(line)) return null
  const path: Array<[number, number]> = []
  for (const pair of line) {
    if (!Array.isArray(pair)) continue
    const longitude = finite(pair[0])
    const latitude = finite(pair[1])
    // Six decimals is a tenth of a metre: enough for a line, and half the bytes.
    if (latitude != null && longitude != null) path.push([Math.round(latitude * 1e6) / 1e6, Math.round(longitude * 1e6) / 1e6])
  }
  return path.length > 1 ? path : null
}
