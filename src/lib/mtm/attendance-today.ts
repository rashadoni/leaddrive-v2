import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import type { AttendanceExplanationDto, AttendanceExplanationKind } from "@/lib/mtm/attendance-explanation-contract"

/** Days before today in which a missing finish still asks for HR attention. */
export const ATTENDANCE_TODAY_LOOKBACK_DAYS = 7

export type AttendanceTodayAttention =
  | { type: "absent"; employeeId: string; employeeName: string; teamName: string | null; date: string }
  | { type: "late"; employeeId: string; employeeName: string; teamName: string | null; date: string; lateSeconds: number; startedAt: string; timezone: string }
  | { type: "missing-finish"; employeeId: string; employeeName: string; teamName: string | null; date: string }
  /** An explanation of today that no late or absent row shows, kept on the card until HR decides it (attendanceRowExplanation). */
  | { type: "explanation"; employeeId: string; employeeName: string; teamName: string | null; date: string; kind: AttendanceExplanationKind }

/** What Today needs of an explanation to place it on the card. */
export type AttendanceTodayExplanation = Pick<AttendanceExplanationDto, "employeeId" | "employeeName" | "date" | "kind" | "status">

export type AttendanceTodayDay = { date: string; future: boolean; expected: number; present: number; late: number; away: number; absent: number }

/** Monday of the week containing `date` (date keys are calendar days, no zone). */
export function attendanceWeekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
  return addDateKeyDays(date, -((weekday + 6) % 7))
}

/** The report period the Today screen reads: the week, plus the lookback. */
export function attendanceTodayRange(today: string) {
  const weekStart = attendanceWeekStart(today)
  const lookback = addDateKeyDays(today, -ATTENDANCE_TODAY_LOOKBACK_DAYS)
  return { from: lookback < weekStart ? lookback : weekStart, to: addDateKeyDays(weekStart, 6), weekStart }
}

// A day the person is expected at work: a working calendar day, employed, and
// not covered by an approved absence. Approved remote work or a trip still
// counts once the person actually marked the start.
const expectedOn = (row: MtmAttendanceReportRow) => row.isWorkingDay && row.kind !== "NOT_EMPLOYED"
  && (row.kind !== "APPROVED_REQUEST" || row.startedAt !== null)
const awayOn = (row: MtmAttendanceReportRow) => row.kind === "APPROVED_REQUEST" && row.startedAt === null
const presentOn = (row: MtmAttendanceReportRow) => row.startedAt !== null && row.factsState === "VALID"
const lateOn = (row: MtmAttendanceReportRow) => (row.lateSeconds ?? 0) > 0

/**
 * Everything the Personnel → Today screen shows, from one report snapshot.
 * Counting rules are the report's own (`summarizeMtmAttendanceRows`): arrived
 * means a valid recorded start, absent means the report's ABSENT kind (no
 * approved reason), missing finish is the report's MISSING_FINISH kind.
 * `explanations` are the explanations API's for the past month: one that no
 * late or absent row of today shows and HR has not decided becomes a row of
 * its own, dated when it is about an earlier day.
 */
export function summarizeAttendanceToday(rows: readonly MtmAttendanceReportRow[], today: string, explanations: readonly AttendanceTodayExplanation[] = []) {
  const { weekStart } = attendanceTodayRange(today)
  const lookback = addDateKeyDays(today, -ATTENDANCE_TODAY_LOOKBACK_DAYS)
  const todayRows = rows.filter(row => row.date === today)
  const missing = rows.filter(row => row.kind === "MISSING_FINISH" && row.date < today && row.date >= lookback)
  const lateOrAbsent: AttendanceTodayAttention[] = [
    ...todayRows.filter(row => row.kind === "ABSENT").map(row => ({ type: "absent" as const, employeeId: row.employeeId, employeeName: row.employeeName, teamName: row.teamName, date: row.date })),
    ...todayRows.filter(row => lateOn(row) && row.startedAt).sort((a, b) => (b.lateSeconds ?? 0) - (a.lateSeconds ?? 0)).map(row => ({
      type: "late" as const, employeeId: row.employeeId, employeeName: row.employeeName, teamName: row.teamName, date: row.date,
      lateSeconds: row.lateSeconds ?? 0, startedAt: row.startedAt!, timezone: row.timezone })),
  ]
  const shownOnRows = new Set(lateOrAbsent.map(item => attendanceRowExplanation(item, explanations)))
  const teamOf = new Map(todayRows.map(row => [row.employeeId, row.teamName]))
  const attention: AttendanceTodayAttention[] = [
    ...lateOrAbsent,
    // An explanation asked about an earlier day (from a report, owner 2026-11-01) is decided here as well.
    ...explanations.filter(item => item.date <= today && !shownOnRows.has(item) && (item.status === "REQUESTED" || item.status === "ANSWERED"))
      .sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName) || a.kind.localeCompare(b.kind))
      .map(item => ({ type: "explanation" as const, employeeId: item.employeeId, employeeName: item.employeeName, teamName: teamOf.get(item.employeeId) ?? null, date: item.date, kind: item.kind })),
    ...missing.sort((a, b) => b.date.localeCompare(a.date)).map(row => ({ type: "missing-finish" as const, employeeId: row.employeeId, employeeName: row.employeeName, teamName: row.teamName, date: row.date })),
  ]
  const people = new Set(rows.filter(row => row.kind !== "NOT_EMPLOYED").map(row => row.employeeId))
  const flagged = new Set(attention.map(item => item.employeeId))
  const week: AttendanceTodayDay[] = []
  for (let index = 0; index < 7; index++) {
    const date = addDateKeyDays(weekStart, index)
    const day = rows.filter(row => row.date === date)
    const expected = day.filter(expectedOn).length
    // Weekend columns appear only when somebody is scheduled to work them.
    if (index >= 5 && expected === 0) continue
    week.push({ date, future: date > today, expected, present: day.filter(presentOn).length, late: day.filter(lateOn).length,
      away: day.filter(awayOn).length, absent: day.filter(row => row.kind === "ABSENT").length })
  }
  return {
    expected: todayRows.filter(expectedOn).length,
    arrived: todayRows.filter(presentOn).length,
    late: todayRows.filter(lateOn).length,
    absent: todayRows.filter(row => row.kind === "ABSENT").length,
    away: todayRows.filter(awayOn).length,
    missingFinish: missing.length,
    attention,
    /** People in tracking with nothing for HR to look at. */
    quiet: [...people].filter(id => !flagged.has(id)).length,
    people: people.size,
    week,
  }
}

export type AttendanceTodaySummary = ReturnType<typeof summarizeAttendanceToday>

/** One explanation per person, day and reason — the key the explanations API answers with. */
export function attendanceExplanationKey(employeeId: string, date: string, kind: "LATE" | "ABSENT"): string {
  return `${employeeId}|${date}|${kind}`
}

/**
 * The explanation a row of «needs attention» shows: the one of its own kind,
 * and on a late or absent row without one, the one the person already has for
 * that day. Someone asked as absent at 09:20 who comes at 12:30 and answers
 * is a late row by then; his answer belongs under that row, where HR reads it
 * and decides — this card is the only place in the CRM that decides one
 * (verifier, 2026-10-20). A missing finish has no explanation.
 */
export function attendanceRowExplanation<T extends Pick<AttendanceTodayExplanation, "employeeId" | "date" | "kind">>(item: AttendanceTodayAttention, explanations: readonly T[]): T | undefined {
  if (item.type === "missing-finish") return undefined
  const sameDay = explanations.filter(explanation => explanation.employeeId === item.employeeId && explanation.date === item.date)
  const own = sameDay.find(explanation => explanation.kind === attendanceTodayExplanationKind(item))
  return own ?? (item.type === "explanation" ? undefined : sameDay[0])
}

/** The kind a late, absent or explanation row asks about; null for a missing finish. */
function attendanceTodayExplanationKind(item: AttendanceTodayAttention): AttendanceExplanationKind | null {
  return item.type === "late" ? "LATE" : item.type === "absent" ? "ABSENT" : item.type === "explanation" ? item.kind : null
}

/**
 * The rows of «needs attention» HR can still ask to explain: late or absent,
 * with nothing asked or written for that person and day yet, whatever the
 * kind — one question a day, so someone asked as absent who then came late is
 * not asked again about the lateness. In list order.
 */
export function attendanceAskableExplanations(attention: readonly AttendanceTodayAttention[], explanations: readonly Pick<AttendanceTodayExplanation, "employeeId" | "date">[]): string[] {
  const explained = new Set(explanations.map(item => `${item.employeeId}|${item.date}`))
  return attention.flatMap(item => {
    if (item.type !== "late" && item.type !== "absent") return []
    return explained.has(`${item.employeeId}|${item.date}`) ? [] : [attendanceExplanationKey(item.employeeId, item.date, item.type === "late" ? "LATE" : "ABSENT")]
  })
}

/**
 * «İzahat istə» in one click (owner, 2026-10-20, the «Kadr uçotu» clip: «bir
 * düymə ilə»): a row that can be asked is ticked when it first appears. The
 * screen reloads every minute; a row it has already shown keeps whatever HR
 * did with its tick, so an untick is not undone by the next refresh. Returns
 * the rows to tick now; `seen` is updated in place.
 */
export function attendanceNewlyAskable(askable: readonly string[], seen: Set<string>): string[] {
  const fresh = askable.filter(key => !seen.has(key))
  for (const key of fresh) seen.add(key)
  return fresh
}

export type AttendanceNowPerson = { employeeId: string; name: string; at: string | null; dayKind: MtmAttendanceReportRow["dayKind"] | null }
export type AttendanceNow = { working: AttendanceNowPerson[]; paused: AttendanceNowPerson[]; left: AttendanceNowPerson[]; notYet: AttendanceNowPerson[] }
/**
 * Personnel → Today → «Now» (owner, 2026-10-16: who is at work or on a break
 * right now). Read from today's report rows: a finish means gone, a pause not
 * yet resumed means on a break, a start means at work; someone expected today
 * with no start — or away on an approved request — has not come yet. People
 * off today (weekend, holiday, before hiring) are not listed at all.
 */
export function attendanceNow(rows: readonly MtmAttendanceReportRow[], today: string): AttendanceNow {
  const latest = new Map<string, MtmAttendanceReportRow>()
  for (const row of rows) if (row.date === today) latest.set(row.employeeId, row)
  const now: AttendanceNow = { working: [], paused: [], left: [], notYet: [] }
  for (const row of latest.values()) {
    // The reason shown is the approved request's (leave, sick leave), never an absence code.
    const person = (at: string | null): AttendanceNowPerson => ({ employeeId: row.employeeId, name: row.employeeName, at, dayKind: row.kind === "APPROVED_REQUEST" ? row.dayKind ?? null : null })
    if (row.completedAt) { now.left.push(person(row.completedAt)); continue }
    if (row.startedAt) {
      const breaks = row.events.filter(event => event.type === "PAUSE" || event.type === "RESUME").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      const last = breaks.at(-1)
      if (last?.type === "PAUSE") now.paused.push(person(last.occurredAt)); else now.working.push(person(row.startedAt))
      continue
    }
    if (row.expectedWorkSeconds > 0 || row.kind === "APPROVED_REQUEST" || row.kind === "ABSENT") now.notYet.push(person(null))
  }
  const byTime = (a: AttendanceNowPerson, b: AttendanceNowPerson) => (a.at ?? "").localeCompare(b.at ?? "") || a.name.localeCompare(b.name)
  now.working.sort(byTime); now.paused.sort(byTime); now.left.sort(byTime)
  // Not yet come: the unexplained first, those away on an approved request after them.
  now.notYet.sort((a, b) => Number(Boolean(a.dayKind)) - Number(Boolean(b.dayKind)) || a.name.localeCompare(b.name))
  return now
}

export const ATTENDANCE_BOARD_FILTERS = ["all", "working", "paused", "late", "absent", "notYet", "away", "left"] as const
export type AttendanceBoardFilter = typeof ATTENDANCE_BOARD_FILTERS[number]
export type AttendanceBoardStatus = "working" | "paused" | "left" | "absent" | "notYet" | "away" | "check"
export type AttendanceBoardCounts = Record<AttendanceBoardFilter, number>
export type AttendanceBoardPerson = {
  employeeId: string; name: string; position: string | null
  departmentName: string | null; teamName: string | null; groupKey: string
  status: AttendanceBoardStatus
  /** When the status began: the start for «at work», the pause for «on a break», the finish for «gone». */
  since: string | null
  late: boolean
  row: MtmAttendanceReportRow
}
export type AttendanceBoardSection = { key: string; name: string | null; arrived: number; expected: number }
export type AttendanceBoardGroup = {
  key: string; name: string | null
  /** Everyone of the group concerned today: expected, away on a request, or come anyway. */
  total: number; expected: number; arrived: number; late: number; absent: number; away: number; notYet: number
  sections: AttendanceBoardSection[]
  counts: AttendanceBoardCounts
}
export type AttendanceBoard = { grouping: "department" | "team" | "none"; groups: AttendanceBoardGroup[]; people: AttendanceBoardPerson[]; counts: AttendanceBoardCounts }

const NONE_KEY = "none"
const emptyCounts = (): AttendanceBoardCounts => ({ all: 0, working: 0, paused: 0, late: 0, absent: 0, notYet: 0, away: 0, left: 0 })
function countPerson(counts: AttendanceBoardCounts, person: AttendanceBoardPerson) {
  counts.all++
  if (person.status !== "check") counts[person.status]++
  if (person.late) counts.late++
}
const ATTENTION_ORDER: Record<AttendanceBoardStatus, number> = { absent: 0, check: 2, notYet: 3, working: 4, paused: 4, left: 4, away: 4 }
const byName = (a: { name: string | null }, b: { name: string | null }) => a.name === null ? (b.name === null ? 0 : 1) : b.name === null ? -1 : a.name.localeCompare(b.name)

/**
 * Personnel → Today → the live board (owner, 2026-11-02, approved mockup after
 * the HRSS clip «Kim işdədir? Canlı baxın»): today by department, a filter per
 * status, everyone of the day in one list.
 *
 * Group figures use the summary's own predicates over today's rows, so the
 * departments add up to the tiles above them. Departments come from employee
 * cards; a company that has none is grouped by section, and one group only
 * gives no strip at all. A person's status reads the latest row of the day, as
 * «Now» did: gone, on a break, at work, then away on a request, absent, not yet.
 */
export function attendanceBoard(rows: readonly MtmAttendanceReportRow[], today: string): AttendanceBoard {
  const todayRows = rows.filter(row => row.date === today)
  const grouping: AttendanceBoard["grouping"] = todayRows.some(row => row.departmentId) ? "department" : todayRows.some(row => row.teamId) ? "team" : "none"
  const groupOf = (row: MtmAttendanceReportRow) => grouping === "department" ? { key: row.departmentId ?? NONE_KEY, name: row.departmentId ? row.departmentName ?? null : null }
    : grouping === "team" ? { key: row.teamId ?? NONE_KEY, name: row.teamId ? row.teamName : null } : { key: NONE_KEY, name: null }

  const latest = new Map<string, MtmAttendanceReportRow>()
  for (const row of todayRows) latest.set(row.employeeId, row)
  const people: AttendanceBoardPerson[] = []
  for (const row of latest.values()) {
    const concerned = row.startedAt !== null || (row.kind !== "NOT_EMPLOYED" && (row.expectedWorkSeconds > 0 || ["APPROVED_REQUEST", "ABSENT", "INVALID_FACTS"].includes(row.kind)))
    if (!concerned) continue
    let status: AttendanceBoardStatus, since: string | null = null
    if (row.factsState === "INVALID") status = "check"
    else if (row.completedAt) { status = "left"; since = row.completedAt }
    else if (row.startedAt) {
      const last = row.events.filter(event => event.type === "PAUSE" || event.type === "RESUME").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).at(-1)
      if (last?.type === "PAUSE") { status = "paused"; since = last.occurredAt } else { status = "working"; since = row.startedAt }
    } else if (row.kind === "APPROVED_REQUEST") status = "away"
    else if (row.kind === "ABSENT") status = "absent"
    else status = "notYet"
    people.push({ employeeId: row.employeeId, name: row.employeeName, position: row.employeePosition ?? null, departmentName: row.departmentName ?? null, teamName: row.teamName,
      groupKey: groupOf(row).key, status, since, late: lateOn(row) && row.startedAt !== null, row })
  }
  people.sort((a, b) => {
    const rank = (person: AttendanceBoardPerson) => person.status === "absent" ? 0 : person.late ? 1 : ATTENTION_ORDER[person.status]
    return rank(a) - rank(b) || (a.late && b.late ? (b.row.lateSeconds ?? 0) - (a.row.lateSeconds ?? 0) : 0) || a.name.localeCompare(b.name)
  })

  const groups = new Map<string, AttendanceBoardGroup>()
  const sections = new Map<string, Map<string, AttendanceBoardSection>>()
  for (const row of todayRows) {
    const { key, name } = groupOf(row)
    const group = groups.get(key) ?? { key, name, total: 0, expected: 0, arrived: 0, late: 0, absent: 0, away: 0, notYet: 0, sections: [], counts: emptyCounts() }
    groups.set(key, group)
    const expected = expectedOn(row), present = presentOn(row)
    if (expected) group.expected++
    if (present) group.arrived++
    if (lateOn(row)) group.late++
    if (row.kind === "ABSENT") group.absent++
    if (awayOn(row)) group.away++
    if (grouping === "department" && (expected || present)) {
      const bySection = sections.get(key) ?? new Map<string, AttendanceBoardSection>()
      sections.set(key, bySection)
      const sectionKey = row.teamId ?? NONE_KEY
      const section = bySection.get(sectionKey) ?? { key: sectionKey, name: row.teamId ? row.teamName : null, arrived: 0, expected: 0 }
      bySection.set(sectionKey, section)
      if (expected) section.expected++
      if (present) section.arrived++
    }
  }
  const counts = emptyCounts()
  for (const person of people) {
    countPerson(counts, person)
    const group = groups.get(person.groupKey)
    if (!group) continue
    group.total++
    if (person.status === "notYet") group.notYet++
    countPerson(group.counts, person)
  }
  for (const group of groups.values()) group.sections = [...(sections.get(group.key)?.values() ?? [])].sort(byName)
  const listed = grouping === "none" ? [] : [...groups.values()].filter(group => group.total > 0 || group.arrived > 0).sort(byName)
  return { grouping, groups: listed.length > 1 ? listed : [], people, counts }
}
