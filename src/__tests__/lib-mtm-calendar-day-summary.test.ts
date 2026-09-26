import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { isMtmRouteShortOfPlan, summarizeMtmCalendarDay } from "@/lib/mtm/calendar-day-summary"

/**
 * Routes audit 2026-09-26, item 2: a team calendar cell showed three routes
 * and «+ещё 6», cut off, and never said who fell short of the plan.
 */
const route = (status: "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "CANCELLED", visitedPoints: number, totalPoints: number) =>
  ({ status, visitedPoints, totalPoints })

describe("a team calendar day in numbers", () => {
  // A demo-tenant day: nine agents, one plan still a draft, one withdrawn.
  const day = [
    route("COMPLETED", 5, 5),
    route("COMPLETED", 5, 5),
    route("COMPLETED", 3, 5), // «Завершён» with two stops nobody visited
    route("INCOMPLETE", 2, 4),
    route("COMPLETED", 4, 4),
    route("COMPLETED", 6, 6),
    route("COMPLETED", 5, 5),
    route("DRAFT", 0, 3),
    route("CANCELLED", 0, 5),
  ]

  it("counts routes, stops done of stops planned, and the routes that fell short", () => {
    expect(summarizeMtmCalendarDay(day, true)).toEqual({ routes: 8, drafts: 1, planned: 34, visited: 30, missed: 2 })
  })

  it("keeps drafts and withdrawn plans out of the stops: the agent never had them", () => {
    expect(summarizeMtmCalendarDay([route("DRAFT", 0, 3), route("CANCELLED", 0, 5)], true)).toEqual({ routes: 1, drafts: 1, planned: 0, visited: 0, missed: 0 })
  })

  it("does not call a route short while its day is still going", () => {
    expect(isMtmRouteShortOfPlan(route("IN_PROGRESS", 1, 4), false)).toBe(false)
    expect(isMtmRouteShortOfPlan(route("PLANNED", 0, 4), false)).toBe(false)
    // Finished early by the agent: short today already.
    expect(isMtmRouteShortOfPlan(route("COMPLETED", 3, 5), false)).toBe(true)
    // The day is over and the day-close job has not marked it yet.
    expect(isMtmRouteShortOfPlan(route("PLANNED", 0, 3), true)).toBe(true)
    expect(isMtmRouteShortOfPlan(route("COMPLETED", 5, 5), true)).toBe(false)
  })
})

describe("the team calendar cell and day list", () => {
  const calendar = readFileSync("src/components/mtm/route-calendar.tsx", "utf8")

  it("shows the day in numbers instead of three cut-off routes and «+N more»", () => {
    expect(calendar).not.toContain("day.routes.slice(0, 3)")
    expect(calendar).not.toContain("calendarMore")
    expect(calendar).toContain('data-testid="mtm-route-calendar-day-summary"')
    expect(calendar).toContain('t("calendarDayVisited", { visited: summary.visited, planned: summary.planned })')
    expect(calendar).toContain('t("calendarDayMissed", { count: summary.missed })')
  })

  it("opens the day's list on a click, on the desktop grid as on the phone, short routes first", () => {
    const summaryButton = calendar.slice(calendar.indexOf('data-testid="mtm-route-calendar-day-summary"'), calendar.indexOf('data-testid="mtm-route-calendar-day-summary"') + 900)
    expect(summaryButton).toContain("selectDate(key)")
    expect(summaryButton).toContain("revealSelectedDayPanel()")
    // One panel under both grids, not inside the phone-only block.
    const phoneBlock = calendar.slice(calendar.indexOf('data-testid="mtm-mobile-calendar-agenda"'), calendar.indexOf('<div className="hidden grid-cols-7 xl:grid">'))
    expect(phoneBlock).not.toContain('data-testid="mtm-route-calendar-selected-day"')
    expect(calendar).toContain("isMtmRouteShortOfPlan(b, selectedDayIsPast)) - Number(isMtmRouteShortOfPlan(a, selectedDayIsPast))")
    expect(calendar).toContain('t("weekStopsMissed", { count: route.totalPoints - route.visitedPoints })')
  })

  it("dims a past day's background, not its result", () => {
    expect(calendar).not.toContain('isPastDay ? "bg-card opacity-60"')
  })
})

describe("routes audit 2026-09-26: all routes", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")

  it("is one row per route — who, when, what came of it — not half a screen of chips and buttons", () => {
    const list = page.slice(page.indexOf('data-testid="mtm-route-list-item"'), page.indexOf('data-testid="mtm-route-list-load-more"'))
    expect(list).not.toContain("route.points.map((p: MtmRoutePoint, i: number) =>")
    expect(list).not.toContain('{t("viewRoute")}')
    expect(list).toContain("onClick={() => openRouteDetails(route)}")
    expect(list).toContain("{route.visitedPoints}/{route.totalPoints}")
    expect(list).toContain('t("weekStopsMissed", { count: route.totalPoints - route.visitedPoints })')
  })

  it("reaches every route, not only the latest 200", () => {
    expect(page).toContain("fetch(`/api/v1/mtm/routes?limit=200&page=${nextPage}`, { headers })")
    expect(page).toContain("{routesTotal > routes.length ? (")
    // A reload in between must not glue an old page onto the new list.
    expect(page).toContain("if (routeRequestRef.current.id !== requestId) return")
  })
})
