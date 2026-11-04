import type { MtmWorkdayPause } from "@/lib/mtm/workday-pauses"

/** Shared by the server and the screens (no server code here): the kinds of a break, `attendance-break-kinds.ts`. */
export const ATTENDANCE_BUILT_IN_BREAK_KINDS = ["smoke", "lunch", "personal"] as const
export const ATTENDANCE_BREAK_KINDS_MAX = 12
export type AttendanceBreakKind = { id: string; name: string | null; limitMinutes: number | null }
/** A built-in kind stored without a name is named by the reader's language (`mtmAttendance.breakKind_<id>`). */
export function attendanceBreakKindName(kind: { kindId: string; kindName: string | null }, t: (key: string) => string) {
  if (kind.kindName) return kind.kindName
  return (ATTENDANCE_BUILT_IN_BREAK_KINDS as readonly string[]).includes(kind.kindId) ? t(`breakKind_${kind.kindId}`) : t("breakKindNone")
}

export type AttendanceBreakLabel = { at: string; kindId: string; kindName: string | null; limitMinutes: number | null }
/** One kind over one day: how many breaks, how long, and the limit the last of them was taken under. */
export type AttendanceBreakKindTotal = { kindId: string; kindName: string | null; count: number; seconds: number; limitMinutes: number | null }

/**
 * Per-kind totals of one day's breaks. A break is labeled by the PAUSE that
 * opened it (`MtmWorkdayPause.from` is that event's instant); a break with no
 * label — chosen before kinds existed, a gap of a reopened day, a pause a
 * correction moved — is counted under no kind and named «без вида» by its reader.
 * An open break counts up to `now`.
 */
export function attendanceBreakKindTotals(pauses: readonly MtmWorkdayPause[], labels: readonly AttendanceBreakLabel[], now: Date): AttendanceBreakKindTotal[] {
  const byStart = new Map(labels.map(label => [new Date(label.at).getTime(), label]))
  const totals = new Map<string, AttendanceBreakKindTotal>()
  for (const pause of pauses) {
    const label = byStart.get(pause.from.getTime())
    const key = label?.kindId ?? ""
    const seconds = Math.max(0, Math.floor(((pause.to ?? now).getTime() - pause.from.getTime()) / 1000))
    const total = totals.get(key) ?? { kindId: key, kindName: label?.kindName ?? null, count: 0, seconds: 0, limitMinutes: label?.limitMinutes ?? null }
    total.count += 1; total.seconds += seconds
    if (label) { total.kindName = label.kindName; total.limitMinutes = label.limitMinutes }
    totals.set(key, total)
  }
  // Labeled kinds first, in the order they were first taken; unlabeled last.
  return [...totals.values()].sort((a, b) => Number(a.kindId === "") - Number(b.kindId === ""))
}
export const attendanceBreakOverLimit = (total: AttendanceBreakKindTotal) => total.kindId !== "" && total.limitMinutes !== null && total.seconds > total.limitMinutes * 60
