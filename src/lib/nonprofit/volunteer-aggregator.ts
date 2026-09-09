/**
 * Volunteer-hours aggregator — R9 Phase 5 slice 1.
 *
 * Given a flat array of `VolunteerActivityRow`s, bucket by:
 *   - "volunteer" — by contactId when present, otherwise volunteerName
 *   - "program"   — by programId (null bucket = unaffiliated)
 *   - "month"     — by "YYYY-MM" UTC
 *   - "type"      — by activityType
 *
 * Returns buckets sorted by totalHours desc. Pure synchronous.
 */
import type {
  VolunteerActivityRow,
  VolunteerAggregateBucket,
  VolunteerGroupBy,
} from "./types"

export interface AggregateVolunteerHoursInput {
  activities: readonly VolunteerActivityRow[]
  groupBy: VolunteerGroupBy
}

export function aggregateVolunteerHours(
  input: AggregateVolunteerHoursInput
): VolunteerAggregateBucket[] {
  const { activities, groupBy } = input
  const buckets = new Map<string, { label: string; totalHours: number; sessionCount: number }>()

  for (const a of activities) {
    if (!Number.isFinite(a.hoursLogged) || a.hoursLogged < 0) continue
    if (!(a.occurredAt instanceof Date) || Number.isNaN(a.occurredAt.getTime())) continue

    const { key, label } = bucketKey(a, groupBy)
    const b = buckets.get(key) ?? { label, totalHours: 0, sessionCount: 0 }
    b.totalHours += a.hoursLogged
    b.sessionCount += 1
    buckets.set(key, b)
  }

  return [...buckets.entries()]
    .map(([key, { label, totalHours, sessionCount }]) => ({
      key,
      label,
      totalHours,
      sessionCount,
    }))
    .sort((a, b) => b.totalHours - a.totalHours)
}

function bucketKey(
  a: VolunteerActivityRow,
  groupBy: VolunteerGroupBy
): { key: string; label: string } {
  switch (groupBy) {
    case "volunteer": {
      // Prefer contactId for canonical grouping; fall back to name
      // when the volunteer doesn't have a CRM contact link yet.
      const key = a.contactId ? `contact:${a.contactId}` : `name:${a.volunteerName}`
      return { key, label: a.volunteerName }
    }
    case "program": {
      if (a.programId) return { key: `program:${a.programId}`, label: a.programId }
      return { key: "program:__unaffiliated__", label: "Unaffiliated" }
    }
    case "month": {
      const yyyy = a.occurredAt.getUTCFullYear()
      const mm = String(a.occurredAt.getUTCMonth() + 1).padStart(2, "0")
      const ym = `${yyyy}-${mm}`
      return { key: ym, label: ym }
    }
    case "type":
      return { key: a.activityType, label: a.activityType }
    default: {
      const exhaustive: never = groupBy
      throw new Error(`Unsupported groupBy: ${exhaustive}`)
    }
  }
}
