import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"

export type MtmRouteAssignmentInput = {
  agentId: string
  role: "PRIMARY" | "PARTICIPANT" | "OBSERVER"
}

export type MtmRoutePointInput = {
  customerId: string
  contactId?: string | null
  plannedTime?: string | Date | null
}

export interface MtmRouteFingerprintInput {
  date: string | Date
  primaryAgentId: string
  assignments: readonly MtmRouteAssignmentInput[]
  points: readonly MtmRoutePointInput[]
}

export interface ExistingRouteForConflict {
  id: string
  status: string
  agentId: string
  assignments?: Array<{ agentId: string; removedAt?: Date | string | null }>
  points?: Array<{
    customerId: string
    contactId?: string | null
    plannedTime?: Date | string | null
    deletedAt?: Date | string | null
  }>
}

export type MtmRouteConflict =
  | { code: "AGENT_SCHEDULE_CONFLICT"; routeId: string; agentIds: string[] }
  | { code: "CUSTOMER_OVERLAP"; routeId: string; customerIds: string[] }
  | { code: "CONTACT_OVERLAP"; routeId: string; contactIds: string[] }

export type MtmRouteInternalScheduleConflict = {
  code: "ROUTE_POINT_TIME_CONFLICT"
  plannedTime: string
  pointIndexes: number[]
  customerIds: string[]
}

/**
 * A coordination notice is deliberately not a publishing blocker. It tells a
 * planner that a colleague already has a visit to the same organization (or
 * the same contact) in the exact requested time slot, so they can make the
 * visit together intentionally instead of discovering it afterwards.
 */
export type MtmRouteCoordinationNotice = {
  code: "COORDINATED_MEETING"
  routeId: string
  agentIds: string[]
  customerIds: string[]
  contactIds: string[]
  plannedTimes: string[]
}

export type MtmRoutePlanningSignals = {
  conflicts: MtmRouteConflict[]
  coordination: MtmRouteCoordinationNotice[]
}

/**
 * Serialize schedule publication for every agent who participates in a route.
 *
 * UI preflight is intentionally advisory: another browser or an older mobile
 * client may publish between the warning and the write. A transaction-scoped
 * PostgreSQL advisory lock closes that race without keeping a permanent lock
 * table. Sorting is important when two routes share more than one agent: every
 * transaction acquires the same keys in the same order and cannot deadlock by
 * taking A/B and B/A in opposite order.
 */
export async function acquireMtmRouteScheduleLocks(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: {
    organizationId: string
    date: string | Date
    agentIds: readonly string[]
  },
): Promise<void> {
  const date = canonicalDate(input.date)
  const agentIds = [...new Set(input.agentIds)].sort()

  for (const agentId of agentIds) {
    const lockKey = `mtm-route-schedule:${input.organizationId}:${date}:${agentId}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  }
}

function canonicalDate(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid route date")
  return parsed.toISOString().slice(0, 10)
}

function canonicalPlannedTime(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

type TimedRoutePoint = {
  customerId: string
  contactId: string | null
  plannedTime: string | null
}

function activeRoutePoints(
  points: readonly {
    customerId: string
    contactId?: string | null
    plannedTime?: string | Date | null
    deletedAt?: Date | string | null
  }[],
): TimedRoutePoint[] {
  return points
    .filter((point) => !point.deletedAt)
    .map((point) => ({
      customerId: point.customerId,
      contactId: point.contactId ?? null,
      plannedTime: canonicalPlannedTime(point.plannedTime),
    }))
}

function candidateRoutePoints(points: readonly MtmRoutePointInput[]): TimedRoutePoint[] {
  return points.map((point) => ({
    customerId: point.customerId,
    contactId: point.contactId ?? null,
    plannedTime: canonicalPlannedTime(point.plannedTime),
  }))
}

function activeRouteAgentIds(route: ExistingRouteForConflict): string[] {
  const agentIds = new Set([route.agentId])
  for (const assignment of route.assignments ?? []) {
    if (!assignment.removedAt) agentIds.add(assignment.agentId)
  }
  return [...agentIds].sort()
}

export function normalizeMtmRouteAssignments(
  legacyAgentId: string | undefined,
  assignments: readonly MtmRouteAssignmentInput[] | undefined,
): { primaryAgentId: string; assignments: MtmRouteAssignmentInput[] } {
  const normalized = assignments?.map((assignment) => ({ ...assignment })) ?? []
  const explicitPrimary = normalized.find((assignment) => assignment.role === "PRIMARY")
  const primaryAgentId = legacyAgentId ?? explicitPrimary?.agentId
  if (!primaryAgentId) throw new Error("A primary agent is required")

  if (normalized.length === 0) {
    return { primaryAgentId, assignments: [{ agentId: primaryAgentId, role: "PRIMARY" }] }
  }

  if (!explicitPrimary) normalized.unshift({ agentId: primaryAgentId, role: "PRIMARY" })
  return { primaryAgentId, assignments: normalized }
}

export function buildMtmRouteDedupeKey(input: MtmRouteFingerprintInput): string {
  const identity = {
    date: canonicalDate(input.date),
    primaryAgentId: input.primaryAgentId,
    assignments: [...input.assignments]
      .map(({ agentId, role }) => ({ agentId, role }))
      .sort((a, b) => a.agentId.localeCompare(b.agentId) || a.role.localeCompare(b.role)),
    points: input.points.map((point) => ({
      customerId: point.customerId,
      contactId: point.contactId ?? null,
      plannedTime: point.plannedTime ? new Date(point.plannedTime).toISOString() : null,
    })),
  }
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex")
}

export function detectMtmRouteConflicts(
  candidate: Pick<MtmRouteFingerprintInput, "primaryAgentId" | "assignments" | "points">,
  existingRoutes: readonly ExistingRouteForConflict[],
): MtmRouteConflict[] {
  const candidateAgents = new Set(candidate.assignments.map((assignment) => assignment.agentId))
  candidateAgents.add(candidate.primaryAgentId)
  const candidatePoints = candidateRoutePoints(candidate.points)
  const conflicts: MtmRouteConflict[] = []

  for (const route of existingRoutes) {
    if (route.status !== "PLANNED" && route.status !== "IN_PROGRESS") continue

    const routeAgents = new Set(activeRouteAgentIds(route))
    const overlappingAgentIds = [...candidateAgents].filter((agentId) => routeAgents.has(agentId)).sort()
    if (!overlappingAgentIds.length) continue

    const routePoints = activeRoutePoints(route.points ?? [])
    const hasTimedCollision = candidatePoints.some((candidatePoint) => (
      candidatePoint.plannedTime !== null
      && routePoints.some((routePoint) => routePoint.plannedTime === candidatePoint.plannedTime)
    ))
    const hasUnknownSchedule = candidatePoints.some((point) => point.plannedTime === null)
      || routePoints.some((point) => point.plannedTime === null)

    // Legacy routes frequently have no point times. Preserve the conservative
    // same-day guard for those records. Once both routes have real slots, a
    // planner is only blocked for an actual time collision.
    if (hasTimedCollision || hasUnknownSchedule) {
      conflicts.push({ code: "AGENT_SCHEDULE_CONFLICT", routeId: route.id, agentIds: overlappingAgentIds })
    }
  }

  return conflicts
}

/**
 * A route is a shared schedule for every assigned agent. Two active stops in
 * the same route therefore cannot occupy the exact same slot, even when no
 * already-published route exists to compare against.
 */
export function detectMtmRouteInternalScheduleConflicts(
  points: readonly MtmRoutePointInput[],
): MtmRouteInternalScheduleConflict[] {
  const byPlannedTime = new Map<string, Array<{ pointIndex: number; customerId: string }>>()

  points.forEach((point, pointIndex) => {
    const plannedTime = canonicalPlannedTime(point.plannedTime)
    if (!plannedTime) return
    const entries = byPlannedTime.get(plannedTime) ?? []
    entries.push({ pointIndex, customerId: point.customerId })
    byPlannedTime.set(plannedTime, entries)
  })

  return [...byPlannedTime.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([plannedTime, entries]) => ({
      code: "ROUTE_POINT_TIME_CONFLICT" as const,
      plannedTime,
      pointIndexes: entries.map(({ pointIndex }) => pointIndex),
      customerIds: [...new Set(entries.map(({ customerId }) => customerId))].sort(),
    }))
}

export function detectMtmRouteCoordination(
  candidate: Pick<MtmRouteFingerprintInput, "primaryAgentId" | "assignments" | "points">,
  existingRoutes: readonly ExistingRouteForConflict[],
): MtmRouteCoordinationNotice[] {
  const candidateAgents = new Set(candidate.assignments.map((assignment) => assignment.agentId))
  candidateAgents.add(candidate.primaryAgentId)
  const candidatePoints = candidateRoutePoints(candidate.points)
  const notices: MtmRouteCoordinationNotice[] = []

  for (const route of existingRoutes) {
    if (route.status !== "PLANNED" && route.status !== "IN_PROGRESS") continue

    const otherAgentIds = activeRouteAgentIds(route).filter((agentId) => !candidateAgents.has(agentId))
    if (!otherAgentIds.length) continue

    const routePoints = activeRoutePoints(route.points ?? [])
    const customerIds = new Set<string>()
    const contactIds = new Set<string>()
    const plannedTimes = new Set<string>()

    for (const candidatePoint of candidatePoints) {
      if (!candidatePoint.plannedTime) continue
      for (const routePoint of routePoints) {
        if (routePoint.plannedTime !== candidatePoint.plannedTime) continue
        if (routePoint.customerId !== candidatePoint.customerId) continue
        customerIds.add(candidatePoint.customerId)
        plannedTimes.add(candidatePoint.plannedTime)
        if (candidatePoint.contactId && candidatePoint.contactId === routePoint.contactId) {
          contactIds.add(candidatePoint.contactId)
        }
      }
    }

    if (customerIds.size > 0) {
      notices.push({
        code: "COORDINATED_MEETING",
        routeId: route.id,
        agentIds: otherAgentIds,
        customerIds: [...customerIds].sort(),
        contactIds: [...contactIds].sort(),
        plannedTimes: [...plannedTimes].sort(),
      })
    }
  }

  return notices
}

export function detectMtmRoutePlanningSignals(
  candidate: Pick<MtmRouteFingerprintInput, "primaryAgentId" | "assignments" | "points">,
  existingRoutes: readonly ExistingRouteForConflict[],
): MtmRoutePlanningSignals {
  return {
    conflicts: detectMtmRouteConflicts(candidate, existingRoutes),
    coordination: detectMtmRouteCoordination(candidate, existingRoutes),
  }
}
