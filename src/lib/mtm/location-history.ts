import { calculateDistance } from "@/lib/geo-utils"

export const LOCATION_HISTORY_DISTANCE_FORMULA = "haversine-r6371000-filtered-v1"
export const LOCATION_HISTORY_MAX_RAW_POINTS = 5_001
export const LOCATION_HISTORY_MAX_OUTPUT_POINTS = 1_500

export type HistoryLocationPoint = {
  id: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  battery: number | null
  isMoving: boolean
  recordedAt: Date
  workdayId: string | null
}

export type HistoryVisit = {
  id: string
  customerId: string
  status: string
  checkInAt: Date
  checkOutAt: Date | null
  checkInLat: number | null
  checkInLng: number | null
  customer: {
    name: string
    address: string | null
    latitude: number | null
    longitude: number | null
  }
}

export type HistoryStop = {
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  latitude: number
  longitude: number
  pointCount: number
  averageAccuracy: number | null
  batteryStart: number | null
  batteryEnd: number | null
  connectivity: "ONLINE" | "OFFLINE_GAPS"
  visit: {
    id: string
    customerId: string
    customerName: string
    customerAddress: string | null
    status: string
    confirmed: true
  } | null
}

export type HistoryGap = {
  id: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  reason: "TELEMETRY_GAP"
  startLatitude: number
  startLongitude: number
  endLatitude: number
  endLongitude: number
}

export type HistoryAnomaly = {
  id: string
  type: "IMPOSSIBLE_JUMP" | "LOW_ACCURACY" | "MISSING_SEGMENT"
  startedAt: Date
  endedAt: Date
  detail: {
    distanceMeters?: number
    speedKmh?: number
    accuracyMeters?: number
    durationSeconds?: number
  }
}

export type HistoryTimelineEvent = {
  id: string
  at: Date
  endedAt: Date | null
  kind:
    | "WORKDAY_START"
    | "WORKDAY_END"
    | "PLANNED_STOP"
    | "VISIT"
    | "STOP"
    | "TELEMETRY_GAP"
    | "IMPOSSIBLE_JUMP"
    | "LOW_ACCURACY"
  source: "WORKDAY" | "PLAN" | "VISIT" | "GPS"
  label: string
  relatedId: string | null
  confirmed: boolean
}

function isFiniteCoordinate(point: HistoryLocationPoint): boolean {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90
    && Math.abs(point.longitude) <= 180
}

export function prepareHistoryPoints(
  rows: HistoryLocationPoint[],
  maxAccuracyMeters: number,
): {
  points: HistoryLocationPoint[]
  rejectedByAccuracy: number
  rejectedInvalid: number
  duplicateCount: number
} {
  const sorted = [...rows].sort((a, b) =>
    a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id),
  )
  const seen = new Set<string>()
  const points: HistoryLocationPoint[] = []
  let rejectedByAccuracy = 0
  let rejectedInvalid = 0
  let duplicateCount = 0

  for (const point of sorted) {
    const fingerprint = `${point.recordedAt.toISOString()}:${point.latitude}:${point.longitude}`
    if (seen.has(fingerprint)) {
      duplicateCount += 1
      continue
    }
    seen.add(fingerprint)
    if (!isFiniteCoordinate(point)) {
      rejectedInvalid += 1
      continue
    }
    if (point.accuracy != null && point.accuracy > maxAccuracyMeters) {
      rejectedByAccuracy += 1
      continue
    }
    points.push(point)
  }

  return { points, rejectedByAccuracy, rejectedInvalid, duplicateCount }
}

/** Deterministic first/last-preserving downsampling for a safe map payload. */
export function downsampleHistoryPoints(
  points: HistoryLocationPoint[],
  limit: number,
): HistoryLocationPoint[] {
  if (points.length <= limit) return points
  if (limit <= 1) return points.slice(0, 1)
  const result: HistoryLocationPoint[] = []
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * (points.length - 1) / (limit - 1))
    result.push(points[sourceIndex])
  }
  return result
}

export function calculateHistoryDistance(points: HistoryLocationPoint[]): number {
  let meters = 0
  for (let index = 1; index < points.length; index += 1) {
    meters += calculateDistance(
      points[index - 1].latitude,
      points[index - 1].longitude,
      points[index].latitude,
      points[index].longitude,
    )
  }
  return Math.round(meters)
}

export function detectHistoryGaps(
  points: HistoryLocationPoint[],
  gapThresholdSeconds: number,
): HistoryGap[] {
  const gaps: HistoryGap[] = []
  for (let index = 1; index < points.length; index += 1) {
    const durationSeconds = Math.floor(
      (points[index].recordedAt.getTime() - points[index - 1].recordedAt.getTime()) / 1_000,
    )
    if (durationSeconds > gapThresholdSeconds) {
      gaps.push({
        id: `gap-${points[index - 1].id}-${points[index].id}`,
        startedAt: points[index - 1].recordedAt,
        endedAt: points[index].recordedAt,
        durationSeconds,
        reason: "TELEMETRY_GAP",
        startLatitude: points[index - 1].latitude,
        startLongitude: points[index - 1].longitude,
        endLatitude: points[index].latitude,
        endLongitude: points[index].longitude,
      })
    }
  }
  return gaps
}

export function detectHistoryAnomalies(input: {
  acceptedPoints: HistoryLocationPoint[]
  rawPoints: HistoryLocationPoint[]
  gaps: HistoryGap[]
  maxAccuracyMeters: number
  impossibleSpeedKmh: number
}): HistoryAnomaly[] {
  const anomalies: HistoryAnomaly[] = input.gaps.map((gap) => ({
    id: `missing-${gap.id}`,
    type: "MISSING_SEGMENT",
    startedAt: gap.startedAt,
    endedAt: gap.endedAt,
    detail: { durationSeconds: gap.durationSeconds },
  }))

  for (let index = 1; index < input.acceptedPoints.length; index += 1) {
    const previous = input.acceptedPoints[index - 1]
    const current = input.acceptedPoints[index]
    const elapsedSeconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1_000
    if (elapsedSeconds <= 0) continue
    const distanceMeters = calculateDistance(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    )
    const speedKmh = distanceMeters / elapsedSeconds * 3.6
    if (speedKmh > input.impossibleSpeedKmh) {
      anomalies.push({
        id: `jump-${previous.id}-${current.id}`,
        type: "IMPOSSIBLE_JUMP",
        startedAt: previous.recordedAt,
        endedAt: current.recordedAt,
        detail: {
          distanceMeters: Math.round(distanceMeters),
          speedKmh: Math.round(speedKmh * 10) / 10,
        },
      })
    }
  }

  for (const point of input.rawPoints) {
    if (point.accuracy != null && point.accuracy > input.maxAccuracyMeters) {
      anomalies.push({
        id: `accuracy-${point.id}`,
        type: "LOW_ACCURACY",
        startedAt: point.recordedAt,
        endedAt: point.recordedAt,
        detail: { accuracyMeters: point.accuracy },
      })
    }
  }

  return anomalies.sort((a, b) =>
    a.startedAt.getTime() - b.startedAt.getTime()
    || a.type.localeCompare(b.type)
    || a.id.localeCompare(b.id),
  )
}

function visitOverlapsStop(visit: HistoryVisit, startedAt: Date, endedAt: Date): boolean {
  const visitEnd = visit.checkOutAt ?? visit.checkInAt
  return visit.checkInAt <= endedAt && visitEnd >= startedAt
}

function confirmedVisitForStop(
  visits: HistoryVisit[],
  startedAt: Date,
  endedAt: Date,
): HistoryStop["visit"] {
  const visit = visits.find((candidate) => visitOverlapsStop(candidate, startedAt, endedAt))
  if (!visit) return null
  return {
    id: visit.id,
    customerId: visit.customerId,
    customerName: visit.customer.name,
    customerAddress: visit.customer.address,
    status: visit.status,
    confirmed: true,
  }
}

export function detectHistoryStops(input: {
  points: HistoryLocationPoint[]
  visits: HistoryVisit[]
  radiusMeters: number
  minimumSeconds: number
  offlineThresholdSeconds: number
}): HistoryStop[] {
  const { points, visits, radiusMeters, minimumSeconds, offlineThresholdSeconds } = input
  const stops: HistoryStop[] = []
  let startIndex = 0

  while (startIndex < points.length) {
    const anchor = points[startIndex]
    let endIndex = startIndex
    while (
      endIndex + 1 < points.length
      && calculateDistance(
        anchor.latitude,
        anchor.longitude,
        points[endIndex + 1].latitude,
        points[endIndex + 1].longitude,
      ) <= radiusMeters
    ) {
      endIndex += 1
    }

    const endedAt = points[endIndex].recordedAt
    const durationSeconds = Math.floor((endedAt.getTime() - anchor.recordedAt.getTime()) / 1_000)
    if (endIndex > startIndex && durationSeconds >= minimumSeconds) {
      const cluster = points.slice(startIndex, endIndex + 1)
      const accuracies = cluster.flatMap((point) => point.accuracy == null ? [] : [point.accuracy])
      const batteries = cluster.flatMap((point) => point.battery == null ? [] : [point.battery])
      const hasOfflineGap = cluster.some((point, index) =>
        index > 0
        && point.recordedAt.getTime() - cluster[index - 1].recordedAt.getTime() > offlineThresholdSeconds * 1_000,
      )
      stops.push({
        id: `stop-${anchor.id}-${points[endIndex].id}`,
        startedAt: anchor.recordedAt,
        endedAt,
        durationSeconds,
        latitude: cluster.reduce((sum, point) => sum + point.latitude, 0) / cluster.length,
        longitude: cluster.reduce((sum, point) => sum + point.longitude, 0) / cluster.length,
        pointCount: cluster.length,
        averageAccuracy: accuracies.length
          ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length * 10) / 10
          : null,
        batteryStart: batteries[0] ?? null,
        batteryEnd: batteries.at(-1) ?? null,
        connectivity: hasOfflineGap ? "OFFLINE_GAPS" : "ONLINE",
        visit: confirmedVisitForStop(visits, anchor.recordedAt, endedAt),
      })
      startIndex = endIndex + 1
      continue
    }
    startIndex += 1
  }

  return stops
}

const TIMELINE_PRIORITY: Record<HistoryTimelineEvent["kind"], number> = {
  WORKDAY_START: 10,
  PLANNED_STOP: 20,
  VISIT: 30,
  STOP: 40,
  TELEMETRY_GAP: 50,
  IMPOSSIBLE_JUMP: 60,
  LOW_ACCURACY: 70,
  WORKDAY_END: 80,
}

export function buildHistoryTimeline(input: {
  workday: { id: string; startedAt: Date; completedAt: Date | null } | null
  plannedStops: Array<{ id: string; plannedTime: Date | null; label: string }>
  visits: HistoryVisit[]
  stops: HistoryStop[]
  gaps: HistoryGap[]
  anomalies: HistoryAnomaly[]
}): HistoryTimelineEvent[] {
  const events: HistoryTimelineEvent[] = []
  if (input.workday) {
    events.push({
      id: `workday-start-${input.workday.id}`,
      at: input.workday.startedAt,
      endedAt: null,
      kind: "WORKDAY_START",
      source: "WORKDAY",
      label: "workday_start",
      relatedId: input.workday.id,
      confirmed: true,
    })
    if (input.workday.completedAt) {
      events.push({
        id: `workday-end-${input.workday.id}`,
        at: input.workday.completedAt,
        endedAt: null,
        kind: "WORKDAY_END",
        source: "WORKDAY",
        label: "workday_end",
        relatedId: input.workday.id,
        confirmed: true,
      })
    }
  }
  for (const stop of input.plannedStops) {
    if (!stop.plannedTime) continue
    events.push({
      id: `plan-${stop.id}`,
      at: stop.plannedTime,
      endedAt: null,
      kind: "PLANNED_STOP",
      source: "PLAN",
      label: stop.label,
      relatedId: stop.id,
      confirmed: false,
    })
  }
  for (const visit of input.visits) {
    events.push({
      id: `visit-${visit.id}`,
      at: visit.checkInAt,
      endedAt: visit.checkOutAt,
      kind: "VISIT",
      source: "VISIT",
      label: visit.customer.name,
      relatedId: visit.id,
      confirmed: true,
    })
  }
  for (const stop of input.stops) {
    events.push({
      id: stop.id,
      at: stop.startedAt,
      endedAt: stop.endedAt,
      kind: "STOP",
      source: "GPS",
      label: stop.visit?.customerName ?? "gps_stop",
      relatedId: stop.visit?.id ?? null,
      confirmed: Boolean(stop.visit),
    })
  }
  for (const gap of input.gaps) {
    events.push({
      id: gap.id,
      at: gap.startedAt,
      endedAt: gap.endedAt,
      kind: "TELEMETRY_GAP",
      source: "GPS",
      label: "telemetry_gap",
      relatedId: null,
      confirmed: true,
    })
  }
  for (const anomaly of input.anomalies) {
    if (anomaly.type === "MISSING_SEGMENT") continue // represented by its gap event
    events.push({
      id: anomaly.id,
      at: anomaly.startedAt,
      endedAt: anomaly.endedAt,
      kind: anomaly.type,
      source: "GPS",
      label: anomaly.type.toLowerCase(),
      relatedId: null,
      confirmed: true,
    })
  }
  return events.sort((a, b) =>
    a.at.getTime() - b.at.getTime()
    || TIMELINE_PRIORITY[a.kind] - TIMELINE_PRIORITY[b.kind]
    || a.id.localeCompare(b.id),
  )
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value)
  return `"${text.replaceAll("\"", "\"\"")}"`
}

export function buildHistoryCsv(input: {
  agentName: string
  timezone: string
  date: string
  distanceMeters: number | null
  timeline: HistoryTimelineEvent[]
}): string {
  const rows: unknown[][] = [
    ["Agent", input.agentName],
    ["Date", input.date],
    ["Timezone", input.timezone],
    ["Distance meters", input.distanceMeters ?? "not_calculated"],
    [],
    ["Timestamp UTC", "End UTC", "Source", "Kind", "Label", "Confirmed", "Related ID"],
    ...input.timeline.map((event) => [
      event.at.toISOString(),
      event.endedAt?.toISOString() ?? "",
      event.source,
      event.kind,
      event.label,
      event.confirmed ? "yes" : "no",
      event.relatedId ?? "",
    ]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}
