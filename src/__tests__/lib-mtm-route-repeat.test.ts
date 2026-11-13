import { describe, expect, it, vi } from "vitest"
import {
  MTM_ROUTE_REPEAT_MAX_ROUTES,
  mtmRouteRepeatDates,
  mtmRouteRepeatPayload,
  runMtmRouteRepeat,
} from "@/lib/mtm/route-repeat"

/**
 * Zeytun 2026-11-13: «клиент хочет повторяющийся маршрут: например, он каждую
 * пятницу идёт по какому-то маршруту. Чтоб мог пересоздавать». Owner's mockup:
 * weekday, every week or every other, up to a date; busy and closed days are
 * skipped and named.
 */
const FRIDAY_ROUTE = {
  date: "2026-11-20T00:00:00.000Z",
  name: "Klinika 3 və apteklər",
  agentId: "agent-rashad",
  assignments: [
    { agentId: "agent-rashad", role: "PRIMARY" },
    { agentId: "manager-leyla", role: "OBSERVER" },
    { agentId: "agent-tural", role: "PARTICIPANT" },
  ],
  points: [
    { customerId: "pharmacy-92", contactId: null, orderIndex: 2, plannedTime: "2026-11-20T08:00:00.000Z" },
    { customerId: "clinic-3", contactId: "doctor-aliyeva", orderIndex: 0, plannedTime: "2026-11-20T06:00:00.000Z" },
    { customerId: "clinic-3", contactId: "doctor-huseynov", orderIndex: 1, plannedTime: null },
    { customerId: "gone", contactId: null, orderIndex: 3, plannedTime: null, deletedAt: "2026-11-10T00:00:00.000Z" },
  ],
}

describe("which dates a repeat makes", () => {
  it("every Friday after the route's own Friday, up to the end date inclusive", () => {
    expect(mtmRouteRepeatDates({ sourceDate: "2026-11-20", today: "2026-11-13", weekday: 5, everyWeeks: 1, until: "2026-12-18" }))
      .toEqual(["2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18"])
  })

  it("every other week keeps the route's own rhythm, and nothing lands in the past", () => {
    // An old Friday route repeated on Friday 2026-11-13: today is of its
    // fortnight but already under way, so the first copy is two weeks on.
    expect(mtmRouteRepeatDates({ sourceDate: "2026-10-30", today: "2026-11-13", weekday: 5, everyWeeks: 2, until: "2026-12-31" }))
      .toEqual(["2026-11-27", "2026-12-11", "2026-12-25"])
  })

  it("another weekday begins with the first such day after the route", () => {
    expect(mtmRouteRepeatDates({ sourceDate: "2026-11-20", today: "2026-11-13", weekday: 1, everyWeeks: 1, until: "2026-11-30" }))
      .toEqual(["2026-11-23", "2026-11-30"])
  })

  it("stops at the limit and refuses nonsense", () => {
    expect(mtmRouteRepeatDates({ sourceDate: "2026-11-20", today: "2026-11-13", weekday: 5, everyWeeks: 1, until: "2028-01-01" }))
      .toHaveLength(MTM_ROUTE_REPEAT_MAX_ROUTES)
    expect(mtmRouteRepeatDates({ sourceDate: "2026-11-20", today: "2026-11-13", weekday: 9, everyWeeks: 1, until: "2026-12-31" })).toEqual([])
    expect(mtmRouteRepeatDates({ sourceDate: "2026-11-20", today: "2026-11-13", weekday: 5, everyWeeks: 1, until: "" })).toEqual([])
  })
})

describe("what each copy is", () => {
  it("the same people and stops in order, each meeting at the same time of day, as a draft", () => {
    expect(mtmRouteRepeatPayload(FRIDAY_ROUTE, "2026-12-04")).toEqual({
      name: "Klinika 3 və apteklər",
      date: "2026-12-04",
      status: "DRAFT",
      agentId: "agent-rashad",
      // An observer watched that one route; he is not put on every Friday.
      assignments: [{ agentId: "agent-rashad", role: "PRIMARY" }, { agentId: "agent-tural", role: "PARTICIPANT" }],
      points: [
        { customerId: "clinic-3", contactId: "doctor-aliyeva", plannedTime: "2026-12-04T06:00:00.000Z" },
        { customerId: "clinic-3", contactId: "doctor-huseynov", plannedTime: null },
        { customerId: "pharmacy-92", contactId: null, plannedTime: "2026-12-04T08:00:00.000Z" },
      ],
    })
  })
})

describe("making the routes", () => {
  function server(refuse: Record<string, string>) {
    let id = 0
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/publish")) return new Response(JSON.stringify({ success: true, data: { version: 2 } }), { status: 200 })
      const date = JSON.parse(String(init?.body)).date as string
      if (refuse[date]) return new Response(JSON.stringify({ error: "no", code: refuse[date] }), { status: 409 })
      id += 1
      return new Response(JSON.stringify({ success: true, data: { id: `route-${id}`, version: 1 } }), { status: 201 })
    })
  }

  it("skips a busy date without asking, names a refused one, makes and publishes the rest", async () => {
    const fetch = server({ "2026-12-04": "MTM_ROUTE_NON_WORKING_DAY" })
    const outcomes = await runMtmRouteRepeat({
      source: FRIDAY_ROUTE,
      dates: ["2026-11-27", "2026-12-04", "2026-12-11"],
      busyDates: new Set(["2026-11-27"]),
      publish: true,
      fetch,
    })
    expect(outcomes).toEqual([
      { date: "2026-11-27", result: "skipped", reason: "busy" },
      { date: "2026-12-04", result: "skipped", reason: "closedDay", message: "no" },
      { date: "2026-12-11", result: "created", routeId: "route-1", published: true },
    ])
    const creates = fetch.mock.calls.filter(([url]) => url === "/api/v1/mtm/routes")
    expect(creates.map(([, init]) => JSON.parse(String(init?.body)).date)).toEqual(["2026-12-04", "2026-12-11"])
    expect(fetch).toHaveBeenCalledWith("/api/v1/mtm/routes/route-1/publish", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedVersion: 1 }),
    }))
  })

  it("leaves drafts as drafts when the source was a draft", async () => {
    const fetch = server({})
    const outcomes = await runMtmRouteRepeat({ source: FRIDAY_ROUTE, dates: ["2026-11-27"], busyDates: new Set(), publish: false, fetch })
    expect(outcomes).toEqual([{ date: "2026-11-27", result: "created", routeId: "route-1", published: false }])
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/publish"))).toBe(false)
  })
})
