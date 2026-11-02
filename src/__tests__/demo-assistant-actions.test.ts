/**
 * The guide's hands (src/lib/demo-center/assistant/actions.ts): what an
 * assistant answer may do on the prospect's screen, planned against the real
 * story. A closed list — open a module at its beginning, or bring the current
 * step back — through the same jump rules as the sidebar. The fuzz test walks
 * the story and tries every module from every position: nothing an assistant
 * action does may complete or skip a step, end the demo or record a call.
 */
import { describe, expect, it } from "vitest"
import { parseDemoAssistantAction, planAssistantAction } from "@/lib/demo-center/assistant/actions"
import { DEMO_NAVIGATION_INTENTS } from "@/lib/demo-center/assistant/prepared-answers"
import {
  DEMO_JOURNEY_MODULES,
  PROSPECT_TO_CLOSED_WON,
  createJourneySnapshot,
  findSection,
  moduleFirstSectionId,
  reduceJourney,
  withLiveCall,
  type DemoJourneyManifest,
  type DemoJourneySnapshot,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"

const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel: "instagram",
}
const NOW = new Date("2026-10-19T08:00:00.000Z")

function start(manifest: DemoJourneyManifest): DemoJourneySnapshot {
  return createJourneySnapshot(manifest, identity, NOW)
}

/** The positions a prospect passes walking the story, by completing each step as it comes. */
function walk(manifest: DemoJourneyManifest, limit = 400): DemoJourneySnapshot[] {
  const positions: DemoJourneySnapshot[] = []
  let current = start(manifest)
  for (let guard = 0; guard < limit && current.state !== "COMPLETED"; guard += 1) {
    positions.push(current)
    const section = findSection(manifest, current.sectionId)
    const step = section?.steps.find((candidate) => candidate.id === current.stepId)
    if (!step) break
    const action = step.completion.kind === "transition"
      ? { type: "transition" as const, stepId: step.id, to: step.completion.to }
      : step.completion.kind === "outcome"
        ? { type: "outcome" as const, stepId: step.id, to: step.completion.to[0] }
        : step.completion.kind === "snapshot"
          ? { type: "ui" as const, path: step.completion.path, value: step.completion.equals }
          : { type: "complete-step" as const, stepId: step.id }
    let result = reduceJourney(current, action, manifest, NOW)
    if (!result.ok || (result.snapshot.stepId === current.stepId && result.snapshot.sectionId === current.sectionId)) {
      result = reduceJourney(current, { type: "complete-step", stepId: step.id }, manifest, NOW)
    }
    if (!result.ok || (result.snapshot.stepId === current.stepId && result.snapshot.sectionId === current.sectionId)) {
      // A module ends on «what next»: pick the next module the hub offers.
      const next = DEMO_JOURNEY_MODULES.map((module) => moduleFirstSectionId(manifest, module.id)).find((id) => id && !current.visitedSections.includes(id))
      if (!next) break
      result = reduceJourney(current, { type: "open-section", sectionId: next }, manifest, NOW)
      if (!result.ok) break
    }
    current = result.snapshot
  }
  return positions
}

describe("parseDemoAssistantAction", () => {
  it("takes exactly an action from the list and nothing else", () => {
    expect(parseDemoAssistantAction({ kind: "open_module", moduleId: "contracts" })).toEqual({ kind: "open_module", moduleId: "contracts" })
    expect(parseDemoAssistantAction({ kind: "point_step" })).toEqual({ kind: "point_step" })
    for (const junk of [
      null, undefined, "open_module", [], { kind: "open_module" }, { kind: "open_module", moduleId: "summary" },
      { kind: "open_module", moduleId: "contracts", sectionId: "ctr-sign" }, { kind: "point_step", stepId: "x" },
      { kind: "complete_step", stepId: "x" }, { kind: "open_module", moduleId: { toString: () => "contracts" } },
    ]) {
      expect(parseDemoAssistantAction(junk), JSON.stringify(junk) ?? String(junk)).toBeNull()
    }
  })
})

describe("what a request to go somewhere promises", () => {
  // «Lidləri göstərin» once went to Sales, which opens on the task board: the
  // leads are in the omnichannel part. A request may only name what the
  // module it opens actually shows.
  it("only the module that holds the lead card is promised for leads", () => {
    for (const [id, intent] of Object.entries(DEMO_NAVIGATION_INTENTS)) {
      const promised = intent.criteria.split("NOT")[0]
      const sections: readonly string[] = DEMO_JOURNEY_MODULES.find((module) => module.id === intent.moduleId)!.sections
      if (/\blead/i.test(promised)) expect(sections, id).toContain("lead-created")
    }
    expect(DEMO_NAVIGATION_INTENTS.open_deals.criteria).toMatch(/NOT leads/)
  })
})

describe("planAssistantAction", () => {
  it("opens a module at its own beginning from the welcome screen", () => {
    const snapshot = start(PROSPECT_TO_CLOSED_WON)
    expect(planAssistantAction({ kind: "open_module", moduleId: "contracts" }, snapshot, PROSPECT_TO_CLOSED_WON)).toEqual({
      kind: "open",
      sectionId: moduleFirstSectionId(PROSPECT_TO_CLOSED_WON, "contracts"),
      moduleTitle: "Müqavilələr",
    })
  })

  it("asked for the module the prospect is in, shows the current step instead of restarting it", () => {
    const snapshot = { ...start(PROSPECT_TO_CLOSED_WON), sectionId: "ctr-approve" }
    expect(planAssistantAction({ kind: "open_module", moduleId: "contracts" }, snapshot, PROSPECT_TO_CLOSED_WON)).toEqual({ kind: "point" })
  })

  it("never leaves the live call while it waits for its outcome", () => {
    const live = withLiveCall(PROSPECT_TO_CLOSED_WON)
    const waiting = walk(live).find((position) => {
      const section = findSection(live, position.sectionId)
      return section?.steps.some((step) => step.id === position.stepId && step.completion.kind === "outcome")
    })
    expect(waiting, "the walk reaches the live call").toBeDefined()
    expect(planAssistantAction({ kind: "open_module", moduleId: "contracts" }, waiting!, live)).toEqual({ kind: "refused", reason: "waits_for_call" })
  })

  it("never opens the story's own screens: every module's first section is a module's section", () => {
    for (const manifest of [PROSPECT_TO_CLOSED_WON, withLiveCall(PROSPECT_TO_CLOSED_WON)]) {
      for (const module of DEMO_JOURNEY_MODULES) {
        const first = moduleFirstSectionId(manifest, module.id)
        if (!first) continue
        expect(findSection(manifest, first)?.navGroup, `${module.id} → ${first}`).not.toBe("demo")
      }
    }
  })

  it("from every position a walk reaches, opening any module completes nothing, skips nothing and ends nothing", () => {
    for (const manifest of [PROSPECT_TO_CLOSED_WON, withLiveCall(PROSPECT_TO_CLOSED_WON)]) {
      const positions = walk(manifest)
      expect(positions.length).toBeGreaterThan(20)
      for (const position of positions) {
        for (const module of DEMO_JOURNEY_MODULES) {
          const plan = planAssistantAction({ kind: "open_module", moduleId: module.id }, position, manifest)
          if (!plan || plan.kind !== "open") continue
          const result = reduceJourney(position, { type: "open-section", sectionId: plan.sectionId }, manifest, NOW)
          expect(result.ok, `${position.sectionId} → ${module.id}`).toBe(true)
          if (!result.ok) continue
          const after = result.snapshot
          expect(after.state, `${position.sectionId} → ${module.id}`).not.toBe("COMPLETED")
          // Nothing done in the prospect's name: completed and skipped steps
          // grow only by what the jump stages, never by the module it opened.
          const opened = findSection(manifest, plan.sectionId)!
          for (const step of opened.steps) {
            expect(after.completedSteps.includes(step.id) && !position.completedSteps.includes(step.id), `${module.id}: ${step.id}`).toBe(false)
          }
          expect(after.ui["next.finish"]).not.toBe(true)
        }
      }
    }
  })
})
