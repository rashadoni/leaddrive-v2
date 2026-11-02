/**
 * An agent's day as the manager's «Komanda» card tells it (owner, 2026-11-01,
 * mockup «как посылка в трекинге»: «Начал 09:10 · first client», «дальше …»,
 * «на визите 48 мин»). Read from today's published route points and his open
 * visit; the counts beside it stay `routeToday`.
 *
 * Who a stop is: the doctor when the route was planned by doctors, otherwise
 * the organization — the same rule as the agent's own «Bu gün».
 */

export type TeamRouteDayPoint = {
  id: string
  orderIndex: number
  status: string
  plannedTime: Date | null
  visitedAt: Date | null
  customer: { name: string } | null
  contact: { displayName: string } | null
}

export type TeamRouteDayVisit = {
  checkInAt: Date
  routePointId: string | null
  customer: { name: string } | null
  contact: { displayName: string } | null
}

export type TeamRouteDay = {
  /** The first client he visited today, and when. */
  first: { name: string; at: string } | null
  /** The next stop of the plan still ahead, with its planned time if set. */
  next: { name: string; plannedTime: string | null } | null
  /** The client he is with now: a visit opened today and not closed. */
  visiting: { name: string; since: string } | null
}

function who(stop: { customer: { name: string } | null; contact: { displayName: string } | null }): string | null {
  const name = stop.contact?.displayName?.trim() || stop.customer?.name?.trim()
  return name || null
}

export function teamRouteDay(points: TeamRouteDayPoint[], openVisitToday: TeamRouteDayVisit | null): TeamRouteDay | null {
  if (points.length === 0 && !openVisitToday) return null
  const visited = points
    .filter((point) => point.status === "VISITED" && point.visitedAt)
    .sort((a, b) => a.visitedAt!.getTime() - b.visitedAt!.getTime())
  const firstPoint = visited.find((point) => who(point))
  const ahead = points
    // The stop he is at now is not «next».
    .filter((point) => point.status === "PENDING" && point.id !== openVisitToday?.routePointId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .find((point) => who(point))
  const visitingName = openVisitToday ? who(openVisitToday) : null
  return {
    first: firstPoint ? { name: who(firstPoint)!, at: firstPoint.visitedAt!.toISOString() } : null,
    next: ahead ? { name: who(ahead)!, plannedTime: ahead.plannedTime ? ahead.plannedTime.toISOString() : null } : null,
    visiting: openVisitToday && visitingName ? { name: visitingName, since: openVisitToday.checkInAt.toISOString() } : null,
  }
}
