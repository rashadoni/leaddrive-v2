/**
 * The quick views of the «Клиенты» and «Учреждения» lists: «Все», «Не были в
 * {месяц}», «Не запланированы», «Без ответственного».
 *
 * Owner, 2026-10-16, from the UX audit of the route module: on 1470 px the
 * first doctor began below the screen (eight filter fields, a request card),
 * the institutions table was 2437 px wide in a 1148 px frame, and every row
 * said «Правило не подписано». He chose, from a picture, one search and these
 * chips with how many each holds, the named fields behind «Ещё фильтры».
 *
 * «Не были» counts the calendar month the route planner colours orange
 * (UTC month of today's date key, as /api/v1/mtm/routes/candidates counts it),
 * so the list and the map name the same clients. «Не запланированы» is the
 * list's own «Следующий визит» column being empty: no pending point on a
 * planned or running route from today on.
 */
import type { Prisma } from "@prisma/client"

export const MTM_CLIENT_QUICK_FILTERS = ["NOT_VISITED", "NOT_PLANNED", "UNASSIGNED"] as const
export type MtmClientQuickFilter = (typeof MTM_CLIENT_QUICK_FILTERS)[number]

export function mtmClientQuickFilter(value: string | null | undefined): MtmClientQuickFilter | null {
  return (MTM_CLIENT_QUICK_FILTERS as readonly string[]).includes(value ?? "") ? value as MtmClientQuickFilter : null
}

/** The month «не были в {месяц}» is about: the one today's date key falls in. */
export function mtmClientVisitMonth(asOf: Date): { key: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1))
  const end = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1))
  return { key: start.toISOString().slice(0, 7), start, end }
}

/** A visit that counts as «был»: closed, in the month. */
export function mtmClientVisitInMonth(organizationId: string, month: { start: Date; end: Date }): Prisma.MtmVisitWhereInput {
  return {
    organizationId,
    deletedAt: null,
    status: "CHECKED_OUT",
    checkInAt: { gte: month.start, lt: month.end },
  }
}

/** A next visit as the list shows it: a pending point on a planned or running route from today on. */
export function mtmClientPendingRoutePoint(
  organizationId: string,
  asOf: Date,
  routeScope: Prisma.MtmRouteWhereInput = {},
): Prisma.MtmRoutePointWhereInput {
  return {
    deletedAt: null,
    status: "PENDING",
    route: {
      organizationId,
      deletedAt: null,
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      date: { gte: asOf },
      ...routeScope,
    },
  }
}

export type MtmClientQuickCounts = {
  all: number
  NOT_VISITED: number
  NOT_PLANNED: number
  /** Null where the reader may not look for clients nobody has. */
  UNASSIGNED: number | null
  /** How many in each class (A, B, VIP…), under the chosen quick view. */
  categories: Array<{ category: string; count: number }>
}

/** Classes in the order the tenant grades them, the counts the server found. */
export function mtmClientCategoryCounts(rows: Array<{ category: string; _count: { _all: number } }>): MtmClientQuickCounts["categories"] {
  const order = ["VIP", "A", "B", "C", "D"]
  return rows
    .map((row) => ({ category: row.category, count: row._count._all }))
    .filter((row) => row.count > 0)
    .sort((left, right) => {
      const a = order.indexOf(left.category)
      const b = order.indexOf(right.category)
      return (a === -1 ? order.length : a) - (b === -1 ? order.length : b) || left.category.localeCompare(right.category)
    })
}
