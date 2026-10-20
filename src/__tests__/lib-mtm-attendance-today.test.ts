import { describe, expect, it } from "vitest"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { attendanceAskableExplanations, attendanceExplanationKey, attendanceNewlyAskable, attendanceRowExplanation, attendanceTodayRange, attendanceWeekStart, summarizeAttendanceToday, type AttendanceTodayExplanation } from "@/lib/mtm/attendance-today"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"

// Wednesday 14 October 2026, 12:00 in Baku: past the 09:00 start and its grace.
const today = "2026-10-14"
const now = "2026-10-14T08:00:00Z"
const at = (date: string, time: string) => `${date}T${time}:00+04:00`
const kinds = defaultAttendanceDayKinds(() => ({ az: "Fixture", ru: "Fixture", en: "Fixture" }))
const leave: AttendanceApprovedPeriod = { id: "leave", agentId: "on-leave", startDate: "2026-10-13", endDate: "2026-10-16", decidedAt: "2026-10-01T08:00:00Z",
  details: { kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", dayKind: kinds.find(kind => kind.key === "ANNUAL_LEAVE")! } }
const day = (agentId: string, date: string, start: string, finish: string | null) => ({
  id: `${agentId}-${date}`, agentId, workDate: date, status: finish ? "COMPLETED" : "STARTED", startedAt: at(date, start), completedAt: finish ? at(date, finish) : null, totalPausedSeconds: 0,
  events: [{ type: "START", occurredAt: at(date, start) }, ...(finish ? [{ type: "FINISH", occurredAt: at(date, finish) }] : [])],
})

function report() {
  const range = attendanceTodayRange(today)
  return buildMtmAttendanceReport({
    from: range.from, to: range.to, now, rules: [], calendar: [], dayKinds: kinds, approvedRequests: [leave],
    employees: ["on-time", "late", "absent", "on-leave", "forgot"].map(id => ({ id, name: `Fictional ${id}`, teamId: null, teamName: null })),
    workdays: [
      day("on-time", today, "08:58", null),
      day("late", today, "09:25", null),
      day("forgot", "2026-10-13", "09:00", null),
      day("forgot", today, "09:05", null),
      ...["2026-10-12", "2026-10-13"].flatMap(date => [day("on-time", date, "09:00", "18:00"), day("late", date, "09:00", "18:00")]),
    ],
  }).rows
}

describe("Personnel → Today summary", () => {
  it("reads the week from Monday plus a seven-day lookback", () => {
    expect(attendanceWeekStart(today)).toBe("2026-10-12")
    expect(attendanceWeekStart("2026-10-18")).toBe("2026-10-12")
    expect(attendanceTodayRange(today)).toEqual({ from: "2026-10-07", to: "2026-10-18", weekStart: "2026-10-12" })
  })

  it("counts today with the report's own rules on report-built rows", () => {
    const summary = summarizeAttendanceToday(report(), today)
    // Leave is not expected at work and is not an unexcused absence.
    expect(summary).toMatchObject({ expected: 4, arrived: 3, late: 1, absent: 1, away: 1, missingFinish: 1, people: 5 })
  })

  it("lists only people with something to do, each once per fact, with the action's data", () => {
    const summary = summarizeAttendanceToday(report(), today)
    expect(summary.attention.map(item => [item.type, item.employeeId, item.date])).toEqual([
      ["absent", "absent", today],
      ["late", "late", today],
      ["missing-finish", "forgot", "2026-10-13"],
    ])
    const late = summary.attention.find(item => item.type === "late")
    expect(late && late.type === "late" ? late.lateSeconds : 0).toBe(25 * 60)
    expect(summary.quiet).toBe(2)
  })

  it("builds working days of the week, past and planned, and drops an idle weekend", () => {
    const week = summarizeAttendanceToday(report(), today).week
    expect(week.map(day => day.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"])
    // Monday: the leave starts on Tuesday, so that person was still expected.
    expect(week[0]).toMatchObject({ future: false, expected: 5, present: 2, absent: 3, away: 0 })
    expect(week[2]).toMatchObject({ future: false, expected: 4, present: 3, late: 1, away: 1 })
    expect(week[3]).toMatchObject({ future: true, expected: 4, present: 0, away: 1, absent: 0 })
  })
})

// Owner, 2026-10-16: who is at work, on a break, gone, or not yet in — right now.
describe("Personnel → Today → Now", () => {
  it("sorts today's people into at work, on a break, gone and not yet in", async () => {
    const { attendanceNow } = await import("@/lib/mtm/attendance-today")
    const range = attendanceTodayRange(today)
    const rows = buildMtmAttendanceReport({
      from: range.from, to: range.to, now, rules: [], calendar: [], dayKinds: kinds, approvedRequests: [leave],
      employees: ["on-time", "on-break", "gone", "absent", "on-leave"].map(id => ({ id, name: `Fictional ${id}`, teamId: null, teamName: null })),
      workdays: [
        day("on-time", today, "08:58", null),
        { ...day("on-break", today, "09:05", null), status: "PAUSED",
          events: [{ type: "START", occurredAt: at(today, "09:05") }, { type: "PAUSE", occurredAt: at(today, "11:00") }] },
        day("gone", today, "07:00", "10:30"),
      ],
    }).rows
    const result = attendanceNow(rows, today)
    expect(result.working.map(person => person.employeeId)).toEqual(["on-time"])
    expect(result.working[0].at).toBe(rows.find(row => row.employeeId === "on-time" && row.date === today)!.startedAt)
    expect(result.paused.map(person => [person.employeeId, person.at])).toEqual([["on-break", new Date(at(today, "11:00")).toISOString()]])
    expect(result.left.map(person => person.employeeId)).toEqual(["gone"])
    // The unexplained first; leave carries its day kind, an absence carries none.
    expect(result.notYet.map(person => [person.employeeId, person.dayKind?.key ?? null])).toEqual([["absent", null], ["on-leave", "ANNUAL_LEAVE"]])
  })

  it("lists nobody on a day off", async () => {
    const { attendanceNow } = await import("@/lib/mtm/attendance-today")
    const saturday = "2026-10-17"
    const rows = buildMtmAttendanceReport({ from: saturday, to: saturday, now: "2026-10-17T08:00:00Z", rules: [], calendar: [], dayKinds: kinds,
      employees: [{ id: "a", name: "Fictional a", teamId: null, teamName: null }], workdays: [] }).rows
    expect(attendanceNow(rows, saturday)).toEqual({ working: [], paused: [], left: [], notYet: [] })
  })
})

const explanation = (employeeId: string, kind: "LATE" | "ABSENT", status: AttendanceTodayExplanation["status"]): AttendanceTodayExplanation =>
  ({ employeeId, employeeName: `Fictional ${employeeId}`, date: today, kind, status })

describe("Personnel → Today: asking for explanations in one click", () => {
  const attention = () => summarizeAttendanceToday(report(), today).attention

  it("offers the late and the absent of today, not a missing finish, and not one already asked", () => {
    const keys = attendanceAskableExplanations(attention(), [])
    expect(keys).toEqual([attendanceExplanationKey("absent", today, "ABSENT"), attendanceExplanationKey("late", today, "LATE")])
    // Asked, answered or written by the employee himself: nothing left to ask.
    expect(attendanceAskableExplanations(attention(), [explanation("late", "LATE", "REQUESTED")]))
      .toEqual([attendanceExplanationKey("absent", today, "ABSENT")])
  })

  // Asked as absent in the morning, he came late and answered: one question a day, so his late row is
  // not offered again, whatever became of the first question (verifier, 2026-10-20).
  it("asks a person once a day, whatever the kind of the explanation he already has", () => {
    for (const status of ["REQUESTED", "ANSWERED", "ACCEPTED", "REJECTED"] as const) {
      expect(attendanceAskableExplanations(attention(), [explanation("late", "ABSENT", status)])).toEqual([attendanceExplanationKey("absent", today, "ABSENT")])
    }
    // Another day's explanation does not stand for today's.
    expect(attendanceAskableExplanations(attention(), [{ ...explanation("late", "LATE", "ANSWERED"), date: "2026-10-13" }])).toHaveLength(2)
  })

  it("ticks a row once, when it first appears, so an untick survives the minute's refresh", () => {
    const seen = new Set<string>()
    const first = attendanceAskableExplanations(attention(), [])
    expect(attendanceNewlyAskable(first, seen)).toEqual(first)
    // The same rows a minute later: nothing is ticked again, whatever HR did with them.
    expect(attendanceNewlyAskable(first, seen)).toEqual([])
    // Somebody else comes in late: only that row is ticked.
    const later = [...first, attendanceExplanationKey("came-late", today, "LATE")]
    expect(attendanceNewlyAskable(later, seen)).toEqual([attendanceExplanationKey("came-late", today, "LATE")])
  })
})

// The card is the only place in the CRM where an explanation is read and decided, so every one of
// today's stays on it until decided, whatever row the person now has (verifier, 2026-10-20).
describe("Personnel → Today: where an explanation of today is shown", () => {
  const rowsOf = (explanations: AttendanceTodayExplanation[]) => summarizeAttendanceToday(report(), today, explanations)
  const lateRow = (explanations: AttendanceTodayExplanation[]) => rowsOf(explanations).attention.find(item => item.type === "late")!

  it("shows an absence answer under the person's late row once he has come", () => {
    const answer = explanation("late", "ABSENT", "ANSWERED")
    const summary = rowsOf([answer])
    expect(attendanceRowExplanation(lateRow([answer]), [answer])).toBe(answer)
    // No row of its own, and nobody counted twice.
    expect(summary.attention.map(item => item.type)).toEqual(["absent", "late", "missing-finish"])
    expect(summary.quiet).toBe(2)
  })

  it("prefers the row's own kind, and gives the other kind's open explanation a row of its own", () => {
    const own = explanation("late", "LATE", "REQUESTED"), other = explanation("late", "ABSENT", "ANSWERED")
    expect(attendanceRowExplanation(lateRow([other, own]), [other, own])).toBe(own)
    const summary = rowsOf([other, own])
    expect(summary.attention.map(item => [item.type, item.employeeId])).toEqual([["absent", "absent"], ["late", "late"], ["explanation", "late"], ["missing-finish", "forgot"]])
    const row = summary.attention[2]
    expect(row.type === "explanation" && row.kind).toBe("ABSENT")
    expect(attendanceRowExplanation(row, [other, own])).toBe(other)
  })

  it("keeps an open explanation whose row has left the list, until it is decided", () => {
    // Asked as absent, he turned out on time (or a reason was recorded): no late or absent row any more.
    for (const status of ["REQUESTED", "ANSWERED"] as const) {
      const summary = rowsOf([explanation("on-time", "ABSENT", status)])
      expect(summary.attention.map(item => [item.type, item.employeeId])).toEqual([["absent", "absent"], ["late", "late"], ["explanation", "on-time"], ["missing-finish", "forgot"]])
      // He is on the card, so not among the «rest, no questions».
      expect(summary.quiet).toBe(1)
    }
    for (const status of ["ACCEPTED", "REJECTED"] as const) {
      expect(rowsOf([explanation("on-time", "ABSENT", status)]).attention.map(item => item.type)).toEqual(["absent", "late", "missing-finish"])
    }
    // Another day's explanation is not today's business.
    expect(rowsOf([{ ...explanation("on-time", "ABSENT", "ANSWERED"), date: "2026-10-13" }]).attention.map(item => item.type)).toEqual(["absent", "late", "missing-finish"])
  })
})
