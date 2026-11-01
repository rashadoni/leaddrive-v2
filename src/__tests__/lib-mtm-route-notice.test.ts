/** The agent's route notice in his own words (owner 2026-11-01): day, visits, no client names. */
import { describe, expect, it } from "vitest"
import { isRouteNoticeEvent, routeNotice, routeNoticeLocale } from "@/lib/mtm/route-notice"

const DAY = new Date("2026-11-05T00:00:00.000Z")

describe("the route notice", () => {
  it("speaks Azerbaijani unless the agent chose Russian or English", () => {
    expect([routeNoticeLocale("ru"), routeNoticeLocale("en"), routeNoticeLocale("az"), routeNoticeLocale(null), routeNoticeLocale("de")]).toEqual(["ru", "en", "az", "az", "az"])
  })

  it("names the day and counts the visits, in each language", () => {
    expect(routeNotice({ locale: "ru", event: "route_updated", routeDate: DAY, visitCount: 8 })).toEqual({ title: "Маршрут на 5 ноября изменён", body: "8 визитов. Откройте маршрут в приложении." })
    expect(routeNotice({ locale: "ru", event: "route_published", routeDate: DAY, visitCount: 3 }).body).toBe("3 визита. Откройте маршрут в приложении.")
    expect(routeNotice({ locale: "ru", event: "route_published", routeDate: DAY, visitCount: 21 }).body).toBe("21 визит. Откройте маршрут в приложении.")
    expect(routeNotice({ locale: "ru", event: "route_published", routeDate: DAY, visitCount: 12 }).body).toBe("12 визитов. Откройте маршрут в приложении.")
    expect(routeNotice({ locale: "az", event: "route_updated", routeDate: DAY, visitCount: 8 })).toEqual({ title: "Marşrut dəyişdi: 5 noyabr", body: "8 vizit. Tətbiqdə açın." })
    expect(routeNotice({ locale: "en", event: "route_published", routeDate: DAY, visitCount: 1 })).toEqual({ title: "Route for 5 November is ready", body: "1 visit. Open it in the app." })
  })

  it("says only «open it» for a route without visits", () => {
    expect(routeNotice({ locale: "ru", event: "route_updated", routeDate: DAY, visitCount: 0 }).body).toBe("Откройте маршрут в приложении.")
  })

  it("writes only the two route events", () => {
    expect([isRouteNoticeEvent("route_published"), isRouteNoticeEvent("route_updated"), isRouteNoticeEvent("route_change_approved"), isRouteNoticeEvent(undefined)]).toEqual([true, true, false, false])
  })
})
