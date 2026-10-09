// @vitest-environment jsdom
/**
 * The selected employee's card on the live map, third wave of «бери почти
 * всё, чего у нас нет» (owner, 2026-10-09, of the Navixy demo): where he is
 * in words, since when, his own events of today — and, beside the card, the
 * list as an Excel file and the ruler's area.
 *
 * The rules are tested on behaviour: which place is named for which
 * coordinate, how many times the street is asked for while a person stands
 * still, which journal rows are his events and at what time they happened.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages

vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string, values?: Record<string, unknown>) => string>()
  return {
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      let translate = translators.get(namespace)
      if (!translate) {
        translate = (key, values) => {
          let node: unknown = ru
          for (const part of `${namespace}.${key}`.split(".")) node = (node as Messages | undefined)?.[part]
          const raw = typeof node === "string" ? node : `${namespace}.${key}`
          return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
        }
        translators.set(namespace, translate)
      }
      return translate
    },
  }
})
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})

import { LiveMapAgentEvents } from "@/components/mtm/live-map-agent-events"
import { LiveMapAgentPlace, resetLiveMapPlaceCacheForTests } from "@/components/mtm/live-map-agent-place"
import { LiveMapRoster } from "@/components/mtm/live-map-roster"
import {
  LIVE_MAP_AGENT_EVENTS_REFRESH_MS,
  liveMapAgentEventHref,
  liveMapAgentEvents,
  liveMapAgentEventsRefreshKey,
  type LiveMapActivityRow,
  type LiveMapAlertGroupRow,
} from "@/lib/mtm/live-map-agent-events"
import {
  isPlaceApproximate,
  liveMapPlace,
  placeLookupPoint,
  placeMovedFromAnchor,
  type LiveMapPlaceStop,
} from "@/lib/mtm/live-map-place"
import { ROSTER_DEFAULT_VIEW, availableRosterColumns } from "@/lib/mtm/live-map-roster"
import { rosterCellText, rosterExportFileName, rosterExportTable, type RosterExportWords } from "@/lib/mtm/live-map-roster-export"
import { liveMapDuration, liveMapStateSince } from "@/lib/mtm/live-map-state-since"
import { outlineCrossesItself, pathLengthMeters, polygonAreaSquareMeters } from "@/lib/mtm/live-map-trails"
import { formatMtmArea } from "@/lib/mtm/visit-place-check"
import type { MtmDashboardAgent } from "@/lib/mtm-types"

const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180
const CENTRE = { latitude: 40.4093, longitude: 49.8671 }
const northOf = (meters: number) => ({ latitude: CENTRE.latitude + meters / METERS_PER_DEGREE, longitude: CENTRE.longitude })
const eastOf = (meters: number) => ({
  latitude: CENTRE.latitude,
  longitude: CENTRE.longitude + meters / (METERS_PER_DEGREE * Math.cos((CENTRE.latitude * Math.PI) / 180)),
})

const pharmacy: LiveMapPlaceStop = { name: "Аптека на углу", address: "ул. Низами, 10", ...CENTRE, zoneRadiusMeters: 100 }
const clinic: LiveMapPlaceStop = { name: "Клиника", address: null, ...northOf(2_000), zoneRadiusMeters: 150 }

describe("where the employee is, in words", () => {
  it("names the client whose circle his coordinate is inside, and asks nobody", () => {
    expect(liveMapPlace({ position: northOf(60), inVisit: false, stops: [clinic, pharmacy] }))
      .toEqual({ kind: "client", basis: "zone", name: "Аптека на углу", address: "ул. Низами, 10" })
  })

  it("names the nearer of two clients whose circles overlap", () => {
    const next: LiveMapPlaceStop = { name: "Соседняя аптека", ...northOf(80), zoneRadiusMeters: 100 }
    expect(liveMapPlace({ position: northOf(70), inVisit: false, stops: [pharmacy, next] }))
      .toMatchObject({ kind: "client", name: "Соседняя аптека" })
  })

  it("outside every circle it is a street to be asked for — one metre past the radius is outside", () => {
    expect(liveMapPlace({ position: northOf(101), inVisit: false, stops: [pharmacy] }).kind).toBe("street")
    expect(liveMapPlace({ position: northOf(99), inVisit: false, stops: [pharmacy] }).kind).toBe("client")
  })

  it("the visit he is in names the client without a coordinate, without a pin, and through indoor drift", () => {
    const inVisit = { ...pharmacy, inVisit: true }
    const visit = { kind: "client", basis: "visit", name: "Аптека на углу", address: "ул. Низами, 10" }
    expect(liveMapPlace({ position: null, inVisit: true, stops: [inVisit] })).toEqual(visit)
    // 100 m circle, a fix ±30 m that has wandered 250 m off inside a building: still at the client.
    expect(liveMapPlace({ position: { ...northOf(250), accuracy: 30 }, inVisit: true, stops: [inVisit] })).toEqual(visit)
    // The client has no pin: there is nothing to measure against, and he did press the button there.
    const unpinned = { ...inVisit, latitude: Number.NaN, longitude: Number.NaN }
    expect(liveMapPlace({ position: northOf(5_000), inVisit: true, stops: [unpinned] })).toMatchObject({ kind: "client", basis: "visit" })
    // A visit at a client that is not on today's route: the circle or the street answers.
    expect(liveMapPlace({ position: northOf(60), inVisit: true, stops: [pharmacy] })).toMatchObject({ basis: "zone" })
  })

  it("a visit left open by a man who has plainly driven away is said as that — both facts, and the street is asked", () => {
    const inVisit = { ...pharmacy, inVisit: true }
    const away = liveMapPlace({ position: { ...northOf(2_100), accuracy: 15 }, inVisit: true, stops: [inVisit] })
    expect(away).toMatchObject({ kind: "away", name: "Аптека на углу", distanceMeters: 2_100 })
    // The edge does not flicker on jitter: radius + the fix's error + a margin is still «у клиента».
    expect(liveMapPlace({ position: { ...northOf(100 + 15 + 150 - 5), accuracy: 15 }, inVisit: true, stops: [inVisit] }).kind).toBe("client")
    expect(liveMapPlace({ position: { ...northOf(100 + 15 + 150 + 5), accuracy: 15 }, inVisit: true, stops: [inVisit] }).kind).toBe("away")
    // A coarse fix earns a wider reach, not a quicker accusation.
    expect(liveMapPlace({ position: { ...northOf(500), accuracy: 400 }, inVisit: true, stops: [inVisit] }).kind).toBe("client")
  })

  it("claims nothing without a live coordinate", () => {
    expect(liveMapPlace({ position: null, inVisit: false, stops: [pharmacy] })).toEqual({ kind: "unknown" })
    expect(liveMapPlace({ position: { latitude: Number.NaN, longitude: 49 }, inVisit: false, stops: [pharmacy] })).toEqual({ kind: "unknown" })
  })

  it("a stop without coordinates or without a radius has no circle to be inside", () => {
    const unplaced: LiveMapPlaceStop = { name: "Без точки", latitude: Number.NaN, longitude: Number.NaN, zoneRadiusMeters: 100 }
    const noRadius: LiveMapPlaceStop = { name: "Без радиуса", ...CENTRE, zoneRadiusMeters: null }
    expect(liveMapPlace({ position: CENTRE, inVisit: false, stops: [unplaced, noRadius] }).kind).toBe("street")
  })

  it("asks for the street of a coordinate rounded to about eleven metres", () => {
    expect(placeLookupPoint(40.409312, 49.867149)).toEqual({ latitude: 40.4093, longitude: 49.8671, key: "40.4093,49.8671" })
  })

  it("a move is measured from where the street was asked for, and never smaller than the fix's own error", () => {
    expect(placeMovedFromAnchor(null, CENTRE)).toBe(true)
    expect(placeMovedFromAnchor(CENTRE, northOf(40))).toBe(false)
    expect(placeMovedFromAnchor(CENTRE, northOf(60))).toBe(true)
    // ±120 m: sixty metres is inside the noise.
    expect(placeMovedFromAnchor(CENTRE, { ...northOf(60), accuracy: 120 })).toBe(false)
    expect(placeMovedFromAnchor(CENTRE, { ...northOf(130), accuracy: 120 })).toBe(true)
    // However poor the fix, three hundred metres is a move: past that the old
    // street is no longer shown, so a question has to be on its way.
    expect(placeMovedFromAnchor(CENTRE, { ...northOf(290), accuracy: 900 })).toBe(false)
    expect(placeMovedFromAnchor(CENTRE, { ...northOf(310), accuracy: 900 })).toBe(true)
  })

  it("says «примерно» only for a fix worse than fifty metres", () => {
    expect(isPlaceApproximate({ ...CENTRE, accuracy: 50 })).toBe(false)
    expect(isPlaceApproximate({ ...CENTRE, accuracy: 51 })).toBe(true)
    expect(isPlaceApproximate({ ...CENTRE })).toBe(false)
    expect(isPlaceApproximate(null)).toBe(false)
  })
})

describe("since when", () => {
  const base = { fieldStatus: "ON_ROAD", workdayState: "ACTIVE" }

  it("the visit he is in, the break he is on, the shift he closed — each only with its own state", () => {
    expect(liveMapStateSince({ ...base, fieldStatus: "CHECKED_IN", openVisitSince: "2026-10-09T10:21:00.000Z" }))
      .toEqual([{ basis: "VISIT", since: "2026-10-09T10:21:00.000Z", ongoing: true }])
    expect(liveMapStateSince({ ...base, workdayState: "PAUSED", workdayPausedAt: "2026-10-09T09:05:00.000Z" }))
      .toEqual([{ basis: "BREAK", since: "2026-10-09T09:05:00.000Z", ongoing: true }])
    expect(liveMapStateSince({ ...base, workdayState: "CLOSED", workdayCompletedAt: "2026-10-09T14:02:00.000Z" }))
      .toEqual([{ basis: "SHIFT_CLOSED", since: "2026-10-09T14:02:00.000Z", ongoing: false }])
  })

  it("says nothing of a visit once the map has stopped calling him «на месте»", () => {
    // The browser ages a silent phone to OFFLINE; the visit's start no longer explains the row.
    expect(liveMapStateSince({ ...base, fieldStatus: "OFFLINE", openVisitSince: "2026-10-09T10:21:00.000Z" })).toEqual([])
  })

  it("a time left over from another state is not shown, and an unreadable one is not guessed", () => {
    expect(liveMapStateSince({ ...base, workdayState: "ACTIVE", workdayPausedAt: "2026-10-09T09:05:00.000Z" })).toEqual([])
    expect(liveMapStateSince({ ...base, workdayState: "PAUSED", workdayPausedAt: "not a date" })).toEqual([])
    expect(liveMapStateSince({ ...base, workdayState: "PAUSED", workdayPausedAt: null })).toEqual([])
  })

  it("nothing is claimed about standing still: «стоит» has no recorded beginning", () => {
    expect(liveMapStateSince({ fieldStatus: "STOPPED", workdayState: "ACTIVE" })).toEqual([])
  })

  it("a break inside a visit shows both", () => {
    expect(liveMapStateSince({
      fieldStatus: "CHECKED_IN", workdayState: "PAUSED",
      openVisitSince: "2026-10-09T10:00:00.000Z", workdayPausedAt: "2026-10-09T10:30:00.000Z",
    }).map((fact) => fact.basis)).toEqual(["VISIT", "BREAK"])
  })

  it("how long, in the two units that read at a glance", () => {
    const now = Date.parse("2026-10-09T12:00:00.000Z")
    const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
    expect(liveMapDuration(ago(0.5), now)).toEqual({ unit: "moment" })
    expect(liveMapDuration(ago(35), now)).toEqual({ unit: "minutes", minutes: 35 })
    expect(liveMapDuration(ago(80), now)).toEqual({ unit: "hours", hours: 1, minutes: 20 })
    expect(liveMapDuration(ago(47 * 60 + 59), now)).toEqual({ unit: "hours", hours: 47, minutes: 59 })
    expect(liveMapDuration(ago(50 * 60), now)).toEqual({ unit: "days", days: 2, hours: 2 })
    // A phone clock ahead of the server is not a negative duration.
    expect(liveMapDuration(ago(-3), now)).toEqual({ unit: "moment" })
    expect(liveMapDuration(null, now)).toBeNull()
    expect(liveMapDuration("nonsense", now)).toBeNull()
  })
})

const activityRow = (id: string, action: string, createdAt: string, extra: Partial<LiveMapActivityRow> = {}): LiveMapActivityRow =>
  ({ id, action, createdAt, agentId: "a1", ...extra })
const alertGroup = (key: string, lastAt: string, extra: Partial<LiveMapAlertGroupRow> = {}): LiveMapAlertGroupRow => ({
  key, agentId: "a1", alertType: "OUT_OF_ZONE", message: { key: "outOfZoneCheckIn", distanceMeters: 420 },
  count: 1, firstAt: lastAt, lastAt, historyHref: "/mtm/map?mode=history&agentId=a1&date=2026-10-09", ...extra,
})

describe("the employee's own events of today", () => {
  it("a finished visit is two events — begun and finished — newest first, each opening the visit", () => {
    const events = liveMapAgentEvents({
      agentId: "a1",
      activity: [
        activityRow("2", "CHECK_OUT", "2026-10-09T10:40:00.000Z", { subject: { customerName: "Аптека на углу", visitId: "v1", routeId: "r1" } }),
        activityRow("1", "CHECK_IN", "2026-10-09T10:05:00.000Z", { subject: { customerName: "Аптека на углу", visitId: "v1", routeId: "r1" } }),
      ],
      alerts: [],
    })
    expect(events.map((event) => [event.kind === "action" ? event.action : "", event.at]))
      .toEqual([["CHECK_OUT", "2026-10-09T10:40:00.000Z"], ["CHECK_IN", "2026-10-09T10:05:00.000Z"]])
    expect(events.map(liveMapAgentEventHref)).toEqual(["/mtm/visits?visitId=v1", "/mtm/visits?visitId=v1"])
    expect(events[0]).toMatchObject({ customerName: "Аптека на углу" })
  })

  it("a shift begun offline stands at the moment he pressed the button, not when the phone synced", () => {
    const [event] = liveMapAgentEvents({
      agentId: "a1",
      activity: [activityRow("9", "WORKDAY_START", "2026-10-09T07:30:00.000Z", { newData: { claimedAt: "2026-10-09T05:00:00.000Z" } })],
      alerts: [],
    })
    expect(event.at).toBe("2026-10-09T05:00:00.000Z")
    // The claimed time is the shift's own: a visit row keeps the time it was written with.
    const [visit] = liveMapAgentEvents({
      agentId: "a1",
      activity: [activityRow("8", "CHECK_IN", "2026-10-09T07:30:00.000Z", { newData: { claimedAt: "2026-10-09T05:00:00.000Z" } })],
      alerts: [],
    })
    expect(visit.at).toBe("2026-10-09T07:30:00.000Z")
  })

  it("what the office did to him is not his event; neither is somebody else's row", () => {
    const events = liveMapAgentEvents({
      agentId: "a1",
      activity: [
        activityRow("1", "AGENT_UPDATE", "2026-10-09T08:00:00.000Z"),
        activityRow("2", "WORKDAY_REOPEN", "2026-10-09T08:10:00.000Z"),
        activityRow("3", "ROUTE_UPDATE", "2026-10-09T08:20:00.000Z"),
        activityRow("4", "PHOTO_UPLOAD", "2026-10-09T08:30:00.000Z"),
        activityRow("5", "CHECK_IN", "2026-10-09T08:40:00.000Z", { agentId: "somebody-else" }),
        activityRow("6", "ROUTE_ADDITION_REQUEST", "2026-10-09T08:50:00.000Z", { subject: { routeId: "r1" } }),
      ],
      alerts: [alertGroup("x", "2026-10-09T09:00:00.000Z", { agentId: "somebody-else" })],
    })
    expect(events.map((event) => event.id)).toEqual(["action-6"])
    expect(liveMapAgentEventHref(events[0])).toBe("/mtm/routes?routeId=r1")
  })

  it("an alert group is one event at its last moment, with how many times, opening the GPS history around it", () => {
    const events = liveMapAgentEvents({
      agentId: "a1",
      activity: [activityRow("1", "CHECK_IN", "2026-10-09T10:05:00.000Z")],
      alerts: [alertGroup("g1", "2026-10-09T10:20:00.000Z", { count: 3, firstAt: "2026-10-09T10:01:00.000Z" })],
    })
    expect(events[0]).toMatchObject({ kind: "alert", at: "2026-10-09T10:20:00.000Z", count: 3, alertType: "OUT_OF_ZONE" })
    expect(liveMapAgentEventHref(events[0])).toBe("/mtm/map?mode=history&agentId=a1&date=2026-10-09")
    expect(events[1]).toMatchObject({ kind: "action", action: "CHECK_IN" })
  })

  it("the shift start the row shows is added when the journal has none, and not doubled when it has", () => {
    const visit = activityRow("1", "CHECK_IN", "2026-10-09T10:05:00.000Z")
    const without = liveMapAgentEvents({ agentId: "a1", activity: [visit], alerts: [], workdayStartedAt: "2026-10-09T05:00:00.000Z" })
    expect(without.map((event) => event.kind === "action" ? event.action : "")).toEqual(["CHECK_IN", "WORKDAY_START"])
    const withRow = liveMapAgentEvents({
      agentId: "a1",
      activity: [visit, activityRow("0", "WORKDAY_START", "2026-10-09T05:00:10.000Z")],
      alerts: [],
      workdayStartedAt: "2026-10-09T05:00:00.000Z",
    })
    expect(withRow.filter((event) => event.kind === "action" && event.action === "WORKDAY_START")).toHaveLength(1)
  })

  it("a row with no readable time is left out rather than sorted somewhere", () => {
    expect(liveMapAgentEvents({ agentId: "a1", activity: [activityRow("1", "CHECK_IN", "")], alerts: [alertGroup("g", "")] })).toEqual([])
  })

  it("a shift event pressed yesterday and heard of today is not an event of today, and is not today's shift start", () => {
    const events = liveMapAgentEvents({
      agentId: "a1",
      activity: [
        activityRow("2", "WORKDAY_FINISH", "2026-10-09T05:10:00.000Z", { newData: { claimedAt: "2026-10-08T18:14:00.000Z" } }),
        activityRow("1", "WORKDAY_START", "2026-10-09T05:10:00.000Z", { newData: { claimedAt: "2026-10-08T05:00:00.000Z" } }),
        activityRow("3", "WORKDAY_START", "2026-10-09T05:20:00.000Z", { newData: { claimedAt: "2026-10-09T05:15:00.000Z" } }),
      ],
      alerts: [],
      isEarlierDay: (iso) => iso < "2026-10-09",
    })
    expect(events.map((event) => event.id)).toEqual(["action-3"])
    // With only yesterday's start in the journal, today's start comes from the row.
    const today = liveMapAgentEvents({
      agentId: "a1",
      activity: [activityRow("1", "WORKDAY_START", "2026-10-09T05:10:00.000Z", { newData: { claimedAt: "2026-10-08T05:00:00.000Z" } })],
      alerts: [],
      workdayStartedAt: "2026-10-09T05:15:00.000Z",
      isEarlierDay: (iso) => iso < "2026-10-09",
    })
    expect(today.map((event) => [event.id, event.at])).toEqual([["action-shift-start", "2026-10-09T05:15:00.000Z"]])
  })

  it("asks again at once when the row says he did something, and otherwise every couple of minutes — not on every refresh of the map", () => {
    const row = { fieldStatus: "ON_ROAD", workdayState: "ACTIVE", openVisitSince: null, routeVisited: 2, routeTotal: 5 }
    const now = 1_000 * LIVE_MAP_AGENT_EVENTS_REFRESH_MS
    const key = liveMapAgentEventsRefreshKey(row, now)
    // Four refreshes of the map, thirty seconds apart, nothing about him changed: the same key.
    expect([30_000, 60_000, 90_000].map((later) => liveMapAgentEventsRefreshKey({ ...row }, now + later))).toEqual([key, key, key])
    // An alert about him is raised while his row stands still: the next turn of the clock reads again.
    expect(liveMapAgentEventsRefreshKey(row, now + LIVE_MAP_AGENT_EVENTS_REFRESH_MS)).not.toBe(key)
    // He did something: at once.
    expect(liveMapAgentEventsRefreshKey({ ...row, fieldStatus: "CHECKED_IN", openVisitSince: "2026-10-09T10:05:00.000Z" }, now)).not.toBe(key)
    expect(liveMapAgentEventsRefreshKey({ ...row, routeVisited: 3 }, now)).not.toBe(key)
    expect(liveMapAgentEventsRefreshKey({ ...row, workdayState: "PAUSED" }, now)).not.toBe(key)
  })
})

const agent = (over: Partial<MtmDashboardAgent> & { agentId: string; name: string }): MtmDashboardAgent => ({
  isOnline: true, fieldStatus: "ON_ROAD", freshness: "ONLINE", workdayState: "ACTIVE", locationState: "AVAILABLE",
  routeCompletion: 0, routeVisited: 0, routeTotal: 0, recordedAt: "2026-10-09T10:21:00.000Z", ...CENTRE, ...over,
})
const words: RosterExportWords = {
  column: (column) => `[${column}]`,
  status: (status) => `status:${status}`,
  freshness: (freshness) => `gps:${freshness}`,
  presence: (online) => (online ? "в сети" : "не в сети"),
  workday: (state) => `day:${state}`,
  routeProgress: (done, total) => `${done} из ${total}`,
  speed: (kmh) => `${kmh} км/ч`,
  distance: (meters) => `${Math.round(meters)} м`,
  clock: (iso) => iso.slice(11, 16),
  dateTime: (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`,
  visitOpened: (time) => `визит открыт: ${time}`,
}

describe("the list as an Excel file", () => {
  it("writes the signal as a clock time and what the map made of it — an age would be false a minute later", () => {
    expect(rosterCellText(agent({ agentId: "a", name: "A", freshness: "DELAYED" }), "signal", words)).toBe("2026-10-09 10:21 · gps:DELAYED")
    expect(rosterCellText(agent({ agentId: "a", name: "A", freshness: "NO_LOCATION", recordedAt: undefined }), "signal", words)).toBe("gps:NO_LOCATION")
  })

  it("says when the open visit began, and when a carried-over shift began with its date", () => {
    expect(rosterCellText(agent({ agentId: "a", name: "A", fieldStatus: "CHECKED_IN", openVisitSince: "2026-10-08T18:14:00.000Z" }), "status", words))
      .toBe("status:CHECKED_IN · визит открыт: 2026-10-08 18:14")
    expect(rosterCellText(agent({ agentId: "a", name: "A" }), "status", words)).toBe("status:ON_ROAD")
    expect(rosterCellText(agent({ agentId: "a", name: "A", workdayStartedAt: "2026-10-09T05:00:00.000Z" }), "workday", words)).toBe("day:ACTIVE · 05:00")
    expect(rosterCellText(agent({ agentId: "a", name: "A", workdayStartedAt: "2026-10-08T05:00:00.000Z", workdayCarryover: true }), "workday", words))
      .toBe("day:ACTIVE · 2026-10-08 05:00")
    expect(rosterCellText(agent({ agentId: "a", name: "A", workdayState: "CLOSED", workdayStartedAt: "2026-10-09T05:00:00.000Z" }), "workday", words)).toBe("day:CLOSED")
  })

  it("leaves a dash where there is nothing to say, never a zero", () => {
    const empty = agent({ agentId: "a", name: "A", speed: null, battery: null, teamId: null, distanceMeters: null })
    expect((["team", "route", "speed", "battery", "distance"] as const).map((column) => rosterCellText(empty, column, words)))
      .toEqual(["—", "—", "—", "—", "—"])
    const full = agent({ agentId: "a", name: "A", speed: 41.6, battery: 12.4, teamId: "t", teamName: "Север", managerId: "m", managerName: "Старший", routeVisited: 2, routeTotal: 5, distanceMeters: 450.2 })
    expect((["team", "manager", "route", "speed", "battery", "distance", "app"] as const).map((column) => rosterCellText(full, column, words)))
      .toEqual(["Север", "Старший", "2 из 5", "42 км/ч", "12%", "450 м", "в сети"])
    expect(rosterCellText(empty, "manager", words)).toBe("—")
  })

  it("has every column the roster can show, in the roster's order, for the rows in the order given", () => {
    const rows = [agent({ agentId: "b", name: "Б", battery: 80 }), agent({ agentId: "a", name: "А", battery: 15 })]
    const table = rosterExportTable(rows, ["battery", "name", "status", "signal"], words)
    expect(table.headers).toEqual(["[name]", "[status]", "[signal]", "[battery]"])
    expect(table.rows.map((row) => [row[0], row[3]])).toEqual([["Б", "80%"], ["А", "15%"]])
  })

  it("names the file by the organization's date and clock, in plain ASCII", () => {
    expect(rosterExportFileName("2026-10-09", new Date("2026-10-09T10:21:00.000Z"), "Asia/Baku")).toBe("mtm-live-map-2026-10-09-1421")
    // A wrong time zone or a missing date does not break the name.
    expect(rosterExportFileName(null, new Date("2026-10-09T10:21:00.000Z"), "No/Such_Zone")).toBe("mtm-live-map-2026-10-09-1021")
    expect(rosterExportFileName("2026-10-09", new Date("2026-10-09T10:21:00.000Z"), "Asia/Baku")).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/)
  })
})

describe("the ruler's area", () => {
  it("a square kilometre near Baku reads as a square kilometre", () => {
    const square = [CENTRE, northOf(1_000), { latitude: northOf(1_000).latitude, longitude: eastOf(1_000).longitude }, eastOf(1_000)]
    expect(Math.abs(polygonAreaSquareMeters(square) - 1_000_000)).toBeLessThan(2_000)
    // The same four points the other way round.
    expect(polygonAreaSquareMeters([...square].reverse())).toBeCloseTo(polygonAreaSquareMeters(square), 3)
  })

  it("two points have a length and no area", () => {
    expect(polygonAreaSquareMeters([CENTRE, northOf(500)])).toBe(0)
    expect(polygonAreaSquareMeters([])).toBe(0)
    expect(pathLengthMeters([CENTRE, northOf(500)])).toBeCloseTo(500, 0)
  })

  it("a line that crosses itself has no one area: the ruler is told so instead of being given the difference of the loops", () => {
    const corner = { latitude: northOf(1_000).latitude, longitude: eastOf(1_000).longitude }
    const square = [CENTRE, northOf(1_000), corner, eastOf(1_000)]
    const bowTie = [CENTRE, corner, northOf(1_000), eastOf(1_000)]
    expect(outlineCrossesItself(square)).toBe(false)
    expect(outlineCrossesItself([...square].reverse())).toBe(false)
    expect(outlineCrossesItself(bowTie)).toBe(true)
    // What the sum would have read under a shape that is plainly not empty.
    expect(polygonAreaSquareMeters(bowTie)).toBeLessThan(5_000)
    // A triangle cannot cross itself; a zig-zag path of five points can.
    expect(outlineCrossesItself([CENTRE, northOf(500), eastOf(500)])).toBe(false)
    expect(outlineCrossesItself([CENTRE, northOf(1_000), eastOf(300), { latitude: northOf(700).latitude, longitude: eastOf(900).longitude }, eastOf(100)])).toBe(true)
  })

  it("is said in the unit a person would use for that size", () => {
    expect(formatMtmArea(850.4, "ru")).toBe("850 m²")
    expect(formatMtmArea(24_000, "ru")).toBe("2,4 ha")
    expect(formatMtmArea(1_250_000, "ru")).toBe("1,25 km²")
    expect(formatMtmArea(24_000, "en", (unit, value) => `${value} ${unit}`)).toBe("2.4 ha")
    expect(formatMtmArea(-5, "en")).toBe("0 m²")
  })
})

describe("the card's pieces on screen", () => {
  let root: Root
  let container: HTMLDivElement
  let requests: string[]
  let streetAnswer: () => Response

  const byTestId = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const settle = async (ms = 0) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
  const render = async (element: ReturnType<typeof createElement>) => { await act(async () => { root.render(element) }) }
  const place = (position: { latitude: number; longitude: number; accuracy?: number } | null, extra: Record<string, unknown> = {}) =>
    createElement(LiveMapAgentPlace, { position, inVisit: false, stops: [pharmacy], stopsReady: true, ...extra } as never)
  /** Longer than the component's own settle time. */
  const STREET_WAIT_MS = 800
  /**
   * Past the component's settle time, and then for as long as an answer is
   * still on its way: a loaded runner is slow to hand a response over, and a
   * fixed pause would read the line a moment too early.
   */
  const settleStreet = async () => {
    await settle(STREET_WAIT_MS)
    for (let turn = 0; turn < 150 && byTestId("live-map-agent-place-text")?.textContent === "определяю улицу…"; turn += 1) await settle(20)
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    resetLiveMapPlaceCacheForTests()
    requests = []
    streetAnswer = () => Response.json({ success: true, data: { available: true, street: "Nizami küçəsi", distanceMeters: 9 } })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  describe("«где сейчас»", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn(async (input: string) => {
        requests.push(String(input))
        return streetAnswer()
      }))
    })

    it("inside a client's circle it names the client and asks for no street", async () => {
      await render(place(northOf(40)))
      await settleStreet()
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("в зоне клиента Аптека на углу")
      expect(byTestId("live-map-agent-place")?.textContent).toContain("ул. Низами, 10")
      expect(requests).toEqual([])
    })

    it("outside it asks our own road server once and shows the street", async () => {
      await render(place(northOf(500)))
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("определяю улицу…")
      await settleStreet()
      expect(requests).toHaveLength(1)
      // The rounded coordinate is what travels.
      expect(requests[0]).toMatch(/^\/api\/v1\/mtm\/geocode\/street\?lat=40\.\d{1,4}&lng=49\.\d{1,4}$/)
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("Nizami küçəsi")
    })

    it("standing still through five refreshes of the map is one question, not five", async () => {
      await render(place(northOf(500)))
      await settleStreet()
      for (const wander of [505, 512, 495, 520, 508]) {
        await render(place({ ...northOf(wander), accuracy: 12 }))
        await settleStreet()
      }
      expect(requests).toHaveLength(1)
      // Sixty metres on: a second one.
      await render(place(northOf(570)))
      await settleStreet()
      expect(requests).toHaveLength(2)
    })

    it("a fix worse than fifty metres says «примерно» — for a street and for a client's circle alike", async () => {
      await render(place({ ...northOf(500), accuracy: 80 }))
      await settleStreet()
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("примерно Nizami küçəsi")
      await render(place({ ...northOf(40), accuracy: 80 }))
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("примерно в зоне клиента Аптека на углу")
      await render(place({ ...northOf(40), accuracy: 10 }))
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("в зоне клиента Аптека на углу")
    })

    it("a visit left open by a man who has driven away: both are said, with the street he is on", async () => {
      const open = [{ ...pharmacy, inVisit: true }]
      await render(place({ ...northOf(2_100), accuracy: 15 }, { inVisit: true, stops: open, formatDistance: (meters: number) => `${(meters / 1000).toFixed(1)} км` }))
      expect(byTestId("live-map-agent-place")?.getAttribute("data-place")).toBe("away")
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("визит у клиента Аптека на углу не закрыт, а сам в 2.1 км оттуда")
      await settleStreet()
      expect(requests).toHaveLength(1)
      expect(byTestId("live-map-agent-place")?.textContent).toContain("· Nizami küçəsi")
      // Standing in the client's doorway with the visit open asks nothing.
      requests.length = 0
      await render(place({ ...northOf(20), accuracy: 15 }, { inVisit: true, stops: open }))
      await settleStreet()
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("у клиента Аптека на углу, идёт визит")
      expect(requests).toEqual([])
    })

    it("a place read from a coordinate a few minutes old is toned like the signal and says so", async () => {
      await render(place(northOf(40), { delayed: true }))
      const line = byTestId("live-map-agent-place")!
      expect(line.className).toContain("text-amber-700")
      expect(line.getAttribute("title")).toBe("по координате с задержкой — время в строке выше")
      await render(place(northOf(40)))
      expect(byTestId("live-map-agent-place")!.className).not.toContain("text-amber-700")
    })

    it("no street there, or the road server silent: the coordinates, not a guess", async () => {
      streetAnswer = () => Response.json({ success: true, data: { available: true, street: null, distanceMeters: 400 } })
      await render(place(northOf(500)))
      await settleStreet()
      expect(byTestId("live-map-agent-place-text")?.textContent).toMatch(/^улица не определена · 40\.\d{5}, 49\.\d{5}$/)
    })

    it("after «too many requests» it asks nothing for a minute, wherever he moves", async () => {
      streetAnswer = () => new Response("{}", { status: 429 })
      await render(place(northOf(500)))
      await settleStreet()
      expect(requests).toHaveLength(1)
      await render(place(northOf(700)))
      await settleStreet()
      expect(requests).toHaveLength(1)
      expect(byTestId("live-map-agent-place-text")?.textContent).toMatch(/^улица не определена/)
    })

    describe("a road server that did not answer", () => {
      const unavailable = () => Response.json({ success: true, data: { available: false, street: null, distanceMeters: null } })
      // A second at a time: React applies what a timer set when the `act` it
      // fired in ends, as a browser does when the timer's own task ends.
      const forward = async (ms: number) => {
        for (let passed = 0; passed < ms; passed += 1_000) {
          await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1_000, ms - passed)) })
        }
      }
      // The pause and the retry are a minute long: the clock is driven by hand.
      beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }) })
      afterEach(() => { vi.useRealTimers() })

      it("is not the street of that corner: a man who has not moved is asked about again after the pause, by the card itself", async () => {
        streetAnswer = unavailable
        await render(place(northOf(500)))
        await forward(700)
        expect(requests).toHaveLength(1)
        expect(byTestId("live-map-agent-place-text")?.textContent).toMatch(/^улица не определена/)
        streetAnswer = () => Response.json({ success: true, data: { available: true, street: "Nizami küçəsi", distanceMeters: 9 } })
        // Half a minute on, with two refreshes of the map in between: nothing is asked yet.
        await render(place({ ...northOf(503), accuracy: 12 }))
        await forward(30_000)
        expect(requests).toHaveLength(1)
        await forward(36_000)
        expect(requests).toHaveLength(2)
        expect(byTestId("live-map-agent-place-text")?.textContent).toBe("Nizami küçəsi")
        // An answer at last: it stands, and nothing more is asked while he stands.
        await forward(5 * 60_000)
        expect(requests).toHaveLength(2)
      })

      it("is asked a bounded number of times while it stays silent, not once a minute for ever", async () => {
        streetAnswer = unavailable
        await render(place(northOf(500)))
        await forward(30 * 60_000)
        // The first question and three more by the card itself.
        expect(requests).toHaveLength(4)
        expect(byTestId("live-map-agent-place-text")?.textContent).toMatch(/^улица не определена/)
      })
    })

    it("two cards at the same corner share one answer", async () => {
      await render(place(northOf(500)))
      await settleStreet()
      await render(createElement("div"))
      await render(place(northOf(500)))
      await settleStreet()
      expect(requests).toHaveLength(1)
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("Nizami küçəsi")
    })

    it("until today's route is read, «not at a client» is not known and no street is asked", async () => {
      await render(place(northOf(500), { stopsReady: false }))
      await settle(STREET_WAIT_MS)
      expect(requests).toEqual([])
      expect(byTestId("live-map-agent-place-text")?.textContent).toBe("определяю улицу…")
    })

    it("draws nothing for a person the map shows no live position for", async () => {
      await render(place(null))
      await settleStreet()
      expect(byTestId("live-map-agent-place")).toBeNull()
      expect(requests).toEqual([])
    })
  })

  describe("«события сегодня»", () => {
    let activity: LiveMapActivityRow[]
    let alerts: LiveMapAlertGroupRow[]
    let fail: boolean
    /** What the journal says it has in all, when that is more than the page it sent. */
    let journalTotal: number | null
    const events = (extra: Record<string, unknown> = {}) => createElement(LiveMapAgentEvents, {
      agentId: "a1", refreshKey: "k1", workdayStartedAt: null,
      formatTime: (value: string) => value.slice(11, 16),
      alertText: () => "Отметка в 420 м от клиента",
      ...extra,
    } as never)
    const rowTexts = () => [...container.querySelectorAll('[data-testid="live-map-agent-event"]')].map((row) => row.textContent)

    beforeEach(() => {
      fail = false
      journalTotal = null
      activity = [
        activityRow("2", "CHECK_OUT", "2026-10-09T10:40:00.000Z", { subject: { customerName: "Аптека на углу", visitId: "v1" } }),
        activityRow("1", "CHECK_IN", "2026-10-09T10:05:00.000Z", { subject: { customerName: "Аптека на углу", visitId: "v1" } }),
        activityRow("0", "WORKDAY_START", "2026-10-09T05:00:00.000Z"),
      ]
      alerts = [alertGroup("g1", "2026-10-09T10:06:00.000Z", { count: 2 })]
      vi.stubGlobal("fetch", vi.fn(async (input: string) => {
        const url = new URL(String(input), "http://localhost")
        requests.push(url.pathname + url.search)
        if (fail) return new Response("{}", { status: 500 })
        if (url.pathname === "/api/v1/mtm/activity") return Response.json({ success: true, data: { logs: activity, total: journalTotal ?? activity.length } })
        if (url.pathname === "/api/v1/mtm/alerts") return Response.json({ success: true, data: { groups: alerts } })
        throw new Error(`unexpected request: ${url.pathname}`)
      }))
    })

    it("says so when the day has more of his events than one page holds — the list is not passed off as the whole day", async () => {
      alerts = []
      await render(events())
      await settle(10)
      expect(byTestId("live-map-agent-events-cut")).toBeNull()
      journalTotal = 140
      await render(events({ refreshKey: "k2" }))
      await settle(10)
      expect(byTestId("live-map-agent-events-cut")?.textContent).toBe("Показаны последние 100 событий дня — более ранние смотрите в «Истории за день»")
    })

    it("leaves out a shift event pressed on an earlier day, by the organization's calendar", async () => {
      activity = [
        activityRow("2", "CHECK_IN", "2026-10-09T10:05:00.000Z"),
        activityRow("1", "WORKDAY_FINISH", "2026-10-09T05:10:00.000Z", { newData: { claimedAt: "2026-10-08T18:14:00.000Z" } }),
      ]
      alerts = []
      await render(events({ isEarlierDay: (iso: string) => iso < "2026-10-09" }))
      await settle(10)
      expect(rowTexts()).toEqual(["10:05Начал визит"])
    })

    it("reads his journal and his alerts — for him, for today — and lists them newest first in words", async () => {
      await render(events())
      await settle(10)
      // His own events are picked out by the server (type=FIELD_DAY), so the page counts them and not his photos.
      expect(requests.sort()).toEqual([
        "/api/v1/mtm/activity?agentId=a1&period=today&type=FIELD_DAY&limit=100",
        "/api/v1/mtm/alerts?view=groups&agentId=a1&status=all",
      ])
      const texts = rowTexts()
      expect([texts[0], texts[2], texts[3]]).toEqual([
        "10:40Завершил визит · Аптека на углу",
        "10:05Начал визит · Аптека на углу",
        "05:00Рабочий день начат",
      ])
      // The alert in words, and that it repeated (the plural itself is the translator's).
      expect(texts[1]).toMatch(/^10:06Отметка в 420 м от клиента · \S/)
      const links = [...container.querySelectorAll('[data-testid="live-map-agent-event"] a')].map((link) => link.getAttribute("href"))
      expect(links).toEqual(["/mtm/visits?visitId=v1", "/mtm/map?mode=history&agentId=a1&date=2026-10-09", "/mtm/visits?visitId=v1"])
    })

    it("shows five and offers the rest in words", async () => {
      activity = Array.from({ length: 8 }, (_unused, index) =>
        activityRow(String(index), index % 2 ? "CHECK_OUT" : "CHECK_IN", `2026-10-09T0${index}:00:00.000Z`))
      alerts = []
      await render(events())
      await settle(10)
      expect(rowTexts()).toHaveLength(5)
      expect(byTestId("live-map-agent-events-more")?.textContent).toBe("Показать ещё 3")
      await act(async () => { byTestId("live-map-agent-events-more")!.click() })
      expect(rowTexts()).toHaveLength(8)
      expect(byTestId("live-map-agent-events-more")?.textContent).toBe("Свернуть")
    })

    it("a day with nothing in it says so", async () => {
      activity = []
      alerts = []
      await render(events())
      await settle(10)
      expect(byTestId("live-map-agent-events-empty")?.textContent).toBe("Сегодня событий пока нет")
    })

    it("asks again only when the row says he did something; a failed refresh keeps what was read and says it is not fresh", async () => {
      await render(events())
      await settle(10)
      expect(requests).toHaveLength(2)
      // The map refreshed, nothing about him changed: no new question.
      await render(events())
      await settle(10)
      expect(requests).toHaveLength(2)
      fail = true
      await render(events({ refreshKey: "k2" }))
      await settle(10)
      expect(requests).toHaveLength(4)
      expect(byTestId("live-map-agent-events-failed")?.textContent).toBe("Не удалось обновить события")
      expect(rowTexts()).toHaveLength(4)
    })

    it("when the first read fails it does not call the day empty", async () => {
      fail = true
      await render(events())
      await settle(10)
      expect(byTestId("live-map-agent-events-failed")).not.toBeNull()
      expect(byTestId("live-map-agent-events-empty")).toBeNull()
    })
  })

  describe("«Excel» above the list", () => {
    const people = [
      agent({ agentId: "b", name: "=cmd|' /C calc'!A0", battery: 80 }),
      agent({ agentId: "a", name: "Əli Məmmədov", battery: 15, fieldStatus: "STOPPED" }),
    ]
    const roster = (extra: Record<string, unknown> = {}) => createElement(LiveMapRoster, {
      agents: people, rows: people, searchSlot: null, filters: {}, onFiltersChange: () => {},
      view: ROSTER_DEFAULT_VIEW, onViewChange: () => {}, onHide: () => {}, hiddenAgentIds: new Set<string>(),
      onToggleAgentOnMap: () => {}, onSetAgentsOnMap: () => {}, selectedAgentId: null, onSelect: () => {},
      renderDetail: () => null, nowMs: Date.parse("2026-10-09T10:30:00.000Z"), workforceEnabled: true,
      formatClock: (value: string | null | undefined) => (value ? value.slice(11, 16) : ""),
      formatVisitOpened: (value: string) => value.slice(11, 16), isEarlierDay: () => false,
      exportFileName: () => "mtm-live-map-2026-10-09-1430",
      ...extra,
    } as never)
    let posted: Array<{ url: string; body: { sheetName: string; fileName: string; headers: string[]; rows: string[][] } }>
    let exportStatus: number
    let downloads: string[]

    beforeEach(() => {
      posted = []
      exportStatus = 200
      vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
        posted.push({ url: String(input), body: JSON.parse(String(init?.body)) })
        // A plain string: a jsdom Blob is not a body Node 20's Response accepts.
        return new Response("xlsx", { status: exportStatus })
      }))
      Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} })
      downloads = []
      // jsdom does not follow a download link; what would have been saved is recorded.
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
        downloads.push(this.download)
      })
    })
    afterEach(() => { vi.restoreAllMocks() })

    it("is not offered where the page gave no file name", async () => {
      await render(roster({ exportFileName: undefined }))
      expect(byTestId("live-map-roster-export")).toBeNull()
    })

    it("sends the rows on screen, in their order, with every column the roster has — as words", async () => {
      await render(roster())
      const button = byTestId("live-map-roster-export")!
      expect(button.textContent).toBe("Excel")
      await act(async () => { button.click() })
      await settle(10)
      expect(posted).toHaveLength(1)
      const { url, body } = posted[0]
      expect(url).toBe("/api/v1/mtm/locations/export")
      expect(body.fileName).toBe("mtm-live-map-2026-10-09-1430")
      expect(body.sheetName).toBe("Сотрудники")
      // Not only the three columns the narrow list draws.
      const available = availableRosterColumns(people, { workforceEnabled: true })
      expect(body.headers).toHaveLength(available.length)
      expect(body.headers.slice(0, 3)).toEqual(["Сотрудник", "Статус", "Сигнал"])
      expect(body.rows.map((row) => row[0])).toEqual(["=cmd|' /C calc'!A0", "Əli Məmmədov"])
      expect(body.rows[1][1]).toBe("Стоит")
      expect(body.rows.every((row) => row.length === body.headers.length && row.every((cell) => typeof cell === "string"))).toBe(true)
      expect(byTestId("live-map-roster-export-failed")).toBeNull()
      expect(downloads).toEqual(["mtm-live-map-2026-10-09-1430.xlsx"])
    })

    it("says so when the file could not be made", async () => {
      exportStatus = 500
      await render(roster())
      await act(async () => { byTestId("live-map-roster-export")!.click() })
      await settle(10)
      expect(byTestId("live-map-roster-export-failed")?.textContent).toBe("Не удалось выгрузить список. Попробуйте ещё раз.")
      expect(downloads).toEqual([])
    })

    it("has nothing to export from an empty list", async () => {
      await render(roster({ rows: [] }))
      expect((byTestId("live-map-roster-export") as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
