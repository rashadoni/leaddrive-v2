import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  combineMtmDayRoutes,
  deriveMtmLiveFieldStatus,
  isMtmAgentMoving,
  type MtmLiveFieldStatusInput,
} from "@/lib/mtm/live-field-status"
import { FIELD_STATUS_LABEL_KEYS } from "@/lib/mtm-types"

function input(patch: Partial<MtmLiveFieldStatusInput> = {}): MtmLiveFieldStatusInput {
  return {
    freshness: "ONLINE",
    isCheckedIn: false,
    isOnline: true,
    isMoving: false,
    dayRoutes: null,
    tenantHour: 12,
    lateAfterHour: 10,
    ...patch,
  }
}

const route = (status: string, totalPoints: number, visitedPoints: number) => ({ status, totalPoints, visitedPoints })

describe("combineMtmDayRoutes (review of #205: several routes a day)", () => {
  it("does not call the day finished while another route is running", () => {
    expect(combineMtmDayRoutes([route("CANCELLED", 3, 0), route("IN_PROGRESS", 4, 1)])?.state).toBe("ACTIVE")
    expect(combineMtmDayRoutes([route("IN_PROGRESS", 4, 1), route("CANCELLED", 3, 0)])?.state).toBe("ACTIVE")
    expect(combineMtmDayRoutes([route("COMPLETED", 2, 2), route("PLANNED", 3, 0)])?.state).toBe("ACTIVE")
  })

  it("is finished only when every counted route is closed or fully visited", () => {
    expect(combineMtmDayRoutes([route("COMPLETED", 2, 2), route("IN_PROGRESS", 3, 3), route("CANCELLED", 5, 0)])).toEqual({
      state: "FINISHED",
      totalPoints: 5,
      visitedPoints: 5,
      completion: 100,
    })
    expect(combineMtmDayRoutes([route("INCOMPLETE", 4, 1), route("DRAFT", 2, 0)])?.state).toBe("FINISHED")
  })

  it("ignores drafts and cancelled routes; with nothing else there is no route", () => {
    expect(combineMtmDayRoutes([route("CANCELLED", 2, 0)])).toBeNull()
    expect(combineMtmDayRoutes([route("DRAFT", 2, 0)])).toBeNull()
    expect(combineMtmDayRoutes([])).toBeNull()
  })

  it("is not started only when every counted route is published and untouched", () => {
    expect(combineMtmDayRoutes([route("PLANNED", 2, 0), route("PLANNED", 1, 0), route("CANCELLED", 2, 1)])?.state).toBe("NOT_STARTED")
    expect(combineMtmDayRoutes([route("IN_PROGRESS", 0, 0)])?.state).toBe("ACTIVE")
  })

  it("sums completion across counted routes", () => {
    expect(combineMtmDayRoutes([route("COMPLETED", 2, 2), route("IN_PROGRESS", 2, 0)])?.completion).toBe(50)
  })
})

describe("deriveMtmLiveFieldStatus (prod audit 2026-09-14: «Yolda» after the route was done)", () => {
  it("calls a motionless agent whose day is done «route finished», not «on the road»", () => {
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes: combineMtmDayRoutes([route("IN_PROGRESS", 2, 2)]) }))).toBe("ROUTE_FINISHED")
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes: combineMtmDayRoutes([route("INCOMPLETE", 2, 1)]), isMoving: true }))).toBe("ROUTE_FINISHED")
  })

  it("keeps a running afternoon route active next to a cancelled morning one", () => {
    const dayRoutes = combineMtmDayRoutes([route("CANCELLED", 3, 0), route("IN_PROGRESS", 3, 1)])
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes, isMoving: true }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes }))).toBe("STOPPED")
  })

  it("requires movement for ON_ROAD; an online agent standing still is STOPPED", () => {
    expect(deriveMtmLiveFieldStatus(input({ isMoving: true }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes: combineMtmDayRoutes([route("IN_PROGRESS", 3, 1)]), isMoving: true, isOnline: false }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input())).toBe("STOPPED")
  })

  it("keeps the earlier precedence for stale GPS, open visits and a late start", () => {
    expect(deriveMtmLiveFieldStatus(input({ freshness: "STALE", isCheckedIn: true }))).toBe("OFFLINE")
    expect(deriveMtmLiveFieldStatus(input({ freshness: "NO_LOCATION" }))).toBe("OFFLINE")
    expect(deriveMtmLiveFieldStatus(input({ isCheckedIn: true, dayRoutes: combineMtmDayRoutes([route("COMPLETED", 1, 1)]) }))).toBe("CHECKED_IN")
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes: combineMtmDayRoutes([route("PLANNED", 2, 0)]) }))).toBe("LATE")
    // One route already done this morning: the day has started, so not «late».
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes: combineMtmDayRoutes([route("COMPLETED", 1, 1), route("PLANNED", 2, 0)]) }))).toBe("STOPPED")
    expect(deriveMtmLiveFieldStatus(input({ dayRoutes: combineMtmDayRoutes([route("PLANNED", 2, 0)]), tenantHour: 9, isMoving: true }))).toBe("ON_ROAD")
    expect(deriveMtmLiveFieldStatus(input({ isOnline: false }))).toBe("OFFLINE")
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

describe("isMtmAgentMoving (review of #205: a red light is not «Dayanıb»)", () => {
  const now = new Date("2026-09-14T13:00:00.000Z")
  const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1_000)
  const here = { latitude: 40.4093, longitude: 49.8671 }

  it("stays moving when the newest sample is still but the car moved a minute ago", () => {
    expect(isMtmAgentMoving({
      now,
      samples: [
        { ...here, recordedAt: at(10), isMoving: false, speed: 0 },
        { latitude: 40.4113, longitude: 49.8671, recordedAt: at(60), isMoving: true, speed: 9 },
      ],
    })).toBe(true)
  })

  it("stays moving when only the database remembers the last moving sample", () => {
    expect(isMtmAgentMoving({
      now,
      samples: [{ ...here, recordedAt: at(10), isMoving: false }],
      lastMovingAt: at(120),
    })).toBe(true)
  })

  it("counts displacement beyond 50 m within the dwell as movement even without a flag", () => {
    expect(isMtmAgentMoving({
      now,
      samples: [
        { ...here, recordedAt: at(10), isMoving: false },
        { latitude: 40.4099, longitude: 49.8671, recordedAt: at(200), isMoving: false },
      ],
    })).toBe(true)
  })

  it("is stopped after five minutes without movement within 50 m", () => {
    expect(isMtmAgentMoving({
      now,
      samples: [
        { ...here, recordedAt: at(10), isMoving: false, speed: 0.3 },
        { latitude: 40.4095, longitude: 49.8672, recordedAt: at(120), isMoving: false },
        // Moving, but outside the dwell window.
        { latitude: 40.42, longitude: 49.87, recordedAt: at(400), isMoving: true, speed: 12 },
      ],
      lastMovingAt: at(400),
    })).toBe(false)
  })

  it("trusts a moving newest sample and has no opinion without samples", () => {
    expect(isMtmAgentMoving({ now, samples: [{ ...here, recordedAt: at(5), isMoving: false, speed: 4 }] })).toBe(true)
    expect(isMtmAgentMoving({ now, samples: [] })).toBe(false)
  })
})
