import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, task A2: one source of "points this agent may
 * work on today". The write validator and the v1 targets endpoint both ask
 * `eligibleFieldCustomerWhere`, which is assignment OR an actionable route.
 *
 * The endpoint the app actually calls did not. It filtered on assignments
 * alone, so the planner offered strictly LESS than the server accepts: a
 * customer reachable through a route saved fine and never appeared in the
 * list. The original A2 bug was the same mismatch pointing the other way.
 *
 * This is a source contract because the alternative is a live database: the
 * only thing worth pinning is that all three paths name the same helper.
 */
const PLANNER = "src/app/api/v2/mtm/mobile/route-field/planning-targets/route.ts"
const VALIDATOR = "src/lib/mtm/route-targets.ts"
const V1_TARGETS = "src/app/api/v1/mtm/mobile/routes/targets/route.ts"

describe("A2: one eligibility scope for organizations", () => {
  it("is asked for by every path that decides what an agent may work on", () => {
    const missing = [PLANNER, VALIDATOR, V1_TARGETS]
      .filter((file) => !readFileSync(file, "utf8").includes("eligibleFieldCustomerWhere"))
    expect(missing).toEqual([])
  })

  it("stops the planner from filtering organizations on assignments alone", () => {
    const planner = readFileSync(PLANNER, "utf8")
    const organizationBranch = planner.slice(
      planner.indexOf('if (kind === "organization")'),
      planner.indexOf("const rows = await prisma.mtmCustomer.findMany"),
    )
    expect(organizationBranch).toContain("eligibleFieldCustomerWhere({ agentId: actor.agentId, date: routeDate })")
    expect(organizationBranch).not.toContain("agentAssignments: { some: { agentId: actor.agentId")
  })

  it("explains an empty list only when the caller's own filters cannot", () => {
    // A search or a type that matched nothing is neither "no assignments" nor
    // "territory", and the shared vocabulary has no word for it. Guessing one
    // sends the agent to a manager over a typo; staying silent lets the screen
    // say the plain thing instead.
    const planner = readFileSync(PLANNER, "utf8")
    expect(planner).toContain("const callerNarrowed = Boolean(search || organizationKind || objectType)")
    expect(planner).toContain("if (pageRows.length === 0 && !page && !callerNarrowed)")
    expect(planner).toContain("fieldEligibilityEmptyReason({")
    expect(planner).toContain("eligibility,")
  })

  it("pays for the explanation only on the empty page", () => {
    // The extra agent, count and calendar reads sit inside the empty branch:
    // the common path is a list a field agent opens dozens of times a day.
    const planner = readFileSync(PLANNER, "utf8")
    const branch = planner.slice(planner.indexOf("const callerNarrowed"), planner.indexOf("return noStoreJson({\n      success: true,\n      data: {\n        targets:"))
    for (const query of ["prisma.mtmAgent.findFirst", "prisma.mtmCustomer.count", "prisma.mtmWorkCalendarDay.findMany"]) {
      expect(branch, `${query} must stay inside the empty branch`).toContain(query)
    }
  })

  it("leaves doctors assignment-only, as the validator says out loud", () => {
    // Widening this one would grant a write the interface never offered — the
    // validator's own note, and the reason the contact phases are untouched.
    const validator = readFileSync(VALIDATOR, "utf8")
    expect(validator).toContain("Doctors stay assignment-only on purpose")
    const planner = readFileSync(PLANNER, "utf8")
    expect(planner).toContain("const directAssignment = { agentId: actor.agentId, ...assignmentWindow }")
  })
})
