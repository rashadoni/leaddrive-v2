import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"

export type AttendanceParticipationChange = { included: boolean; effectiveAt: string }
export type AttendanceParticipationState = "INCLUDED" | "EXCLUDED" | "BEFORE_START"

/** Participation is a reporting rule, never an employment fact. Changes apply
 * to their civil date and later dates; an exclusion cannot rewrite earlier
 * days. Missing legacy boundaries retain the established reporting history. */
export function attendanceParticipationOnDate(
  includedFrom: string | null | undefined,
  changes: readonly AttendanceParticipationChange[] | undefined,
  date: string,
  timezone: string,
): AttendanceParticipationState {
  if (!isDateKey(date)) throw new Error("MTM_ATTENDANCE_PARTICIPATION_DATE_INVALID")
  const civilDate = (value: string) => {
    const instant = new Date(value)
    if (!Number.isFinite(instant.getTime())) throw new Error("MTM_ATTENDANCE_PARTICIPATION_HISTORY_INVALID")
    return currentDateKey(instant, timezone)
  }
  let state: AttendanceParticipationState = includedFrom && date < civilDate(includedFrom) ? "BEFORE_START" : "INCLUDED"
  const ordered = [...(changes ?? [])].sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt))
  for (const change of ordered) {
    if (civilDate(change.effectiveAt) <= date) state = change.included ? "INCLUDED" : "EXCLUDED"
  }
  return state
}
