/**
 * POST /api/v1/mtm/routes/order — the planner's day along the roads and the
 * order that drives less (owner 2026-11-01, mockup «MTM: порядок объезда
 * лучше»). OSRM is stood in for by a road table of kilometres on a line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

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

const deps = vi.hoisted(() => ({
  roadTable: vi.fn(),
  roadPath: vi.fn(),
  checkRateLimit: vi.fn(),
  hashForRateLimit: vi.fn(),
}))
vi.mock("@/lib/mtm/road-router", () => ({ roadTable: deps.roadTable, roadPath: deps.roadPath }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: deps.checkRateLimit, hashForRateLimit: deps.hashForRateLimit }))

import { POST } from "@/app/api/v1/mtm/routes/order/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"

/** Stops on a line, `km` apart from its start, two minutes a kilometre. */
function lineTable(km: number[]) {
  const metres = km.map((from) => km.map((to) => Math.abs(from - to) * 1_000))
  return { metres, seconds: metres.map((row) => row.map((value) => value * 0.12)) }
}

function request(body: unknown, headers: HeadersInit = {}) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/routes/order", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  })
}

const stop = (key: string, km: number, plannedTime: string) => ({ key, latitude: 40.4 + km / 111, longitude: 49.85, plannedTime })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "manager-user", role: "manager", email: "m@example.com", name: "Manager" } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "manager-agent", role: "MANAGER" } as never)
  deps.checkRateLimit.mockReturnValue(true)
  deps.hashForRateLimit.mockResolvedValue("rate-key")
  deps.roadPath.mockImplementation(async (points: Array<{ latitude: number; longitude: number }>) => points.map((point) => [point.latitude, point.longitude]))
})

describe("the day along the roads", () => {
  it("reads the order as it is and proposes one that drives the line once, on the same times by position", async () => {
    // 0, 8, 2, 6, 4 km: the agent zigzags 20 km.
    deps.roadTable.mockResolvedValue(lineTable([0, 8, 2, 6, 4]))
    const stops = [stop("a", 0, "09:30"), stop("b", 8, "10:30"), stop("c", 2, "11:30"), stop("d", 6, "12:30"), stop("e", 4, "13:30")]
    const response = await POST(request({ stops }), { params: Promise.resolve({}) } as never)
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    const { data } = await response.json()
    expect(data.current).toMatchObject({ order: ["a", "b", "c", "d", "e"], metres: 20_000, driveSeconds: 2_400, onTime: 5 })
    expect(data.proposed).toMatchObject({ order: ["a", "c", "e", "d", "b"], metres: 8_000, driveSeconds: 960, onTime: 5 })
    expect(data.reason).toEqual({ kind: "SHORTER", metres: 12_000, seconds: 1_440 })
    // Both ways are drawn along the roads, the proposed one in its own order.
    expect(deps.roadPath).toHaveBeenCalledTimes(2)
    expect(data.proposed.line).toHaveLength(5)
  })

  it("proposes nothing when the order a route has is already the best", async () => {
    deps.roadTable.mockResolvedValue(lineTable([0, 1, 2]))
    const response = await POST(request({ stops: [stop("a", 0, "09:30"), stop("b", 1, "10:30"), stop("c", 2, "11:30")] }), { params: Promise.resolve({}) } as never)
    const { data } = await response.json()
    expect(data.proposed).toBeNull()
    expect(data.reason).toBeNull()
    expect(data.current.arrivals).toEqual([570, 602, 662])
    expect(deps.roadPath).toHaveBeenCalledTimes(1)
  })

  it("answers 503 without roads, so the planner keeps its straight line", async () => {
    deps.roadTable.mockResolvedValue(null)
    const response = await POST(request({ stops: [stop("a", 0, "09:30"), stop("b", 1, "10:30")] }), { params: Promise.resolve({}) } as never)
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe("MTM_ROUTE_ORDER_ROADS_UNAVAILABLE")
  })

  it("refuses a repeated stop, a bad time, too many stops and a call from outside the page", async () => {
    deps.roadTable.mockResolvedValue(lineTable([0, 1]))
    const call = (body: unknown, headers?: HeadersInit) => POST(request(body, headers), { params: Promise.resolve({}) } as never)
    expect((await call({ stops: [stop("a", 0, "09:30"), stop("a", 1, "10:30")] })).status).toBe(400)
    expect((await call({ stops: [stop("a", 0, "9:30"), stop("b", 1, "10:30")] })).status).toBe(400)
    expect((await call({ stops: Array.from({ length: 26 }, (_, index) => stop(`s${index}`, index, "09:30")) })).status).toBe(400)
    expect((await call({ stops: [stop("a", 0, "09:30"), stop("b", 1, "10:30")] }, { "sec-fetch-site": "cross-site" })).status).toBe(403)
    expect(deps.roadTable).not.toHaveBeenCalled()
  })

  it("slows down a page that asks too often", async () => {
    deps.checkRateLimit.mockReturnValue(false)
    const response = await POST(request({ stops: [stop("a", 0, "09:30"), stop("b", 1, "10:30")] }), { params: Promise.resolve({}) } as never)
    expect(response.status).toBe(429)
  })
})

describe("«часы приёма» on the day (owner 2026-11-02)", () => {
  it("counts the lunch wait and moves a clinic that closes at 10:30 before it closes", async () => {
    deps.roadTable.mockResolvedValue(lineTable([0, 2, 4]))
    const stops = [
      stop("a", 0, "09:00"),
      { ...stop("b", 2, "10:00"), hours: { open: "09:00", close: "20:00", breakFrom: "13:00", breakTo: "14:00" } },
      { ...stop("c", 4, "11:00"), hours: { open: "08:00", close: "10:30" } },
    ]
    const response = await POST(request({ stops }), { params: Promise.resolve({}) } as never)
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.current).toMatchObject({ closed: [false, false, true], hoursKnown: 2, inHours: 1 })
    expect(data.proposed.closed).toEqual([false, false, false])
    expect(data.proposed.order.indexOf("c")).toBeLessThan(2)
    expect(data.reason).toEqual({ kind: "CLOSED_FIXED", stop: "c" })
  })

  it("keeps a place that does not work that day closed in every order and ignores a day that reads backwards", async () => {
    deps.roadTable.mockResolvedValue(lineTable([0, 1, 2]))
    const stops = [stop("a", 0, "09:00"), { ...stop("b", 1, "10:00"), hours: null }, { ...stop("c", 2, "11:00"), hours: { open: "18:00", close: "09:00" } }]
    const { data } = await (await POST(request({ stops }), { params: Promise.resolve({}) } as never)).json()
    expect(data.current.closed).toEqual([false, true, false])
    expect(data.current.hoursKnown).toBe(1)
  })
})

