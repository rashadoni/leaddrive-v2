/**
 * Opening any section at once (owner, 2026-09-22: «если клиент сразу
 * интересуется, например, омни-каналом, зачем ему обязательно переходить по
 * всем разделам?»). A jump stages what the sections in between would have
 * produced, so the section opens on the data it expects; it never goes
 * backwards, never opens the story's own shell, never skips a real call.
 */
import { describe, expect, it } from "vitest"
import {
  PROSPECT_TO_CLOSED_WON,
  acceptJourneyReport,
  createJourneySnapshot,
  findStep,
  journeyProgress,
  journeyReportsBetween,
  reduceJourney,
  sectionJumpTarget,
  sectionStatus,
  summarizeJourney,
  withLiveCall,
  type DemoJourneyAction,
  type DemoJourneyManifest,
  type DemoJourneySnapshot,
  type DemoProspectIdentity,
} from "@/lib/demo-center/journey"

const manifest = PROSPECT_TO_CLOSED_WON
const NOW = new Date("2026-09-22T09:00:00.000Z")
const identity: DemoProspectIdentity = {
  name: "Nigar Əliyeva",
  company: "Xəzər Logistika MMC",
  jobTitle: "Satış direktoru",
  emailMasked: "n***@xezerlog.az",
  phoneMasked: "+994 ** *** 45 67",
  sourceChannel: "instagram",
}

const start = (m: DemoJourneyManifest = manifest) => createJourneySnapshot(m, identity, NOW)
const jump = (snapshot: DemoJourneySnapshot, sectionId: string, m: DemoJourneyManifest = manifest) =>
  reduceJourney(snapshot, { type: "open-section", sectionId }, m, NOW)

function actionFor(snapshot: DemoJourneySnapshot, m: DemoJourneyManifest = manifest): DemoJourneyAction {
  const { step } = findStep(m, snapshot.stepId)!
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

function driveToEnd(snapshot: DemoJourneySnapshot, m: DemoJourneyManifest = manifest): DemoJourneySnapshot {
  let current = snapshot
  for (let guard = 0; guard < 200 && current.state !== "COMPLETED"; guard += 1) {
    const result = reduceJourney(current, actionFor(current, m), m, NOW)
    if (!result.ok) throw new Error(`${current.stepId}: ${result.error}`)
    current = result.snapshot
  }
  return current
}

describe("opening a section ahead of the story", () => {
  it("lands an Omni-channel prospect straight in the inbox, on its first step", () => {
    const result = jump(start(), "conversation")
    expect(result.ok).toBe(true)
    expect(result.snapshot).toMatchObject({ sectionId: "conversation", stepId: "conversation-views", state: "SOURCE_SEEN" })
    expect(result.transitioned).toBe("SOURCE_SEEN")
    expect(result.snapshot.visitedSections).toContain("conversation")
    // Nothing was done in their name: no step counts as completed.
    expect(result.snapshot.completedSteps).toEqual([])
  })

  it("stages the records the section expects — a board opens on a real lead, not an empty screen", () => {
    const { snapshot } = jump(start(), "task")
    expect(snapshot.state).toBe("CALL_SKIPPED")
    expect(snapshot.records.lead).not.toBeNull()
    expect(snapshot.records.lead?.status).toBe("qualified")
    // The AI reply the lead's timeline quotes was staged too.
    expect(snapshot.records.conversation.messages.some((message) => message.direction === "outbound")).toBe(true)
    expect(snapshot.records.task).toBeNull()
  })

  it("stages records between the story's last move and now, so the lead's history still reads in order", () => {
    // The prospect opened their own card a moment ago, then jumps to the deals.
    let snapshot = jump(start(), "lead-created").snapshot
    const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)
    for (let guard = 0; snapshot.stepId !== "lead-details"; guard += 1) {
      snapshot = reduceJourney(snapshot, actionFor(snapshot), manifest, later(5)).snapshot
      if (guard > 10) throw new Error("did not open the card")
    }
    const { snapshot: jumped } = reduceJourney(snapshot, { type: "open-section", sectionId: "deal" }, manifest, later(35))
    const lead = jumped.records.lead!
    const dates = lead.timeline.map((entry) => Date.parse(entry.date))
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
    expect(Math.max(...dates)).toBeLessThanOrEqual(later(35).getTime())
    expect(Math.min(...dates.slice(-2))).toBeGreaterThanOrEqual(later(5).getTime())
  })

  it("lets the story carry on from there to the end with the ordinary rules", () => {
    for (const sectionId of ["conversation", "lead-created", "task", "deal", "quote", "closed-won"]) {
      const { snapshot } = jump(start(), sectionId)
      expect(driveToEnd(snapshot).state, sectionId).toBe("COMPLETED")
    }
  })

  it("jumps from the middle too, including into the section whose entry is the current state", () => {
    let snapshot = start()
    for (let guard = 0; snapshot.stepId !== "conversation-contact"; guard += 1) {
      snapshot = reduceJourney(snapshot, actionFor(snapshot), manifest, NOW).snapshot
      if (guard > 50) throw new Error("did not reach conversation-contact")
    }
    expect(snapshot.state).toBe("CONVERSATION_OPENED")
    const result = jump(snapshot, "ai-reply")
    expect(result.ok).toBe(true)
    expect(result.snapshot).toMatchObject({ sectionId: "ai-reply", state: "CONVERSATION_OPENED" })
    expect(result.transitioned).toBeUndefined()
  })
})

describe("what a jump refuses", () => {
  it("never goes backwards: behind the story a section only opens read-only", () => {
    const { snapshot } = jump(start(), "deal")
    expect(jump(snapshot, "conversation").ok).toBe(false)
    expect(jump(snapshot, "deal").ok).toBe(false)
  })

  it("never opens the story's own shell — the summary comes at the end", () => {
    expect(jump(start(), "summary").ok).toBe(false)
    expect(jump(start(), "orientation").ok).toBe(false)
    expect(jump(start(), "no-such-section").ok).toBe(false)
  })

  it("stops at the real AI call instead of skipping it, and does not let a second click past it", () => {
    const live = withLiveCall(manifest)
    expect(sectionJumpTarget(start(live), live, "deal")).toMatchObject({ ok: true, section: { id: "ai-call" } })
    const stopped = jump(start(live), "deal", live).snapshot
    expect(stopped).toMatchObject({ sectionId: "ai-call", state: "LEAD_QUALIFIED" })
    // While the call step waits — before the call, or while the phone rings
    // (the snapshot does not show that) — nothing jumps away from it.
    for (const sectionId of ["task", "deal", "quote"]) {
      const again = jump(stopped, sectionId, live)
      expect(again.ok, sectionId).toBe(false)
      expect(again.snapshot).toBe(stopped)
    }
    expect(stopped.records.lead?.timeline.some((entry) => entry.id === "tl-call")).toBe(false)
  })

  it("lets the story move on once the call step has its outcome", () => {
    const live = withLiveCall(manifest)
    const stopped = jump(start(live), "deal", live).snapshot
    const atCall = reduceJourney(stopped, { type: "complete-step", stepId: "ai-call-consent-control" }, live, NOW).snapshot
    expect(atCall.stepId).toBe("ai-call-live")
    const declined = reduceJourney(atCall, { type: "outcome", stepId: "ai-call-live", to: "CALL_DECLINED" }, live, NOW)
    expect(declined.ok).toBe(true)
    const onward = jump(declined.snapshot, "deal", live)
    expect(onward.ok).toBe(true)
    expect(onward.snapshot.sectionId).toBe("deal")
  })

  it("without a live call, the call step is just passed on the way", () => {
    const { snapshot } = jump(start(), "task")
    expect(snapshot.state).toBe("CALL_SKIPPED")
  })
})

describe("progress after a jump", () => {
  it("counts only sections the prospect walked; the ones jumped over are «passed», not done", () => {
    const { snapshot } = jump(start(), "task")
    expect(sectionStatus(snapshot, manifest, "task")).toBe("current")
    expect(sectionStatus(snapshot, manifest, "lead-created")).toBe("passed")
    expect(sectionStatus(snapshot, manifest, "deal")).toBe("upcoming")
    expect(journeyProgress(snapshot, manifest).sectionsDone).toBe(0)
  })
})

describe("what the admin hears about a jump", () => {
  it("does not count jumped-over sections as walked", () => {
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
    const summary = summarizeJourney(manifest, [
      { eventType: "journey.section_opened", stepId: null, metadata: { sectionId: "closed-won" }, occurredAt: at(1) },
      { eventType: "journey.step_completed", stepId: "closed-won-move", metadata: { sectionId: "closed-won" }, occurredAt: at(2) },
    ])
    expect(summary.sectionsReached).toBe(1)
    expect(summary.furthestSectionId).toBe("closed-won")
  })

  it("only that the section was opened — the staged states were not walked", () => {
    const before = start()
    const { snapshot: after } = jump(before, "conversation")
    const reports = journeyReportsBetween(before, after, { jumped: true })
    expect(reports).toEqual([{ eventType: "JOURNEY", name: "journey.section_opened", sectionId: "conversation" }])
    expect(acceptJourneyReport(manifest, reports[0]).ok).toBe(true)
  })
})
