import { describe, expect, it } from "vitest"
import {
  VISIT_SWITCH_ACTION_KEYS,
  companyVisitRule,
  listedSpecialVisitRules,
  specialVisitRuleCount,
  teamsWithoutSpecialVisitRule,
  visitActionDetail,
  visitActionRefined,
  visitActionsAfterDetail,
  visitActionsAfterSwitch,
  visitModeFromSwitches,
  visitRuleActions,
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

/**
 * «Photo required on every visit» is a setting older than the rules: the
 * resolver honours it only while no rule is selected. Its own switch left the
 * settings page on 2026-10-08 — two places to require a photo, and the page
 * had to warn that one of them might not apply. What it holds must not be lost
 * with it: the photo row shows it, and the first rule starts from it.
 */
describe("the older «photo required» setting, for an organization with no rule yet", () => {
  const legacy = { legacyPhotoRequired: true }

  it("shows on the photo row, so the row does not say «optional» for a photo the server requires", () => {
    expect(visitSwitchState(null, "PHOTO", legacy)).toEqual({ shown: true, required: true, conditional: false })
    expect(visitSwitchState(null, "PHOTO", { legacyPhotoRequired: false })).toEqual({ shown: true, required: false, conditional: false })
    // It was only ever about the photo.
    expect(visitSwitchState(null, "SIGNATURE", legacy)).toEqual({ shown: true, required: false, conditional: false })
  })

  it("is carried into the rule the first switch creates, whichever action that switch is about", () => {
    const next = visitActionsAfterSwitch(null, "SIGNATURE", { required: true }, legacy)
    expect(next.map((item) => [item.actionKey, item.mode])).toEqual([
      ["PHOTO", "REQUIRED"], ["PRESENTATION", "OPTIONAL"], ["SIGNATURE", "REQUIRED"],
      ["VISIT_NOTE", "OPTIONAL"], ["STOCK_CHECK", "OPTIONAL"], ["FEEDBACK", "OPTIONAL"],
    ])
  })

  it("can be lifted with the photo row's own switch", () => {
    const next = visitActionsAfterSwitch(null, "PHOTO", { required: false }, legacy)
    expect(next.find((item) => item.actionKey === "PHOTO")?.mode).toBe("OPTIONAL")
  })

  it("means nothing once a rule exists: the rule is what the server reads then", () => {
    const company = rule({ actions: [action("SIGNATURE", "REQUIRED")] })
    expect(visitSwitchState(company, "PHOTO", legacy)).toEqual({ shown: true, required: false, conditional: false })
    expect(visitActionsAfterSwitch(company, "SIGNATURE", { required: false }, legacy).find((item) => item.actionKey === "PHOTO")?.mode)
      .toBe("OPTIONAL")
  })
})

/**
 * Owner, 2026-10-08, shown the old editor under the switches: «эту часть ты
 * оставил без изменений». It went; a group of agents gets the same table. What
 * the old editor offered per action is kept where the server acts on it: the
 * photo minimum and the two «only at institutions of…» conditions.
 */
describe("the refinements of an action", () => {
  const company = rule({
    actions: [
      action("PHOTO", "REQUIRED", { minCount: 3, allowWaiver: true }),
      action("PRESENTATION", "OPTIONAL", { conditions: { objectTypes: ["PHARMACY"], customerCategories: ["A"] } }),
      action("SIGNATURE", "OPTIONAL", { minCount: 4 }),
    ],
  })

  it("reads the minimum and the two conditions off the rule, and «any» where there is none", () => {
    expect(visitActionDetail(company, "PHOTO")).toEqual({ minCount: 3, customerClass: null, clientKind: null })
    expect(visitActionDetail(company, "PRESENTATION")).toEqual({ minCount: 1, customerClass: "A", clientKind: "PHARMACY" })
    expect(visitActionDetail(null, "PHOTO")).toEqual({ minCount: 1, customerClass: null, clientKind: null })
  })

  it("marks a row as refined only for what the server acts on: a count is a photo's", () => {
    expect(visitActionRefined(company, "PHOTO")).toBe(true)
    expect(visitActionRefined(company, "PRESENTATION")).toBe(true)
    // A stored minimum of 4 signatures binds nobody: the server counts one.
    expect(visitActionRefined(company, "SIGNATURE")).toBe(false)
    expect(visitActionRefined(company, "VISIT_NOTE")).toBe(false)
  })

  it("changes the one thing it names and leaves the mode, the waiver and every other action", () => {
    const next = visitActionsAfterDetail(company, "PHOTO", { clientKind: "CLINIC" })
    expect(next.find((item) => item.actionKey === "PHOTO"))
      .toEqual(action("PHOTO", "REQUIRED", { minCount: 3, allowWaiver: true, conditions: { objectTypes: ["CLINIC"] } }))
    expect(next.find((item) => item.actionKey === "PRESENTATION")).toEqual(company.actions[1])
    expect(next.find((item) => item.actionKey === "SIGNATURE")).toEqual(company.actions[2])
  })

  it("takes one condition off without touching the other, and stores no empty condition", () => {
    const withoutKind = visitActionsAfterDetail(company, "PRESENTATION", { clientKind: null })
    expect(withoutKind.find((item) => item.actionKey === "PRESENTATION")?.conditions).toEqual({ customerCategories: ["A"] })
    const bare = visitActionsAfterDetail(rule({ actions: withoutKind }), "PRESENTATION", { customerClass: null })
    expect(bare.find((item) => item.actionKey === "PRESENTATION")?.conditions).toBeNull()
  })

  it("keeps a minimum a whole number between 1 and 100, and ignores what is not a number", () => {
    const minimum = (value: number) => visitActionsAfterDetail(company, "PHOTO", { minCount: value }).find((item) => item.actionKey === "PHOTO")?.minCount
    expect([minimum(5), minimum(0), minimum(-3), minimum(2.9), minimum(1000), minimum(Number.NaN)]).toEqual([5, 1, 1, 2, 100, 3])
  })

  it("lists what a rule says about all six actions, for a copy into a group's new rule", () => {
    expect(visitRuleActions(company).map((item) => [item.actionKey, item.mode])).toEqual([
      ["PHOTO", "REQUIRED"], ["PRESENTATION", "OPTIONAL"], ["SIGNATURE", "OPTIONAL"],
      ["VISIT_NOTE", "OPTIONAL"], ["STOCK_CHECK", "OPTIONAL"], ["FEEDBACK", "OPTIONAL"],
    ])
    // With no company rule yet, the copy starts from what applies without one.
    expect(visitRuleActions(null, { legacyPhotoRequired: true })[0]).toEqual(action("PHOTO", "REQUIRED"))
  })
})

describe("the rules «own rules for groups» lists", () => {
  const company = rule({ id: "company" })
  const rules = [
    company,
    rule({ id: "team", teamId: "team-1" }),
    rule({ id: "later", teamId: "team-2", effectiveFrom: "2099-01-01" }),
    rule({ id: "off", teamId: "team-3", isActive: false }),
    rule({ id: "ended", teamId: "team-4", effectiveTo: "2026-10-05" }),
    rule({ id: "audit", visitType: "AUDIT" }),
  ]

  it("is every rule that is on and has not ended, except the company rule — one that starts later included", () => {
    expect(listedSpecialVisitRules(rules, NOW).map((item) => item.id)).toEqual(["team", "later", "audit"])
  })

  it("offers a group a rule only while it has none the server would refuse a second of", () => {
    const teams = ["team-1", "team-2", "team-3", "team-4", "team-5"].map((id) => ({ id }))
    // team-1 and team-2 have a listed rule; the rules of team-3 and team-4 are gone.
    expect(teamsWithoutSpecialVisitRule(teams, rules, NOW).map((team) => team.id)).toEqual(["team-3", "team-4", "team-5"])
    // A rule at another priority or for another visit type does not collide with a new default one.
    const other = [rule({ id: "p50", teamId: "team-1", priority: 50 }), rule({ id: "audit", teamId: "team-2", visitType: "AUDIT" })]
    expect(teamsWithoutSpecialVisitRule(teams.slice(0, 2), other, NOW).map((team) => team.id)).toEqual(["team-1", "team-2"])
  })
})
