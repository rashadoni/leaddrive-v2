export type MtmRouteReturnTarget = {
  href: string
  label: "returnToOperationalWeek" | "returnToCustomers"
}

export type MtmRouteAssignmentDirection = "DOCTOR" | "PHARMACY" | "ORGANIZATION"

export type MtmRouteAssignmentHandoff = {
  agentId: string
  date: string
  direction: MtmRouteAssignmentDirection
  /** A local route-planning URL only. Never trust an external redirect here. */
  returnTo: string
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function isSafeRoutePlanningHref(value: string | null | undefined): value is string {
  if (!value || !value.startsWith("/")) return false
  try {
    const parsed = new URL(value, "https://leaddrive.invalid")
    return parsed.origin === "https://leaddrive.invalid" && parsed.pathname === "/mtm/routes"
  } catch {
    return false
  }
}

function isRouteAssignmentDirection(value: string | null): value is MtmRouteAssignmentDirection {
  return value === "DOCTOR" || value === "PHARMACY" || value === "ORGANIZATION"
}

/**
 * A stable, relative return URL for the route builder. Keeping the selected
 * employee, date and object type in this URL prevents a manager from having to
 * reconstruct their planning context after assigning a customer.
 */
export function mtmRoutePlannerHref(input: {
  agentId: string
  date: string
  direction: MtmRouteAssignmentDirection
}): string {
  const params = new URLSearchParams({
    planAgentId: input.agentId,
    planDate: input.date,
    planDirection: input.direction,
  })
  return `/mtm/routes?${params.toString()}`
}

/**
 * Opens the catalogue needed by the current route direction with a compact,
 * typed handoff. The catalogue can then assign the chosen object and return
 * straight to this exact route builder state.
 */
export function mtmRouteAssignmentCatalogHref(input: {
  agentId: string
  date: string
  direction: MtmRouteAssignmentDirection
}): string {
  const returnTo = mtmRoutePlannerHref(input)
  const params = new URLSearchParams({
    routeAgentId: input.agentId,
    routeDate: input.date,
    routeDirection: input.direction,
    routeReturnTo: returnTo,
  })
  const pathname = input.direction === "DOCTOR" ? "/mtm/contacts" : "/mtm/customers"
  if (input.direction === "PHARMACY") {
    params.set("scope", "ALL")
    params.set("objectType", "PHARMACY")
  }
  return `${pathname}?${params.toString()}`
}

/**
 * Parses only a local, well-formed route assignment handoff. A bad or stale
 * URL deliberately falls back to normal catalogue behaviour instead of
 * redirecting the user somewhere unexpected.
 */
export function mtmRouteAssignmentHandoffFromSearchParams(
  params: Pick<URLSearchParams, "get">,
): MtmRouteAssignmentHandoff | null {
  const agentId = params.get("routeAgentId")?.trim() ?? ""
  const date = params.get("routeDate") ?? ""
  const direction = params.get("routeDirection")
  if (!agentId || !DATE_KEY.test(date) || !isRouteAssignmentDirection(direction)) return null

  const suggestedReturnTo = params.get("routeReturnTo")
  const returnTo = isSafeRoutePlanningHref(suggestedReturnTo)
    ? suggestedReturnTo
    : mtmRoutePlannerHref({ agentId, date, direction })

  return { agentId, date, direction, returnTo }
}

/** Keep a route-assignment handoff when a catalogue rewrites its normal filters. */
export function appendMtmRouteAssignmentHandoff(
  params: URLSearchParams,
  handoff: MtmRouteAssignmentHandoff | null,
): URLSearchParams {
  if (!handoff) return params
  params.set("routeAgentId", handoff.agentId)
  params.set("routeDate", handoff.date)
  params.set("routeDirection", handoff.direction)
  params.set("routeReturnTo", handoff.returnTo)
  return params
}

export function mtmRoutePlanningHref(input: {
  customerId: string
  contactId?: string | null
  returnTo?: string | null
}): string {
  const params = new URLSearchParams({ customerId: input.customerId })
  if (input.contactId) params.set("contactId", input.contactId)
  if (input.returnTo) params.set("returnTo", input.returnTo)
  return `/mtm/routes?${params.toString()}`
}

export function mtmRouteReturnTarget(value: string | null): MtmRouteReturnTarget | null {
  if (value === "/mtm" || value?.startsWith("/mtm?")) {
    return { href: value, label: "returnToOperationalWeek" }
  }
  if (value === "/mtm/customers" || value?.startsWith("/mtm/customers?")) {
    return { href: value, label: "returnToCustomers" }
  }
  return null
}
