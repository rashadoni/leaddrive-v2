import { describe, expect, it } from "vitest"
import { isMtmWorkdayLeftOpen, mtmManagerWorkdayState, MTM_WORKDAY_OPEN_ANOMALY_HOURS } from "@/lib/mtm/workday-open-anomaly"
import { mtmAgentPresence, mtmAgentSilenceExplained } from "@/lib/mtm/agent-day-state"

/**
 * Prod 2026-09-14, Anar Mammadov: workday started 11 Sep 20:57 (Baku), never
 * closed. The Panel said «Başlamayıb», the map «İş günü aktivdir», the agents
 * list "not started". One state for all of them: left open, 3 days.
 */
const NOW = new Date("2026-09-14T11:00:00.000Z") // 15:00 in Baku
const ANAR_OPEN = { status: "STARTED", workDate: new Date("2026-09-11T00:00:00.000Z"), startedAt: new Date("2026-09-11T16:57:00.000Z") }

describe("manager workday state", () => {
  it("names a shift open since an earlier day as left open, with calendar days", () => {
    const state = mtmManagerWorkdayState({ today: null, active: ANAR_OPEN, now: NOW, todayKey: "2026-09-14" })
    expect(state).toEqual({
      kind: "left-open",
      since: "2026-09-11T16:57:00.000Z",
      workDate: "2026-09-11",
      days: 3,
      hours: 66,
      status: "STARTED",
    })
  })

  it("wins over 'not started today', which is only true because of it", () => {
    expect(mtmManagerWorkdayState({ today: null, active: ANAR_OPEN, now: NOW, todayKey: "2026-09-14" }).kind).toBe("left-open")
    expect(mtmManagerWorkdayState({ today: null, active: null, now: NOW, todayKey: "2026-09-14" })).toEqual({ kind: "not-started" })
  })

  it("flags a same-day shift only after the 16 h threshold", () => {
    const startedAt = new Date(NOW.getTime() - MTM_WORKDAY_OPEN_ANOMALY_HOURS * 3_600_000 + 60_000)
    const fresh = { status: "STARTED", workDate: "2026-09-14", startedAt }
    expect(isMtmWorkdayLeftOpen(fresh, NOW, "2026-09-14")).toBe(false)
    expect(mtmManagerWorkdayState({ today: fresh, now: NOW, todayKey: "2026-09-14" })).toEqual({ kind: "working", since: startedAt.toISOString() })

    const stale = { ...fresh, startedAt: new Date(NOW.getTime() - (MTM_WORKDAY_OPEN_ANOMALY_HOURS + 1) * 3_600_000) }
    const state = mtmManagerWorkdayState({ today: stale, now: NOW, todayKey: "2026-09-14" })
    expect(state).toMatchObject({ kind: "left-open", days: 0, hours: 17 })
  })

  it("does not flag a shift just because it crossed midnight (review of #210)", () => {
    // Started 22:00 Baku on 13 Sep, read at 00:05 on 14 Sep: 2 h of work.
    const lateStart = { status: "STARTED", workDate: "2026-09-13", startedAt: "2026-09-13T18:00:00.000Z" }
    const justAfterMidnight = new Date("2026-09-13T20:05:00.000Z")
    expect(isMtmWorkdayLeftOpen(lateStart, justAfterMidnight, "2026-09-14")).toBe(false)
    // No row for today yet: the open row speaks for the day instead of "not started".
    expect(mtmManagerWorkdayState({ today: null, active: lateStart, now: justAfterMidnight, todayKey: "2026-09-14" }))
      .toEqual({ kind: "working", since: "2026-09-13T18:00:00.000Z" })

    // 17 h later it is an anomaly, labelled in hours (not yet a full day).
    const nextMorning = new Date("2026-09-14T11:01:00.000Z")
    expect(mtmManagerWorkdayState({ active: lateStart, now: nextMorning, todayKey: "2026-09-14" }))
      .toMatchObject({ kind: "left-open", days: 0, hours: 17, workDate: "2026-09-13" })

    // After a full day the label switches to calendar days: 13 → 15 Sep = 2.
    const dayAfter = new Date("2026-09-15T06:00:00.000Z")
    expect(mtmManagerWorkdayState({ active: lateStart, now: dayAfter, todayKey: "2026-09-15" }))
      .toMatchObject({ kind: "left-open", days: 2, hours: 36 })
  })

  it("keeps a paused anomaly paused in its status, and never flags a closed day", () => {
    expect(mtmManagerWorkdayState({ active: { ...ANAR_OPEN, status: "PAUSED" }, now: NOW, todayKey: "2026-09-14" }))
      .toMatchObject({ kind: "left-open", status: "PAUSED" })
    const closed = { status: "COMPLETED", workDate: "2026-09-11", startedAt: ANAR_OPEN.startedAt, completedAt: "2026-09-11T20:00:00.000Z" }
    expect(isMtmWorkdayLeftOpen(closed, NOW, "2026-09-14")).toBe(false)
    expect(mtmManagerWorkdayState({ today: closed, now: NOW, todayKey: "2026-09-14" })).toEqual({ kind: "finished", at: "2026-09-11T20:00:00.000Z" })
  })

  it("reports ordinary states unchanged", () => {
    const today = { status: "PAUSED", workDate: "2026-09-14", startedAt: "2026-09-14T05:00:00.000Z", pausedAt: "2026-09-14T09:05:00.000Z" }
    expect(mtmManagerWorkdayState({ today, now: NOW, todayKey: "2026-09-14" })).toEqual({ kind: "paused", since: "2026-09-14T09:05:00.000Z" })
  })
})

describe("shared presence helper opts into the same state", () => {
  it("keeps its old output when the caller passes no clock", () => {
    expect(mtmAgentPresence({ status: "STARTED", startedAt: "2026-09-11T16:57:00.000Z" })).toEqual({ kind: "working", since: "2026-09-11T16:57:00.000Z" })
    expect(mtmAgentPresence(null)).toEqual({ kind: "not-started" })
  })

  it("returns left-open for the carried-over shift when given the clock and the open row", () => {
    const presence = mtmAgentPresence(null, { now: NOW, todayKey: "2026-09-14", active: ANAR_OPEN })
    expect(presence).toEqual({ kind: "left-open", since: "2026-09-11T16:57:00.000Z", workDate: "2026-09-11", days: 3, hours: 66 })
    // A shift nobody closed does not explain GPS silence.
    expect(mtmAgentSilenceExplained(presence)).toBe(false)
  })
})
