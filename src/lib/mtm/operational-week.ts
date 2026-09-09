import { createHash } from "node:crypto"
import {
  addDateKeyDays,
  isDateKey,
  localDateKeyToUtc,
  startOfIsoWeekDateKey,
} from "@/lib/mtm/mobile-week"

export const OPERATIONAL_WEEK_LIMITS = {
  filterAgents: 500,
  routes: 100,
  pointsPerRoute: 50,
  // A selected employee can still have a very dense shared-plan week, but
  // the web contract must remain safe to render on ordinary phones/tablets.
  routePointsTotal: 500,
  visits: 2_000,
  // Visits remain broad enough for deterministic point matching, while only
  // a bounded unmatched agenda is serialized into render/cache payloads.
  unplannedVisits: 100,
  tasks: 1_000,
  planChanges: 500,
  workdayEventsPerDay: 100,
} as const

export type OperationalWeekDays = 1 | 5 | 7
export type OperationalPointState = "PLANNED" | "IN_PROGRESS" | "ACTUAL" | "CANCELLED"
export type OperationalVisitMatch = "ROUTE_POINT" | "ROUTE_SUBJECT" | "DAY_SUBJECT"

export type OperationalWeekWindow = {
  anchor: string
  start: string
  endExclusive: string
  days: OperationalWeekDays
  activityStart: Date
  activityEnd: Date
  routeStart: Date
  routeEnd: Date
}

export type OperationalVisitEvidence = {
  id: string
  routeId: string | null
  routePointId: string | null
  customerId: string
  contactId: string | null
  status: string
  checkInAt: Date
  checkOutAt: Date | null
}

function subjectKey(customerId: string, contactId: string | null): string {
  return contactId ? `contact:${contactId}` : `customer:${customerId}`
}

export function parseOperationalWeekDays(value: string | null): OperationalWeekDays | null {
  if (value === null || value === "5") return 5
  if (value === "1") return 1
  if (value === "7") return 7
  return null
}

export function resolveOperationalWeekWindow(
  anchor: string,
  days: OperationalWeekDays,
  timezone: string,
): OperationalWeekWindow | null {
  if (!isDateKey(anchor)) return null
  const start = days === 1 ? anchor : startOfIsoWeekDateKey(anchor)
  const endExclusive = addDateKeyDays(start, days)
  return {
    anchor,
    start,
    endExclusive,
    days,
    activityStart: localDateKeyToUtc(start, timezone),
    activityEnd: localDateKeyToUtc(endExclusive, timezone),
    routeStart: new Date(`${start}T00:00:00.000Z`),
    routeEnd: new Date(`${endExclusive}T00:00:00.000Z`),
  }
}

/** Assignment intervals are evaluated against the selected tenant-local route day. */
export function assignmentIntersectsRouteDay(
  assignment: { assignedAt: Date; removedAt: Date | null },
  routeDateKey: string,
  timezone: string,
): boolean {
  const dayStart = localDateKeyToUtc(routeDateKey, timezone).getTime()
  const dayEnd = localDateKeyToUtc(addDateKeyDays(routeDateKey, 1), timezone).getTime()
  return assignment.assignedAt.getTime() < dayEnd &&
    (!assignment.removedAt || assignment.removedAt.getTime() > dayStart)
}

/** Participant membership is historical: current membership is not substituted for event time. */
export function participantAtVisitTime(
  participant: { joinedAt: Date; leftAt: Date | null },
  checkInAt: Date,
): boolean {
  return participant.joinedAt.getTime() <= checkInAt.getTime() &&
    (!participant.leftAt || participant.leftAt.getTime() > checkInAt.getTime())
}

/**
 * Match published plan points to actual visit evidence. Explicit foreign keys
 * win, followed by same-route subject identity, then same-local-day subject.
 * The input order is the deterministic evidence preference (completed first,
 * then check-in/id order in the API query).
 */
export function matchOperationalVisit(
  input: {
    routeId: string
    routeDateKey: string
    pointId: string
    customerId: string
    contactId: string | null
  },
  visits: ReadonlyArray<OperationalVisitEvidence & { dateKey: string }>,
): { visit: OperationalVisitEvidence; match: OperationalVisitMatch } | null {
  const byPoint = visits.find((visit) => visit.routePointId === input.pointId)
  if (byPoint) return { visit: byPoint, match: "ROUTE_POINT" }

  const expectedSubject = subjectKey(input.customerId, input.contactId)
  const byRouteSubject = visits.find((visit) =>
    visit.routePointId === null &&
    visit.routeId === input.routeId &&
    subjectKey(visit.customerId, visit.contactId) === expectedSubject,
  )
  if (byRouteSubject) return { visit: byRouteSubject, match: "ROUTE_SUBJECT" }

  const byDaySubject = visits.find((visit) =>
    visit.routePointId === null &&
    visit.routeId === null &&
    visit.dateKey === input.routeDateKey &&
    subjectKey(visit.customerId, visit.contactId) === expectedSubject,
  )
  return byDaySubject ? { visit: byDaySubject, match: "DAY_SUBJECT" } : null
}

export function operationalPointState(input: {
  routeStatus: string
  pointStatus: string
  visitStatus?: string | null
}): OperationalPointState {
  if (input.routeStatus === "CANCELLED" || input.pointStatus === "SKIPPED" || input.visitStatus === "CANCELLED") {
    return "CANCELLED"
  }
  if (input.visitStatus === "CHECKED_OUT" || input.pointStatus === "VISITED") return "ACTUAL"
  if (input.visitStatus === "CHECKED_IN") return "IN_PROGRESS"
  return "PLANNED"
}

export function workedSeconds(
  workday: {
    status: string
    startedAt: Date
    pausedAt: Date | null
    completedAt: Date | null
    totalPausedSeconds: number
  },
  now: Date,
): number {
  const end = workday.completedAt ?? now
  const currentPause = workday.status === "PAUSED" && workday.pausedAt
    ? Math.max(0, Math.floor((end.getTime() - workday.pausedAt.getTime()) / 1_000))
    : 0
  const elapsed = Math.max(0, Math.floor((end.getTime() - workday.startedAt.getTime()) / 1_000))
  return Math.max(0, elapsed - workday.totalPausedSeconds - currentPause)
}

export function availableWorkdayActions(status: string | null): string[] {
  if (!status) return ["START"]
  if (status === "STARTED") return ["PAUSE", "FINISH"]
  if (status === "PAUSED") return ["RESUME", "FINISH"]
  return []
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

/** generatedAt is deliberately supplied outside this stable source snapshot. */
export function operationalWeekSnapshotId(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
}

export function latestOperationalSourceAt(values: ReadonlyArray<Date | null | undefined>): string | null {
  let latest = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value && Number.isFinite(value.getTime())) latest = Math.max(latest, value.getTime())
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null
}
