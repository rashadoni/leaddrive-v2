/**
 * The two server pieces behind the live map's card and its «Excel» button:
 *
 *  - GET /api/v1/mtm/geocode/street — the street the selected employee is on,
 *    answered by the company's own road server (OSRM on 127.0.0.1), so that a
 *    coordinate of a named company's employee is not sent to a public address
 *    service;
 *  - POST /api/v1/mtm/locations/export — the list on screen as a real .xlsx.
 *
 * The real routes behind the real Route & Field wrapper; authentication, the
 * database and the road server are stood in for. The workbook that comes back
 * is opened and read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import ExcelJS from "exceljs"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET as streetGET } from "@/app/api/v1/mtm/geocode/street/route"
import { POST as exportPOST } from "@/app/api/v1/mtm/locations/export/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { nearestStreet, nearestStreetUrl, parseNearestStreet, resetNearestStreetStateForTests } from "@/lib/mtm/nearest-street"
import { resetRateLimit } from "@/lib/rate-limit"
import { MTM_AGENT_TAG_MAX_COUNT, MTM_AGENT_TAG_MAX_LENGTH, validateMtmAgentTags } from "@/lib/mtm/agent-tags"
import { ROSTER_COLUMNS } from "@/lib/mtm/live-map-roster"
import { rosterExportTable } from "@/lib/mtm/live-map-roster-export"
import type { MtmDashboardAgent } from "@/lib/mtm-types"

const ORG = "org-1"
const USER = "user-manager"
const ROAD_SERVER = "http://127.0.0.1:5055"
const fetchMock = vi.fn()
const osrm = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const streetRequest = (query: string) => new NextRequest(new URL(`http://localhost:3000/api/v1/mtm/geocode/street${query}`))
const exportRequest = (body: unknown) => new NextRequest(new URL("http://localhost:3000/api/v1/mtm/locations/export"), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  resetNearestStreetStateForTests()
  resetRateLimit(`mtm-geocode-street:${ORG}:${USER}`)
  resetRateLimit(`mtm-live-map-export:${ORG}:${USER}`)
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG, userId: USER, role: "manager", email: "manager@example.com", name: "Manager",
  })
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "pro", addons: [], features: ["mtm"], modules: { mtm: true },
  } as never)
  fetchMock.mockResolvedValue(osrm({ code: "Ok", waypoints: [{ name: "Nizami küçəsi", distance: 11.4, location: [49.8372, 40.3777] }] }))
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("MTM_MAP_MATCHING_URL", ROAD_SERVER)
})

describe("the street under a coordinate, from our own road server", () => {
  it("asks OSRM for the nearest road, longitude first, at eleven-metre precision", () => {
    expect(nearestStreetUrl(ROAD_SERVER, 40.377712, 49.837249)).toBe(`${ROAD_SERVER}/nearest/v1/driving/49.8372,40.3777?number=1`)
  })

  it("reads the road's name only when the road is his street: named, and within a short walk", () => {
    expect(parseNearestStreet({ code: "Ok", waypoints: [{ name: " Nizami küçəsi ", distance: 11.4 }] })).toEqual({ street: "Nizami küçəsi", distanceMeters: 11 })
    // An unnamed lane has nothing to say.
    expect(parseNearestStreet({ code: "Ok", waypoints: [{ name: "", distance: 12 }] })).toEqual({ street: null, distanceMeters: 12 })
    // A road a few blocks away is not where he is standing.
    expect(parseNearestStreet({ code: "Ok", waypoints: [{ name: "Sahil yolu", distance: 400 }] })).toEqual({ street: null, distanceMeters: 400 })
    // The open sea: answered, no road.
    expect(parseNearestStreet({ code: "NoSegment" })).toEqual({ street: null, distanceMeters: null })
    // Not an answer at all.
    expect(parseNearestStreet(null)).toBeNull()
    expect(parseNearestStreet({ waypoints: [] })).toBeNull()
  })

  it("never asks anything outside the server: the only host is the road server's own", async () => {
    const result = await nearestStreet({ latitude: 40.377712, longitude: 49.837249 })
    expect(result).toEqual({ ok: true, street: "Nizami küçəsi", distanceMeters: 11 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String(fetchMock.mock.calls[0][0])).origin).toBe(ROAD_SERVER)
  })

  it("remembers a corner: two people at the same door are one question", async () => {
    await nearestStreet({ latitude: 40.377712, longitude: 49.837249 })
    await nearestStreet({ latitude: 40.377731, longitude: 49.837211 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await nearestStreet({ latitude: 40.3791, longitude: 49.8372 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("without a road server says «not available», not «no street» — and a dead one is left alone for a minute", async () => {
    vi.stubEnv("MTM_MAP_MATCHING_URL", "off")
    expect(await nearestStreet({ latitude: 40.3777, longitude: 49.8372 })).toEqual({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv("MTM_MAP_MATCHING_URL", ROAD_SERVER)
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))
    let now = 1_000_000
    expect(await nearestStreet({ latitude: 40.3777, longitude: 49.8372 }, { now: () => now })).toEqual({ ok: false })
    expect(await nearestStreet({ latitude: 40.39, longitude: 49.85 }, { now: () => now })).toEqual({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // A minute later it is tried again, and the failure was not remembered as an answer.
    now += 61_000
    fetchMock.mockResolvedValue(osrm({ code: "Ok", waypoints: [{ name: "Nizami küçəsi", distance: 5 }] }))
    expect(await nearestStreet({ latitude: 40.3777, longitude: 49.8372 }, { now: () => now })).toMatchObject({ ok: true, street: "Nizami küçəsi" })
  })
})

describe("GET /api/v1/mtm/geocode/street", () => {
  it("names the street for the card", async () => {
    const response = await streetGET(streetRequest("?lat=40.377712&lng=49.837249"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { available: true, street: "Nizami küçəsi", distanceMeters: 11 } })
  })

  it("says the road server is not available rather than inventing «no street»", async () => {
    vi.stubEnv("MTM_MAP_MATCHING_URL", "off")
    const response = await streetGET(streetRequest("?lat=40.377712&lng=49.837249"))
    expect([response.status, await response.json()]).toEqual([200, { success: true, data: { available: false, street: null, distanceMeters: null } }])
  })

  it("refuses what is not a point, without asking the road server", async () => {
    const answers = []
    for (const query of ["", "?lat=40.4", "?lat=abc&lng=49.8", "?lat=95&lng=49.8", "?lat=0&lng=0"]) {
      const response = await streetGET(streetRequest(query))
      answers.push([response.status, (await response.json()).code])
    }
    expect(answers).toEqual(Array.from({ length: 5 }, () => [400, "MTM_GEOCODE_POINT_INVALID"]))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("is for signed-in people of an organization that has the module", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await streetGET(streetRequest("?lat=40.377712&lng=49.837249"))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("holds one person to a sane number of questions a minute", async () => {
    let last = 200
    for (let turn = 0; turn < 61; turn += 1) last = (await streetGET(streetRequest(`?lat=40.37&lng=49.${8000 + turn}`))).status
    expect(last).toBe(429)
  })
})

describe("POST /api/v1/mtm/locations/export", () => {
  const table = {
    sheetName: "Сотрудники",
    fileName: "mtm-live-map-2026-10-09-1421",
    headers: ["Сотрудник", "Статус", "Сигнал"],
    rows: [
      ["Əli Məmmədov", "На месте · визит открыт: 14:21", "14:21 · на связи"],
      ["=cmd|' /C calc'!A0", "Стоит", "—"],
      ["+994 50 000 00 00", "В пути", "14:20 · задержка"],
    ],
  }
  const read = async (response: Response) => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer() as never)
    const sheet = workbook.worksheets[0]
    const rows: unknown[][] = []
    sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
    return { name: sheet.name, rows }
  }

  it("returns a real workbook with the words it was given — Azerbaijani letters intact, named as asked", async () => {
    const response = await exportPOST(exportRequest(table))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(response.headers.get("content-disposition")).toContain('filename="mtm-live-map-2026-10-09-1421.xlsx"')
    expect(response.headers.get("cache-control")).toBe("no-store")
    const sheet = await read(response)
    expect(sheet.name).toBe("Сотрудники")
    expect(sheet.rows[0]).toEqual(["Сотрудник", "Статус", "Сигнал"])
    expect(sheet.rows[1]).toEqual(["Əli Məmmədov", "На месте · визит открыт: 14:21", "14:21 · на связи"])
  })

  it("a name that begins like a formula stays text", async () => {
    const sheet = await read(await exportPOST(exportRequest(table)))
    expect(sheet.rows[2][0]).toBe("'=cmd|' /C calc'!A0")
    expect(sheet.rows[3][0]).toBe("'+994 50 000 00 00")
    // Every cell is a string cell: nothing was turned into a formula object.
    expect(sheet.rows.flat().every((cell) => typeof cell === "string")).toBe(true)
  })

  // The three limits that have to agree: how many labels a card may hold and
  // how long each may be (the card's validator), how the list joins them into
  // a cell, and how long a cell this route accepts. One cell too long refuses
  // the whole file, not one row — so the fullest card there can be is sent.
  it("takes the fullest «Метки» cell a card can hold, in a table with every column the list has, and writes it whole", async () => {
    const labels = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT }, (_unused, index) => `${index}${"я".repeat(MTM_AGENT_TAG_MAX_LENGTH - 1)}`)
    expect(validateMtmAgentTags(labels)).toEqual({ ok: true, tags: labels })
    const person: MtmDashboardAgent = {
      agentId: "a", name: "Əli Məmmədov", isOnline: true, fieldStatus: "ON_ROAD", freshness: "ONLINE", workdayState: "ACTIVE",
      locationState: "AVAILABLE", routeCompletion: 0, tags: labels,
    }
    const word = (value: unknown) => String(value)
    const sent = rosterExportTable([person], ROSTER_COLUMNS, {
      column: word, status: word, freshness: word, presence: word, workday: word, routeProgress: (done, total) => `${done}/${total}`,
      speed: word, distance: word, clock: word, dateTime: word, visitOpened: word, standingSince: word,
    })
    const cell = sent.rows[0][sent.headers.indexOf("tags")]
    expect(cell).toBe(labels.join(", "))

    const response = await exportPOST(exportRequest({ ...table, headers: sent.headers, rows: sent.rows }))

    expect(response.status).toBe(200)
    const sheet = await read(response)
    expect(sheet.rows[1][sent.headers.indexOf("tags")]).toBe(cell)
  })

  it("reads nothing of the tenant: it only puts the given words into a workbook", async () => {
    await exportPOST(exportRequest(table))
    const touched = Object.entries(prisma as unknown as Record<string, Record<string, { mock?: { calls: unknown[] } }>>)
      .flatMap(([model, methods]) => Object.entries(methods ?? {})
        .filter(([, method]) => (method?.mock?.calls.length ?? 0) > 0)
        .map(([method]) => `${model}.${method}`))
    // The module check of the Route & Field wrapper is the only read.
    expect(touched.filter((name) => name !== "organization.findUnique")).toEqual([])
  })

  it("refuses a table that is not a table", async () => {
    const bad: unknown[] = [
      "not json",
      {},
      { ...table, headers: [] },
      { ...table, rows: [["only one cell"]] },
      { ...table, fileName: "../../etc/passwd" },
      { ...table, fileName: "Отчёт" },
      { ...table, rows: [[1, 2, 3]] },
      { ...table, headers: Array.from({ length: 17 }, (_unused, index) => `c${index}`), rows: [] },
      { ...table, rows: [["a", "b", "x".repeat(301)]] },
      { ...table, rows: Array.from({ length: 1_001 }, () => ["a", "b", "c"]) },
    ]
    const answers = []
    for (const body of bad) {
      const response = await exportPOST(exportRequest(body))
      answers.push([response.status, (await response.json()).code])
      resetRateLimit(`mtm-live-map-export:${ORG}:${USER}`)
    }
    expect(answers).toEqual(Array.from({ length: bad.length }, () => [400, "MTM_LIVE_MAP_EXPORT_INVALID"]))
  })

  it("is for signed-in people of an organization that has the module, a few times a minute", async () => {
    let last = 200
    for (let turn = 0; turn < 11; turn += 1) last = (await exportPOST(exportRequest(table))).status
    expect(last).toBe(429)

    resetRateLimit(`mtm-live-map-export:${ORG}:${USER}`)
    vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
    expect((await exportPOST(exportRequest(table))).status).toBe(401)
  })
})
