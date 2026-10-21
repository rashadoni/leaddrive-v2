/**
 * The Personnel demo's week, held to the product's own rules (audit of the
 * «Kadr uçotu» intro clip, 2026-10-20: the clip showed records the product
 * would never have produced). The records and requests are not typed in next
 * to the timesheet: they are read from the same phone facts, and here the
 * product's own checks are run over those facts to see they agree.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

// The checks live next to the code that writes their records; only their pure parts are called.
vi.mock("@/lib/prisma", () => ({ prisma: {}, logAudit: vi.fn() }))

import { attendanceTimingRisk, usualAttendanceInstallationUser } from "@/lib/mtm/attendance-risk-detection"
import { DEFAULT_ATTENDANCE_RISK_POLICY } from "@/lib/mtm/attendance-risk-policy"
import { AttendanceRequestInputSchema } from "@/lib/mtm/attendance-request-contract"
import { WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS } from "@/lib/mtm/workday"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { buildMtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { MTM_ATTENDANCE_BASELINE_RULE } from "@/lib/mtm/attendance-rules"
import { addDays } from "@/components/demo-center/journey/scenes/mtm-demo-data"
import {
  PERSONNEL_DEMO_EMPLOYEES,
  PERSONNEL_DEMO_RISK_LIMITS,
  personnelDemoReport,
  personnelDemoRequests,
  personnelDemoRiskReport,
  personnelDemoRisks,
} from "@/components/demo-center/journey/scenes/personnel-demo-data"

const TODAY = "2026-10-15"
const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages/az.json"), "utf8"))
const kinds = defaultAttendanceDayKinds((key) => {
  const name = (messages.mtmAttendance as Record<string, string>)[`dayKindName${key}`]
  return { az: name, ru: name, en: name }
})
const week = personnelDemoReport(TODAY, addDays(TODAY, -40), TODAY, kinds)
const startOf = (employeeId: string, date: string) => {
  const row = week.rows.find((candidate) => candidate.employeeId === employeeId && candidate.date === date)
  return row?.events.find((event) => event.type === "START") ?? null
}
const iso = (value: unknown) => new Date(value as string).toISOString()

describe("the suspicious records of the Personnel demo", () => {
  const risks = personnelDemoRisks(TODAY)

  it("are listed as the review lists them: the newest day first", () => {
    const days = risks.map((item) => item.workDate)
    expect(days).toEqual([...days].sort().reverse())
  })

  it("carry the times of the very marks in the timesheet", () => {
    for (const item of risks) {
      const start = startOf(item.employeeId, item.workDate)
      expect(start, `${item.employeeName} ${item.workDate}`).not.toBeNull()
      expect(item.claimedAt).toBe(iso(start!.claimedAt))
      expect(item.serverReceivedAt).toBe(iso(start!.serverReceivedAt))
    }
  })

  it("are of the kind, and say the seconds, the product's own timing check gives", () => {
    expect(PERSONNEL_DEMO_RISK_LIMITS).toEqual({ delayedAfterSeconds: WORKFORCE_ATTENDANCE_REVIEW_DELAY_MS / 1000, clockDifferenceSeconds: DEFAULT_ATTENDANCE_RISK_POLICY.clockDifferenceSeconds })
    const timed = risks.filter((item) => item.kind === "DELAYED_CLAIM" || item.kind === "CLOCK_DIFFERENCE")
    expect(timed.map((item) => item.kind).sort()).toEqual(["CLOCK_DIFFERENCE", "DELAYED_CLAIM"])
    for (const item of timed) {
      const check = attendanceTimingRisk(new Date(item.claimedAt), new Date(item.serverReceivedAt), DEFAULT_ATTENDANCE_RISK_POLICY.clockDifferenceSeconds)
      expect(check?.kind, item.employeeName).toBe(item.kind)
      const details = check!.details as { deltaSeconds?: number; thresholdSeconds?: number }
      expect({ deltaSeconds: item.deltaSeconds, thresholdSeconds: item.thresholdSeconds }).toEqual({ deltaSeconds: details.deltaSeconds, thresholdSeconds: details.thresholdSeconds })
    }
    // Every other start of the week reached the server as it was made: nothing else to look at.
    const flagged = new Set(timed.map((item) => `${item.employeeId}|${item.workDate}`))
    for (const row of week.rows.filter((candidate) => candidate.date >= addDays(TODAY, -6) && candidate.date < TODAY)) {
      const start = row.events.find((event) => event.type === "START")
      if (!start || flagged.has(`${row.employeeId}|${row.date}`)) continue
      expect(attendanceTimingRisk(new Date(iso(start.claimedAt)), new Date(iso(start.serverReceivedAt)), DEFAULT_ATTENDANCE_RISK_POLICY.clockDifferenceSeconds), `${row.employeeName} ${row.date}`).toBeNull()
    }
  })

  it("open a shared-phone record for everyone who marked on that phone, each naming the other and the phone's usual user", () => {
    const shared = risks.filter((item) => item.kind === "SHARED_INSTALLATION")
    expect(shared.map((item) => item.employeeName).sort()).toEqual(["Kamal Səfərov", "Ülvi Cəfərov"])
    for (const item of shared) expect(item.relatedNames).toEqual(shared.filter((other) => other !== item).map((other) => other.employeeName))
    // The phone is Kamal's: in the month before, it marked his days and nobody else's.
    const kamal = PERSONNEL_DEMO_EMPLOYEES.find((employee) => employee.name === "Kamal Səfərov")!
    const date = shared[0].workDate
    const history = week.rows
      .filter((row) => row.employeeId === kamal.id && row.date >= addDays(date, -30) && row.date < date && row.events.some((event) => event.type === "START"))
      .map((row) => ({ agentId: row.employeeId, workDate: new Date(`${row.date}T00:00:00.000Z`) }))
    const usual = usualAttendanceInstallationUser(history)
    expect(usual.usualAgentId).toBe(kamal.id)
    for (const item of shared) expect({ usualName: item.usualName, usualDays: item.usualDays, observedDays: item.observedDays }).toEqual({ usualName: kamal.name, usualDays: usual.usualDays, observedDays: usual.observedDays })
  })

  it("keep the guided record first-named, and count every open one", () => {
    expect(risks.find((item) => item.id === "risk-1")?.employeeName).toBe("Ülvi Cəfərov")
    const report = personnelDemoRiskReport(TODAY, null)
    expect(report.items.filter((item) => !item.dismissal)).toHaveLength(risks.length)
  })
})

describe("the requests waiting on «Bu gün»", () => {
  it("are requests the product's own form accepts — a time correction in hours, from the phone's start", () => {
    for (const request of personnelDemoRequests(TODAY)) {
      const parsed = AttendanceRequestInputSchema.safeParse({
        clientRequestId: randomUUID(),
        kind: request.kind,
        unit: request.unit,
        startDate: request.from,
        endDate: request.to,
        ...(request.startTime ? { startTime: request.startTime } : {}),
        ...(request.endTime ? { endTime: request.endTime } : {}),
        reason: request.reason,
      })
      expect(parsed.success, `${request.employeeName}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
    const correction = personnelDemoRequests(TODAY).find((request) => request.kind === "TIME_CORRECTION")!
    const start = startOf(PERSONNEL_DEMO_EMPLOYEES.find((employee) => employee.name === correction.employeeName)!.id, correction.from)!
    expect(correction.startTime).toBe(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso(start.occurredAt))))
    expect(correction.endTime).toBe("18:10")
  })
})

describe("the day HR corrected", () => {
  it("was, before the correction, exactly what the phone had sent: a start and nothing after", async () => {
    const { personnelDemoPlan } = await import("@/components/demo-center/journey/scenes/personnel-demo-data")
    const plan = personnelDemoPlan(TODAY)
    const month = personnelDemoReport(TODAY, plan.monthStart, plan.lastMonthEnd, kinds)
    const corrected = month.rows.filter((row) => row.corrections?.length)
    expect(corrected).toHaveLength(1)
    const [row] = corrected
    const before = row.corrections![0].before
    expect(before.kind).toBe("WORKDAY")
    if (before.kind !== "WORKDAY") return
    expect(row.events.map((event) => event.type)).toEqual(["START"])
    expect(before.facts).toMatchObject({ status: "STARTED", startedAt: iso(row.events[0].occurredAt), pausedAt: null, completedAt: null, totalPausedSeconds: 0 })
  })

  it("is counted as the product counts a day the phone itself closed at that minute — lunch taken off and said so", async () => {
    // Reviewer of the re-filmed clip, 2026-10-20: the card read 08:52 → 18:07, worked 8:15, break 0:00, and
    // nothing said where the hour went. The product takes the lunch hour off a day nobody pressed a break in
    // (`lunchAutoSeconds`) and the card says «Nahar 1:00 avtomatik çıxıldı».
    const { personnelDemoPlan } = await import("@/components/demo-center/journey/scenes/personnel-demo-data")
    const plan = personnelDemoPlan(TODAY)
    const month = personnelDemoReport(TODAY, plan.monthStart, plan.lastMonthEnd, kinds)
    const row = month.rows.find((candidate) => candidate.corrections?.length)!
    const employee = PERSONNEL_DEMO_EMPLOYEES.find((candidate) => candidate.id === row.employeeId)!
    const closedByPhone = buildMtmAttendanceReport({
      employees: [employee],
      workdays: [{ id: "plain", agentId: employee.id, workDate: row.date, status: "COMPLETED", startedAt: row.startedAt!, completedAt: row.completedAt!, totalPausedSeconds: 0,
        events: [{ id: "s", type: "START", occurredAt: row.startedAt! }, { id: "f", type: "FINISH", occurredAt: row.completedAt! }] }],
      calendar: [], rules: [MTM_ATTENDANCE_BASELINE_RULE], dayKinds: kinds, from: row.date, to: row.date, now: `${TODAY}T05:20:00.000Z`,
    }).rows[0]
    const counted = ({ kind, dayKind, factsState, workedSeconds, pausedSeconds, lunchAutoSeconds, lateSeconds, earlyLeaveSeconds, flags }: typeof row) =>
      ({ kind, dayKind: dayKind?.key, factsState, workedSeconds, pausedSeconds, lunchAutoSeconds, lateSeconds, earlyLeaveSeconds, flags })
    expect(counted(row)).toEqual(counted(closedByPhone))
    expect(row.lunchAutoSeconds).toBe(3600)
    expect(row.workedSeconds! + row.pausedSeconds! + row.lunchAutoSeconds!).toBe((Date.parse(row.completedAt!) - Date.parse(row.startedAt!)) / 1000)
  })

  it("leaves every forgotten check-out of the month a day with its start alone", async () => {
    const { personnelDemoPlan } = await import("@/components/demo-center/journey/scenes/personnel-demo-data")
    const plan = personnelDemoPlan(TODAY)
    for (const entry of plan.missingFinish) {
      const row = week.rows.find((candidate) => candidate.employeeId === entry.personId && candidate.date === entry.date)
      if (!row) continue
      expect(row.events.map((event) => event.type), `${row.employeeName} ${row.date}`).toEqual(["START"])
    }
  })
})
