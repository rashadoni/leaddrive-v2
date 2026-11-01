import { describe, expect, it } from "vitest"
import { buildMtmAttendanceReport, type MtmAttendanceWorkday } from "@/lib/mtm/attendance-report"
import { attendanceDayPlanFact } from "@/lib/mtm/attendance-plan-fact"

/**
 * «Plan / fact» of a day (owner, 2026-11-01, after the HRSS clip). Built from the real report
 * builder, not from a hand-made row: the card must say what the timesheet says.
 */
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
/** `pause` is a break the employee pressed, as the phone writes it: PAUSE then RESUME. */
const day = (id: string, date: string, start: string, finish: string | null, pause?: [string, string]): MtmAttendanceWorkday => ({
  id, agentId: "e", workDate: date, status: finish ? "COMPLETED" : "STARTED", startedAt: at(date, start), completedAt: finish ? at(date, finish) : null,
  totalPausedSeconds: pause ? (Date.parse(at(date, pause[1])) - Date.parse(at(date, pause[0]))) / 1000 : 0,
  events: [{ type: "START", occurredAt: at(date, start) },
    ...(pause ? [{ type: "PAUSE" as const, occurredAt: at(date, pause[0]) }, { type: "RESUME" as const, occurredAt: at(date, pause[1]) }] : []),
    ...(finish ? [{ type: "FINISH" as const, occurredAt: at(date, finish) }] : [])],
}) as MtmAttendanceWorkday
const rowsOf = (workdays: MtmAttendanceWorkday[], from = "2026-10-12", to = "2026-10-18") => buildMtmAttendanceReport({ from, to, now: "2026-10-20T08:00:00Z", rules: [], calendar: [],
  employees: [{ id: "e", name: "Fictional employee", teamId: null, teamName: null }], workdays }).rows
const on = (date: string, workdays: MtmAttendanceWorkday[]) => attendanceDayPlanFact(rowsOf(workdays).find(row => row.date === date)!)

describe("plan / fact of one day", () => {
  it("a late start and an early leave: the worked hours fall short of the norm and the card says so", () => {
    const fact = on("2026-10-13", [day("d", "2026-10-13", "09:40", "17:10")])
    expect(fact.plan).not.toBeNull()
    expect(fact).toMatchObject({ lateSeconds: 40 * 60, earlyLeaveSeconds: 50 * 60, normSeconds: 8 * 3600, short: true, overtimeSeconds: 0 })
    expect(fact.workedSeconds).toBeLessThan(8 * 3600)
  })
  it("a long day with no threshold: every hour over the norm is overtime, as in the timesheet", () => {
    const fact = on("2026-10-14", [day("d", "2026-10-14", "08:00", "20:00")])
    expect(fact.short).toBe(false)
    expect(fact.overtimeSeconds).toBe(fact.workedSeconds! - 8 * 3600)
    expect(fact.overtimeSeconds).toBeGreaterThan(0)
  })
  it("a day still going: the fact has no end, nothing is short and overtime is not known yet", () => {
    const fact = attendanceDayPlanFact(buildMtmAttendanceReport({ from: "2026-10-14", to: "2026-10-14", now: "2026-10-14T08:00:00Z", rules: [], calendar: [],
      employees: [{ id: "e", name: "Fictional employee", teamId: null, teamName: null }], workdays: [day("d", "2026-10-14", "09:05", null)] }).rows[0])
    expect(fact.actual).toEqual({ start: new Date(at("2026-10-14", "09:05")).toISOString(), end: null, open: true })
    expect(fact).toMatchObject({ short: false, overtimeSeconds: null })
  })
  it("a day off has no schedule window and no norm", () => {
    const fact = on("2026-10-18", [])
    expect(fact).toMatchObject({ plan: null, normSeconds: 0, workedSeconds: 0, short: false })
  })
  it("the breaks pressed are the breaks; an unpressed lunch is named separately", () => {
    const pressed = on("2026-10-15", [day("d", "2026-10-15", "09:00", "18:00", ["13:00", "13:30"])])
    expect(pressed.pausedSeconds).toBe(1800)
    const none = on("2026-10-16", [day("d", "2026-10-16", "09:00", "18:00")])
    expect(none.lunchAutoSeconds).toBeGreaterThan(0)
    expect(none.workedSeconds).toBe(8 * 3600)
  })
})
