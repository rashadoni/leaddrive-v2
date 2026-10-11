export const GPS_FRESHNESS = {
  onlineSeconds: 5 * 60,
  delayedSeconds: 15 * 60,
} as const

export type GpsFreshness = "ONLINE" | "DELAYED" | "STALE" | "NO_LOCATION"
export type LiveWorkdayState = "ACTIVE" | "PAUSED" | "CLOSED" | "NOT_STARTED"
export type LocationState = "AVAILABLE" | "NO_LOCATION_REPORTED" | "PERMISSION_NOT_GRANTED"

export function classifyGpsFreshness(
  recordedAt: Date | string | null | undefined,
  now: Date = new Date(),
  thresholds: { onlineSeconds: number; delayedSeconds: number } = GPS_FRESHNESS,
): GpsFreshness {
  if (!recordedAt) return "NO_LOCATION"
  const ageSeconds = Math.max(0, (now.getTime() - new Date(recordedAt).getTime()) / 1000)
  if (ageSeconds <= thresholds.onlineSeconds) return "ONLINE"
  if (ageSeconds <= thresholds.delayedSeconds) return "DELAYED"
  return "STALE"
}

export function mapWorkdayState(status: string | null | undefined): LiveWorkdayState {
  if (status === "STARTED") return "ACTIVE"
  if (status === "PAUSED") return "PAUSED"
  if (status === "COMPLETED") return "CLOSED"
  return "NOT_STARTED"
}

export function explainMissingLocation(input: {
  hasLocation: boolean
  lastSeenAt: Date | string | null | undefined
  permissionState?: "GRANTED" | "DENIED" | "UNKNOWN" | null
}): LocationState {
  if (input.hasLocation) return "AVAILABLE"
  // `lastSeenAt` is presence telemetry, not OS permission telemetry. Only an
  // explicit, trusted denial may be described as permission not granted.
  if (input.permissionState === "DENIED") return "PERMISSION_NOT_GRANTED"
  return "NO_LOCATION_REPORTED"
}

// ─── What the live roster reads of an employee ──────────────────────────────
//
// GET /api/v1/mtm/locations draws a marker from these, and the public answer
// of a «ссылка на местоположение» (/api/v1/public/location-share/[token])
// reads the same rows through the same functions — so an outsider is never
// shown a point, or a shift, that the managers' own map reads differently.

/**
 * How vague a point may be and still be a position: the organization's
 * `historyMaxAccuracyMeters`, held between five metres and a kilometre.
 */
export function liveMapMaxAccuracyMeters(historyMaxAccuracyMeters: number): number {
  return Math.min(1_000, Math.max(5, historyMaxAccuracyMeters))
}

/** The filter below as a query words it; the fields are those of mtm_agent_locations. */
export interface LiveMapAdmissibleLocationWhere {
  latitude: { gte: number; lte: number }
  longitude: { gte: number; lte: number }
  OR: Array<{ accuracy: null } | { accuracy: { gte: number; lte: number } }>
}

/**
 * The rows of mtm_agent_locations a marker may be drawn from: on the globe,
 * and exact enough — or with no accuracy reported at all. The newest of them
 * is the position; accuracy is a gate, never a reason to prefer an older,
 * prettier point.
 */
export function liveMapAdmissibleLocationWhere(maxAccuracyMeters: number): LiveMapAdmissibleLocationWhere {
  return {
    latitude: { gte: -90, lte: 90 },
    longitude: { gte: -180, lte: 180 },
    OR: [
      { accuracy: null },
      { accuracy: { gte: 0, lte: maxAccuracyMeters } },
    ],
  }
}

/** The same filter asked of a row already read: a legacy row may hold a number that is not one. */
export function isLiveMapAdmissibleLocation(
  candidate: { latitude: number; longitude: number; accuracy: number | null },
  maxAccuracyMeters: number,
): boolean {
  return Number.isFinite(candidate.latitude) && candidate.latitude >= -90 && candidate.latitude <= 90 &&
    Number.isFinite(candidate.longitude) && candidate.longitude >= -180 && candidate.longitude <= 180 &&
    (candidate.accuracy == null || (
      Number.isFinite(candidate.accuracy) && candidate.accuracy >= 0 && candidate.accuracy <= maxAccuracyMeters
    ))
}

/** How the roster reads an employee's workdays, as a query words it; the fields are those of mtm_agent_workdays. */
export interface LiveMapWorkdayRead {
  where: { OR: Array<{ status: { in: Array<"STARTED" | "PAUSED"> } } | { workDate: Date }> }
  take: number
  orderBy: Array<{ startedAt: "desc" } | { workDate: "desc" }>
}

/**
 * Which workdays say what an employee's shift is right now: one that is open
 * — whatever day it was opened on — and today's, the two newest first.
 * `today` is the organization's day as mtm_agent_workdays stores a date: UTC
 * midnight of it.
 *
 * An unfinished shift of an earlier day is read on purpose. Calling it «not
 * started» would hide the exact anomaly the operator must resolve.
 */
export function liveMapWorkdayRead(today: Date): LiveMapWorkdayRead {
  return {
    where: {
      OR: [
        { status: { in: ["STARTED", "PAUSED"] } },
        { workDate: today },
      ],
    },
    take: 2,
    orderBy: [{ startedAt: "desc" }, { workDate: "desc" }],
  }
}

/**
 * The shift an employee is in, out of the rows read above: the open one
 * (`active`) if there is one, otherwise today's. `active` is handed back as
 * well — whether it is today's or was left open is the caller's to say.
 */
export function liveMapWorkdayOf<W extends { status: string; workDate: Date }>(
  workdays: readonly W[],
  today: Date,
): { active: W | undefined; effective: W | undefined } {
  const active = workdays.find((workday) => workday.status === "STARTED" || workday.status === "PAUSED")
  const ofToday = workdays.find((workday) => workday.workDate.getTime() === today.getTime())
  return { active, effective: active ?? ofToday }
}
