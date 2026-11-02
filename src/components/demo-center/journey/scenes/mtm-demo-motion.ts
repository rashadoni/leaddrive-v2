/**
 * Where on the demo's streets (`mtm-demo-roads.ts`) a drive is at a moment.
 * The drive is even along its road: what the live map shows of somebody on
 * the way, and the fixes the evening's history is made of, both come from
 * here, so the two screens put him on the same street at the same minute.
 */
import { calculateDistance } from "@/lib/geo-utils"
import { MTM_DEMO_ROADS, type MtmDemoRoadId } from "./mtm-demo-roads"

export interface MtmDemoPosition {
  readonly latitude: number
  readonly longitude: number
}

const lengths = new Map<MtmDemoRoadId, number[]>()

/** Metres from the road's start to each of its vertices. */
function cumulative(road: MtmDemoRoadId): number[] {
  const known = lengths.get(road)
  if (known) return known
  const vertices = MTM_DEMO_ROADS[road]
  const sums = [0]
  for (let index = 1; index < vertices.length; index += 1) {
    const [fromLat, fromLng] = vertices[index - 1]
    const [toLat, toLng] = vertices[index]
    sums.push(sums[index - 1] + calculateDistance(fromLat, fromLng, toLat, toLng))
  }
  lengths.set(road, sums)
  return sums
}

export function mtmDemoRoadMeters(road: MtmDemoRoadId): number {
  const sums = cumulative(road)
  return sums[sums.length - 1]
}

/** The point `meters` along the road, held at its ends. */
export function mtmDemoAlongRoad(road: MtmDemoRoadId, meters: number): MtmDemoPosition {
  const vertices = MTM_DEMO_ROADS[road]
  const sums = cumulative(road)
  const at = Math.min(Math.max(meters, 0), sums[sums.length - 1])
  let index = 1
  while (index < sums.length - 1 && sums[index] < at) index += 1
  const span = sums[index] - sums[index - 1]
  const share = span > 0 ? (at - sums[index - 1]) / span : 0
  const [fromLat, fromLng] = vertices[index - 1]
  const [toLat, toLng] = vertices[index]
  return { latitude: fromLat + (toLat - fromLat) * share, longitude: fromLng + (toLng - fromLng) * share }
}

/** The road's line between two distances along it, its own bends included. */
export function mtmDemoRoadStretch(road: MtmDemoRoadId, fromMeters: number, toMeters: number): Array<[number, number]> {
  const vertices = MTM_DEMO_ROADS[road]
  const sums = cumulative(road)
  const start = mtmDemoAlongRoad(road, fromMeters)
  const end = mtmDemoAlongRoad(road, toMeters)
  const inside = vertices.filter((_, index) => sums[index] > fromMeters && sums[index] < toMeters).map(([latitude, longitude]) => [latitude, longitude] as [number, number])
  return [[start.latitude, start.longitude], ...inside, [end.latitude, end.longitude]]
}

/** A drive along one road, evenly, between two instants (ms). */
export interface MtmDemoDrive {
  readonly road: MtmDemoRoadId
  readonly departsMs: number
  readonly arrivesMs: number
}

/** Where the drive is at `atMs`: at its start before it departs, at its end once it has arrived. */
export function mtmDemoDrivePosition(drive: MtmDemoDrive, atMs: number): MtmDemoPosition & { readonly meters: number } {
  const share = Math.min(1, Math.max(0, (atMs - drive.departsMs) / (drive.arrivesMs - drive.departsMs)))
  const meters = share * mtmDemoRoadMeters(drive.road)
  return { ...mtmDemoAlongRoad(drive.road, meters), meters }
}
