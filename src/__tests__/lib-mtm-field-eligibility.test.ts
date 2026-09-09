import { describe, expect, it } from "vitest"
import {
  eligibleFieldCustomerWhere,
  fieldEligibilityEmptyReason,
  MTM_FIELD_ELIGIBILITY_REASONS,
} from "@/lib/mtm/field-eligibility"
import { customerMutationScopeForActor } from "@/lib/mtm/field-scope"

const DATE = new Date("2026-09-07T00:00:00.000Z") // Monday
const SATURDAY = "2026-09-05"
const MONDAY = "2026-09-07"

describe("eligibleFieldCustomerWhere", () => {
  it("is literally the mutation scope of the target employee, not of the caller", () => {
    // The point of A2: one definition. A supervisor opening the picker for
    // their agent must get that agent's set, and it must be the same object
    // Visits and Customers build, or the three screens drift apart again.
    expect(eligibleFieldCustomerWhere({ agentId: "agent-1", date: DATE })).toEqual(
      customerMutationScopeForActor(
        { agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] },
        DATE,
      ),
    )
  })

  it("accepts an actionable route as a reason a point is workable", () => {
    const scope = eligibleFieldCustomerWhere({ agentId: "agent-1", date: DATE })
    const arms = scope.OR as Array<Record<string, unknown>>
    expect(arms).toHaveLength(2)
    expect(arms[0]).toHaveProperty("agentAssignments")
    expect(arms[1]).toHaveProperty("routePoints")
  })

  it("does not offer a point whose only route is finished", () => {
    // COMPLETED keeps a customer readable on Customers, but nobody may check
    // into a finished route: a picker that offers it promises work the app
    // then refuses. This is the half of A2 that was already written.
    const scope = eligibleFieldCustomerWhere({ agentId: "agent-1", date: DATE })
    const routeArm = (scope.OR as Array<{
      routePoints?: { some: { route: { status: { in: string[] } } } }
    }>)[1]
    expect(routeArm.routePoints?.some.route.status.in).toEqual([
      "PLANNED",
      "IN_PROGRESS",
      "INCOMPLETE",
    ])
  })
})

describe("fieldEligibilityEmptyReason", () => {
  const base = { dateKey: MONDAY, date: DATE, hasAnyEligibleSource: true }

  it("names an unusable date before anything else", () => {
    expect(fieldEligibilityEmptyReason({ ...base, date: null })).toBe("date")
  })

  it("stays silent about the calendar while the tenant has not switched it on", () => {
    // enforceWorkCalendarForRoutes defaults to false, and while it is false a
    // Saturday blocks nothing. Blaming the weekend then would send the agent
    // chasing a rule that is not being applied.
    expect(fieldEligibilityEmptyReason({
      ...base,
      dateKey: SATURDAY,
      hasAnyEligibleSource: false,
    })).toBe("assignment")
  })

  it("blames the weekend ahead of ownership once the calendar is enforced", () => {
    // Most-general first: a closed day is closed whether or not the agent owns
    // anything, so all three screens must say the same word about it.
    expect(fieldEligibilityEmptyReason({
      ...base,
      dateKey: SATURDAY,
      workCalendarEnforced: true,
      hasAnyEligibleSource: false,
    })).toBe("weekend")
  })

  it("separates a deliberate day off from the ordinary working week", () => {
    const reason = fieldEligibilityEmptyReason({
      ...base,
      workCalendarEnforced: true,
      calendarOverrides: [{
        id: "cal-1",
        date: MONDAY,
        kind: "COMPANY_HOLIDAY",
        name: "Company day off",
        teamId: null,
        agentId: null,
        movedToDate: null,
        routePlanningAllowed: null,
      }],
    })
    expect(reason).toBe("policy")
  })

  it("blames ownership when the employee holds nothing at all", () => {
    expect(fieldEligibilityEmptyReason({ ...base, hasAnyEligibleSource: false })).toBe("assignment")
  })

  it("blames the filter, not ownership, when a non-empty set was narrowed away", () => {
    expect(fieldEligibilityEmptyReason({
      ...base,
      hasAnyEligibleSource: true,
      narrowedByTerritory: true,
    })).toBe("territory")
  })

  it("only ever returns a code from the shared vocabulary", () => {
    for (const workCalendarEnforced of [true, false]) {
      for (const hasAnyEligibleSource of [true, false]) {
        for (const narrowedByTerritory of [true, false]) {
          for (const dateKey of [MONDAY, SATURDAY]) {
            const reason = fieldEligibilityEmptyReason({
              date: DATE,
              dateKey,
              workCalendarEnforced,
              hasAnyEligibleSource,
              narrowedByTerritory,
            })
            expect(MTM_FIELD_ELIGIBILITY_REASONS).toContain(reason)
          }
        }
      }
    }
  })
})
