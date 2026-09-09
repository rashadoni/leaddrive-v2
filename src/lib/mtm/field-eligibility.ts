import type { Prisma } from "@prisma/client"
import { customerMutationScopeForActor } from "@/lib/mtm/field-scope"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { resolveWorkCalendarDay, type WorkCalendarOverride } from "@/lib/mtm/work-calendar"

/**
 * Why an agent's set of workable points is empty.
 *
 * Three screens used to answer that question three different ways: the mobile
 * planner demanded an effective assignment, while Visits and Customers also
 * accepted route membership. For one agent on one day that read 0 against 3
 * against 3, and each screen blamed something different. These codes are the
 * shared vocabulary, and the fixed order in `fieldEligibilityEmptyReason` is
 * what makes the screens name the SAME one.
 */
export const MTM_FIELD_ELIGIBILITY_REASONS = [
  "date",
  "weekend",
  "policy",
  "assignment",
  "territory",
] as const

export type MtmFieldEligibilityReason = (typeof MTM_FIELD_ELIGIBILITY_REASONS)[number]

/**
 * The legacy empty code the mobile app still switches on. The app ships from a
 * separate repository, so this wire value stays put in this release and the
 * precise reason travels beside it; the app adopts the new field in epic B.
 */
export const LEGACY_EMPTY_REASON = "NO_EFFECTIVE_ASSIGNMENTS"

/**
 * The one definition of "a point this employee may work on this date".
 *
 * It is deliberately the MUTATION scope, not the read scope: planning a route
 * to a point is an action, and offering a point the agent cannot check into is
 * exactly the promise the app then refuses to keep. A finished route keeps its
 * customer readable on Customers, but must not put them back into a picker.
 *
 * Built by asking field-scope about the TARGET employee rather than about the
 * caller, so a supervisor planning for their agent sees that agent's set and
 * not their own.
 */
export function eligibleFieldCustomerWhere(input: {
  agentId: string
  date: Date
}): Prisma.MtmCustomerWhereInput {
  const asAgent: MtmRouteActor = {
    agentId: input.agentId,
    role: "AGENT",
    scopedAgentIds: [input.agentId],
  }
  return customerMutationScopeForActor(asAgent, input.date)
}

/**
 * Names the single reason an eligible set came back empty.
 *
 * Precedence runs most-general first, which is what keeps three screens in
 * agreement: a closed day is closed whether or not the agent owns anything, so
 * every screen must say "weekend" rather than one saying "weekend" and another
 * "no assignments". Callers pass only what they already know; anything left
 * undefined is treated as "not a problem" instead of being guessed at.
 */
export function fieldEligibilityEmptyReason(input: {
  /** Parsed route date, or null when the caller could not parse the input. */
  date: Date | null
  dateKey: string
  /**
   * `enforceWorkCalendarForRoutes`. While a tenant has not switched this on,
   * a weekend or a holiday blocks nothing, so blaming the calendar for an
   * empty list would send the agent chasing the wrong thing.
   */
  workCalendarEnforced?: boolean
  calendarOverrides?: readonly WorkCalendarOverride[]
  teamId?: string | null
  agentId?: string | null
  /** Whether the employee holds any assignment or actionable route at all. */
  hasAnyEligibleSource: boolean
  /** True when a non-empty eligible set was narrowed to zero by a filter. */
  narrowedByTerritory?: boolean
}): MtmFieldEligibilityReason {
  if (!input.date) return "date"

  if (input.workCalendarEnforced) {
    const day = resolveWorkCalendarDay({
      date: input.dateKey,
      overrides: input.calendarOverrides ?? [],
      teamId: input.teamId ?? null,
      agentId: input.agentId ?? null,
    })
    // The default weekend rule and a deliberate override are different answers
    // to "why is this day closed": one is the working week, the other is a
    // decision somebody made. An agent can act on the second and not the first.
    if (!day.routePlanningAllowed) {
      return day.source === "WEEKEND_DEFAULT" ? "weekend" : "policy"
    }
  }

  if (!input.hasAnyEligibleSource) return "assignment"
  return input.narrowedByTerritory ? "territory" : "assignment"
}
