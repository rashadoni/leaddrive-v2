import { readMtmAlertMessage } from "@/lib/mtm/alert-messages"
import { formatTime } from "@/lib/format-date"
import { dateInputValueInTimezone } from "@/lib/timezone"

/**
 * The live map's event feed, alert half.
 *
 * Prod audit 2026-09-14: the feed printed «Route deviation detected» in
 * English, ten times in a row for one agent, with no distance, and a row led
 * nowhere. Three separate faults:
 *
 * - the text was the stored English `title`; the generator has written a
 *   `messageKey` + numbers into `metadata` since A4, and nobody read it here;
 * - one agent drifting off route for an hour produces an alert per throttle
 *   window, and fifteen feed slots filled with the same sentence;
 * - the manager's next question is always "where was he at that moment",
 *   which is the GPS history of that agent at that time.
 *
 * So the server groups repeats (same agent, same kind, same local hour) and
 * hands the client a translatable message, and the client links each group to
 * the history window around it.
 */

export type MtmLiveFeedAlertMessage =
  | { key: "routeDeviation"; distanceMeters: number }
  | { key: "outOfZoneCheckIn"; distanceMeters: number }
  | { key: "visitStillOpen"; minutes: number }
  | { key: "type"; alertType: string }

export interface MtmLiveFeedAlertRow {
  id: string
  agentId: string
  agentName: string | null
  type: string
  title: string
  createdAt: Date | string
  metadata: unknown
}

export interface MtmLiveFeedAlertGroup {
  id: string
  type: "ALERT"
  agentId: string
  agent: string
  /** Legacy stored sentence — shown only by clients that predate `alert`. */
  customer: string
  time: string
  alert: {
    alertType: string
    message: MtmLiveFeedAlertMessage
    count: number
    firstAt: string
    lastAt: string
  }
}

const ROUTE_DEVIATION_KEYS = new Set(["routeDeviation", "agentRouteDeviation"])
const OUT_OF_ZONE_KEYS = new Set([
  "outOfZoneCheckIn",
  "outOfZoneCheckInForced",
  "geofenceViolation",
  "geofenceViolationUnnamed",
  "agentOutOfZoneCheckIn",
  "agentOutOfZoneCheckInUnnamed",
])
const OPEN_VISIT_KEYS = new Set(["visitStillOpen", "visitStillOpenUnnamed"])

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Reads what happened and with which number, from the row's metadata. */
export function buildMtmLiveFeedAlertMessage(alertType: string, metadata: unknown): MtmLiveFeedAlertMessage {
  const stored = readMtmAlertMessage(metadata)
  if (stored.kind === "localized") {
    if (ROUTE_DEVIATION_KEYS.has(stored.key)) {
      const distance = finiteNonNegative(stored.params.deviationMeters)
      if (distance !== null) return { key: "routeDeviation", distanceMeters: distance }
    }
    if (OUT_OF_ZONE_KEYS.has(stored.key)) {
      const distance = finiteNonNegative(stored.params.distanceMeters)
      if (distance !== null) return { key: "outOfZoneCheckIn", distanceMeters: distance }
    }
    if (OPEN_VISIT_KEYS.has(stored.key)) {
      const minutes = finiteNonNegative(stored.params.minutes)
      if (minutes !== null) return { key: "visitStillOpen", minutes }
    }
  }
  // Rows written before A4 still carry the raw numbers next to the English
  // sentence. The deviation generator has always stored `deviationMeters`.
  const raw = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
  const deviation = finiteNonNegative(raw.deviationMeters)
  if (alertType === "OUT_OF_ZONE" && deviation !== null) return { key: "routeDeviation", distanceMeters: deviation }
  const distance = finiteNonNegative(raw.distanceMeters)
  if (alertType === "OUT_OF_ZONE" && distance !== null) return { key: "outOfZoneCheckIn", distanceMeters: distance }
  return { key: "type", alertType }
}

function iso(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function localHourKey(at: string, timezone: string): string {
  return `${dateInputValueInTimezone(at, timezone)}T${formatTime(at, "az", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).slice(0, 2)}`
}

/**
 * Collapses repeats: one group per agent + alert kind + tenant-local hour.
 * The group keeps the farthest distance, the first and last moment, and the
 * number of rows it stands for. Newest group first.
 */
export function groupMtmLiveFeedAlerts(rows: MtmLiveFeedAlertRow[], timezone: string): MtmLiveFeedAlertGroup[] {
  const groups = new Map<string, MtmLiveFeedAlertGroup>()
  for (const row of rows) {
    const at = iso(row.createdAt)
    if (!at) continue
    const message = buildMtmLiveFeedAlertMessage(row.type, row.metadata)
    const kind = message.key === "type" ? `type:${row.type}` : message.key
    const key = `${row.agentId}|${kind}|${localHourKey(at, timezone)}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        id: `alert-${row.id}`,
        type: "ALERT",
        agentId: row.agentId,
        agent: row.agentName || "—",
        customer: row.title,
        time: at,
        alert: { alertType: row.type, message, count: 1, firstAt: at, lastAt: at },
      })
      continue
    }
    existing.alert.count += 1
    if (at < existing.alert.firstAt) existing.alert.firstAt = at
    if (at > existing.alert.lastAt) {
      existing.alert.lastAt = at
      existing.time = at
      existing.id = `alert-${row.id}`
      existing.customer = row.title
    }
    const current = existing.alert.message
    if ((current.key === "routeDeviation" || current.key === "outOfZoneCheckIn") &&
        (message.key === "routeDeviation" || message.key === "outOfZoneCheckIn") &&
        message.key === current.key && message.distanceMeters > current.distanceMeters) {
      existing.alert.message = message
    } else if (current.key === "visitStillOpen" && message.key === "visitStillOpen" && message.minutes > current.minutes) {
      existing.alert.message = message
    }
  }
  return [...groups.values()].sort((a, b) => b.time.localeCompare(a.time))
}

/**
 * The GPS history of that agent around that moment: the group's span plus a
 * margin on both sides, clamped to the day so the window never wraps.
 */
export function mtmLiveFeedHistoryHref(input: {
  agentId: string
  firstAt: string
  lastAt: string
  timezone: string
  paddingMinutes?: number
}): string {
  const padding = (input.paddingMinutes ?? 15) * 60_000
  const date = dateInputValueInTimezone(input.firstAt, input.timezone)
  const fromAt = new Date(Date.parse(input.firstAt) - padding)
  const toAt = new Date(Date.parse(input.lastAt) + padding)
  const hhmm = (value: Date) => formatTime(value, "az", { hour: "2-digit", minute: "2-digit", timeZone: input.timezone })
  const from = dateInputValueInTimezone(fromAt, input.timezone) < date ? "00:00" : hhmm(fromAt)
  const to = dateInputValueInTimezone(toAt, input.timezone) > date ? "23:59" : hhmm(toAt)
  const params = new URLSearchParams({ mode: "history", agentId: input.agentId, date, from, to })
  return `/mtm/map?${params.toString()}`
}
