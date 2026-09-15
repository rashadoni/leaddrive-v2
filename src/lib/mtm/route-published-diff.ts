import type { Prisma } from "@prisma/client"

/**
 * Changing a route that is already published (PLANNED or IN_PROGRESS).
 *
 * A draft may drop all its points and create new ones: nothing references
 * them yet. A published point is referenced by visits, route change requests,
 * KPI plan facts and live-feed alerts, so replacing it would orphan that
 * history. This module keeps every point whose target stays in the route,
 * soft-deletes only removed points (the tombstone is the sync marker) and
 * creates rows only for new targets.
 *
 * One function is shared by the mobile UPDATE_PUBLISHED command and the web
 * PUT /api/v1/mtm/routes/[id] so the two paths cannot disagree on what is
 * locked.
 */

/** Approval statuses that still wait for a decision. */
export const MTM_PENDING_ROUTE_CHANGE_REQUEST_STATUSES = ["SUBMITTED", "IN_REVIEW", "NEEDS_INFO"] as const

export interface PublishedRouteExistingPoint {
  id: string
  customerId: string
  contactId: string | null
  orderIndex: number
  plannedTime: Date | null
  status: string
  /** Non-deleted visits linked to this point. */
  visitCount: number
  /** Route change requests on this point that still wait for a decision. */
  pendingChangeRequestCount: number
}

export interface PublishedRouteRequestedPoint {
  customerId: string
  contactId?: string | null
  plannedTime?: string | Date | null
}

export interface PublishedRouteKeptPoint {
  id: string
  orderIndex: number
  plannedTime: Date | null
  /** False when neither order nor planned time changes: no write needed. */
  changed: boolean
  locked: boolean
}

export interface PublishedRouteAddedPoint {
  customerId: string
  contactId: string | null
  orderIndex: number
  plannedTime: Date | null
}

export type PublishedRoutePointDiff =
  | {
      ok: true
      kept: PublishedRouteKeptPoint[]
      removed: PublishedRouteExistingPoint[]
      added: PublishedRouteAddedPoint[]
    }
  | {
      ok: false
      code: "ROUTE_VISITED_POINTS_LOCKED" | "ROUTE_POINT_CHANGE_PENDING"
      pointIds: string[]
    }

/** Identity of a stop: the same doctor at a different clinic is a new stop. */
export function publishedRoutePointIdentity(point: { customerId: string; contactId?: string | null }): string {
  return JSON.stringify([point.customerId, point.contactId ?? null])
}

/**
 * A point carries field history once it has a visit or has left PENDING.
 * Such a point may not be removed, reordered relative to other locked points,
 * or retimed.
 */
export function isPublishedRoutePointLocked(point: Pick<PublishedRouteExistingPoint, "status" | "visitCount">): boolean {
  return point.status !== "PENDING" || point.visitCount > 0
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value : new Date(value)
}

/** The web builder edits times as HH:mm; seconds are not a plan change. */
function sameMinute(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right
  return Math.floor(left.getTime() / 60_000) === Math.floor(right.getTime() / 60_000)
}

export function diffPublishedRoutePoints(
  existingPoints: readonly PublishedRouteExistingPoint[],
  requestedPoints: readonly PublishedRouteRequestedPoint[],
): PublishedRoutePointDiff {
  const existing = [...existingPoints].sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
  const existingByIdentity = new Map<string, PublishedRouteExistingPoint>()
  const duplicateRows: PublishedRouteExistingPoint[] = []
  for (const point of existing) {
    const identity = publishedRoutePointIdentity(point)
    if (existingByIdentity.has(identity)) duplicateRows.push(point)
    else existingByIdentity.set(identity, point)
  }
  const requestedIdentities = requestedPoints.map(publishedRoutePointIdentity)
  const requestedSet = new Set(requestedIdentities)

  const removed = [
    ...[...existingByIdentity.entries()]
      .filter(([identity]) => !requestedSet.has(identity))
      .map(([, point]) => point),
    ...duplicateRows,
  ]

  // Locked points: none removed, same relative order, same planned time.
  const lockedViolations = new Set<string>()
  for (const point of removed) {
    if (isPublishedRoutePointLocked(point)) lockedViolations.add(point.id)
  }
  const lockedExistingOrder = [...existingByIdentity.values()]
    .filter((point) => isPublishedRoutePointLocked(point) && requestedSet.has(publishedRoutePointIdentity(point)))
    .map((point) => point.id)
  const lockedRequestedOrder = requestedIdentities
    .map((identity) => existingByIdentity.get(identity))
    .filter((point): point is PublishedRouteExistingPoint => Boolean(point && isPublishedRoutePointLocked(point)))
    .map((point) => point.id)
  lockedExistingOrder.forEach((id, index) => {
    if (lockedRequestedOrder[index] !== id) lockedViolations.add(id)
  })
  requestedPoints.forEach((requested, index) => {
    const point = existingByIdentity.get(requestedIdentities[index]!)
    if (point && isPublishedRoutePointLocked(point) && !sameMinute(point.plannedTime, toDate(requested.plannedTime))) {
      lockedViolations.add(point.id)
    }
  })
  if (lockedViolations.size > 0) {
    return {
      ok: false,
      code: "ROUTE_VISITED_POINTS_LOCKED",
      pointIds: existing.filter((point) => lockedViolations.has(point.id)).map((point) => point.id),
    }
  }

  const pendingRemovals = removed.filter((point) => point.pendingChangeRequestCount > 0).map((point) => point.id)
  if (pendingRemovals.length > 0) {
    return { ok: false, code: "ROUTE_POINT_CHANGE_PENDING", pointIds: pendingRemovals }
  }

  const kept: PublishedRouteKeptPoint[] = []
  const added: PublishedRouteAddedPoint[] = []
  requestedPoints.forEach((requested, orderIndex) => {
    const point = existingByIdentity.get(requestedIdentities[orderIndex]!)
    const locked = point ? isPublishedRoutePointLocked(point) : false
    if (!point) {
      added.push({
        customerId: requested.customerId,
        contactId: requested.contactId ?? null,
        orderIndex,
        plannedTime: toDate(requested.plannedTime),
      })
      return
    }
    // A locked time is compared at minute precision above; keep the stored
    // value so a rounding client cannot rewrite history by a few seconds.
    const plannedTime = locked ? point.plannedTime : toDate(requested.plannedTime)
    kept.push({
      id: point.id,
      orderIndex,
      plannedTime,
      changed: point.orderIndex !== orderIndex || point.plannedTime?.getTime() !== plannedTime?.getTime(),
      locked,
    })
  })

  return { ok: true, kept, removed, added }
}

/** The point select both write paths use to build the diff input. */
export const publishedRoutePointDiffSelect = {
  id: true,
  customerId: true,
  contactId: true,
  orderIndex: true,
  plannedTime: true,
  status: true,
  _count: {
    select: {
      visits: { where: { deletedAt: null } },
      changeRequests: {
        where: { status: { in: [...MTM_PENDING_ROUTE_CHANGE_REQUEST_STATUSES] } },
      },
    },
  },
} satisfies Prisma.MtmRoutePointSelect

export function toPublishedRouteExistingPoint(point: {
  id: string
  customerId: string
  contactId: string | null
  orderIndex: number
  plannedTime: Date | null
  status: string
  _count?: { visits?: number; changeRequests?: number }
}): PublishedRouteExistingPoint {
  return {
    id: point.id,
    customerId: point.customerId,
    contactId: point.contactId,
    orderIndex: point.orderIndex,
    plannedTime: point.plannedTime,
    status: point.status,
    visitCount: point._count?.visits ?? 0,
    pendingChangeRequestCount: point._count?.changeRequests ?? 0,
  }
}

/** The ordered point list the route has after the diff (for dedupe/conflicts). */
export function publishedRouteResultPoints(
  requestedPoints: readonly PublishedRouteRequestedPoint[],
  diff: Extract<PublishedRoutePointDiff, { ok: true }>,
): Array<{ customerId: string; contactId: string | null; plannedTime: Date | null; deletedAt: null }> {
  const keptByIndex = new Map(diff.kept.map((point) => [point.orderIndex, point]))
  return requestedPoints.map((point, index) => ({
    customerId: point.customerId,
    contactId: point.contactId ?? null,
    plannedTime: keptByIndex.has(index) ? keptByIndex.get(index)!.plannedTime : toDate(point.plannedTime),
    deletedAt: null,
  }))
}

/**
 * Raised when a point changed between the read and the write (a check-in or a
 * change request landed in between). Callers roll the transaction back.
 */
export class PublishedRoutePointsChangedError extends Error {
  constructor() {
    super("Route points changed concurrently")
    this.name = "PublishedRoutePointsChangedError"
  }
}

type PointWriteClient = Pick<Prisma.TransactionClient, "mtmRoutePoint">

/**
 * Apply an accepted diff. Removal is fenced in SQL on the same facts the diff
 * trusted (PENDING, no visit, no pending change request), so a concurrent
 * check-in cannot be erased: the count mismatch throws and the caller's
 * transaction rolls back.
 */
export async function applyPublishedRoutePointDiff(
  tx: PointWriteClient,
  input: {
    organizationId: string
    routeId: string
    diff: Extract<PublishedRoutePointDiff, { ok: true }>
    now: Date
  },
): Promise<void> {
  if (input.diff.removed.length > 0) {
    const removed = await tx.mtmRoutePoint.updateMany({
      where: {
        id: { in: input.diff.removed.map((point) => point.id) },
        routeId: input.routeId,
        organizationId: input.organizationId,
        deletedAt: null,
        status: "PENDING",
        visits: { none: { deletedAt: null } },
        changeRequests: { none: { status: { in: [...MTM_PENDING_ROUTE_CHANGE_REQUEST_STATUSES] } } },
      },
      data: { deletedAt: input.now, version: { increment: 1 } },
    })
    if (removed.count !== input.diff.removed.length) throw new PublishedRoutePointsChangedError()
  }

  for (const point of input.diff.kept) {
    if (!point.changed) continue
    const updated = await tx.mtmRoutePoint.updateMany({
      where: {
        id: point.id,
        routeId: input.routeId,
        organizationId: input.organizationId,
        deletedAt: null,
      },
      data: {
        orderIndex: point.orderIndex,
        plannedTime: point.plannedTime,
        version: { increment: 1 },
      },
    })
    if (updated.count !== 1) throw new PublishedRoutePointsChangedError()
  }

  if (input.diff.added.length > 0) {
    await tx.mtmRoutePoint.createMany({
      data: input.diff.added.map((point) => ({
        organizationId: input.organizationId,
        routeId: input.routeId,
        customerId: point.customerId,
        contactId: point.contactId,
        orderIndex: point.orderIndex,
        plannedTime: point.plannedTime,
      })),
    })
  }
}

/** Stops as audit evidence: enough to see what changed, no customer names. */
export function publishedRouteAuditStops(
  points: ReadonlyArray<{ id?: string; customerId: string; contactId?: string | null; plannedTime?: string | Date | null }>,
): Array<{ id: string | null; customerId: string; contactId: string | null; plannedTime: string | null }> {
  return points.map((point) => ({
    id: point.id ?? null,
    customerId: point.customerId,
    contactId: point.contactId ?? null,
    plannedTime: toDate(point.plannedTime)?.toISOString() ?? null,
  }))
}
