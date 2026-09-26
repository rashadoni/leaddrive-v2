import { readMtmAlertMessage, type MtmAlertMessageKey, type MtmAlertMessageParams } from "@/lib/mtm/alert-messages"

/**
 * Today's alerts for the Panel, grouped so eighteen rows read as three lines.
 *
 * Prod 2026-09-14: Anar Mammadov had 18 unresolved OUT_OF_ZONE alerts that day
 * and the Panel's «Diqqət tələb edir» showed none of them — only a zero for
 * pending cancellations and some old tasks. The alerts page lists them one by
 * one; the Panel needs "out of zone · 15:00–16:00 · 6 times · up to 820 m".
 *
 * Grouping key is (type, tenant-local hour). The newest alert of a group
 * supplies the sentence; the distance shown is the largest one in the group,
 * because the question the manager asks is "how far off did it get".
 */

export type MtmWeekAlertRow = {
  id: string
  type: string
  category: string
  createdAt: Date | string
  title?: string | null
  description?: string | null
  metadata?: unknown
}

export type MtmWeekAlert = {
  id: string
  type: string
  category: string
  createdAt: string
  /** Tenant-local YYYY-MM-DD of `createdAt`. */
  date: string
  messageKey: MtmAlertMessageKey | null
  messageParams: MtmAlertMessageParams | null
  /** Stored English sentence for rows written before localization. */
  fallbackText: string | null
  distanceMeters: number | null
}

export type MtmWeekAlertGroup = {
  key: string
  type: string
  category: string
  date: string
  /** Tenant-local hour 0..23. */
  hour: number
  count: number
  firstAt: string
  lastAt: string
  maxDistanceMeters: number | null
  latest: MtmWeekAlert
}

const DISTANCE_PARAM_NAMES = ["distanceMeters", "deviationMeters"]
const DISTANCE_METADATA_NAMES = ["distanceMeters", "distance", "deviationMeters", "deviation"]
const CATEGORY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function localParts(value: Date, timezone: string): { date: string; hour: number } {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
  }
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 }
}

/** Project one stored row into the payload shape. Never throws on bad metadata. */
export function projectMtmWeekAlert(row: MtmWeekAlertRow, timezone: string): MtmWeekAlert | null {
  const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
  if (!Number.isFinite(created.getTime())) return null
  const message = readMtmAlertMessage(row.metadata)
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {}
  let distance: number | null = null
  if (message.kind === "localized") {
    for (const name of DISTANCE_PARAM_NAMES) {
      distance ??= finiteNumber(message.params[name])
    }
  }
  for (const name of DISTANCE_METADATA_NAMES) distance ??= finiteNumber(metadata[name])
  const fallback = [row.title, row.description].map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    createdAt: created.toISOString(),
    date: localParts(created, timezone).date,
    messageKey: message.kind === "localized" ? message.key : null,
    messageParams: message.kind === "localized" ? message.params : null,
    fallbackText: fallback.length ? fallback[fallback.length - 1] : null,
    distanceMeters: distance === null ? null : Math.round(distance),
  }
}

/**
 * Group projected alerts by (date, type, local hour). Groups come back newest
 * hour first, and within an hour the more severe category first.
 */
export function groupMtmWeekAlerts(alerts: readonly MtmWeekAlert[], timezone: string): MtmWeekAlertGroup[] {
  const groups = new Map<string, MtmWeekAlertGroup>()
  for (const alert of alerts) {
    const { date, hour } = localParts(new Date(alert.createdAt), timezone)
    const key = `${date}:${String(hour).padStart(2, "0")}:${alert.type}`
    const current = groups.get(key)
    if (!current) {
      groups.set(key, {
        key,
        type: alert.type,
        category: alert.category,
        date,
        hour,
        count: 1,
        firstAt: alert.createdAt,
        lastAt: alert.createdAt,
        maxDistanceMeters: alert.distanceMeters,
        latest: alert,
      })
      continue
    }
    current.count += 1
    if (alert.createdAt < current.firstAt) current.firstAt = alert.createdAt
    if (alert.createdAt > current.lastAt) {
      current.lastAt = alert.createdAt
      current.latest = alert
    }
    if ((CATEGORY_RANK[alert.category] ?? 9) < (CATEGORY_RANK[current.category] ?? 9)) current.category = alert.category
    if (alert.distanceMeters !== null) {
      current.maxDistanceMeters = current.maxDistanceMeters === null
        ? alert.distanceMeters
        : Math.max(current.maxDistanceMeters, alert.distanceMeters)
    }
  }
  return [...groups.values()].sort((left, right) =>
    right.date.localeCompare(left.date)
    || right.hour - left.hour
    || (CATEGORY_RANK[left.category] ?? 9) - (CATEGORY_RANK[right.category] ?? 9)
    || left.type.localeCompare(right.type),
  )
}
