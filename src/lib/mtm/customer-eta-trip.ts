import { prisma } from "@/lib/prisma"
import { roadTable } from "@/lib/mtm/road-router"
import { customerEtaArrivesAt } from "@/lib/mtm/customer-eta-link"
import type { LocationShareLinkPosition } from "@/lib/mtm/location-share-link"

/**
 * What the page of a link the bot sent a customer («агент едет к вам») is
 * told on top of where the agent is: whether he has arrived, and if not, when
 * he will. Called by the public answer inside the organization's scope.
 *
 *   - ARRIVED — he checked in at this customer after the link was sent (or
 *     the stop is done): the page says «представитель на месте» and is given
 *     no position from then on;
 *   - ELSEWHERE — he is in a visit at somebody else: no position, no reason;
 *   - ON_THE_WAY — the customer's pin and, when the roads answer, about when;
 *   - null — the stop is gone or was skipped: the link no longer works.
 */
export type CustomerEtaTrip =
  | { state: "ARRIVED" }
  | { state: "ELSEWHERE" }
  | { state: "ON_THE_WAY"; destination: { latitude: number; longitude: number } | null; arrivesAt: Date | null }

/** An open page asks twice a minute; the roads are asked at most once a minute per link. */
const TRIP_CACHE_MS = 60_000
const TRIP_CACHE_LIMIT = 2_000
type Cached = { at: number; arrivesAt: Date | null }
const cacheHolder = globalThis as typeof globalThis & { __mtmCustomerEtaTripCache?: Map<string, Cached> }
const tripCache = (cacheHolder.__mtmCustomerEtaTripCache ??= new Map())

export function resetCustomerEtaTripCache() {
  tripCache.clear()
}

export async function readCustomerEtaTrip(input: {
  link: { id: string; agentId: string; createdAt: Date; routePointId: string | null; customerId: string | null }
  organizationId: string
  position: LocationShareLinkPosition
  now: Date
  roads?: typeof roadTable
}): Promise<CustomerEtaTrip | null> {
  const { link, organizationId, position, now } = input
  if (!link.routePointId || !link.customerId) return null
  const stop = await prisma.mtmRoutePoint.findFirst({
    where: { id: link.routePointId, organizationId, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!stop || stop.status === "SKIPPED") return null
  if (stop.status === "VISITED") return { state: "ARRIVED" }

  const arrived = await prisma.mtmVisit.findFirst({
    where: {
      organizationId,
      agentId: link.agentId,
      deletedAt: null,
      checkInAt: { gte: link.createdAt },
      OR: [{ routePointId: stop.id }, { customerId: link.customerId }],
    },
    select: { id: true },
  })
  if (arrived) return { state: "ARRIVED" }

  const elsewhere = await prisma.mtmVisit.findFirst({
    where: { organizationId, agentId: link.agentId, status: "CHECKED_IN", deletedAt: null },
    select: { id: true },
  })
  if (elsewhere) return { state: "ELSEWHERE" }

  const customer = await prisma.mtmCustomer.findFirst({
    where: { id: link.customerId, organizationId, deletedAt: null },
    select: { latitude: true, longitude: true },
  })
  if (!customer) return null
  const destination = customer.latitude != null && customer.longitude != null
    ? { latitude: customer.latitude, longitude: customer.longitude }
    : null
  if (!destination || position.state !== "AVAILABLE") return { state: "ON_THE_WAY", destination, arrivesAt: null }

  const cached = tripCache.get(link.id)
  if (cached && now.getTime() - cached.at < TRIP_CACHE_MS) return { state: "ON_THE_WAY", destination, arrivesAt: cached.arrivesAt }
  const table = await (input.roads ?? roadTable)([position, destination]).catch(() => null)
  const arrivesAt = customerEtaArrivesAt(table?.seconds[0]?.[1], now)
  if (tripCache.size >= TRIP_CACHE_LIMIT) tripCache.clear()
  tripCache.set(link.id, { at: now.getTime(), arrivesAt })
  return { state: "ON_THE_WAY", destination, arrivesAt }
}
