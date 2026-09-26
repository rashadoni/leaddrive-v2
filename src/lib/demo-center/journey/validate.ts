/**
 * Manifest validation — pure, returns a list of human-readable problems.
 * An empty list means the manifest satisfies the contract. The test suite
 * asserts `[]`; the admin editor (Phase G) can show the same messages.
 */
import { GROUP_MODULE_IDS } from "@/lib/modules"
import { isDemoAnchor, DEMO_ANCHORS } from "./anchors"
import { coverageAreaFor, DEMO_PRODUCT_AREAS_WITH_COVERAGE } from "./coverage-index"
import { canTransition, journeyPath } from "./state"
import {
  DEMO_CAPABILITY_IDS,
  DEMO_JOURNEY_AREAS,
  DEMO_JOURNEY_EVENTS,
  DEMO_JOURNEY_STATES,
  DEMO_STEP_ACTIONS,
  DEMO_STEP_PLACEMENTS,
  type DemoJourneyArea,
  type DemoJourneyManifest,
  type DemoJourneySection,
  type DemoJourneyState,
} from "./types"

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const NON_ACTION = new Set(["observe", "wait"])

function has<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

/** The deal section starts on the lead card («Convert»), so it may borrow
 *  that one lead anchor and the convert-dialog inventory section. */
function borrowsLeadConvert(section: DemoJourneySection, anchorOrSectionId: string): boolean {
  return section.id === "deal" && (anchorOrSectionId === "leads-convert" || anchorOrSectionId === "leads.card.convert-dialog")
}

export function validateJourneyManifest(manifest: DemoJourneyManifest): string[] {
  const problems: string[] = []
  const push = (message: string) => problems.push(message)

  if (!KEBAB.test(manifest.scenarioId)) push(`scenarioId "${manifest.scenarioId}" must be kebab-case`)
  if (!Number.isInteger(manifest.version) || manifest.version < 1) push("version must be a positive integer")
  if (manifest.locale !== "az") push("locale must be az — prospect copy is Azerbaijani first")
  if (!manifest.title.trim() || !manifest.summary.trim()) push("title and summary are required")
  if (!manifest.sections.length) push("manifest has no sections")

  for (const group of manifest.navGroups) {
    if (!has(GROUP_MODULE_IDS, group)) push(`navGroups: unknown group "${group}"`)
  }
  for (const capability of Object.keys(manifest.capabilities)) {
    if (!has(DEMO_CAPABILITY_IDS, capability)) push(`capabilities: unknown capability "${capability}"`)
  }
  for (const capability of DEMO_CAPABILITY_IDS) {
    if (typeof manifest.capabilities[capability] !== "boolean") push(`capabilities.${capability} must be declared`)
  }
  if (!manifest.capabilities.emailVerification) push("emailVerification can never be switched off")
  if (manifest.capabilities.liveCall && !manifest.capabilities.phoneVerification) {
    push("liveCall requires phoneVerification")
  }

  const minutes = manifest.sections.reduce((sum, section) => sum + section.estimatedMinutes, 0)
  if (minutes !== manifest.estimatedMinutes) {
    push(`estimatedMinutes ${manifest.estimatedMinutes} does not equal the section sum ${minutes}`)
  }

  const sectionIds = new Set<string>()
  const stepIds = new Set<string>()
  const coveredSections = new Set<string>()
  let previousExit: DemoJourneyState | undefined

  for (const [index, section] of manifest.sections.entries()) {
    const where = `section[${index}] "${section.id}"`
    validateSectionShape(section, where, push, manifest)

    if (sectionIds.has(section.id)) push(`${where}: duplicate section id`)
    sectionIds.add(section.id)

    // State chain: the previous section's exit must be one of this section's
    // entries, and walking the transition steps must land in an exit state.
    if (previousExit !== undefined && !section.entryStates.includes(previousExit)) {
      push(`${where}: entry states [${section.entryStates.join(", ")}] do not include the previous exit "${previousExit}"`)
    }
    if (previousExit === undefined && section.entryStates.length !== 1) {
      push(`${where}: the first section must have exactly one entry state`)
    }
    let cursor: DemoJourneyState = previousExit ?? section.entryStates[0]

    for (const [stepIndex, step] of section.steps.entries()) {
      const at = `${where} step[${stepIndex}] "${step.id}"`
      if (!KEBAB.test(step.id)) push(`${at}: id must be kebab-case`)
      if (stepIds.has(step.id)) push(`${at}: duplicate step id`)
      stepIds.add(step.id)
      if (!step.title.trim() || !step.instruction.trim()) push(`${at}: title and instruction are required`)

      if (!isDemoAnchor(step.anchor)) push(`${at}: unknown anchor "${step.anchor}"`)
      else {
        const anchorArea = DEMO_ANCHORS[step.anchor].area
        const allowed = anchorArea === section.area || anchorArea === "shell" || borrowsLeadConvert(section, step.anchor)
        if (!allowed) push(`${at}: anchor "${step.anchor}" belongs to area "${anchorArea}", section is "${section.area}"`)
      }
      if (!has(DEMO_STEP_PLACEMENTS, step.placement)) push(`${at}: bad placement "${step.placement}"`)
      if (!has(DEMO_STEP_ACTIONS, step.action)) push(`${at}: bad action "${step.action}"`)
      if (!has(DEMO_JOURNEY_EVENTS, step.analyticsEvent)) push(`${at}: unknown analytics event "${step.analyticsEvent}"`)

      const rule = step.completion
      if (rule.kind === "viewed" && !NON_ACTION.has(step.action)) {
        push(`${at}: "${step.action}" steps must complete on a transition or snapshot rule, not on being viewed`)
      }
      if (rule.kind !== "viewed" && NON_ACTION.has(step.action)) {
        push(`${at}: observe/wait steps cannot require a state change`)
      }
      if (rule.kind === "transition") {
        if (!has(DEMO_JOURNEY_STATES, rule.to)) push(`${at}: unknown target state "${rule.to}"`)
        else if (!canTransition(cursor, rule.to)) push(`${at}: transition ${cursor} → ${rule.to} is not allowed`)
        else cursor = rule.to
        if (!step.required) push(`${at}: a transition step must be required`)
        if (!step.result) push(`${at}: a transition step must describe its visible result`)
      }
      if (rule.kind === "snapshot" && !rule.path.trim()) push(`${at}: snapshot rule needs a path`)
      if (rule.kind === "outcome") {
        // What the world decides must be walkable from here, must end the
        // section, and the step must be the section's last: nothing after it
        // could know which state it starts from.
        if (rule.to.length === 0) push(`${at}: an outcome step needs at least one outcome`)
        for (const target of rule.to) {
          if (!has(DEMO_JOURNEY_STATES, target)) push(`${at}: unknown outcome state "${target}"`)
          else if (!journeyPath(cursor, target)) push(`${at}: no legal path ${cursor} → ${target}`)
          if (!section.exitStates.includes(target)) push(`${at}: outcome ${target} does not end the section`)
        }
        if (section.steps[section.steps.length - 1] !== step) push(`${at}: an outcome step must be the last in its section`)
        if (!step.required) push(`${at}: an outcome step must be required`)
        if (!step.result) push(`${at}: an outcome step must describe its visible result`)
        if (rule.to[0] && has(DEMO_JOURNEY_STATES, rule.to[0])) cursor = rule.to[0]
      }

      for (const covered of step.covers) {
        const area = covered.split(".")[0]
        if (area !== section.area && !borrowsLeadConvert(section, covered)) {
          push(`${at}: covers "${covered}" outside the section area "${section.area}"`)
        }
        const inventory = has(DEMO_JOURNEY_AREAS, area) ? coverageAreaFor(area as DemoJourneyArea) : undefined
        const entry = inventory?.sections.find((candidate) => candidate.id === covered)
        if (!entry) push(`${at}: covers unknown inventory section "${covered}"`)
        else if (!entry.included) push(`${at}: covers "${covered}", which the inventory excludes`)
        coveredSections.add(covered)
      }
    }

    if (!section.exitStates.includes(cursor)) {
      push(`${where}: steps end in "${cursor}", exit states are [${section.exitStates.join(", ")}]`)
    }
    previousExit = cursor
  }

  if (previousExit !== "COMPLETED") push(`the last section must end in COMPLETED, ends in "${previousExit ?? "nothing"}"`)

  // Every included inventory section of a shown area must be demonstrated.
  for (const area of DEMO_PRODUCT_AREAS_WITH_COVERAGE) {
    for (const entry of area.sections) {
      if (entry.included && !coveredSections.has(entry.id)) {
        push(`inventory "${entry.id}" is included but no step covers it`)
      }
      if (!entry.included && !entry.reason?.trim()) {
        push(`inventory "${entry.id}" is excluded without a reason`)
      }
    }
  }

  return problems
}

function validateSectionShape(
  section: DemoJourneySection,
  where: string,
  push: (message: string) => void,
  manifest: DemoJourneyManifest,
): void {
  if (!KEBAB.test(section.id)) push(`${where}: id must be kebab-case`)
  if (!section.title.trim() || !section.summary.trim()) push(`${where}: title and summary are required`)
  if (!has(DEMO_JOURNEY_AREAS, section.area)) push(`${where}: unknown area "${section.area}"`)
  if (!Number.isInteger(section.estimatedMinutes) || section.estimatedMinutes < 1) push(`${where}: estimatedMinutes must be ≥ 1`)
  if (!section.steps.length) push(`${where}: section has no steps`)
  if (!section.entryStates.length || !section.exitStates.length) push(`${where}: entry and exit states are required`)
  for (const value of [...section.entryStates, ...section.exitStates]) {
    if (!has(DEMO_JOURNEY_STATES, value)) push(`${where}: unknown state "${value}"`)
  }
  for (const capability of section.requires) {
    if (!has(DEMO_CAPABILITY_IDS, capability)) push(`${where}: unknown capability "${capability}"`)
  }
  if (section.requires.length && !section.skippedNotice) push(`${where}: sections with requirements need a skippedNotice`)
  if (section.intro && !manifest.capabilities.video) push(`${where}: intro clip declared but video capability is off`)

  const demoRoute = section.route.startsWith("demo:")
  if (section.navGroup === "demo") {
    if (!demoRoute) push(`${where}: navGroup "demo" requires a demo: route`)
    if (section.area !== "shell" && section.area !== "summary") push(`${where}: demo sections must be shell or summary`)
    return
  }
  if (demoRoute) push(`${where}: product sections cannot use a demo: route`)
  if (!manifest.navGroups.includes(section.navGroup)) push(`${where}: navGroup "${section.navGroup}" is not visible in this scenario`)
  const inventory = coverageAreaFor(section.area)
  if (!inventory) push(`${where}: product area "${section.area}" has no coverage inventory`)
  else if (!inventory.routes.includes(section.route)) push(`${where}: route "${section.route}" is not an inventory route of "${section.area}"`)
  const base = section.route.replace(/\/\[[a-zA-Z]+\]$/, "")
  if (!manifest.visibleRoutes.includes(base)) push(`${where}: route "${base}" is not in visibleRoutes`)
}
