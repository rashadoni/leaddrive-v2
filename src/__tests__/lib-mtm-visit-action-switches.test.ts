import { describe, expect, it } from "vitest"
import {
  VISIT_SWITCH_ACTION_KEYS,
  companyVisitRule,
  specialVisitRuleCount,
  visitActionsAfterSwitch,
  visitModeFromSwitches,
  visitSwitchState,
  type VisitSwitchAction,
  type VisitSwitchRule,
} from "@/lib/mtm/visit-action-switches"

/**
 * Owner, 2026-10-07, about the visit action policies editor: «я хочу, чтоб ты
 * этот раздел настолько улучшил в плане интуитивности, что среднестатистический
 * пользователь с первого раза смог понять… обычные переключатели ставь».
 *
 * Two switches per action — shown, required — over the rules that were already
 * there. These tests hold the switches to the rule the resolver really reads
 * and to changing nothing they do not name.
 */
const NOW = new Date("2026-10-07T12:00:00.000Z")
const action = (actionKey: string, mode: VisitSwitchAction["mode"], extra: Partial<VisitSwitchAction> = {}): VisitSwitchAction => ({
  actionKey, mode, minCount: 1, conditions: null, allowWaiver: false, ...extra,
})
const rule = (extra: Partial<VisitSwitchRule> = {}): VisitSwitchRule => ({
  id: "rule-1", teamId: null, visitType: "DEFAULT", priority: 100,
  effectiveFrom: "2026-10-01", effectiveTo: null, isActive: true, actions: [], ...extra,
})

describe("the rule the switches stand for", () => {
  it("is the organization-wide rule for the default visit type, in effect now", () => {
    const company = rule({ id: "company" })
    const rules = [
      rule({ id: "team", teamId: "team-1" }),
      rule({ id: "special-type", visitType: "AUDIT" }),
      rule({ id: "off", isActive: false }),
      rule({ id: "later", effectiveFrom: "2026-11-01" }),
      rule({ id: "ended", effectiveTo: "2026-10-05" }),
      company,
    ]
    expect(companyVisitRule(rules, NOW)?.id).toBe("company")
  })

  it("picks among several the one the resolver picks: lowest priority number, then the latest start", () => {
    const rules = [
      rule({ id: "p100-old", priority: 100, effectiveFrom: "2026-09-01" }),
      rule({ id: "p100-new", priority: 100, effectiveFrom: "2026-10-05" }),
      rule({ id: "p50", priority: 50, effectiveFrom: "2026-08-01" }),
    ]
    expect(companyVisitRule(rules, NOW)?.id).toBe("p50")
    expect(companyVisitRule(rules.slice(0, 2), NOW)?.id).toBe("p100-new")
  })

  it("is nothing for an organization that never wrote a rule", () => {
    expect(companyVisitRule([], NOW)).toBeNull()
    expect(companyVisitRule([rule({ teamId: "team-1" })], NOW)).toBeNull()
  })

  it("counts the other rules in effect, so the page can say they exist", () => {
    const rules = [rule({ id: "company" }), rule({ id: "team", teamId: "team-1" }), rule({ id: "off", teamId: "team-2", isActive: false })]
    expect(specialVisitRuleCount(rules, NOW)).toBe(1)
    expect(specialVisitRuleCount([rule()], NOW)).toBe(0)
  })
})

describe("what the two switches show", () => {
  const company = rule({ actions: [action("PHOTO", "REQUIRED"), action("SIGNATURE", "HIDDEN"), action("PRESENTATION", "OPTIONAL", { conditions: { objectTypes: ["PHARMACY"] } })] })

  it("reads shown and required off the stored mode", () => {
    expect(visitSwitchState(company, "PHOTO")).toEqual({ shown: true, required: true, conditional: false })
    expect(visitSwitchState(company, "SIGNATURE")).toEqual({ shown: false, required: false, conditional: false })
    expect(visitSwitchState(company, "PRESENTATION")).toEqual({ shown: true, required: false, conditional: true })
  })

  it("shows an action nobody configured as the server treats it: visible, not required", () => {
    expect(visitSwitchState(company, "VISIT_NOTE")).toEqual({ shown: true, required: false, conditional: false })
    expect(visitSwitchState(null, "PHOTO")).toEqual({ shown: true, required: false, conditional: false })
  })

  it("has no way to require what is hidden", () => {
    expect([visitModeFromSwitches(true, true), visitModeFromSwitches(true, false), visitModeFromSwitches(false, false), visitModeFromSwitches(false, true)])
      .toEqual(["REQUIRED", "OPTIONAL", "HIDDEN", "HIDDEN"])
  })
})

describe("what one switch writes", () => {
  const company = rule({
    actions: [
      action("PHOTO", "REQUIRED", { minCount: 3, allowWaiver: true }),
      action("SIGNATURE", "OPTIONAL"),
      action("PRESENTATION", "OPTIONAL", { conditions: { objectTypes: ["PHARMACY"] } }),
      action("CHECKLIST", "HIDDEN"),
    ],
  })
  const modeOf = (actions: VisitSwitchAction[], key: string) => actions.find((item) => item.actionKey === key)?.mode

  it("hides an action, and takes «required» off with it", () => {
    const next = visitActionsAfterSwitch(company, "PHOTO", { shown: false })
    expect(modeOf(next, "PHOTO")).toBe("HIDDEN")
  })

  it("brings a hidden action back as optional, never straight to required", () => {
    const hidden = rule({ actions: [action("PHOTO", "HIDDEN")] })
    expect(modeOf(visitActionsAfterSwitch(hidden, "PHOTO", { shown: true }), "PHOTO")).toBe("OPTIONAL")
  })

  it("makes a shown action required and back", () => {
    expect(modeOf(visitActionsAfterSwitch(company, "SIGNATURE", { required: true }), "SIGNATURE")).toBe("REQUIRED")
    expect(modeOf(visitActionsAfterSwitch(company, "PHOTO", { required: false }), "PHOTO")).toBe("OPTIONAL")
  })

  it("does not make a hidden action required, whatever is asked", () => {
    const hidden = rule({ actions: [action("FEEDBACK", "HIDDEN")] })
    expect(modeOf(visitActionsAfterSwitch(hidden, "FEEDBACK", { required: true }), "FEEDBACK")).toBe("HIDDEN")
  })

  it("leaves every other action, and everything else about this one, as the rule had it", () => {
    const next = visitActionsAfterSwitch(company, "SIGNATURE", { required: true })
    expect(next.find((item) => item.actionKey === "PHOTO")).toEqual(action("PHOTO", "REQUIRED", { minCount: 3, allowWaiver: true }))
    expect(next.find((item) => item.actionKey === "PRESENTATION")).toEqual(action("PRESENTATION", "OPTIONAL", { conditions: { objectTypes: ["PHARMACY"] } }))
    expect(next.find((item) => item.actionKey === "CHECKLIST")).toEqual(action("CHECKLIST", "HIDDEN"))
    const photoOff = visitActionsAfterSwitch(company, "PHOTO", { shown: false }).find((item) => item.actionKey === "PHOTO")
    expect(photoOff).toEqual(action("PHOTO", "HIDDEN", { minCount: 3, allowWaiver: true }))
  })

  it("writes all six actions for an organization with no rule yet, optional except the one switched", () => {
    const next = visitActionsAfterSwitch(null, "STOCK_CHECK", { shown: false })
    expect(next.map((item) => item.actionKey)).toEqual([...VISIT_SWITCH_ACTION_KEYS])
    expect(next.map((item) => item.mode)).toEqual(["OPTIONAL", "OPTIONAL", "OPTIONAL", "OPTIONAL", "HIDDEN", "OPTIONAL"])
    // At most eight actions per rule is the API's own limit.
    expect(next.length).toBeLessThanOrEqual(8)
  })
})
