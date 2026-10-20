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
import type { AttendanceRiskItem, AttendanceRiskReport } from "@/lib/mtm/attendance-risk-contract"
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

/**
 * What the phone sent for one day: start, a short break, finish (or not yet).
 * `startReceived` is when the server got the start, if not at once (a phone
 * offline, or with its clock off).
 */
function workday(personId: string, date: string, start: number, finish: number | null, breakAt: number | null, startReceived = start): MtmAttendanceWorkday {
  const at = (minutes: number) => mtmDemoAt(date, clock(minutes))
  const events: MtmAttendanceEventInput[] = [{ id: `${personId}-${date}-start`, type: "START", occurredAt: at(start), claimedAt: at(start), serverReceivedAt: at(startReceived) }]
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

/**
 * The marks this week the product's checks raised a record on
 * (`recordAttendanceRisks`): Ülvi's start made on Kamal's phone, Murad's start
 * that reached the server 46 minutes late, Səidə's with her phone's clock 12
 * minutes behind. They are days of the timesheet like any other — the record
 * reads its times from them (`personnelDemoRisks`).
 */
const FLAGGED_MARKS: ReadonlyArray<{ readonly personId: string; readonly daysAgo: number; readonly claimed: string; readonly received: string; readonly onPhoneOf?: string }> = [
  { personId: "emp-10", daysAgo: 2, claimed: "08:57", received: "08:57", onPhoneOf: "emp-08" },
  { personId: "emp-05", daysAgo: 3, claimed: "08:55", received: "09:41" },
  { personId: "emp-06", daysAgo: 1, claimed: "08:50", received: "09:02" },
]

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** When somebody's phone says he started that day: his habit, or the mark the record is about. */
function startMinutes(plan: ReturnType<typeof personnelDemoPlan>, person: (typeof PEOPLE)[number], date: string): number {
  const flagged = FLAGGED_MARKS.find((mark) => mark.personId === person.id && addDays(plan.today, -mark.daysAgo) === date)
  if (flagged) return minutesOf(flagged.claimed)
  // Today at 09:20: whoever started has started; the late ones are still on their way or just in.
  if (date === plan.today && person.id === "emp-02") return 9 * 60 + 18
  if (date === plan.today && person.id === "emp-08") return 9 * 60 + 14
  const roll = spread(`${person.id}:${date}`, 100)
  if (person.habit === "late" && roll % 3 === 0) return 9 * 60 + 12 + (roll % 24)
  return 8 * 60 + 44 + (roll % 23)
}

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
      const start = startMinutes(plan, person, date)
      let finish = 18 * 60 + (roll % 17)
      if (person.habit === "early" && roll % 5 === 0) finish = 17 * 60 + 15 + (roll % 20)
      const missing = plan.missingFinish.find((entry) => entry.personId === person.id && entry.date === date)
      if (date === plan.today) {
        if (start > nowMinutes) continue
        const onBreak = person.id === "emp-12" ? 9 * 60 + 12 : null
        days.push(workday(person.id, date, start, null, onBreak))
        continue
      }
      const flagged = FLAGGED_MARKS.find((mark) => mark.personId === person.id && addDays(plan.today, -mark.daysAgo) === date)
      days.push(workday(person.id, date, start, missing ? null : finish, roll % 2 === 0 ? 15 * 60 + 30 : null, flagged ? minutesOf(flagged.received) : start))
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

/**
 * Requests waiting on «Bu gün»: a leave, an hour off, and the forgotten
 * check-out of yesterday. A time correction is always in hours with the day's
 * start and end (`AttendanceRequestInputSchema`): Elnur's start is the one his
 * phone sent, the end the 18:10 he names.
 */
export function personnelDemoRequests(today: string) {
  const plan = personnelDemoPlan(today)
  const yesterday = addDays(today, -1)
  const elnur = PEOPLE.find((person) => person.id === "emp-07")!
  return [
    { id: "req-wait-1", employeeName: "Vüsal Hüseynov", kind: "ANNUAL_LEAVE" as const, from: addDays(today, 18), to: addDays(today, 22), unit: "DAYS" as const, startTime: null, endTime: null, reason: "Ailə səfəri" },
    { id: "req-wait-2", employeeName: "Gülnar Əliyeva", kind: "HOURLY_ABSENCE" as const, from: addDays(today, 1), to: addDays(today, 1), unit: "HOURS" as const, startTime: "14:00", endTime: "16:00", reason: "Həkim qəbulu" },
    { id: "req-wait-3", employeeName: elnur.name, kind: "TIME_CORRECTION" as const, from: yesterday, to: yesterday, unit: "HOURS" as const, startTime: clock(startMinutes(plan, elnur, yesterday)), endTime: "18:10", reason: "Çıxışı qeyd etməyi unutdum, 18:10-da çıxmışam." },
  ]
}

/** The product's limits for a mark's two times (`attendanceTimingRisk`; the organization's default clock difference). */
export const PERSONNEL_DEMO_RISK_LIMITS = { delayedAfterSeconds: 15 * 60, clockDifferenceSeconds: 300 } as const

/**
 * Records that ask a person to look, as the product raises them over the
 * week's marks (`recordAttendanceRisks`) and lists them (newest day first,
 * `attendance-risk-review-store.ts`):
 *
 * - a mark on another person's phone opens a «shared installation» record for
 *   everyone who marked on that phone that day — Ülvi and Kamal — with who
 *   used the phone in the month before (`usualAttendanceInstallationUser`);
 * - a start that reached the server more than a quarter of an hour late is
 *   «delayed», one off by more than five minutes a «clock difference», each
 *   with its seconds.
 */
export function personnelDemoRisks(today: string): AttendanceRiskItem[] {
  const plan = personnelDemoPlan(today)
  const base = { timezone: TZ, canDismiss: true, relatedNamesRestricted: false, usualName: null, usualDays: null, observedDays: null, deltaSeconds: null, thresholdSeconds: null, branchName: null, distanceMeters: null, dismissal: null, action: "START" as const }
  const person = (id: string) => PERSONNEL_DEMO_EMPLOYEES.find((employee) => employee.id === id)!
  const startOf = (personId: string, date: string) => {
    const event = workdays(plan, date, date).find((day) => day.agentId === personId)!.events.find((entry) => entry.type === "START")!
    const iso = (value: MtmAttendanceEventInput["claimedAt"]) => new Date(value ?? event.occurredAt).toISOString()
    return { claimedAt: iso(event.claimedAt), serverReceivedAt: iso(event.serverReceivedAt) }
  }
  const items: AttendanceRiskItem[] = []
  for (const [index, mark] of FLAGGED_MARKS.entries()) {
    const date = addDays(today, -mark.daysAgo)
    const own = person(mark.personId)
    const times = startOf(mark.personId, date)
    const id = `risk-${index + 1}`
    if (mark.onPhoneOf) {
      // Everybody who marked on that phone that day, each with the others' names and the phone's usual user.
      const owner = person(mark.onPhoneOf)
      const ownerTimes = startOf(owner.id, date)
      const createdAt = [times.serverReceivedAt, ownerTimes.serverReceivedAt].sort().at(-1)!
      const observed = new Set(workdays(plan, addDays(date, -30), addDays(date, -1)).filter((day) => day.agentId === owner.id).map((day) => day.workDate))
      const usual = { usualName: owner.name, usualDays: observed.size, observedDays: observed.size }
      items.push({ ...base, ...usual, id, employeeId: own.id, employeeName: own.name, teamId: own.teamId ?? null, teamName: own.teamName ?? null, kind: "SHARED_INSTALLATION", workDate: date, ...times, createdAt, relatedNames: [owner.name] })
      items.push({ ...base, ...usual, id: `${id}-peer`, employeeId: owner.id, employeeName: owner.name, teamId: owner.teamId ?? null, teamName: owner.teamName ?? null, kind: "SHARED_INSTALLATION", workDate: date, ...ownerTimes, createdAt, relatedNames: [own.name] })
      continue
    }
    const deltaSeconds = Math.trunc((Date.parse(times.serverReceivedAt) - Date.parse(times.claimedAt)) / 1000)
    const delayed = deltaSeconds > PERSONNEL_DEMO_RISK_LIMITS.delayedAfterSeconds
    items.push({ ...base, id, employeeId: own.id, employeeName: own.name, teamId: own.teamId ?? null, teamName: own.teamName ?? null,
      kind: delayed ? "DELAYED_CLAIM" : "CLOCK_DIFFERENCE", workDate: date, ...times, createdAt: times.serverReceivedAt, relatedNames: [],
      deltaSeconds, thresholdSeconds: delayed ? PERSONNEL_DEMO_RISK_LIMITS.delayedAfterSeconds : PERSONNEL_DEMO_RISK_LIMITS.clockDifferenceSeconds })
  }
  // The review's own order: the newest day first, then the newest record, then the id.
  return items.sort((left, right) => right.workDate.localeCompare(left.workDate) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}

/**
 * The one answer that comes back after «İzahat istə»: Lalə's, written on her
 * phone a quarter of an hour later. The others are still waiting.
 */
export const PERSONNEL_DEMO_EXPLANATION = {
  employeeId: "emp-02",
  answeredAt: "09:34",
  answer: "Metroda qatar tuneldə on beş dəqiqə dayandı. Rəhbərimə 09:05-də yazmışdım.",
} as const

/** What the reviewer writes when closing the shared-phone record — a sample; the prospect may change it. */
export const PERSONNEL_DEMO_RISK_REASON = "Ülvi ilə danışdım: telefonu xarab idi, Kamalın telefonundan qeyd etdi. Anbar rəhbəri onun 08:55-də işdə olduğunu təsdiqlədi."
export const PERSONNEL_DEMO_REVIEWER = "Orxan Musayev"

/**
 * The review list in the shape its API answers with (`AttendanceRiskReport`),
 * for the product's own table (`buildAttendanceRiskTable`). Once the first
 * record is closed it carries the reviewer, the moment and the reason, as the
 * product's dismissal does; the time itself does not change.
 */
export function personnelDemoRiskReport(today: string, closed: { reason: string } | null): AttendanceRiskReport {
  const items = personnelDemoRisks(today).map((item) => (closed && item.id === "risk-1"
    ? { ...item, dismissal: { at: mtmDemoAt(today, PERSONNEL_DEMO_CLOCK), byName: PERSONNEL_DEMO_REVIEWER, reason: closed.reason } }
    : item))
  return {
    directory: PERSONNEL_DEMO_EMPLOYEES.map((employee) => ({ id: employee.id, name: employee.name, teamId: employee.teamId ?? null, teamName: employee.teamName ?? null })),
    items,
    snapshot: {
      id: "0".repeat(64),
      asOf: mtmDemoAt(today, PERSONNEL_DEMO_CLOCK),
      query: { from: addDays(today, -6), to: today, status: "ALL", kind: "ALL", teamId: "", employeeId: "" },
    },
  }
}
