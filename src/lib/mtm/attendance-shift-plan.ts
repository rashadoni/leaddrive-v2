import { minutesOfDay } from "@/lib/mtm/attendance-rules"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { AttendanceShiftValueSchema, type AttendanceShiftAssignment } from "@/lib/mtm/attendance-shift-contract"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"
export type AttendanceResolvedShift = {
  id: string; timezone: string; startTime: string; endTime: string; nextDay: boolean; working: boolean
  lunchMinutes: number; lateGraceMinutes: number; accountingDate: string; shorteningMinutes: number; overtimeThresholdMinutes: number | null
}
/** Frozen membership and an immutable sequence choose the plan. A later team
 * transfer never changes a historical employee's published schedule. */
export function attendanceShiftForDate(assignments: readonly AttendanceShiftAssignment[], agentId: string, teamId: string | null, date: string, calendar: readonly WorkCalendarOverride[]): AttendanceResolvedShift | null {
  const candidates = assignments.filter(row => row.agentId === agentId && row.plan.value.from <= date && row.plan.value.to >= date)
  const plan = candidates.reduce<AttendanceShiftAssignment["plan"] | null>((best, row) => !best || row.plan.version > best.version ? row.plan : best, null)
  if (!plan) return null
  const value = AttendanceShiftValueSchema.parse(plan.value)
  const index = Math.round((Date.parse(date) - Date.parse(value.from)) / 86_400_000) % value.cycle.length
  const day = value.cycle[index]
  // Day-off cycles retain a harmless valid clock for the common calculator;
  // an explicit working-calendar exception uses the first actual work slot.
  const fallback = value.cycle.find(item => item.kind === "WORK")
  const clock = day.kind === "WORK" ? day : fallback?.kind === "WORK" ? fallback
    : { startTime: "09:00", endTime: "18:00", nextDay: false, lunchMinutes: 60, lateGraceMinutes: 10 }
  const effective = resolveWorkCalendarDay({ date, overrides: calendar, agentId, teamId })
  const following = resolveWorkCalendarDay({ date: addDateKeyDays(date, 1), overrides: calendar, agentId, teamId })
  const shorteningMinutes = value.preHolidayMinutes !== null && value.preHolidayConfirmed && following.kind === "PUBLIC_HOLIDAY" ? value.preHolidayMinutes : 0
  const endOffset = Math.floor((minutesOfDay(clock.endTime) + (clock.nextDay ? 1440 : 0) - shorteningMinutes) / 1440)
  return { id: plan.id, timezone: value.timezone, ...clock, working: day.kind === "WORK", accountingDate: value.attribution === "END_DAY" && clock.nextDay && (day.kind === "WORK" || (effective.overrideId !== null && effective.isWorkingDay)) ? addDateKeyDays(date, endOffset) : date,
    shorteningMinutes, overtimeThresholdMinutes: value.overtimeThresholdMinutes }
}
