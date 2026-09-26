import { localDateTimeToUtc } from "@/lib/timezone"

/** The fields of a route-builder stop these rules read. */
export interface RouteBuilderStopTimeFields {
  status?: string
  plannedTime?: string | null
  /** Published edit only: the stored ISO time and the :00/:30 slot it was shown as. */
  originalPlannedTime?: string | null
  originalSlot?: string | null
  /** Published edit only: the stop already has a (possibly open) visit. */
  hasVisit?: boolean
}

/**
 * A stop with field history cannot be removed, moved or retimed. The same
 * rule as the server's isPublishedRoutePointLocked: a non-PENDING status or
 * any visit, including an open check-in on a still-PENDING stop.
 */
export function isRouteBuilderStopLocked(stop: Pick<RouteBuilderStopTimeFields, "status" | "hasVisit">): boolean {
  return (stop.status !== undefined && stop.status !== "PENDING") || stop.hasVisit === true
}

/**
 * The time the builder sends for a stop.
 *
 * The time input snaps to :00/:30 slots. In a published edit a visit planned
 * at 10:15 would otherwise go back as 10:00: the server reads that as a
 * retimed locked stop and refuses every save, and an unlocked stop is
 * silently re-snapped. So a locked stop always keeps its stored time, and an
 * unlocked stop keeps it unless the user picked a different slot.
 */
export function routeBuilderStopPlannedTimeForSave(
  stop: RouteBuilderStopTimeFields,
  input: { date: string; timezone: string; publishedEdit: boolean },
): string | null {
  if (input.publishedEdit && stop.originalPlannedTime !== undefined) {
    if (isRouteBuilderStopLocked(stop) || (stop.plannedTime ?? null) === (stop.originalSlot ?? null)) {
      return stop.originalPlannedTime
    }
  }
  return stop.plannedTime
    ? localDateTimeToUtc(`${input.date}T${stop.plannedTime}`, input.timezone).toISOString()
    : null
}
