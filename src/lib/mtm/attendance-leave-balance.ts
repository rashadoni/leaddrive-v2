import type { MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { attendanceApprovedAbsenceWindow } from "@/lib/mtm/attendance-request-projection"
import { isDateKey } from "@/lib/mtm/mobile-week"
import type { AttendanceLeaveBalance, AttendanceLeavePolicy, AttendanceLeaveProfile, AttendanceLeaveRevision } from "@/lib/mtm/attendance-leave-contract"

/** Completed civil years, never age inferred from account creation. Leap-day
 * service begins its next completed year on March 1 in a non-leap year. */
export function attendanceServiceYears(start: string, basis: string): number | null {
  if (!isDateKey(start) || !isDateKey(basis) || start > basis) return null
  return Number(basis.slice(0, 4)) - Number(start.slice(0, 4)) - Number(basis.slice(5) < start.slice(5))
}
const round = (value: number) => Math.round(value * 10000) / 10000
function leaveFraction(row: MtmAttendanceReportRow, policy: AttendanceLeavePolicy): number | null {
  if (row.employmentState === "NOT_EMPLOYED" || ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"].includes(row.calendarKind)
    || (policy.counting === "WORKING_DAYS" && !row.isWorkingDay)) return 0
  const periods = (row.approvedRequests ?? []).filter(period => period.details.dayKind.key === "ANNUAL_LEAVE")
  if (periods.some(period => period.details.unit === "DAYS")) return 1
  if (!periods.length) return 0
  if (!policy.minutesPerDay) return null
  const windows: [number, number][] = []
  for (const period of periods) {
    const window = attendanceApprovedAbsenceWindow(period)
    if (!window) return null
    windows.push(window)
  }
  // Union approved overlaps; duplicates cannot consume a day twice. A full
  // day already took precedence above. No legal conversion factor is assumed.
  let cursor = Number.NEGATIVE_INFINITY, total = 0
  for (const [from, to] of windows.sort(([a], [b]) => a - b)) { total += Math.max(0, to - Math.max(cursor, from)); cursor = Math.max(cursor, to) }
  return total / (policy.minutesPerDay * 60_000)
}
export function attendanceLeaveBalance(input: {
  employeeId: string; name: string; teamName: string | null; rows: readonly MtmAttendanceReportRow[]; usedThrough: string
  policy: AttendanceLeavePolicy | null; profile: AttendanceLeaveRevision<AttendanceLeaveProfile> | null
}): AttendanceLeaveBalance {
  const { policy, profile } = input
  const result: AttendanceLeaveBalance = { employeeId: input.employeeId, name: input.name, teamName: input.teamName, profile,
    serviceYears: null, allowanceDays: null, usedDays: null, plannedDays: null, remainingDays: null, availableDays: null, state: "POLICY_MISSING" }
  if (!policy?.reviewed || !policy.basisDate || !policy.counting) return result
  let used = 0, planned = 0, unknown = false
  for (const row of input.rows) {
    if (row.employeeId !== input.employeeId) continue
    const fraction = leaveFraction(row, policy)
    if (fraction === null) unknown = true
    else if (row.date <= input.usedThrough) used += fraction
    else planned += fraction
  }
  if (!unknown) { result.usedDays = round(used); result.plannedDays = round(planned) }
  if (!profile) return { ...result, state: "PROFILE_MISSING" }
  result.serviceYears = attendanceServiceYears(profile.value.serviceStart, policy.basisDate)
  if (result.serviceYears === null) return { ...result, state: "TENURE_UNKNOWN" }
  const tier = policy.tiers.filter(item => item.category === profile.value.category && item.minimumYears <= result.serviceYears!).sort((a, b) => b.minimumYears - a.minimumYears)[0]
  if (!tier) return { ...result, state: "TIER_MISSING" }
  result.allowanceDays = tier.days
  if (unknown) return { ...result, state: policy.minutesPerDay ? "HOURS_INVALID" : "HOURS_UNCONFIGURED" }
  result.remainingDays = round(tier.days + profile.value.openingDays - used)
  result.availableDays = round(result.remainingDays - planned)
  return { ...result, state: "READY" }
}
