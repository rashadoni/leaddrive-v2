/**
 * The call section for a grant with a real AI call (owner decision 2026-09-21).
 *
 * The story must record what happened on the line — answered, missed, busy,
 * refused, uncertain, or declined — reached along legal transitions, and the
 * ordinary scenario must be untouched. Both variants are validated and driven
 * end to end through the reducer.
 */
import { describe, expect, it } from "vitest"
import {
  DEMO_LIVE_CALL_OUTCOMES,
  DEMO_LIVE_CALL_STEP_ID,
  PROSPECT_TO_CLOSED_WON,
  createJourneySnapshot,
  findStep,
  journeyPath,
  reduceJourney,
  validateJourneyManifest,
  withLiveCall,
  type DemoJourneyAction,
  type DemoJourneyManifest,
  type DemoJourneySnapshot,
  type DemoJourneyState,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"

const NOW = new Date("2026-09-21T09:00:00.000Z")
const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel: "instagram",
}
const live = withLiveCall(PROSPECT_TO_CLOSED_WON)

function actionFor(manifest: DemoJourneyManifest, snapshot: DemoJourneySnapshot, outcome: DemoJourneyState): DemoJourneyAction {
  const located = findStep(manifest, snapshot.stepId)
  if (!located) throw new Error(`unknown step ${snapshot.stepId}`)
  const { step } = located
  switch (step.completion.kind) {
    case "viewed":
      return { type: "complete-step", stepId: step.id }
    case "snapshot":
      return { type: "ui", path: step.completion.path, value: step.completion.equals }
    case "transition":
      return { type: "transition", stepId: step.id, to: step.completion.to }
    case "outcome":
      return { type: "outcome", stepId: step.id, to: outcome }
  }
}

function drive(manifest: DemoJourneyManifest, outcome: DemoJourneyState, stopAt?: string): DemoJourneySnapshot {
  let current = createJourneySnapshot(manifest, identity, NOW)
  for (let guard = 0; guard < 200 && current.state !== "COMPLETED"; guard += 1) {
    if (stopAt && current.stepId === stopAt) break
    const result = reduceJourney(current, actionFor(manifest, current, outcome), manifest, new Date(NOW.getTime() + guard * 60_000))
    if (!result.ok) throw new Error(`${current.stepId}: ${result.error}`)
    current = result.snapshot
  }
  return current
}

describe("journeyPath", () => {
  it("walks through the states the world goes through", () => {
    expect(journeyPath("LEAD_QUALIFIED", "CALL_NO_ANSWER")).toEqual(["CALL_QUEUED", "CALLING", "CALL_NO_ANSWER"])
    expect(journeyPath("LEAD_QUALIFIED", "CALL_DECLINED")).toEqual(["CALL_DECLINED"])
    expect(journeyPath("LEAD_QUALIFIED", "CALL_ATTENTION_REQUIRED")).toEqual(["CALL_QUEUED", "CALL_ATTENTION_REQUIRED"])
  })

  it("finds nothing where the transitions do not connect", () => {
    expect(journeyPath("CALL_NO_ANSWER", "CALLING")).toBeNull()
    expect(journeyPath("LEAD_QUALIFIED", "LEAD_QUALIFIED")).toBeNull()
  })
})

describe("the live-call variant", () => {
  it("is a valid scenario, and so is the ordinary one it came from", () => {
    expect(validateJourneyManifest(live)).toEqual([])
    expect(validateJourneyManifest(PROSPECT_TO_CLOSED_WON)).toEqual([])
  })

  it("replaces only the call section", () => {
    const changed = live.sections.filter((section, index) => section !== PROSPECT_TO_CLOSED_WON.sections[index])
    expect(changed.map((section) => section.id)).toEqual(["ai-call"])
    expect(live.capabilities.liveCall).toBe(true)
    expect(PROSPECT_TO_CLOSED_WON.capabilities.liveCall).toBe(false)
  })

  it("leaves the ordinary scenario with the simulated call from the card", () => {
    const section = PROSPECT_TO_CLOSED_WON.sections.find((candidate) => candidate.id === "ai-call")!
    expect(section.exitStates).toEqual(["CALL_RESULT_RECORDED"])
    expect(section.steps.map((step) => step.id)).toEqual(["ai-call-consent-control", "ai-call-from-card"])
  })

  it.each(DEMO_LIVE_CALL_OUTCOMES)("records %s and carries the story on to the end", (outcome) => {
    const atCall = drive(live, outcome, DEMO_LIVE_CALL_STEP_ID)
    expect(atCall.state).toBe("LEAD_QUALIFIED")

    const result = reduceJourney(atCall, { type: "outcome", stepId: DEMO_LIVE_CALL_STEP_ID, to: outcome }, live, NOW)
    expect(result.ok).toBe(true)
    expect(result.snapshot.state).toBe(outcome)
    expect(result.snapshot.completedSteps).toContain(DEMO_LIVE_CALL_STEP_ID)
    expect(result.snapshot.sectionId).toBe("ai-call-result")

    expect(drive(live, outcome).state).toBe("COMPLETED")
  })

  it("does not accept an ending the step does not list", () => {
    const atCall = drive(live, "CALL_RESULT_RECORDED", DEMO_LIVE_CALL_STEP_ID)
    const skipped = reduceJourney(atCall, { type: "outcome", stepId: DEMO_LIVE_CALL_STEP_ID, to: "CALL_SKIPPED" }, live, NOW)
    expect(skipped.ok).toBe(false)
  })

  it("cannot be closed by the renderer as a plain transition", () => {
    const atCall = drive(live, "CALL_RESULT_RECORDED", DEMO_LIVE_CALL_STEP_ID)
    const forced = reduceJourney(atCall, { type: "transition", stepId: DEMO_LIVE_CALL_STEP_ID, to: "CALL_QUEUED" }, live, NOW)
    expect(forced.ok).toBe(false)
  })
})

describe("the validator guards outcome steps", () => {
  function withCallSteps(mutate: (manifest: DemoJourneyManifest) => DemoJourneyManifest) {
    return validateJourneyManifest(mutate(live)).join("\n")
  }

  it("requires every outcome to end the section", () => {
    const problems = withCallSteps((manifest) => ({
      ...manifest,
      sections: manifest.sections.map((section) =>
        section.id === "ai-call" ? { ...section, exitStates: ["CALL_RESULT_RECORDED"] } : section),
    }))
    expect(problems).toMatch(/outcome CALL_NO_ANSWER does not end the section/)
  })

  it("requires the outcome step to be the section's last", () => {
    const problems = withCallSteps((manifest) => ({
      ...manifest,
      sections: manifest.sections.map((section) =>
        section.id === "ai-call" ? { ...section, steps: [...section.steps].reverse() } : section),
    }))
    expect(problems).toMatch(/an outcome step must be the last in its section/)
  })
})

describe("the live call's words", () => {
  it("never mention SMS: the demo's code comes only through Telegram (owner, 2026-09-22)", () => {
    const section = withLiveCall(PROSPECT_TO_CLOSED_WON).sections.find((candidate) => candidate.id === "ai-call")!
    const words = [section.title, section.summary, ...section.steps.flatMap((step) => [step.title, step.instruction, step.fallback ?? "", step.targetLabel ?? "", step.result ?? ""])]
    expect(words.filter((text) => /SMS/i.test(text))).toEqual([])
  })
})
