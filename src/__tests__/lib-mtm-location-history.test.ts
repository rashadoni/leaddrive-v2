import { describe, expect, it } from "vitest"
import {
  calculateHistoryDistance,
  buildHistoryCsv,
  buildHistoryTimeline,
  detectHistoryAnomalies,
  detectHistoryGaps,
  detectHistoryStops,
  downsampleHistoryPoints,
  prepareHistoryPoints,
  type HistoryLocationPoint,
  type HistoryVisit,
} from "@/lib/mtm/location-history"

function point(
  id: string,
  minute: number,
  latitude = 40.4093,
  longitude = 49.8671,
  accuracy: number | null = 8,
): HistoryLocationPoint {
  return {
    id,
    latitude,
    longitude,
    accuracy,
    speed: 0,
    heading: null,
    battery: 80,
    isMoving: false,
    recordedAt: new Date(`2026-07-15T08:${String(minute).padStart(2, "0")}:00.000Z`),
    workdayId: "workday-1",
  }
}

describe("MTM location history calculations", () => {
  it("sorts, deduplicates and filters low-quality points before distance", () => {
    const duplicate = point("duplicate", 0)
    const prepared = prepareHistoryPoints([
      point("later", 10, 40.4103),
      point("first", 0),
      duplicate,
      point("inaccurate", 5, 40.4098, 49.8671, 250),
      point("invalid", 7, 120, 49.8671),
    ], 100)

    expect(prepared.points.map((item) => item.id)).toEqual(["first", "later"])
    expect(prepared).toMatchObject({
      rejectedByAccuracy: 1,
      rejectedInvalid: 1,
      duplicateCount: 1,
    })
    expect(calculateHistoryDistance(prepared.points)).toBeGreaterThan(100)
    expect(calculateHistoryDistance(prepared.points)).toBeLessThan(120)
  })

  it("detects a stop without claiming a visit when no visit fact overlaps", () => {
    const first = point("a", 0)
    const last = point("c", 8, 40.40932)
    first.battery = 100
    last.battery = 99
    const stops = detectHistoryStops({
      points: [first, point("b", 3, 40.40931), last],
      visits: [],
      radiusMeters: 50,
      minimumSeconds: 5 * 60,
      offlineThresholdSeconds: 300,
    })

    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({
      durationSeconds: 480,
      batteryStart: 100,
      batteryEnd: 99,
      visit: null,
      connectivity: "ONLINE",
    })
  })

  it("marks a stop as a confirmed visit only when a stored visit overlaps", () => {
    const visit: HistoryVisit = {
      id: "visit-1",
      customerId: "customer-1",
      status: "CHECKED_OUT",
      checkInAt: new Date("2026-07-15T08:02:00.000Z"),
      checkOutAt: new Date("2026-07-15T08:07:00.000Z"),
      checkInLat: 40.4093,
      checkInLng: 49.8671,
      customer: {
        name: "Clinic 14",
        address: "Baku",
        latitude: 40.4093,
        longitude: 49.8671,
      },
    }
    const [stop] = detectHistoryStops({
      points: [point("a", 0), point("b", 4), point("c", 8)],
      visits: [visit],
      radiusMeters: 50,
      minimumSeconds: 5 * 60,
      offlineThresholdSeconds: 300,
    })

    expect(stop.visit).toEqual({
      id: "visit-1",
      customerId: "customer-1",
      customerName: "Clinic 14",
      customerAddress: "Baku",
      status: "CHECKED_OUT",
      confirmed: true,
    })
  })

  it("reports telemetry gaps and preserves endpoints when downsampling", () => {
    const points = [
      point("a", 0),
      point("b", 1),
      point("c", 2),
      point("d", 20),
      point("e", 21),
    ]
    expect(detectHistoryGaps(points, 300)).toEqual([
      expect.objectContaining({ id: "gap-c-d", durationSeconds: 1_080, reason: "TELEMETRY_GAP" }),
    ])
    expect(downsampleHistoryPoints(points, 3).map((item) => item.id)).toEqual(["a", "c", "e"])
  })

  it("detects impossible jumps, missing segments and low-accuracy evidence deterministically", () => {
    const accepted = [
      point("a", 0),
      point("b", 1, 41.4093, 49.8671),
      point("c", 20, 41.4094, 49.8671),
    ]
    const gaps = detectHistoryGaps(accepted, 300)
    const anomalies = detectHistoryAnomalies({
      acceptedPoints: accepted,
      rawPoints: [...accepted, point("low", 2, 40.5, 49.9, 400)],
      gaps,
      maxAccuracyMeters: 100,
      impossibleSpeedKmh: 180,
    })

    expect(anomalies.map((item) => item.type)).toEqual([
      "IMPOSSIBLE_JUMP",
      "MISSING_SEGMENT",
      "LOW_ACCURACY",
    ])
    expect(anomalies[0].detail.speedKmh).toBeGreaterThan(180)
  })

  it("builds a stable planned-vs-actual timeline and an auditable CSV", () => {
    const timeline = buildHistoryTimeline({
      workday: {
        id: "workday-1",
        startedAt: new Date("2026-07-15T08:00:00.000Z"),
        completedAt: new Date("2026-07-15T18:00:00.000Z"),
      },
      plannedStops: [
        { id: "point-1", plannedTime: new Date("2026-07-15T09:00:00.000Z"), label: "Clinic 14" },
      ],
      visits: [],
      stops: [],
      gaps: [],
      anomalies: [],
    })

    expect(timeline.map((event) => event.kind)).toEqual([
      "WORKDAY_START",
      "PLANNED_STOP",
      "WORKDAY_END",
    ])
    const csv = buildHistoryCsv({
      agentName: "Aysel \"North\"",
      timezone: "Asia/Baku",
      date: "2026-07-15",
      distanceMeters: 1200,
      timeline,
    })
    expect(csv).toContain("\"Aysel \"\"North\"\"\"")
    expect(csv).toContain("\"PLANNED_STOP\"")
    expect(csv).toContain("\"2026-07-15T09:00:00.000Z\"")
  })
})
