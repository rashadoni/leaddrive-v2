import {
  buildMtmLiveFeedAlertMessage,
  mtmLiveFeedHistoryHref,
  type MtmLiveFeedAlertMessage,
} from "@/lib/mtm/live-feed-alerts"
import { dateInputValueInTimezone } from "@/lib/timezone"

/**
 * The office manager's alert list, grouped.
 *
 * Prod 2026-09-14: /mtm/alerts showed 31 identical English cards «Route
 * deviation detected» for one agent — one per throttle window, roughly every
 * ten minutes — with no distance and no link, and alerts from April still
 * open among them. The live map already collapses repeats per hour
 * (live-feed-alerts.ts); the list works on a day, so it collapses per agent +
 * kind of situation + tenant-local day, and keeps every row inside the group
 * so the manager can still open one.
 *
 * Message reading is the map's (`buildMtmLiveFeedAlertMessage`), so the same
 * alert says the same thing in both places.
 */

/** Open alerts older than this are "old": listed apart, closable in bulk. */
export const MTM_ALERT_STALE_DAYS = 7

export interface MtmAlertDayRow {
  id: string
  agentId: string
  agentName: string | null
  type: string
  category: string
  title: string
  description: string | null
  isResolved: boolean
  createdAt: Date | string
  metadata: unknown
}

export interface MtmAlertDayItem {
  id: string
  at: string
  isResolved: boolean
  message: MtmLiveFeedAlertMessage
  /** Stored English sentence — only for rows whose message is not readable. */
  title: string
  description: string | null
  visitId: string | null
  routeId: string | null
  /** Stored `messageKey` + params, read by the page for the full sentence. */
  metadata: unknown
}

export interface MtmAlertDayGroup {
  key: string
  agentId: string
  agentName: string
  alertType: string
  category: string
  dateKey: string
  /** Farthest distance / longest open visit of the group. */
  message: MtmLiveFeedAlertMessage
  count: number
  openCount: number
  firstAt: string
  lastAt: string
  historyHref: string
  /** Latest visit the group is about, when any row names one. */
  visitId: string | null
  openIds: string[]
  items: MtmAlertDayItem[]
}

const CATEGORY_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }

function stringField(metadata: unknown, field: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[field]
  return typeof value === "string" && value.trim() ? value : null
}

function iso(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function strongerMessage(current: MtmLiveFeedAlertMessage, next: MtmLiveFeedAlertMessage): MtmLiveFeedAlertMessage {
  if ((current.key === "routeDeviation" || current.key === "outOfZoneCheckIn") && next.key === current.key) {
    return next.distanceMeters > current.distanceMeters ? next : current
  }
  if (current.key === "visitStillOpen" && next.key === "visitStillOpen") {
    return next.minutes > current.minutes ? next : current
  }
  return current
}

/**
 * One group per agent + situation + tenant-local day. Groups are ordered by
 * severity, then by the latest moment; items inside a group newest first.
 */
export function groupMtmAlertsByAgentDay(rows: MtmAlertDayRow[], timezone: string): MtmAlertDayGroup[] {
  const groups = new Map<string, MtmAlertDayGroup>()
  for (const row of rows) {
    const at = iso(row.createdAt)
    if (!at) continue
    const message = buildMtmLiveFeedAlertMessage(row.type, row.metadata)
    const kind = message.key === "type" ? `type:${row.type}` : message.key
    const dateKey = dateInputValueInTimezone(at, timezone)
    const key = `${row.agentId}|${kind}|${dateKey}`
    const item: MtmAlertDayItem = {
      id: row.id,
      at,
      isResolved: row.isResolved,
      message,
      title: row.title,
      description: row.description,
      visitId: stringField(row.metadata, "visitId"),
      routeId: stringField(row.metadata, "routeId"),
      metadata: row.metadata,
    }
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        agentId: row.agentId,
        agentName: row.agentName || "—",
        alertType: row.type,
        category: row.category,
        dateKey,
        message,
        count: 0,
        openCount: 0,
        firstAt: at,
        lastAt: at,
        historyHref: "",
        visitId: null,
        openIds: [],
        items: [],
      }
      groups.set(key, group)
    }
    group.count += 1
    group.items.push(item)
    if (!row.isResolved) {
      group.openCount += 1
      group.openIds.push(row.id)
    }
    if (at < group.firstAt) group.firstAt = at
    if (at >= group.lastAt) {
      group.lastAt = at
      if (item.visitId) group.visitId = item.visitId
    } else if (!group.visitId && item.visitId) {
      group.visitId = item.visitId
    }
    if ((CATEGORY_ORDER[row.category] ?? 3) < (CATEGORY_ORDER[group.category] ?? 3)) group.category = row.category
    group.message = strongerMessage(group.message, message)
  }
  const out = [...groups.values()]
  for (const group of out) {
    group.items.sort((a, b) => b.at.localeCompare(a.at))
    group.historyHref = mtmLiveFeedHistoryHref({
      agentId: group.agentId,
      firstAt: group.firstAt,
      lastAt: group.lastAt,
      timezone,
    })
  }
  return out.sort((a, b) =>
    (CATEGORY_ORDER[a.category] ?? 3) - (CATEGORY_ORDER[b.category] ?? 3) || b.lastAt.localeCompare(a.lastAt),
  )
}
