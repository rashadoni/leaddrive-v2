/**
 * Opening any section at once (owner, 2026-09-22: «если клиент сразу
 * интересуется, например, омни-каналом, зачем ему обязательно переходить по
 * всем разделам?»). A jump stages what the sections in between would have
 * produced, so the section opens on the data it expects; it never opens the
 * story's own shell and never skips a real call. Since 2026-10-13 a section
 * behind the story opens too — with its guide, from its beginning.
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

/**
 * Owner, 2026-10-13, after walking his own demo: «для клиента должны быть
 * открыты модули; переходя по модулю, начинается гид». He had jumped from
 * the campaigns to the boards; the inbox, the AI reply and the AI call then
 * only opened «prepared, read-only», and the demo still told him it was
 * complete at 15 of 27 steps.
 */
describe("a module behind the story opens with its guide", () => {
  /** Drives the story until `stepId` is the step in hand. */
  const driveTo = (snapshot: DemoJourneySnapshot, stepId: string, m: DemoJourneyManifest = manifest) => {
    let current = snapshot
    for (let guard = 0; guard < 200 && current.stepId !== stepId; guard += 1) {
      const result = reduceJourney(current, actionFor(current, m), m, NOW)
      if (!result.ok) throw new Error(`${current.stepId}: ${result.error}`)
      current = result.snapshot
    }
    return current
  }

  it("starts over from the module's first step, on the data it begins with", () => {
    const atDeal = jump(start(), "deal").snapshot
    expect(atDeal.records.lead).not.toBeNull()

    const back = jump(atDeal, "conversation")
    expect(back.ok).toBe(true)
    expect(back.snapshot).toMatchObject({ sectionId: "conversation", stepId: "conversation-views", state: "SOURCE_SEEN" })
    // The inbox as it is before anyone answered: the request is there, the lead is not yet.
    expect(back.snapshot.records.conversation.messages.length).toBeGreaterThan(0)
    expect(back.snapshot.records.lead).toBeNull()
    expect(back.snapshot.records.deal).toBeNull()
    // …and its steps are the prospect's to do: the first one completes like any other.
    expect(reduceJourney(back.snapshot, actionFor(back.snapshot), manifest, NOW).ok).toBe(true)
  })

  it("can be opened again after it was walked — the guide starts from the beginning", () => {
    const walked = driveTo(start(), "ai-reply-draft")
    expect(sectionStatus(walked, manifest, "conversation")).toBe("done")
    const again = jump(walked, "conversation").snapshot
    expect(again).toMatchObject({ sectionId: "conversation", stepId: "conversation-views" })
    // What was walked stays walked: the menu's tick does not disappear.
    expect(sectionStatus(again, manifest, "source")).toBe("done")
    expect(again.completedSteps).toEqual(walked.completedSteps)
  })

  it("then goes on to what was not seen, not through what was", () => {
    // Jumped to the deals and walked them; the quote is next and unseen.
    const dealsWalked = driveTo(jump(start(), "deal").snapshot, "quote-create")
    // Back to the campaigns — the first module, never walked.
    const campaigns = jump(dealsWalked, "source").snapshot
    const afterCampaigns = driveTo(campaigns, "conversation-views")
    expect(afterCampaigns.sectionId).toBe("conversation")
    // …and when the guide reaches the deals again it does not walk them twice.
    const afterTask = driveTo(afterCampaigns, "quote-create")
    expect(afterTask.completedSteps.filter((id) => id === "deal-convert")).toHaveLength(1)
    expect(sectionStatus(afterTask, manifest, "deal")).toBe("done")
    expect(afterTask.records.deal, "the quote opens on its deal, staged for it").not.toBeNull()
  })

  it("keeps how the call really ended instead of rebuilding it as «no call»", () => {
    const afterCall = driveTo(start(), "task-boards")
    const answered = afterCall.records.lead!.timeline.find((entry) => entry.id === "tl-call")!.title
    const dealAgain = jump(driveTo(afterCall, "quote-create"), "deal").snapshot
    expect(dealAgain.records.lead!.timeline.find((entry) => entry.id === "tl-call")?.title).toBe(answered)
  })

  it("is still refused while the real call waits for its outcome", () => {
    const live = withLiveCall(manifest)
    const atCall = jump(start(live), "deal", live).snapshot
    expect(atCall.sectionId).toBe("ai-call")
    expect(jump(atCall, "conversation", live).ok).toBe(false)
  })
})

describe("what a jump refuses", () => {

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

describe("what is reported when the guide skips modules already walked", () => {
  it("files the prospect's own step, never the states that were staged past", () => {
    // Deals walked after a jump, then the campaigns opened from behind: their
    // last step lands the story on the next module not seen yet.
    let current = jump(start(), "deal").snapshot
    const drive = (until: (snapshot: DemoJourneySnapshot) => boolean) => {
      for (let guard = 0; guard < 200 && !until(current); guard += 1) current = reduceJourney(current, actionFor(current), manifest, NOW).snapshot
    }
    drive((snapshot) => snapshot.sectionId === "summary")
    current = jump(current, "conversation").snapshot
    drive((snapshot) => snapshot.sectionId === "ai-reply")
    // Walk the two inbox chapters and the lead chapters up to the last step before the walked deals.
    drive((snapshot) => snapshot.stepId === "task-reports")
    const before = current
    const result = reduceJourney(before, actionFor(before), manifest, NOW)
    expect(result.snapshot.sectionId, "past the walked deals, quote and win").toBe("summary")
    expect(result.snapshot.state).not.toBe(before.state)

    const reports = journeyReportsBetween(before, result.snapshot, { moved: result.transitioned ?? null })
    expect(reports.map((report) => report.name)).toEqual(["journey.step_completed", "journey.section_opened"])
    // …and each of them is one the server accepts.
    for (const report of reports) expect(acceptJourneyReport(manifest, report).ok, report.name).toBe(true)
  })
})
