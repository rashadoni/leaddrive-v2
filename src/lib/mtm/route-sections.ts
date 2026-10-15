/**
 * Which views each route section offers (owner, 2026-10-15: «два раздела без
 * повторов»).
 *
 * «Маршруты» and «Календарь» were one workspace with the same views behind
 * two tabs, and the view remembered in one opened in the other: «Маршруты»
 * opened on a calendar with no tab lit. On 2026-09-23 the owner had asked for
 * the calendar as a section of its own; on 2026-10-15 he chose to keep it so,
 * without the repeats. The calendar holds the month and the team week; the
 * routes hold the list and the approvals. The employee over a period (opened
 * from a name in the team week, or by a link) and the old week plan (by an
 * old link only) open in either, without a tab of their own.
 */
export type MtmRouteSurface = "routes" | "calendar"
export type MtmRouteViewMode = "list" | "matrix" | "week" | "calendar" | "approvals" | "agent"

export const MTM_ROUTE_SURFACE_VIEWS: Record<MtmRouteSurface, readonly MtmRouteViewMode[]> = {
  calendar: ["calendar", "week", "agent", "matrix"],
  routes: ["list", "approvals", "agent", "matrix"],
}

/** The view a section opens on when nothing else is asked for. */
export function defaultMtmRouteView(surface: MtmRouteSurface): MtmRouteViewMode {
  return surface === "calendar" ? "calendar" : "list"
}

/** Whether a view may be shown in this section to this user; the team views need a reviewer. */
export function canUseMtmRouteView(mode: MtmRouteViewMode, canReview: boolean, surface: MtmRouteSurface): boolean {
  return MTM_ROUTE_SURFACE_VIEWS[surface].includes(mode) && (canReview || (mode !== "week" && mode !== "approvals"))
}
