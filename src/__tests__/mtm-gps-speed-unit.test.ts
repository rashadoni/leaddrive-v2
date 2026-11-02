// @vitest-environment jsdom
/**
 * A GPS fix's speed reads the same km/h on every screen.
 *
 * `mtm_agent_locations.speed` is km/h: the field app converts Android's m/s
 * before it uploads, and production's fixes agree with their own track
 * (src/lib/mtm/gps-speed.ts has the evidence). History read the field as m/s
 * and multiplied it by 3.6 again, so a 52 km/h drive showed there as
 * 187.9 km/h, while the live map's list said 52 km/h for the same fix.
 *
 * Tested on what a person reads: History is rendered from the server's answer,
 * the list's cell comes from the function its table and Excel file use.
 */
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LocationHistoryPanel } from "@/components/mtm/location-history-panel"
import { calculateDistance } from "@/lib/geo-utils"
import { mtmSpeedKmh } from "@/lib/mtm/gps-speed"
import { rosterCellText, type RosterExportWords } from "@/lib/mtm/live-map-roster-export"
import type { MtmDashboardAgent } from "@/lib/mtm-types"

// The Leaflet canvas is not drawn in jsdom.
vi.mock("next/dynamic", async () => {
  const { createElement: h } = await import("react")
  return { default: () => function MapStandIn() { return h("div", { "data-testid": "map-stand-in" }) } }
})
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const kmhWords = (value: number) => (ru.mtmMap.roster.kmh as string).replace("{value}", String(value))
const speedLabel = ru.mtmMap.history.gpsSpeed as string

/**
 * A drive in Baku: two fixes 30 s apart, the second 435 m north of the first.
 * The phone measured 14.5 m/s and sent 14.5 × 3.6 = 52.2 — the km/h the track
 * itself says.
 */
const A = { latitude: 40.4093, longitude: 49.8671, recordedAt: "2026-10-14T06:00:00.000Z" }
const B = { latitude: 40.4093 + 435 / 111_195, longitude: 49.8671, recordedAt: "2026-10-14T06:00:30.000Z" }
const PHONE_METERS_PER_SECOND = 14.5
const STORED_SPEED = PHONE_METERS_PER_SECOND * 3.6

const fix = (id: string, at: typeof A, speed: number | null) => ({
  id, ...at, accuracy: 6, speed, heading: 0, battery: 80, isMoving: true, workdayId: null,
})

function historyAnswer(speed: number | null) {
  return {
    agent: { id: "agent-1", name: "Agent", role: "FIELD_AGENT", team: null },
    capabilities: { workforce: false },
    range: { date: "2026-10-14", from: "00:00", to: "23:59", timezone: "Asia/Baku" },
    policy: { maxAccuracyMeters: 50, stopRadiusMeters: 50, stopMinimumMinutes: 5, gapThresholdSeconds: 300, distanceFormula: "haversine", impossibleSpeedKmh: 180, autoTrackingSupported: true },
    quality: { rawPointCount: 2, acceptedPointCount: 2, returnedPointCount: 2, rejectedByAccuracy: 0, rejectedInvalid: 0, duplicateCount: 0, rawTruncated: false, downsampled: false },
    summary: { distanceMeters: 435, firstPointAt: A.recordedAt, lastPointAt: B.recordedAt, stopCount: 0, visitCount: 0, gapCount: 0, anomalyCount: 0 },
    workday: null,
    points: [fix("p1", A, speed), fix("p2", B, speed)],
    stops: [], gaps: [], anomalies: [], plannedRoutes: [], timeline: [], trip: null, visits: [],
  }
}

let history = historyAnswer(STORED_SPEED)
const json = (body: unknown) => new Response(JSON.stringify(body))
const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input), "https://crm.test")
  if (url.pathname === "/api/v1/mtm/location-history" && !url.searchParams.has("agentId")) {
    return json({ success: true, data: { agents: [{ id: "agent-1", name: "Agent", role: "FIELD_AGENT", team: null }], timezone: "Asia/Baku", policy: { maxAccuracyMeters: 50 } } })
  }
  if (url.pathname === "/api/v1/mtm/location-history") return json({ success: true, data: history })
  return json({ success: true, data: {} })
})

let container: HTMLDivElement
let root: Root

/** What History's replay line says about the speed of the fix it stands on. */
async function historySpeedText(): Promise<string> {
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {} },
    createElement(LocationHistoryPanel))))
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const line = Array.from(container.querySelectorAll("span")).find((span) => span.textContent?.startsWith(`${speedLabel}:`))
  if (!line) throw new Error("History shows no speed line")
  return line.textContent!.slice(speedLabel.length + 1).trim()
}

const agent = (speed: number | null): MtmDashboardAgent => ({
  agentId: "agent-1", name: "Agent", isOnline: true, fieldStatus: "ON_ROAD", freshness: "ONLINE", workdayState: "ACTIVE", locationState: "AVAILABLE",
  routeCompletion: 0, routeVisited: 0, routeTotal: 0, latitude: B.latitude, longitude: B.longitude, recordedAt: B.recordedAt, speed,
} as MtmDashboardAgent)
const words = { speed: kmhWords } as RosterExportWords

beforeEach(() => {
  history = historyAnswer(STORED_SPEED)
  window.history.replaceState({}, "", "/mtm/history?agentId=agent-1&date=2026-10-14")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("GPS speed unit", () => {
  it("History shows the stored speed as km/h — the speed the fix's own track gives", async () => {
    const trackKmh = calculateDistance(A.latitude, A.longitude, B.latitude, B.longitude) / 30 * 3.6
    expect(Math.round(trackKmh)).toBe(52)

    expect(await historySpeedText()).toBe(kmhWords(Math.round(trackKmh)))
    // Read as m/s it said 187.9 km/h, three and a half times the drive.
    expect(await historySpeedText()).not.toContain("187")
  })

  it("the live map's list (and its Excel file) and History say the same for the same fix", async () => {
    const shownInHistory = await historySpeedText()
    expect(rosterCellText(agent(STORED_SPEED), "speed", words)).toBe(shownInHistory)
    expect(shownInHistory).toBe(kmhWords(52))
  })

  it("a fix without a speed reads as a dash in both, never as zero", async () => {
    history = historyAnswer(null)
    expect(await historySpeedText()).toBe("—")
    expect(rosterCellText(agent(null), "speed", words)).toBe("—")
  })

  it("rounds to whole km/h and has no number for what is not a speed", () => {
    expect([0, 0.4, 0.5, 2.29, 52.2, 78.7, 130.2].map(mtmSpeedKmh)).toEqual([0, 0, 1, 2, 52, 79, 130])
    expect([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1].map(mtmSpeedKmh)).toEqual([null, null, null, null, null])
  })
})
