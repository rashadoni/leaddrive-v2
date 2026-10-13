import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { localDateTimeToUnambiguousUtc } from "@/lib/timezone"

/** Explicit lifecycle facts only. Directory ACTIVE/INACTIVE and createdAt are
 * not employment dates. This DTO has no author, reason or private HR data. */
export type AttendanceEmploymentEvent = { kind: "HIRE" | "TERMINATION" | "REHIRE"; effectiveAt: string }
export type AttendanceEmploymentState = "UNKNOWN" | "EMPLOYED" | "NOT_EMPLOYED"

/** A civil date is employed if any part intersects a recorded employment
 * interval. A termination at midnight therefore excludes that whole date. */
export function attendanceEmploymentOnDate(events: readonly AttendanceEmploymentEvent[] | undefined, date: string, timezone: string): AttendanceEmploymentState {
  if (!events?.length) return "UNKNOWN"
  let start: number, end: number
  try {
    start = localDateTimeToUnambiguousUtc(`${date}T00:00`, timezone).getTime()
    end = localDateTimeToUnambiguousUtc(`${addDateKeyDays(date, 1)}T00:00`, timezone).getTime()
  } catch { return "UNKNOWN" }
  const ordered = events.map(event => ({ ...event, at: Date.parse(event.effectiveAt) })).sort((a, b) => a.at - b.at || Number(a.kind === "REHIRE") - Number(b.kind === "REHIRE"))
  // Only TERMINATION -> REHIRE may share a boundary, after an employed
  // interval. All other duplicate instants remain conflicting imported facts.
  if (ordered.some((event, i) => !Number.isFinite(event.at) || (i > 0 && ordered[i - 1].at === event.at
    && !(event.kind === "REHIRE" && ordered[i - 1].kind === "TERMINATION" && i >= 2
      && ordered[i - 2].at < event.at && ordered[i - 2].kind !== "TERMINATION")))) return "UNKNOWN"
  let state: AttendanceEmploymentState = ordered[0].kind === "HIRE" ? "NOT_EMPLOYED" : "UNKNOWN"
  for (const event of ordered) {
    if (event.at >= end) break
    if (event.at > start && state === "EMPLOYED") return "EMPLOYED"
    state = event.kind === "TERMINATION" ? "NOT_EMPLOYED" : "EMPLOYED"
  }
  return state
}
