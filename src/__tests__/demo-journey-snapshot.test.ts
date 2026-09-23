/**
 * Guided journey snapshot + reducer (Phase B).
 *
 * Drives the whole scenario through the reducer using only the manifest's
 * own completion rules, so any step whose rule cannot be satisfied by an
 * action fails here before a renderer is written for it. Also pins the
 * refusal rules: no completing an action step by viewing, no skipping a
 * required step, no effect applied twice, no resuming a foreign snapshot.
 */
import { describe, expect, it } from "vitest"
import { getLeadScoreFactorLabel } from "@/lib/leads/score-factor-labels"
import {
  DEMO_DEAL_STAGES,
  PROSPECT_TO_CLOSED_WON,
  activeSections,
  createJourneySnapshot,
  demoMoney,
  findStep,
  journeyProgress,
  parseSnapshot,
  quoteTotals,
  reachableRoutes,
  reduceJourney,
  sectionStatus,
  serializeSnapshot,
  type DemoJourneyAction,
  type DemoJourneySnapshot,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"

const manifest = PROSPECT_TO_CLOSED_WON
const NOW = new Date("2026-09-21T09:00:00.000Z")

const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel: "instagram",
}

/** The action the manifest's own completion rule asks for at this step. */
function actionFor(snapshot: DemoJourneySnapshot): DemoJourneyAction {
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
      return { type: "outcome", stepId: step.id, to: step.completion.to[0] }
  }
}

function driveTo(snapshot: DemoJourneySnapshot, stopBeforeStepId: string | null, clock = NOW): DemoJourneySnapshot {
  let current = snapshot
  let tick = 0
  for (let guard = 0; guard < 200; guard += 1) {
    if (current.state === "COMPLETED") break
    if (stopBeforeStepId && current.stepId === stopBeforeStepId) break
    const result = reduceJourney(current, actionFor(current), manifest, new Date(clock.getTime() + tick * 60_000))
    if (!result.ok) throw new Error(`${current.stepId}: ${result.error}`)
    current = result.snapshot
    tick += 1
  }
  return current
}

describe("Journey snapshot: creation", () => {
  const snapshot = createJourneySnapshot(manifest, identity, NOW)

  it("starts at the first step of the first section in STARTED", () => {
    expect(snapshot.state).toBe("STARTED")
    expect(snapshot.sectionId).toBe("orientation")
    expect(snapshot.stepId).toBe("orientation-sidebar")
    expect(snapshot.visitedSections).toEqual(["orientation"])
    expect(snapshot.completedAt).toBeNull()
  })

  it("seeds the prospect's own world without a lead yet", () => {
    expect(snapshot.records.campaign.channel).toBe("instagram")
    expect(snapshot.records.campaign.name).toContain("Instagram")
    expect(snapshot.records.conversation.contactName).toBe(identity.name)
    expect(snapshot.records.conversation.messages[0].text).toContain(identity.company)
    expect(snapshot.records.conversation.aiDraft?.text).toContain("Nigar")
    expect(snapshot.records.lead).toBeNull()
    expect(snapshot.records.deal).toBeNull()
  })

  it("keeps every section active in v1 (no capability-gated section is dropped)", () => {
    expect(activeSections(manifest).map((section) => section.id)).toEqual(manifest.sections.map((section) => section.id))
  })

  it("opens every section's route from the start: behind the story read-only, ahead of it by jumping", () => {
    // Owner, 2026-09-22: a prospect who came for one module need not walk the rest first.
    expect([...reachableRoutes(snapshot, manifest)].sort()).toEqual([...manifest.visibleRoutes].sort())
  })
})

describe("Journey snapshot: reducer rules", () => {
  const start = createJourneySnapshot(manifest, identity, NOW)

  it("refuses to close an action step by viewing it", () => {
    const atOpen = driveTo(start, "source-open-campaign")
    const result = reduceJourney(atOpen, { type: "complete-step", stepId: "source-open-campaign" }, manifest, NOW)
    expect(result.ok).toBe(false)
    expect(result.snapshot).toBe(atOpen)
  })

  it("refuses actions aimed at a step that is not the frontier", () => {
    const result = reduceJourney(start, { type: "complete-step", stepId: "orientation-guide" }, manifest, NOW)
    expect(result.ok).toBe(false)
  })

  it("refuses to skip a required step and allows skipping an optional one", () => {
    const required = reduceJourney(start, { type: "skip-step", stepId: "orientation-sidebar" }, manifest, NOW)
    expect(required.ok).toBe(false)
    const atStats = driveTo(start, "source-stats")
    const optional = reduceJourney(atStats, { type: "skip-step", stepId: "source-stats" }, manifest, NOW)
    expect(optional.ok).toBe(true)
    expect(optional.snapshot.skippedSteps).toEqual(["source-stats"])
    expect(optional.snapshot.stepId).toBe("source-open-campaign")
  })

  it("refuses a transition the step does not declare", () => {
    const atOpen = driveTo(start, "source-open-campaign")
    const wrong = reduceJourney(atOpen, { type: "transition", stepId: "source-open-campaign", to: "LEAD_CREATED" }, manifest, NOW)
    expect(wrong.ok).toBe(false)
    expect(wrong.snapshot.state).toBe("STARTED")
  })

  it("a ui change only closes the step whose snapshot rule it satisfies", () => {
    const atTimeline = driveTo(start, "lead-timeline")
    const other = reduceJourney(atTimeline, { type: "ui", path: "lead.activeTab", value: "details" }, manifest, NOW)
    expect(other.ok).toBe(true)
    expect(other.snapshot.stepId).toBe("lead-timeline")
    expect(other.snapshot.ui["lead.activeTab"]).toBe("details")
    const match = reduceJourney(other.snapshot, { type: "ui", path: "lead.activeTab", value: "timeline" }, manifest, NOW)
    expect(match.completedStep).toBe("lead-timeline")
    expect(match.snapshot.stepId).toBe("lead-sentiment-tasks")
  })

  it("expiry and revocation end the journey and block everything after", () => {
    const expired = reduceJourney(start, { type: "expire" }, manifest, NOW)
    expect(expired.snapshot.state).toBe("EXPIRED")
    expect(reduceJourney(expired.snapshot, { type: "complete-step", stepId: "orientation-sidebar" }, manifest, NOW).ok).toBe(false)
    expect(reduceJourney(expired.snapshot, { type: "revoke" }, manifest, NOW).ok).toBe(false)
  })
})

describe("Journey snapshot: the story end to end", () => {
  const start = createJourneySnapshot(manifest, identity, NOW)

  it("creates the lead from the prospect's own identity and the campaign source", () => {
    const afterLead = driveTo(start, "lead-details")
    expect(afterLead.state).toBe("LEAD_CREATED")
    const lead = afterLead.records.lead!
    expect(lead.contactName).toBe(identity.name)
    expect(lead.companyName).toBe(identity.company)
    expect(lead.jobTitle).toBe(identity.jobTitle)
    expect(lead.email).toBe(identity.emailMasked)
    expect(lead.source).toBe("instagram")
    expect(lead.status).toBe("new")
    expect(lead.timeline.map((entry) => entry.kind)).toEqual(["message", "email", "activity"])
    expect(afterLead.records.conversation.messages.some((message) => message.ai && message.delivery === "simulated")).toBe(true)
    expect(afterLead.records.conversation.aiDraft).toBeNull()
  })

  it("qualifies the lead, calls from the card and creates exactly one task", () => {
    const afterTask = driveTo(start, "task-detail")
    expect(afterTask.state).toBe("TASK_CREATED")
    expect(afterTask.records.lead?.status).toBe("qualified")
    // The call pressed from the card leaves the same pair of records a real
    // one leaves — the card, not the record, is where the open demo says the
    // call was simulated.
    expect(afterTask.records.lead?.timeline.some((entry) => entry.id === "tl-call")).toBe(true)
    expect(afterTask.records.lead?.activities.some((entry) => entry.id === "act-call")).toBe(true)
    expect(afterTask.records.task?.relatedLeadId).toBe("lead-demo-1")
    expect(afterTask.records.task?.assigneeName).toBeTruthy()
  })

  it("carries one amount from the accepted quote onwards — deal, card and summary agree", () => {
    // The screens used to disagree at the finish: the deal held the 4,800
    // estimate, the quote 4,814.40 and the summary a rounded 4,814. The
    // acceptance is where they are made one number.
    const afterAccept = driveTo(start, "closed-won-move")
    const gross = quoteTotals(afterAccept.records.quote!).gross
    expect(afterAccept.records.quote?.status).toBe("accepted")
    expect(afterAccept.records.deal?.amount).toBe(gross)
    expect(afterAccept.records.lead?.timeline.some((entry) => entry.id === "tl-quote-accepted")).toBe(true)
    expect(demoMoney(gross)).toBe("4,814.40 ₼")
    // A whole sum keeps no qəpik, so the story does not print 4,800.00.
    expect(demoMoney(4_800)).toBe("4,800 ₼")
  })

  it("scores the lead with the product's own factors, so the screen reads them in Azerbaijani", () => {
    const afterLead = driveTo(start, "lead-details")
    const factors = Object.keys(afterLead.records.lead!.scoreDetails.factors)
    expect(factors.length).toBeGreaterThan(0)
    for (const key of factors) {
      // Anything the product cannot name falls back to a humanised English
      // word — which is how «Engagement / Fit / Intent» reached a demo that
      // sells Azerbaijani AI.
      expect(getLeadScoreFactorLabel(key, (translationKey) => translationKey), key).not.toBe(key)
    }
  })

  it("reaches closed won with the deal amount taken from the accepted quote", () => {
    const done = driveTo(start, null)
    expect(done.state).toBe("COMPLETED")
    expect(done.completedAt).not.toBeNull()
    expect(done.records.lead?.status).toBe("converted")
    expect(done.records.deal?.wonAt).not.toBeNull()
    expect(done.records.deal?.stageIndex).toBe(DEMO_DEAL_STAGES.length - 1)
    expect(done.records.quote?.status).toBe("accepted")
    expect(done.records.deal?.amount).toBe(quoteTotals(done.records.quote!).gross)
    const progress = journeyProgress(done, manifest)
    expect(progress.requiredDone).toBe(progress.requiredTotal)
    expect(progress.sectionsDone).toBe(progress.sectionsTotal)
    expect(sectionStatus(done, manifest, "source")).toBe("done")
    expect([...reachableRoutes(done, manifest)].sort()).toEqual(["/boards", "/campaigns", "/deals", "/inbox", "/leads", "/quotes"])
  })

  it("never applies an effect twice: replaying a transition on the same records is a no-op", () => {
    const atQualify = driveTo(start, "lead-status-advance")
    const once = reduceJourney(atQualify, actionFor(atQualify), manifest, NOW)
    expect(once.ok).toBe(true)
    const timelineLength = once.snapshot.records.lead!.timeline.length
    // A second application is refused by the frontier rule, records untouched.
    const twice = reduceJourney(once.snapshot, { type: "transition", stepId: "lead-status-advance", to: "LEAD_QUALIFIED" }, manifest, NOW)
    expect(twice.ok).toBe(false)
    expect(twice.snapshot.records.lead!.timeline.length).toBe(timelineLength)
  })

  it("completes every step of every section with only the declared rules", () => {
    const done = driveTo(start, null)
    const allRequired = manifest.sections.flatMap((section) => section.steps.filter((step) => step.required).map((step) => step.id))
    for (const id of allRequired) expect(done.completedSteps, id).toContain(id)
  })
})

describe("Journey snapshot: persistence", () => {
  const start = createJourneySnapshot(manifest, identity, NOW)

  it("round-trips through serialization", () => {
    const mid = driveTo(start, "lead-scoring")
    const restored = parseSnapshot(serializeSnapshot(mid), manifest)
    expect(restored).toEqual(mid)
  })

  it("discards snapshots from another scenario, version or unknown state", () => {
    expect(parseSnapshot(null, manifest)).toBeNull()
    expect(parseSnapshot("not json", manifest)).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...start, scenarioId: "other" }), manifest)).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...start, scenarioVersion: 99 }), manifest)).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...start, state: "HACKED" }), manifest)).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...start, stepId: "no-such-step" }), manifest)).toBeNull()
  })
})
