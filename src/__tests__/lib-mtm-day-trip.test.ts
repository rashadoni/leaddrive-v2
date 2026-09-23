import { describe, expect, it } from "vitest"
import { buildDayTrip, type DayTripEntry } from "@/lib/mtm/day-trip"
import {
  detectHistoryGaps,
  detectHistoryStops,
  type HistoryLocationPoint,
  type HistoryVisit,
} from "@/lib/mtm/location-history"

/**
 * Owner 2026-09-22: «if I sell it as a TMS — how will managers see which way
 * they drove to customers». The day is built from a generated track run
 * through the same stop and gap detectors the API uses, so the test checks
 * what a manager would read, not the shape of a call.
 */
const DAY = "2026-09-22"
const at = (clock: string) => new Date(`${DAY}T${clock}:00.000Z`)

let sequence = 0
function track(from: string, to: string, start: [number, number], end: [number, number], stepSeconds = 30): HistoryLocationPoint[] {
  const t0 = at(from).getTime()
  const t1 = at(to).getTime()
  const steps = Math.max(1, Math.round((t1 - t0) / (stepSeconds * 1_000)))
  return Array.from({ length: steps + 1 }, (_, index) => ({
    id: `p${String(sequence++).padStart(5, "0")}`,
    latitude: start[0] + (end[0] - start[0]) * index / steps,
    longitude: start[1] + (end[1] - start[1]) * index / steps,
    accuracy: 8,
    speed: null,
    heading: null,
    battery: 80,
    isMoving: start[0] !== end[0],
    recordedAt: new Date(t0 + (t1 - t0) * index / steps),
    workdayId: "w1",
  }))
}

const HOME: [number, number] = [40.3800, 49.8300]
const PHARMACY: [number, number] = [40.4300, 49.8700] // ≈ 6.5 km from home
const CLINIC: [number, number] = [40.4100, 49.9300]   // ≈ 5.5 km further

function visit(id: string, name: string, place: [number, number], checkIn: string, checkOut: string | null): HistoryVisit {
  return {
    id,
    customerId: `c-${id}`,
    status: checkOut ? "CHECKED_OUT" : "CHECKED_IN",
    checkInAt: at(checkIn),
    checkOutAt: checkOut ? at(checkOut) : null,
    checkInLat: place[0],
    checkInLng: place[1],
    customer: { name, address: null, latitude: place[0], longitude: place[1] },
  }
}

function dayOf(points: HistoryLocationPoint[], visits: HistoryVisit[], workday = { startedAt: at("09:00"), completedAt: at("12:00") as Date | null }) {
  const unique = points.filter((point, index) => index === 0 || point.recordedAt > points[index - 1].recordedAt)
  const gaps = detectHistoryGaps(unique, 300)
  const stops = detectHistoryStops({ points: unique, visits, radiusMeters: 80, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
  return buildDayTrip({ points: unique, stops, visits, gaps, workday })
}

const describeEntry = (entry: DayTripEntry) => {
  switch (entry.kind) {
    case "START":
    case "END":
      return `${entry.kind} ${entry.at.toISOString().slice(11, 16)} ${entry.source}`
    case "STAY":
      return `STAY ${entry.startedAt.toISOString().slice(11, 16)}-${entry.endedAt.toISOString().slice(11, 16)} ${entry.visit?.customerName ?? "—"}`
    case "MOVE":
      return `MOVE ${entry.startedAt.toISOString().slice(11, 16)}-${entry.endedAt.toISOString().slice(11, 16)}`
    case "GAP":
      return `GAP ${entry.startedAt.toISOString().slice(11, 16)}-${entry.endedAt.toISOString().slice(11, 16)} ${entry.reason}`
  }
}

describe("the day as a trip", () => {
  it("reads left home → drove → customer → drove → no signal → customer → closed the day", () => {
    const points = [
      ...track("09:00", "09:08", HOME, HOME),
      ...track("09:08", "09:30", HOME, PHARMACY),
      ...track("09:30", "09:55", PHARMACY, PHARMACY),
      ...track("09:55", "10:10", PHARMACY, [40.42, 49.90]),
      // The phone falls silent on the way and wakes up at the clinic door.
      ...track("10:50", "11:30", CLINIC, CLINIC),
    ]
    const visits = [
      visit("v1", "Aptek 24", PHARMACY, "09:31", "09:54"),
      visit("v2", "Klinika Mərkəz", CLINIC, "10:52", "11:28"),
    ]

    const trip = dayOf(points, visits)
    expect(trip.entries.map(describeEntry)).toEqual([
      "START 09:00 WORKDAY",
      "STAY 09:00-09:08 —",
      "MOVE 09:08-09:30",
      "STAY 09:30-09:55 Aptek 24",
      "MOVE 09:55-10:10",
      "GAP 10:10-10:50 TELEMETRY_GAP",
      "STAY 10:50-11:30 Klinika Mərkəz",
      "MOVE 11:30-12:00",
      "END 12:00 WORKDAY",
    ])

    const [toPharmacy] = trip.entries.filter((entry) => entry.kind === "MOVE")
    expect(toPharmacy.kind === "MOVE" && toPharmacy.distanceMeters).toBeGreaterThan(6_000)
    expect(toPharmacy.kind === "MOVE" && toPharmacy.distanceMeters).toBeLessThan(7_000)
    const gap = trip.entries.find((entry) => entry.kind === "GAP")
    // How far the agent got while nothing was recorded.
    expect(gap?.kind === "GAP" && gap.displacementMeters).toBeGreaterThan(2_000)
    expect(trip.summary.visitCount).toBe(2)
    expect(trip.summary.unknownSeconds).toBe(40 * 60)
  })

  it("keeps a visit made with the phone silent, and does not call its silence a hole", () => {
    const points = [
      ...track("09:00", "09:20", HOME, PHARMACY),
      ...track("10:30", "10:45", PHARMACY, CLINIC),
    ]
    const trip = dayOf(points, [visit("v1", "Aptek 24", PHARMACY, "09:25", "10:25")], { startedAt: at("09:00"), completedAt: null })

    expect(trip.entries.map(describeEntry)).toEqual([
      "START 09:00 WORKDAY",
      "MOVE 09:00-09:20",
      // Silent from 09:20 to 10:30, but the fixes on both sides are at the
      // pharmacy and the visit sits inside: it is a stay, not a hole.
      "STAY 09:20-10:30 Aptek 24",
      "MOVE 10:30-10:45",
      // Day still open: the end is the last signal, not a closed workday.
      "END 10:45 GPS",
    ])
    expect(trip.summary.unknownSeconds).toBe(0)
  })

  it("keeps a visit no GPS stop covers", () => {
    const points = [
      ...track("09:00", "09:20", HOME, PHARMACY),
      ...track("10:30", "10:45", CLINIC, CLINIC),
    ]
    const trip = dayOf(points, [visit("v1", "Aptek 24", PHARMACY, "09:25", "10:05")], { startedAt: at("09:00"), completedAt: null })
    expect(trip.entries.map(describeEntry)).toEqual([
      "START 09:00 WORKDAY",
      "MOVE 09:00-09:20",
      "GAP 09:20-09:25 TELEMETRY_GAP",
      "STAY 09:25-10:05 Aptek 24",
      "GAP 10:05-10:30 TELEMETRY_GAP",
      "STAY 10:30-10:45 —",
      "END 10:45 GPS",
    ])
    expect(trip.summary.unknownSeconds).toBe(30 * 60)
  })

  it("names a break the agent pressed a break, not missing data", () => {
    const points = [
      ...track("09:00", "09:30", HOME, PHARMACY),
      ...track("10:30", "10:40", PHARMACY, PHARMACY),
    ]
    const unique = points.filter((point, index) => index === 0 || point.recordedAt > points[index - 1].recordedAt)
    const gaps = detectHistoryGaps(unique, 300, [{ startedAt: at("09:31"), endedAt: at("10:30") }])
    const trip = buildDayTrip({ points: unique, stops: [], visits: [], gaps, workday: null })
    expect(trip.entries.find((entry) => entry.kind === "GAP")).toMatchObject({ reason: "WORKDAY_PAUSED" })
    expect(trip.summary.unknownSeconds).toBe(0)
    expect(trip.summary.pausedSeconds).toBe(60 * 60)
    expect(trip.entries[0]).toMatchObject({ kind: "START", source: "GPS" })
  })

  it("is empty for a day without a single fix, workday or visit", () => {
    expect(buildDayTrip({ points: [], stops: [], visits: [], gaps: [], workday: null }).entries).toEqual([])
  })
})

describe("the day's route on the history page", () => {
  it("leads the side column, and a picked leg is drawn and framed on the map", async () => {
    const { readFileSync } = await import("node:fs")
    const panel = readFileSync("src/components/mtm/location-history-panel.tsx", "utf8")
    const map = readFileSync("src/components/mtm/location-history-map.tsx", "utf8")
    const route = readFileSync("src/app/api/v1/mtm/location-history/route.ts", "utf8")
    expect(route).toContain("const trip = rawTruncated ? null : buildDayTrip({")
    expect(route).toContain("points: prepared.points,")
    expect(panel.indexOf("<DayTripLedger")).toBeLessThan(panel.indexOf('t("stopDetails")'))
    expect(panel).toContain("focus={tripFocus}")
    expect(map).toContain("<ResizeAndFit coordinates={focusFrame ?? coordinates}")
    for (const locale of ["az", "ru", "en"]) {
      const trip = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmMap.history.trip
      // Honest about what the line is until the owner picks a road-snapping service.
      expect(trip.straightLineNote).toEqual(expect.any(String))
      expect(trip.summaryVisits).toContain("plural")
    }
  })
})
