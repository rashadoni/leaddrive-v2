/**
 * Elvin's day as the evening's history shows it («Tarixçə» on the live map):
 * the phone's fixes from the start of the workday to its end, his visits and
 * his lunch break — and from them, by the product's own history functions
 * (`src/lib/mtm/location-history.ts`, `day-trip.ts`, `road-distance.ts`), the
 * stops, the silences, the kilometres and the day told as legs. Nothing here
 * is typed in but the fixes and the visits; every figure on the screen is the
 * product's arithmetic over them.
 *
 * The fixes lie on real Baku streets (`mtm-demo-roads.ts`), so the kilometres
 * are along the roads, as the product counts them where its OSRM answered.
 *
 * The owner's rule on breaks: nothing is recorded during one. The phone's
 * last fix is the one before PAUSE and the next is the one at RESUME, both
 * outside it (`src/lib/mtm/workday-pauses.ts`: the seconds at either edge are
 * work); the screens say how long the break was, never where.
 */
import { calculateDistance } from "@/lib/geo-utils"
import type { DayTripData } from "@/components/mtm/day-trip-ledger"
import { buildDayTrip } from "@/lib/mtm/day-trip"
import {
  detectHistoryAnomalies,
  detectHistoryGaps,
  detectHistoryStops,
  prepareHistoryPoints,
  type HistoryLocationPoint,
  type HistoryPauseInterval,
  type HistoryVisit,
} from "@/lib/mtm/location-history"
import { drivingDistanceMeters } from "@/lib/mtm/road-distance"
import { MTM_DEMO_ELVIN_DAY, mtmDemoAt, mtmDemoNearPlace, mtmDemoPlace, mtmDemoVisit } from "./mtm-demo-data"
import { mtmDemoAlongRoad, mtmDemoRoadMeters, mtmDemoRoadStretch, type MtmDemoPosition } from "./mtm-demo-motion"
import { MTM_DEMO_ROADS, type MtmDemoRoadId } from "./mtm-demo-roads"

const SECOND = 1_000
const MINUTE = 60 * SECOND

/**
 * The organization's history settings, at the product's defaults
 * (`MTM_SETTING_DEFAULTS` in src/lib/mtm-settings.ts — a test keeps them equal).
 */
export const MTM_DEMO_HISTORY_POLICY = {
  maxAccuracyMeters: 100,
  stopRadiusMeters: 50,
  stopMinimumMinutes: 5,
  offlineThresholdSeconds: 300,
  gpsInterval: 30,
} as const

/** Elvin's workday and his one break (Baku time). */
export const MTM_DEMO_ELVIN_WORKDAY = { started: "09:02", paused: "12:26", resumed: "13:04", finished: "14:40" } as const

/** After the break he is already some way down the street to the next clinic: the first fix is not where the last one was. */
const RESUMED_ALONG_METERS = 420
/**
 * Closer than this to the door he parks at or leaves from, a drive sends no
 * fix: those last steps belong to the stop (the history's stop radius is 50 m),
 * and a fix on the street a few metres from it would split one stop in two.
 */
const AT_THE_DOOR_METERS = 60

type Piece =
  | { readonly kind: "stay"; readonly at: MtmDemoPosition; readonly from: string; readonly to: string; readonly everySeconds: number }
  | { readonly kind: "drive"; readonly road: MtmDemoRoadId; readonly from: string; readonly to: string; readonly fromMeters?: number }

/** Where the phone checked in at each stop: the same fixes «Vizitlər» shows for the morning. */
function elvinFix(index: number, today: string): MtmDemoPosition {
  const place = mtmDemoPlace(MTM_DEMO_ELVIN_DAY[index].place)
  if (index === 0) {
    const reviewed = mtmDemoVisit(today).placeInput
    return { latitude: reviewed.checkInLat!, longitude: reviewed.checkInLng! }
  }
  return mtmDemoNearPlace(place, index)
}

function roadEnd(road: MtmDemoRoadId, which: "start" | "end"): MtmDemoPosition {
  const vertices = MTM_DEMO_ROADS[road]
  const [latitude, longitude] = vertices[which === "start" ? 0 : vertices.length - 1]
  return { latitude, longitude }
}

/** The day, piece by piece. Times are Baku wall-clock; a piece's last fix is just before the next one's first. */
function elvinPieces(today: string): Piece[] {
  const fix = (index: number) => elvinFix(index, today)
  const day = MTM_DEMO_ELVIN_DAY
  return [
    { kind: "stay", at: roadEnd("startToNar", "start"), from: MTM_DEMO_ELVIN_WORKDAY.started, to: "09:04", everySeconds: 60 },
    { kind: "drive", road: "startToNar", from: "09:05", to: "09:31" },
    { kind: "stay", at: fix(0), from: "09:32", to: day[0].checkOut, everySeconds: 120 },
    { kind: "drive", road: "narToAptPlus", from: "09:59", to: "10:05" },
    { kind: "stay", at: fix(1), from: "10:06", to: day[1].checkOut, everySeconds: 120 },
    { kind: "drive", road: "aptPlusToRespublika", from: "10:52", to: "11:05" },
    { kind: "stay", at: fix(2), from: "11:06", to: day[2].checkOut, everySeconds: 120 },
    { kind: "drive", road: "respublikaToSefa", from: "11:30", to: "11:49" },
    { kind: "stay", at: fix(3), from: "11:50", to: "12:25", everySeconds: 120 },
    // 12:26–13:04: the break. Not one fix.
    { kind: "drive", road: "sefaToUsaq", from: MTM_DEMO_ELVIN_WORKDAY.resumed, to: "13:20", fromMeters: RESUMED_ALONG_METERS },
    { kind: "stay", at: fix(4), from: "13:21", to: day[4].checkOut, everySeconds: 120 },
    { kind: "drive", road: "usaqToDerman", from: "13:53", to: "14:05" },
    { kind: "stay", at: fix(5), from: "14:06", to: "14:38", everySeconds: 120 },
  ]
}

/** A few metres of drift around a spot, the same on every render. */
function drift(at: MtmDemoPosition, seed: number): MtmDemoPosition {
  const angle = (seed * 137.5 * Math.PI) / 180
  const metres = 2 + (seed % 3)
  return {
    latitude: at.latitude + (metres * Math.cos(angle)) / 111_320,
    longitude: at.longitude + (metres * Math.sin(angle)) / (111_320 * Math.cos((at.latitude * Math.PI) / 180)),
  }
}

export interface MtmDemoElvinHistory {
  readonly points: HistoryLocationPoint[]
  /** Road metres arriving at each fix, where its step is along a street (or, across the break, the street he is known to have driven). */
  readonly roadSteps: Array<number | null>
  readonly visits: HistoryVisit[]
  readonly pauses: HistoryPauseInterval[]
  readonly workday: { startedAt: Date; completedAt: Date }
}

/** The fixes and the visits — the only facts of the evening's screen. */
export function mtmDemoElvinFacts(today: string): MtmDemoElvinHistory {
  const at = (hhmm: string) => Date.parse(mtmDemoAt(today, hhmm))
  const startMs = at(MTM_DEMO_ELVIN_WORKDAY.started)
  const endMs = at(MTM_DEMO_ELVIN_WORKDAY.finished)
  const battery = (ms: number) => Math.round(94 - ((ms - startMs) / (endMs - startMs)) * 32)
  const points: HistoryLocationPoint[] = []
  const roadSteps: Array<number | null> = []
  const push = (position: MtmDemoPosition, ms: number, moving: boolean, speed: number, roadStep: number | null) => {
    points.push({
      id: `elvin-${points.length}`,
      latitude: Math.round(position.latitude * 1e6) / 1e6,
      longitude: Math.round(position.longitude * 1e6) / 1e6,
      accuracy: moving ? 6 + (points.length % 5) : 9 + (points.length % 6),
      speed: moving ? Math.round(speed * 10) / 10 : 0,
      heading: null,
      battery: battery(ms),
      isMoving: moving,
      recordedAt: new Date(ms),
      workdayId: "workday-elvin",
    })
    roadSteps.push(roadStep)
  }

  const pieces = elvinPieces(today)
  pieces.forEach((piece, index) => {
    const from = at(piece.from)
    const to = at(piece.to)
    if (piece.kind === "stay") {
      for (let ms = from, seed = 0; ms <= to; ms += piece.everySeconds * SECOND, seed += 1) push(drift(piece.at, seed + points.length), ms, false, 0, null)
      return
    }
    const doors = [pieces[index - 1], pieces[index + 1]].flatMap((neighbour) => neighbour?.kind === "stay" ? [neighbour.at] : [])
    const startMeters = piece.fromMeters ?? 0
    const length = mtmDemoRoadMeters(piece.road) - startMeters
    const speed = length / ((to - from) / SECOND)
    let previousMeters: number | null = null
    for (let ms = from; ms <= to; ms += MTM_DEMO_HISTORY_POLICY.gpsInterval * SECOND) {
      const meters = startMeters + ((ms - from) / (to - from)) * length
      const position = mtmDemoAlongRoad(piece.road, meters)
      if (doors.some((door) => mtmDemoMetresBetween(door, position) < AT_THE_DOOR_METERS)) continue
      // The first fix of a drive: from the door to the street is a few steps,
      // straight; across the break, the street from the clinic to here was driven.
      const step = previousMeters === null ? (piece.fromMeters ? piece.fromMeters : null) : meters - previousMeters
      push(position, ms, true, speed, step)
      previousMeters = meters
    }
  })

  const day = MTM_DEMO_ELVIN_DAY
  const visits: HistoryVisit[] = day.map((stop, index) => {
    const place = mtmDemoPlace(stop.place)
    const fix = elvinFix(index, today)
    return {
      id: `visit-elvin-${index}`,
      customerId: place.id,
      status: "CHECKED_OUT",
      checkInAt: new Date(at(stop.checkIn)),
      checkOutAt: new Date(at(stop.checkOut)),
      checkInLat: fix.latitude,
      checkInLng: fix.longitude,
      customer: { name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude },
    }
  })

  return {
    points,
    roadSteps,
    visits,
    pauses: [{ startedAt: new Date(at(MTM_DEMO_ELVIN_WORKDAY.paused)), endedAt: new Date(at(MTM_DEMO_ELVIN_WORKDAY.resumed)) }],
    workday: { startedAt: new Date(startMs), completedAt: new Date(endMs) },
  }
}

/** The answer of the history API for Elvin's day, as it arrives over JSON — run through the product's own functions. */
export function mtmDemoElvinHistoryView(today: string) {
  const facts = mtmDemoElvinFacts(today)
  const policy = MTM_DEMO_HISTORY_POLICY
  const prepared = prepareHistoryPoints(facts.points, policy.maxAccuracyMeters)
  const gapThresholdSeconds = Math.max(policy.offlineThresholdSeconds, policy.gpsInterval * 3)
  const gaps = detectHistoryGaps(prepared.points, gapThresholdSeconds, facts.pauses)
  const stops = detectHistoryStops({
    points: prepared.points,
    visits: facts.visits,
    radiusMeters: policy.stopRadiusMeters,
    minimumSeconds: policy.stopMinimumMinutes * 60,
    offlineThresholdSeconds: policy.offlineThresholdSeconds,
  })
  const anomalies = detectHistoryAnomalies({ acceptedPoints: prepared.points, rawPoints: facts.points, gaps, maxAccuracyMeters: policy.maxAccuracyMeters, impossibleSpeedKmh: 180 })
  const trip = buildDayTrip({ points: prepared.points, stops, visits: facts.visits, gaps, workday: facts.workday, roadSteps: facts.roadSteps })
  const json = <T,>(value: unknown) => JSON.parse(JSON.stringify(value)) as T
  const first = facts.points[0]
  const last = facts.points[facts.points.length - 1]
  const day = MTM_DEMO_ELVIN_DAY

  // The track along the streets: each drive's stretch of its road.
  const segments = elvinPieces(today).flatMap((piece) => piece.kind === "drive"
    ? [mtmDemoRoadStretch(piece.road, piece.fromMeters ?? 0, mtmDemoRoadMeters(piece.road))]
    : [])

  return {
    policy: { ...policy, gapThresholdSeconds },
    summary: {
      distanceMeters: drivingDistanceMeters(prepared.points, facts.roadSteps),
      stopCount: stops.length,
      visitCount: facts.visits.length,
      gapCount: gaps.filter((gap) => gap.reason === "TELEMETRY_GAP").length,
      pausedGapCount: gaps.filter((gap) => gap.reason === "WORKDAY_PAUSED").length,
      anomalyCount: anomalies.length,
      acceptedPointCount: prepared.points.length,
    },
    points: json<Array<{ id: string; latitude: number; longitude: number; accuracy: number | null; battery: number | null; recordedAt: string; speed: number | null; isMoving: boolean }>>(prepared.points),
    stops: json<Array<{ id: string; latitude: number; longitude: number; startedAt: string; endedAt: string; durationSeconds: number; averageAccuracy: number | null; batteryStart: number | null; batteryEnd: number | null; connectivity: "ONLINE" | "OFFLINE_GAPS"; visit: { customerName: string; customerAddress: string | null; confirmed: true } | null }>>(stops),
    gaps: json<Array<{ id: string; startedAt: string; endedAt: string; durationSeconds: number; reason: "TELEMETRY_GAP" | "WORKDAY_PAUSED"; startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number }>>(gaps),
    visits: json<Array<{ id: string; checkInAt: string; checkInLat: number | null; checkInLng: number | null; customer: { name: string; latitude: number | null; longitude: number | null } }>>(facts.visits),
    workday: {
      startedAt: facts.workday.startedAt.toISOString(),
      completedAt: facts.workday.completedAt.toISOString(),
      startLatitude: first.latitude,
      startLongitude: first.longitude,
      endLatitude: last.latitude,
      endLongitude: last.longitude,
    },
    plannedRoutes: [{
      id: "route-elvin",
      points: day.map((stop, index) => {
        const place = mtmDemoPlace(stop.place)
        return { id: `rp-elvin-${index}`, orderIndex: index, status: "VISITED" as const, plannedTime: mtmDemoAt(today, stop.planned), label: place.name, customer: { latitude: place.latitude, longitude: place.longitude } }
      }),
    }],
    matchedTrack: { segments },
    trip: json<DayTripData>(trip),
  }
}

export type MtmDemoElvinHistoryView = ReturnType<typeof mtmDemoElvinHistoryView>

/** Straight metres between two spots — for tests that the break's two edges are far enough apart to be two places. */
export function mtmDemoMetresBetween(a: MtmDemoPosition, b: MtmDemoPosition): number {
  return calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude)
}
