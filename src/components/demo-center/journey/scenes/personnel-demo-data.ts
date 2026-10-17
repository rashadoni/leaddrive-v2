/**
 * The Personnel module's invented company: eighteen people in four
 * departments of a Baku distributor, a closed last month and this week so far.
 *
 * Nothing is typed into a screen. The days are made of the same facts the
 * phone sends — start, a short break, finish — and the product's own
 * timesheet builder (`buildMtmAttendanceReport`) turns them into late
 * minutes, absences, missing check-outs and day letters, so «Bu gün», the
 * timesheet and the N-1t form agree because the product computes all three.
 * Approved leave and sick days go in as the product's approved periods.
 *
 * Every name, department and minute is made up. The clock is the Route &
 * Field module's demo day (the latest Thursday), at 09:20 Baku time.
 */
import { buildMtmAttendanceReport, type MtmAttendanceCorrection, type MtmAttendanceEmployee, type MtmAttendanceEventInput, type MtmAttendanceReportRow, type MtmAttendanceWorkday } from "@/lib/mtm/attendance-report"
import { MTM_ATTENDANCE_BASELINE_RULE } from "@/lib/mtm/attendance-rules"
import type { AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"
import type { AttendanceApprovedPeriod } from "@/lib/mtm/attendance-request-projection"
import type { AttendanceRiskItem } from "@/lib/mtm/attendance-risk-contract"
import { attendanceTodayRange } from "@/lib/mtm/attendance-today"
import { addDays, mtmDemoAt } from "./mtm-demo-data"

export const PERSONNEL_DEMO_CLOCK = "09:20"
const TZ = "Asia/Baku"

const TEAMS = {
  sales: { id: "team-sales", name: "Satış" },
  warehouse: { id: "team-warehouse", name: "Anbar" },
  finance: { id: "team-finance", name: "Mühasibatlıq" },
  hr: { id: "team-hr", name: "Kadrlar" },
} as const

type Habit = "steady" | "late" | "early"
const PEOPLE: ReadonlyArray<{ id: string; name: string; position: string; team: keyof typeof TEAMS; habit: Habit }> = [
  { id: "emp-01", name: "Anar Quliyev", position: "Satış meneceri", team: "sales", habit: "steady" },
  { id: "emp-02", name: "Lalə Məmmədova", position: "Satış meneceri", team: "sales", habit: "late" },
  { id: "emp-03", name: "Vüsal Hüseynov", position: "Satış meneceri", team: "sales", habit: "steady" },
  { id: "emp-04", name: "Gülnar Əliyeva", position: "Satış rəhbəri", team: "sales", habit: "steady" },
  { id: "emp-05", name: "Murad Kərimov", position: "Satış meneceri", team: "sales", habit: "late" },
  { id: "emp-06", name: "Səidə Rəhimova", position: "Kassir", team: "sales", habit: "early" },
  { id: "emp-07", name: "Elnur Bağırov", position: "Anbardar", team: "warehouse", habit: "steady" },
  { id: "emp-08", name: "Kamal Səfərov", position: "Anbardar", team: "warehouse", habit: "late" },
  { id: "emp-09", name: "Rəşid Nəsirov", position: "Sürücü", team: "warehouse", habit: "steady" },
  { id: "emp-10", name: "Ülvi Cəfərov", position: "Yükləyici", team: "warehouse", habit: "steady" },
  { id: "emp-11", name: "Fuad Abbasov", position: "Anbar rəhbəri", team: "warehouse", habit: "early" },
  { id: "emp-12", name: "Nərgiz Həsənova", position: "Baş mühasib", team: "finance", habit: "steady" },
  { id: "emp-13", name: "Aytən İsmayılova", position: "Mühasib", team: "finance", habit: "steady" },
  { id: "emp-14", name: "Rövşən Əsgərov", position: "Mühasib", team: "finance", habit: "steady" },
  { id: "emp-15", name: "Sevda Qasımova", position: "Kassir-mühasib", team: "finance", habit: "steady" },
  { id: "emp-16", name: "Zəhra Novruzova", position: "Kadrlar üzrə mütəxəssis", team: "hr", habit: "steady" },
  { id: "emp-17", name: "Orxan Musayev", position: "Kadrlar rəhbəri", team: "hr", habit: "steady" },
  { id: "emp-18", name: "Könül Əhmədova", position: "Ofis meneceri", team: "hr", habit: "steady" },
]

export const PERSONNEL_DEMO_EMPLOYEES: MtmAttendanceEmployee[] = PEOPLE.map((person) => ({
  id: person.id,
  name: person.name,
  position: person.position,
  teamId: TEAMS[person.team].id,
  teamName: TEAMS[person.team].name,
  attendanceIncludedFrom: "2026-01-01",
}))

/** A stable 0…modulo-1 number per person and day: the same demo every time. */
function spread(seed: string, modulo: number): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0
  return hash % modulo
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay()
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** What the phone sent for one day: start, a short break, finish (or not yet). */
function workday(personId: string, date: string, start: number, finish: number | null, breakAt: number | null): MtmAttendanceWorkday {
  const at = (minutes: number) => mtmDemoAt(date, clock(minutes))
  const events: MtmAttendanceEventInput[] = [{ id: `${personId}-${date}-start`, type: "START", occurredAt: at(start), claimedAt: at(start), serverReceivedAt: at(start) }]
  if (breakAt !== null) {
    events.push({ id: `${personId}-${date}-pause`, type: "PAUSE", occurredAt: at(breakAt), claimedAt: at(breakAt), serverReceivedAt: at(breakAt) })
    if (finish !== null) events.push({ id: `${personId}-${date}-resume`, type: "RESUME", occurredAt: at(breakAt + 12), claimedAt: at(breakAt + 12), serverReceivedAt: at(breakAt + 12) })
  }
  if (finish !== null) events.push({ id: `${personId}-${date}-finish`, type: "FINISH", occurredAt: at(finish), claimedAt: at(finish), serverReceivedAt: at(finish) })
  return {
    id: `wd-${personId}-${date}`,
    agentId: personId,
    workDate: date,
    status: finish !== null ? "COMPLETED" : breakAt !== null ? "PAUSED" : "STARTED",
    startedAt: at(start),
    completedAt: finish !== null ? at(finish) : null,
    totalPausedSeconds: breakAt !== null && finish !== null ? 12 * 60 : 0,
    events,
  }
}

interface DemoAbsence { readonly personId: string; readonly from: string; readonly to: string; readonly kind: "ANNUAL_LEAVE" | "SICK_LEAVE" }

/** The demo's facts around a day: who was off, who never came, who forgot to check out. */
export function personnelDemoPlan(today: string) {
  const monthStart = `${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1)
  const monday = attendanceTodayRange(today).weekStart
  const firstWorkday = (from: string, skip: number) => {
    let date = from
    let left = skip
    for (;;) {
      if (weekday(date) !== 0 && weekday(date) !== 6) {
        if (left === 0) return date
        left -= 1
      }
      date = addDays(date, 1)
    }
  }
  const absences: DemoAbsence[] = [
    // Last month: a week of annual leave and two sick days.
    { personId: "emp-13", from: firstWorkday(monthStart, 10), to: firstWorkday(monthStart, 14), kind: "ANNUAL_LEAVE" },
    { personId: "emp-09", from: firstWorkday(monthStart, 4), to: firstWorkday(monthStart, 5), kind: "SICK_LEAVE" },
    // This week: on leave since Monday.
    { personId: "emp-15", from: monday, to: addDays(monday, 4), kind: "ANNUAL_LEAVE" },
  ]
  return {
    today,
    monthStart,
    lastMonthEnd,
    absences,
    /** Days nobody came and gave no reason (no request, no record). */
    absent: [
      { personId: "emp-08", date: firstWorkday(monthStart, 7) },
      { personId: "emp-10", date: firstWorkday(monthStart, 16) },
      { personId: "emp-05", date: today },
    ],
    /** Days a check-out was never sent. One of last month's was corrected by HR. */
    missingFinish: [
      { personId: "emp-03", date: firstWorkday(monthStart, 12), corrected: true },
      { personId: "emp-07", date: addDays(today, -1), corrected: false },
    ],
  }
}

const covered = (absences: readonly DemoAbsence[], personId: string, date: string) =>
  absences.find((absence) => absence.personId === personId && absence.from <= date && date <= absence.to) ?? null

/** Everybody's days from `from` to `to`, made of phone facts. Today stops at the demo clock. */
function workdays(plan: ReturnType<typeof personnelDemoPlan>, from: string, to: string): MtmAttendanceWorkday[] {
  const days: MtmAttendanceWorkday[] = []
  const nowMinutes = 9 * 60 + 20
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (date > plan.today || weekday(date) === 0 || weekday(date) === 6) continue
    for (const person of PEOPLE) {
      if (covered(plan.absences, person.id, date)) continue
      if (plan.absent.some((entry) => entry.personId === person.id && entry.date === date)) continue
      const roll = spread(`${person.id}:${date}`, 100)
      let start = 8 * 60 + 44 + (roll % 23)
      if (person.habit === "late" && roll % 3 === 0) start = 9 * 60 + 12 + (roll % 24)
      let finish = 18 * 60 + (roll % 17)
      if (person.habit === "early" && roll % 5 === 0) finish = 17 * 60 + 15 + (roll % 20)
      const missing = plan.missingFinish.find((entry) => entry.personId === person.id && entry.date === date)
      if (date === plan.today) {
        // Today at 09:20: whoever started has started; the late ones are still on their way or just in.
        if (person.id === "emp-02") start = 9 * 60 + 18
        if (person.id === "emp-08") start = 9 * 60 + 14
        if (start > nowMinutes) continue
        const onBreak = person.id === "emp-12" ? 9 * 60 + 12 : null
        days.push(workday(person.id, date, start, null, onBreak))
        continue
      }
      days.push(workday(person.id, date, start, missing ? null : finish, roll % 2 === 0 ? 15 * 60 + 30 : null))
    }
  }
  return days
}

function approvedPeriods(plan: ReturnType<typeof personnelDemoPlan>, dayKinds: readonly AttendanceDayKind[]): AttendanceApprovedPeriod[] {
  return plan.absences.map((absence, index) => ({
    id: `req-${index + 1}`,
    agentId: absence.personId,
    startDate: absence.from,
    endDate: absence.to,
    decidedAt: mtmDemoAt(addDays(absence.from, -3), "11:00"),
    details: { kind: absence.kind, unit: "DAYS", startTime: null, endTime: null, timezone: TZ, dayKind: dayKinds.find((kind) => kind.key === absence.kind)! },
  }))
}

/** The product's timesheet over the demo facts, for any period up to today. */
export function personnelDemoReport(today: string, from: string, to: string, dayKinds: readonly AttendanceDayKind[]) {
  const plan = personnelDemoPlan(today)
  const report = buildMtmAttendanceReport({
    employees: PERSONNEL_DEMO_EMPLOYEES,
    workdays: workdays(plan, from, to),
    calendar: [],
    rules: [MTM_ATTENDANCE_BASELINE_RULE],
    dayKinds,
    approvedRequests: approvedPeriods(plan, dayKinds),
    from,
    to,
    now: mtmDemoAt(today, PERSONNEL_DEMO_CLOCK),
  })
  return { ...report, rows: report.rows.map((row) => withCorrection(row, plan, dayKinds)) }
}

/**
 * The missing check-out HR corrected on an employee's request: the day card's
 * «was → now». The product reads it from its correction ledger; the demo adds
 * the same record to the same row.
 */
function withCorrection(row: MtmAttendanceReportRow, plan: ReturnType<typeof personnelDemoPlan>, dayKinds: readonly AttendanceDayKind[]): MtmAttendanceReportRow {
  const fix = plan.missingFinish.find((entry) => entry.corrected && entry.personId === row.employeeId && entry.date === row.date)
  if (!fix || !row.startedAt) return row
  const correction: MtmAttendanceCorrection = {
    id: `corr-${row.employeeId}-${row.date}`,
    requestId: `req-corr-${row.employeeId}`,
    source: "REQUEST_APPROVAL",
    occurredAt: mtmDemoAt(addDays(row.date, 1), "10:05"),
    reviewer: { id: "emp-17", name: "Orxan Musayev" },
    before: { kind: "WORKDAY", facts: { id: row.workdayId ?? `wd-${row.employeeId}-${row.date}`, workDate: row.date, status: "STARTED", startedAt: row.startedAt, pausedAt: null, completedAt: null, totalPausedSeconds: 0 } },
    after: { id: row.workdayId ?? `wd-${row.employeeId}-${row.date}`, workDate: row.date, status: "COMPLETED", startedAt: row.startedAt, pausedAt: null, completedAt: mtmDemoAt(row.date, "18:07"), totalPausedSeconds: 0 },
  }
  const worked = Math.round((Date.parse(mtmDemoAt(row.date, "18:07")) - Date.parse(row.startedAt)) / 1000) - 3600
  const workedDay = dayKinds.find((kind) => kind.key === "WORKED")
  return { ...row, kind: "WORKED", completedAt: mtmDemoAt(row.date, "18:07"), workedSeconds: worked, pausedSeconds: 0, flags: row.flags.filter((flag) => flag !== "MISSING_FINISH"), corrections: [correction], ...(workedDay ? { dayKind: workedDay } : {}) }
}

/** Requests waiting on «Bu gün»: a leave, an hour off, and the forgotten check-out of yesterday. */
export function personnelDemoRequests(today: string) {
  return [
    { id: "req-wait-1", employeeName: "Vüsal Hüseynov", kind: "ANNUAL_LEAVE" as const, from: addDays(today, 18), to: addDays(today, 22), unit: "DAYS" as const, startTime: null, endTime: null, reason: "Ailə səfəri" },
    { id: "req-wait-2", employeeName: "Gülnar Əliyeva", kind: "HOURLY_ABSENCE" as const, from: addDays(today, 1), to: addDays(today, 1), unit: "HOURS" as const, startTime: "14:00", endTime: "16:00", reason: "Həkim qəbulu" },
    { id: "req-wait-3", employeeName: "Elnur Bağırov", kind: "TIME_CORRECTION" as const, from: addDays(today, -1), to: addDays(today, -1), unit: "DAYS" as const, startTime: null, endTime: null, reason: "Çıxışı qeyd etməyi unutdum, 18:10-da çıxmışam." },
  ]
}

/** Records that ask a person to look: the product's own risk kinds, raised by the product's checks. */
export function personnelDemoRisks(today: string): AttendanceRiskItem[] {
  const base = { teamId: null, timezone: TZ, canDismiss: true, relatedNamesRestricted: false, usualName: null, usualDays: null, observedDays: null, deltaSeconds: null, thresholdSeconds: null, branchName: null, distanceMeters: null, dismissal: null, action: "START" as const }
  return [
    { ...base, id: "risk-1", employeeId: "emp-10", employeeName: "Ülvi Cəfərov", teamName: "Anbar", kind: "SHARED_INSTALLATION", workDate: addDays(today, -2),
      claimedAt: mtmDemoAt(addDays(today, -2), "08:57"), serverReceivedAt: mtmDemoAt(addDays(today, -2), "08:57"), createdAt: mtmDemoAt(addDays(today, -2), "08:57"), relatedNames: ["Kamal Səfərov"] },
    { ...base, id: "risk-2", employeeId: "emp-05", employeeName: "Murad Kərimov", teamName: "Satış", kind: "DELAYED_CLAIM", workDate: addDays(today, -3),
      claimedAt: mtmDemoAt(addDays(today, -3), "08:55"), serverReceivedAt: mtmDemoAt(addDays(today, -3), "09:41"), createdAt: mtmDemoAt(addDays(today, -3), "09:41"), relatedNames: [] },
    { ...base, id: "risk-3", employeeId: "emp-06", employeeName: "Səidə Rəhimova", teamName: "Satış", kind: "CLOCK_DIFFERENCE", workDate: addDays(today, -1),
      claimedAt: mtmDemoAt(addDays(today, -1), "08:50"), serverReceivedAt: mtmDemoAt(addDays(today, -1), "09:02"), createdAt: mtmDemoAt(addDays(today, -1), "09:02"), relatedNames: [],
      deltaSeconds: -720, thresholdSeconds: 300 },
  ]
}
