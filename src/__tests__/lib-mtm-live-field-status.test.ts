import { describe, expect, it } from "vitest"
import { deriveMtmLiveFieldStatus, isMtmRouteFinished, type MtmLiveFieldStatusInput } from "@/lib/mtm/live-field-status"
import { FIELD_STATUS_LABEL_KEYS } from "@/lib/mtm-types"
import { readFileSync } from "node:fs"

function input(patch: Partial<MtmLiveFieldStatusInput> = {}): MtmLiveFieldStatusInput {
  return {
    freshness: "ONLINE",
    isCheckedIn: false,
    isOnline: true,
    isMoving: false,
    route: null,
    tenantHour: 12,
    lateAfterHour: 10,
    ...patch,
  }
}

describe("deriveMtmLiveFieldStatus (prod audit 2026-09-14: «Yolda» after the route was done)", () => {
  it("calls a motionless agent with a completed route «route finished», not «on the road»", () => {
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "IN_PROGRESS", totalPoints: 2, visitedPoints: 2 } }))).toBe("ROUTE_FINISHED")
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "COMPLETED", totalPoints: 2, visitedPoints: 1 } }))).toBe("ROUTE_FINISHED")
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "INCOMPLETE", totalPoints: 2, visitedPoints: 1 }, isMoving: true }))).toBe("ROUTE_FINISHED")
  })

  it("requires movement for ON_ROAD; an online agent standing still is STOPPED", () => {
    expect(deriveMtmLiveFieldStatus(input({ isMoving: true }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "IN_PROGRESS", totalPoints: 3, visitedPoints: 1 }, isMoving: true, isOnline: false }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input())).toBe("STOPPED")
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "IN_PROGRESS", totalPoints: 3, visitedPoints: 1 } }))).toBe("STOPPED")
  })

  it("keeps the earlier precedence for stale GPS, open visits and a late start", () => {
    expect(deriveMtmLiveFieldStatus(input({ freshness: "STALE", isCheckedIn: true }))).toBe("OFFLINE")
    expect(deriveMtmLiveFieldStatus(input({ freshness: "NO_LOCATION" }))).toBe("OFFLINE")
    expect(deriveMtmLiveFieldStatus(input({ isCheckedIn: true, route: { status: "COMPLETED", totalPoints: 1, visitedPoints: 1 } }))).toBe("CHECKED_IN")
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "PLANNED", totalPoints: 2, visitedPoints: 0 } }))).toBe("LATE")
    expect(deriveMtmLiveFieldStatus(input({ route: { status: "PLANNED", totalPoints: 2, visitedPoints: 0 }, tenantHour: 9, isMoving: true }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input({ isOnline: false }))).toBe("OFFLINE")
  })

  it("does not treat an empty in-progress route as finished", () => {
    expect(isMtmRouteFinished({ status: "IN_PROGRESS", totalPoints: 0, visitedPoints: 0 })).toBe(false)
    expect(isMtmRouteFinished(null)).toBe(false)
  })

  it("has a label for every status in every language", () => {
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of Object.values(FIELD_STATUS_LABEL_KEYS)) {
        expect(messages.mtmMap.fieldStatus[key], `${locale} mtmMap.fieldStatus.${key}`).toEqual(expect.any(String))
      }
    }
  })
})
