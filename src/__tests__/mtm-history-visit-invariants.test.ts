// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import { DayTripLedger, type DayTripData } from "@/components/mtm/day-trip-ledger"
import { buildDayTrip, type DayTrip, type DayTripEntry } from "@/lib/mtm/day-trip"
import {
  detectHistoryGaps,
  detectHistoryStops,
  type HistoryLocationPoint,
  type HistoryPauseInterval,
  type HistoryVisit,
} from "@/lib/mtm/location-history"

/**
 * «Tarixçə» on /mtm/map, 2026-10-20: two visits at one place, one after the
 * other — two doctors in one clinic — and the day's route named only the
 * first. One GPS stop covered both; the stop took the first visit it touched,
 * and a visit touching a stop already named was dropped. The days below are
 * fixes run through the same gap and stop detectors as the API, at the
 * product's default policy, and the checks are what a manager reads: every
 * visit named on exactly one row, and none of a visit's time on site told as
 * a drive.
 */
const DAY = "2026-10-20"
const at = (clock: string) => new Date(`${DAY}T${clock.length === 5 ? `${clock}:00` : clock}.000Z`)
const ms = (clock: string) => at(clock).getTime()
const hhmmss = (date: Date) => date.toISOString().slice(11, 19)

type Spot = [number, number]
/** `meters` north of a spot. */
const north = ([latitude, longitude]: Spot, meters: number): Spot => [latitude + meters / 111_320, longitude]

const HOME: Spot = [40.3800, 49.8300]
const CLINIC: Spot = [40.4300, 49.8700] // ≈ 6.5 km from home
const PHARMACY: Spot = [40.4100, 49.9300] // ≈ 5.5 km further

let sequence = 0
/** A fix every 30 s from `from` to `to`, moving evenly from `start` to `end`. */
function fixes(from: string, to: string, start: Spot, end: Spot = start): HistoryLocationPoint[] {
  const t0 = ms(from)
  const t1 = ms(to)
  const steps = Math.max(1, Math.round((t1 - t0) / 30_000))
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

function visit(id: string, name: string, place: Spot, checkIn: string, checkOut: string | null, status?: string): HistoryVisit {
  return {
    id,
    customerId: `c-${id}`,
    status: status ?? (checkOut ? "CHECKED_OUT" : "CHECKED_IN"),
    checkInAt: at(checkIn),
    checkOutAt: checkOut ? at(checkOut) : null,
    checkInLat: place[0],
    checkInLng: place[1],
    customer: { name, address: null, latitude: place[0], longitude: place[1] },
  }
}

/** The day as History builds it: MTM_SETTING_DEFAULTS (50 m, 5 min, 300 s offline, 30 s GPS). */
function dayOf(input: {
  points: HistoryLocationPoint[]
  visits: HistoryVisit[]
  pauses?: HistoryPauseInterval[]
  workday?: { startedAt: Date; completedAt: Date | null }
}): DayTrip {
  const points = input.points.filter((point, index) => index === 0 || point.recordedAt > input.points[index - 1].recordedAt)
  const gaps = detectHistoryGaps(points, Math.max(300, 30 * 3), input.pauses ?? [])
  const stops = detectHistoryStops({ points, visits: input.visits, radiusMeters: 50, minimumSeconds: 5 * 60, offlineThresholdSeconds: 300 })
  return buildDayTrip({
    points,
    stops,
    visits: input.visits,
    gaps,
    workday: input.workday ?? { startedAt: at("09:30"), completedAt: at("12:30") },
  })
}

const told = (entry: DayTripEntry) => {
  switch (entry.kind) {
    case "START":
    case "END":
      return `${entry.kind} ${hhmmss(entry.at)}`
    case "STAY":
      return `STAY ${hhmmss(entry.startedAt)}-${hhmmss(entry.endedAt)} ${entry.afterBreak ? "(same place, after the break)" : entry.visit?.customerName ?? "—"}`
    case "MOVE":
      return `MOVE ${hhmmss(entry.startedAt)}-${hhmmss(entry.endedAt)}`
    case "GAP":
      return `GAP ${hhmmss(entry.startedAt)}-${hhmmss(entry.endedAt)} ${entry.reason}`
  }
}

/**
 * What must hold for every day: each visit named on exactly one row (other
 * rows of it only «after the break»), counted once, no row of the day
 * overlapping another, and — while the fixes keep him at the place — not a
 * second of a visit's check-in..check-out told as a drive.
 */
function expectEveryVisitToldOnce(trip: DayTrip, visits: HistoryVisit[]) {
  const shown = visits.filter((item) => item.status !== "CANCELLED")
  for (const item of shown) {
    const rows = trip.entries.filter((entry) => entry.kind === "STAY" && entry.visit?.id === item.id)
    expect(rows.filter((row) => row.kind === "STAY" && !row.afterBreak), `${item.id} named once`).toHaveLength(1)
    const from = item.checkInAt.getTime()
    const to = item.checkOutAt?.getTime() ?? from
    for (const move of trip.entries.filter((entry) => entry.kind === "MOVE")) {
      const overlap = Math.min(to, move.endedAt.getTime()) - Math.max(from, move.startedAt.getTime())
      expect(overlap, `${item.id} told as a drive by ${told(move)}`).toBeLessThanOrEqual(0)
    }
  }
  expect(trip.summary.visitCount).toBe(shown.length)
  const legs = trip.entries.filter((entry): entry is Exclude<DayTripEntry, { kind: "START" | "END" }> => !("at" in entry))
  for (let index = 1; index < legs.length; index += 1) {
    expect(legs[index].startedAt.getTime(), `${told(legs[index])} after ${told(legs[index - 1])}`)
      .toBeGreaterThanOrEqual(legs[index - 1].endedAt.getTime())
  }
}

/** Home → the clinic for 10:00:30, at the clinic (fixes `atClinic`), then on to the pharmacy. */
function clinicDay(atClinic: HistoryLocationPoint[], leaveAt = "11:30", leaveFrom: Spot = CLINIC) {
  return [
    ...fixes("09:30", "10:00:30", HOME, CLINIC),
    ...atClinic,
    ...fixes(leaveAt, "11:50", leaveFrom, PHARMACY),
    ...fixes("11:50", "12:20", PHARMACY),
  ]
}

describe("two visits at one place, one after the other", () => {
  it("names both, each by its own check-in and check-out — no break", () => {
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "11:00"),
      visit("v2", "Dr. Həsənov", CLINIC, "11:00:30", "11:30"),
    ]
    const trip = dayOf({ points: clinicDay(fixes("10:00:30", "11:30", CLINIC)), visits })

    expect(trip.entries.map(told)).toEqual([
      "START 09:30:00",
      "MOVE 09:30:00-10:00:30",
      // The half minute between them is the first's leaving, not a row.
      "STAY 10:00:30-11:00:30 Dr. Əliyeva",
      "STAY 11:00:30-11:30:00 Dr. Həsənov",
      "MOVE 11:30:00-11:50:00",
      "STAY 11:50:00-12:20:00 —",
      "END 12:30:00",
    ])
    expectEveryVisitToldOnce(trip, visits)
  })

  it("names both when a break fell inside the first and one stop spans it", () => {
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "11:00"),
      visit("v2", "Dr. Həsənov", CLINIC, "11:00:30", "11:30"),
    ]
    const trip = dayOf({
      points: clinicDay([...fixes("10:00:30", "10:20", CLINIC), ...fixes("10:40", "11:30", CLINIC)]),
      visits,
      pauses: [{ startedAt: at("10:20"), endedAt: at("10:40") }],
    })

    expect(trip.entries.filter((entry) => entry.kind === "STAY" && entry.visit).map(told)).toEqual([
      // A break taken standing still is part of the stop, as before.
      "STAY 10:00:30-11:00:30 Dr. Əliyeva",
      "STAY 11:00:30-11:30:00 Dr. Həsənov",
    ])
    expectEveryVisitToldOnce(trip, visits)
  })

  it("names the first once when the fixes after a break inside it drift off the stop", () => {
    // 90 m: beyond the 50 m stop radius, so a second stop, yet the same place.
    const drifted = north(CLINIC, 90)
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "11:00"),
      visit("v2", "Dr. Həsənov", CLINIC, "11:00:30", "11:30"),
    ]
    const trip = dayOf({
      points: clinicDay([...fixes("10:00:30", "10:20", CLINIC), ...fixes("10:40", "11:30", drifted)], "11:30", drifted),
      visits,
      pauses: [{ startedAt: at("10:20"), endedAt: at("10:40") }],
    })

    expect(trip.entries.map(told).slice(1, 6)).toEqual([
      "MOVE 09:30:00-10:00:30",
      "STAY 10:00:30-10:20:00 Dr. Əliyeva",
      "GAP 10:20:00-10:40:00 WORKDAY_PAUSED",
      "STAY 10:40:00-11:00:30 (same place, after the break)",
      "STAY 11:00:30-11:30:00 Dr. Həsənov",
    ])
    expect(trip.summary.pausedSeconds).toBe(20 * 60)
    expectEveryVisitToldOnce(trip, visits)
  })

  for (const [where, meters] of [["at the same spot", 0], ["100 m away", 100]] as const) {
    it(`names the second when the first is checked out just after a break and the second starts ${where}`, () => {
      const second = north(CLINIC, meters)
      const visits = [
        visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "10:42"),
        visit("v2", "Dr. Həsənov", second, "10:43", "11:30"),
      ]
      const trip = dayOf({
        points: clinicDay([...fixes("10:00:30", "10:20", CLINIC), ...fixes("10:40", "11:30", second)], "11:30", second),
        visits,
        pauses: [{ startedAt: at("10:20"), endedAt: at("10:40") }],
      })

      const named = trip.entries.filter((entry) => entry.kind === "STAY" && entry.visit && !entry.afterBreak)
      expect(named.map(told)).toEqual([
        expect.stringMatching(/^STAY 10:00:30-\S+ Dr\. Əliyeva$/),
        expect.stringMatching(/^STAY \S+-11:30:00 Dr\. Həsənov$/),
      ])
      const v2 = named[1]
      expect(v2.kind === "STAY" && v2.startedAt.getTime()).toBeLessThanOrEqual(ms("10:43"))
      expectEveryVisitToldOnce(trip, visits)
    })
  }

  it("names both when the first was never checked out", () => {
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", null),
      visit("v2", "Dr. Həsənov", CLINIC, "11:00:30", "11:30"),
    ]
    const trip = dayOf({ points: clinicDay(fixes("10:00:30", "11:30", CLINIC)), visits })

    expect(trip.entries.filter((entry) => entry.kind === "STAY" && entry.visit).map(told)).toEqual([
      // The open visit ends where the next one begins.
      "STAY 10:00:30-11:00:30 Dr. Əliyeva",
      "STAY 11:00:30-11:30:00 Dr. Həsənov",
    ])
    expectEveryVisitToldOnce(trip, visits)
  })

  it("tells a long wait between them as a stand of its own, not as the first visit", () => {
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "10:30"),
      visit("v2", "Dr. Həsənov", CLINIC, "11:00", "11:30"),
    ]
    const trip = dayOf({ points: clinicDay(fixes("10:00:30", "11:30", CLINIC)), visits })

    expect(trip.entries.map(told).slice(2, 5)).toEqual([
      "STAY 10:00:30-10:30:00 Dr. Əliyeva",
      "STAY 10:30:00-11:00:00 —",
      "STAY 11:00:00-11:30:00 Dr. Həsənov",
    ])
    expectEveryVisitToldOnce(trip, visits)
  })

  it("leaves out a cancelled visit and names the other", () => {
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "10:05", "CANCELLED"),
      visit("v2", "Dr. Həsənov", CLINIC, "10:10", "11:30"),
    ]
    const trip = dayOf({ points: clinicDay(fixes("10:00:30", "11:30", CLINIC)), visits })

    expect(trip.entries.filter((entry) => entry.kind === "STAY" && entry.visit).map(told)).toEqual([
      "STAY 10:00:30-11:30:00 Dr. Həsənov",
    ])
    expectEveryVisitToldOnce(trip, visits)
  })
})

describe("a visit's time is what the fixes allow", () => {
  it("does not let a check-out forgotten until the evening swallow the day's drives", () => {
    const visits = [
      visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "16:00"),
      visit("v2", "Aptek 24", PHARMACY, "11:55", "12:15"),
    ]
    const trip = dayOf({ points: clinicDay(fixes("10:00:30", "11:30", CLINIC)), visits })

    expect(trip.entries.map(told)).toEqual([
      "START 09:30:00",
      "MOVE 09:30:00-10:00:30",
      // Seen going at 11:30:30 (the fix then is still within 150 m of the
      // door): the visit's time on site ends there, not at 16:00.
      "STAY 10:00:30-11:30:30 Dr. Əliyeva",
      "MOVE 11:30:30-11:50:00",
      "STAY 11:50:00-12:20:00 Aptek 24",
      "END 12:30:00",
    ])
    expect(trip.summary.movingSeconds).toBe(50 * 60)
  })

  it("ends a forgotten visit where he was seen going, though the phone fell silent on the way", () => {
    // Left the clinic at 11:30, silent from 11:33 to 11:45, then at the pharmacy.
    const leaving = fixes("11:30", "11:50", CLINIC, PHARMACY)
    const trip = dayOf({
      points: [
        ...fixes("09:30", "10:00:30", HOME, CLINIC),
        ...fixes("10:00:30", "11:30", CLINIC),
        ...leaving.filter((point) => point.recordedAt <= at("11:33") || point.recordedAt >= at("11:45")),
        ...fixes("11:50", "12:20", PHARMACY),
      ],
      visits: [visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "15:00")],
    })
    expect(trip.entries.map(told).slice(2, 6)).toEqual([
      "STAY 10:00:30-11:30:30 Dr. Əliyeva",
      "MOVE 11:30:30-11:33:00",
      "GAP 11:33:00-11:45:00 TELEMETRY_GAP",
      "MOVE 11:45:00-11:50:00",
    ])
  })

  it("tells a visit checked in and out while the phone was silent between two drives whole", () => {
    // Seen driving up to 10:00 and again from 10:40, never at the clinic: the
    // visit's own check-in and check-out are all there is, and they are kept.
    const trip = dayOf({
      points: [...fixes("09:30", "10:00", HOME, north(CLINIC, -1_000)), ...fixes("10:40", "11:00", north(CLINIC, 1_000), PHARMACY)],
      visits: [visit("v1", "Dr. Əliyeva", CLINIC, "10:05", "10:35")],
      workday: { startedAt: at("09:30"), completedAt: at("11:00") },
    })
    expect(trip.entries.map(told).slice(1, 6)).toEqual([
      "MOVE 09:30:00-10:00:00",
      "GAP 10:00:00-10:05:00 TELEMETRY_GAP",
      "STAY 10:05:00-10:35:00 Dr. Əliyeva",
      "GAP 10:35:00-10:40:00 TELEMETRY_GAP",
      "MOVE 10:40:00-11:00:00",
    ])
  })

  it("does not run a visit past the closed day when it was checked out after the last fix", () => {
    const trip = dayOf({
      points: [...fixes("09:30", "10:00:30", HOME, CLINIC), ...fixes("10:00:30", "12:00", CLINIC)],
      visits: [visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "18:40")],
      workday: { startedAt: at("09:30"), completedAt: at("12:10") },
    })
    expect(trip.entries.map(told).slice(-2)).toEqual([
      "STAY 10:00:30-12:10:00 Dr. Əliyeva",
      "END 12:10:00",
    ])
  })

  it("keeps a visit made with the phone silent, and the silence after a check-out made elsewhere is no visit", () => {
    // Quiet from 10:20; next seen at the pharmacy at 10:50. The clinic's
    // check-out at 11:00 came from the pharmacy: on site until 10:20 is all
    // that is known, and the silence is told as one.
    const quietAtClinic = dayOf({
      points: [...fixes("09:30", "10:00:30", HOME, CLINIC), ...fixes("10:00:30", "10:20", CLINIC), ...fixes("10:50", "11:30", PHARMACY)],
      visits: [visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "11:00")],
    })
    expect(quietAtClinic.entries.map(told).slice(2, 5)).toEqual([
      "STAY 10:00:30-10:20:00 Dr. Əliyeva",
      "GAP 10:20:00-10:50:00 TELEMETRY_GAP",
      "STAY 10:50:00-11:30:00 —",
    ])

    // The same silence, but the check-out fell inside it: he was there until then.
    const checkedOutInside = dayOf({
      points: [...fixes("09:30", "10:00:30", HOME, CLINIC), ...fixes("10:00:30", "10:20", CLINIC), ...fixes("10:50", "11:30", PHARMACY)],
      visits: [visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "10:35")],
    })
    expect(checkedOutInside.entries.map(told).slice(2, 5)).toEqual([
      "STAY 10:00:30-10:35:00 Dr. Əliyeva",
      "GAP 10:35:00-10:50:00 TELEMETRY_GAP",
      "STAY 10:50:00-11:30:00 —",
    ])
  })
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The ledger as the history panel renders it, for the API's JSON of `trip`. */
async function ledgerText(trip: DayTrip, locale: "az" | "ru" | "en"): Promise<string[]> {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale, timeZone: "UTC", messages },
    createElement(DayTripLedger, {
      trip: JSON.parse(JSON.stringify(trip)) as DayTripData,
      multiDay: false,
      focusId: null,
      onFocus: () => undefined,
      formatMoment: (value: string) => new Date(value).toISOString().slice(11, 16),
      formatDuration: (value: number) => `${Math.round(value / 60)} min`,
    }))))
  const rows = Array.from(container.querySelectorAll("li")).map((row) => row.textContent ?? "")
  await act(async () => root.unmount())
  container.remove()
  return rows
}

describe("the day's route as the manager reads it", () => {
  const drifted = north(CLINIC, 90)
  const visits = [
    visit("v1", "Dr. Əliyeva", CLINIC, "10:00:30", "11:00"),
    visit("v2", "Dr. Həsənov", CLINIC, "11:00:30", "11:30"),
  ]
  const trip = dayOf({
    points: clinicDay([...fixes("10:00:30", "10:20", CLINIC), ...fixes("10:40", "11:30", drifted)], "11:30", drifted),
    visits,
    pauses: [{ startedAt: at("10:20"), endedAt: at("10:40") }],
  })

  for (const locale of ["az", "ru", "en"] as const) {
    it(`names each doctor once, and the minutes after the break as the same place (${locale})`, async () => {
      const t = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmMap.history.trip
      const rows = await ledgerText(trip, locale)
      expect(rows.filter((row) => row.includes("Dr. Əliyeva"))).toHaveLength(1)
      expect(rows.filter((row) => row.includes("Dr. Həsənov"))).toHaveLength(1)
      const after = rows.find((row) => row.startsWith(t.stayAfterBreak))
      // Still told as the visit's time, by the clock.
      expect(after).toBe(`${t.stayAfterBreak}${t.visitFor.replace("{duration}", "21 min")}10:40–11:00`)
      expect(rows.findIndex((row) => row.startsWith(t.pause))).toBeLessThan(rows.indexOf(after!))
      expect(rows.some((row) => row.startsWith(t.move) && /10:[0-5]\d–11/.test(row))).toBe(false)
    })
  }
})
