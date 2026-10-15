/**
 * The route planner on a map (/mtm/routes/plan): what its map shows, what
 * «Предложить маршрут» picks, and what the route's summary says. Pure — the
 * page and its tests read the same answers.
 *
 * Owner, 2026-10-15, from the UX audit of the route module: the builder was a
 * small window where the date could not be changed («закройте окно и выберите
 * день в календаре»), clients were a list inside it (8 of 72 at a time) and
 * there was no map. He chose a page of its own from a picture: the employee
 * and the day on top, a map of the clients — orange where nobody has been this
 * month — and the day's route beside it, with a button that proposes one.
 *
 * Everything the server decides stays with the server: which clients the
 * agent may visit (the candidate list is the builder's own,
 * /api/v1/mtm/routes/candidates), conflicts, half-hour slots, publishing.
 */
import { MTM_ROUTE_TIME_SLOTS } from "@/lib/mtm/route-time-slots"

/** One client the planner may put into the route: an organization, or a doctor at one. */
export type RoutePlannerCandidate = {
  /** Stable key of the stop it would make: `customerId` or `customerId:contactId`. */
  key: string
  customerId: string
  contactId: string | null
  name: string
  /** The organization's name — for a doctor, where he is seen. */
  placeName: string
  address: string | null
  specialtyName: string | null
  category: string | null
  latitude: number | null
  longitude: number | null
  lastVisitAt: string | null
  /** Visits in the month of the route's day; 0 is «not visited this month». */
  monthlyVisitCount: number
}

/** A point on the map: one organization, with everybody who can be visited there. */
export type RoutePlannerPlace = {
  customerId: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  /** The organization itself first (when it is a candidate), then its doctors by name. */
  candidates: RoutePlannerCandidate[]
  /** Somebody here has had no visit this month. */
  dueThisMonth: boolean
}

export function routePlannerStopKey(stop: { customerId: string; contactId?: string | null }): string {
  return stop.contactId ? `${stop.customerId}:${stop.contactId}` : stop.customerId
}

function hasCoordinates(value: { latitude: number | null; longitude: number | null }): value is { latitude: number; longitude: number } {
  return typeof value.latitude === "number" && typeof value.longitude === "number"
    && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    // (0, 0) is the Gulf of Guinea: a client without a stored pair, never a place.
    && !(value.latitude === 0 && value.longitude === 0)
}

/** Candidates grouped by organization; one without coordinates has no place on the map. */
export function routePlannerPlaces(candidates: RoutePlannerCandidate[]): RoutePlannerPlace[] {
  const places = new Map<string, RoutePlannerPlace>()
  for (const candidate of candidates) {
    if (!hasCoordinates(candidate)) continue
    let place = places.get(candidate.customerId)
    if (!place) {
      place = {
        customerId: candidate.customerId,
        name: candidate.placeName,
        address: candidate.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        candidates: [],
        dueThisMonth: false,
      }
      places.set(candidate.customerId, place)
    }
    if (!place.candidates.some((existing) => existing.key === candidate.key)) place.candidates.push(candidate)
    if (candidate.monthlyVisitCount === 0) place.dueThisMonth = true
  }
  for (const place of places.values()) {
    place.candidates.sort((a, b) => Number(Boolean(a.contactId)) - Number(Boolean(b.contactId)) || a.name.localeCompare(b.name))
  }
  return [...places.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Great-circle distance in kilometres. */
export function routePlannerDistanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radius = 6371
  const lat1 = (a.latitude * Math.PI) / 180
  const lat2 = (b.latitude * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The route's length point to point, in the order given; stops without a place are skipped. */
export function routePlannerLengthKm(stops: Array<{ latitude: number | null; longitude: number | null }>): number {
  const placed = stops.filter(hasCoordinates)
  let total = 0
  for (let index = 1; index < placed.length; index += 1) total += routePlannerDistanceKm(placed[index - 1], placed[index])
  return total
}

export const ROUTE_PLANNER_FIRST_SLOT = "09:30"
/** Between two visits: the visit itself and the way to the next one. */
export const ROUTE_PLANNER_STEP_MINUTES = 60
/** How many stops «Предложить маршрут» fills a day up to. */
export const ROUTE_PLANNER_SUGGESTED_STOPS = 6

function slotMinutes(slot: string): number {
  const [hours, minutes] = slot.split(":").map(Number)
  return hours * 60 + minutes
}

/**
 * The time of the stop after `previous`: an hour later, on a half-hour slot,
 * never past the last slot of the day. The first stop is at 09:30.
 */
export function routePlannerNextSlot(previous: string | null | undefined): string {
  if (!previous || !MTM_ROUTE_TIME_SLOTS.includes(previous)) return ROUTE_PLANNER_FIRST_SLOT
  const next = Math.min(slotMinutes(previous) + ROUTE_PLANNER_STEP_MINUTES, slotMinutes(MTM_ROUTE_TIME_SLOTS[MTM_ROUTE_TIME_SLOTS.length - 1]))
  return MTM_ROUTE_TIME_SLOTS.find((slot) => slotMinutes(slot) >= next) ?? MTM_ROUTE_TIME_SLOTS[MTM_ROUTE_TIME_SLOTS.length - 1]
}

/** Minutes from the first stop's time to the end of the last visit, or null without times. */
export function routePlannerDayMinutes(times: Array<string | null | undefined>): number | null {
  const slots = times.filter((time): time is string => typeof time === "string" && MTM_ROUTE_TIME_SLOTS.includes(time)).map(slotMinutes)
  if (slots.length === 0) return null
  return Math.max(...slots) - Math.min(...slots) + ROUTE_PLANNER_STEP_MINUTES
}

/**
 * «Предложить маршрут»: clients with no visit this month, close to each other.
 *
 * Starts from the route's last stop when there is one; on an empty route,
 * from the place with the most due clients within 1.5 km. Then each time the
 * nearest place with somebody due — everybody due there: its doctors, or the
 * organization itself where it has none — until the day has `maxStops`
 * stops. Nothing already in the route is offered
 * again; a client without coordinates cannot be placed and is left out.
 */
export function suggestRoutePlannerStops(input: {
  candidates: RoutePlannerCandidate[]
  route: Array<{ customerId: string; contactId?: string | null; latitude: number | null; longitude: number | null }>
  maxStops?: number
}): RoutePlannerCandidate[] {
  const maxStops = input.maxStops ?? ROUTE_PLANNER_SUGGESTED_STOPS
  const taken = new Set(input.route.map(routePlannerStopKey))
  const room = maxStops - input.route.length
  if (room <= 0) return []
  const places = routePlannerPlaces(input.candidates)
    .map((place) => {
      // Where doctors can be visited, the visit is to them; the organization
      // on its own is offered only where nobody else is.
      const doctors = place.candidates.filter((candidate) => candidate.contactId)
      const pool = doctors.length > 0 ? doctors : place.candidates
      return { ...place, due: pool.filter((candidate) => candidate.monthlyVisitCount === 0 && !taken.has(candidate.key)) }
    })
    .filter((place) => place.due.length > 0)
  if (places.length === 0) return []

  const lastPlaced = [...input.route].reverse().find((stop) => hasCoordinates(stop))
  let from: { latitude: number; longitude: number }
  if (lastPlaced && hasCoordinates(lastPlaced)) {
    from = { latitude: lastPlaced.latitude, longitude: lastPlaced.longitude }
  } else {
    const densest = places.reduce((best, place) => {
      const near = places.reduce((sum, other) => sum + (routePlannerDistanceKm(place, other) <= 1.5 ? other.due.length : 0), 0)
      return near > best.near || (near === best.near && place.name.localeCompare(best.place.name) < 0) ? { place, near } : best
    }, { place: places[0], near: -1 })
    from = densest.place
  }

  const picked: RoutePlannerCandidate[] = []
  const remaining = [...places]
  while (picked.length < room && remaining.length > 0) {
    let nearestIndex = 0
    for (let index = 1; index < remaining.length; index += 1) {
      const distance = routePlannerDistanceKm(from, remaining[index])
      const best = routePlannerDistanceKm(from, remaining[nearestIndex])
      if (distance < best || (distance === best && remaining[index].name.localeCompare(remaining[nearestIndex].name) < 0)) nearestIndex = index
    }
    const [place] = remaining.splice(nearestIndex, 1)
    for (const candidate of place.due) {
      if (picked.length >= room) break
      picked.push(candidate)
    }
    from = place
  }
  return picked
}
