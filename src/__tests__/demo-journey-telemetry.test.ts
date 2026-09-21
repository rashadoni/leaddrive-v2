/**
 * A granted story reports its progress to the server (journey/telemetry.ts).
 *
 * The strongest check here walks the whole scenario through the real
 * reducer and asserts that every report the browser would send is one the
 * server accepts — the two sides read the same manifest, so a report the
 * server refuses is a progress bar that silently stops moving.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    demoGrant: { findUnique: vi.fn(), updateMany: vi.fn() },
    demoAccessEvent: { create: vi.fn(), count: vi.fn() },
  },
}))

import { POST as recordDemoEvent } from "@/app/api/v1/public/demo-access/[token]/events/route"
import { prisma } from "@/lib/prisma"
import { demoSessionCookieName, issueBrowserCredential } from "@/lib/demo-center/security"
import {
  JOURNEY_EVENTS_PER_GRANT,
  PROSPECT_TO_CLOSED_WON,
  acceptJourneyReport,
  activeSections,
  createJourneySnapshot,
  findStep,
  journeyReportsBetween,
  reduceJourney,
  summarizeJourney,
  withLiveCall,
  type DemoJourneyAction,
  type DemoJourneyManifest,
  type DemoJourneyReport,
  type DemoJourneySnapshot,
  type DemoProspectIdentity,
  type JourneyEventRow,
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

function actionFor(snapshot: DemoJourneySnapshot, story: DemoJourneyManifest): DemoJourneyAction {
  const located = findStep(story, snapshot.stepId)
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

/** Every report the browser sends while the story is walked to its end. */
function walkReports(story: DemoJourneyManifest = manifest): DemoJourneyReport[] {
  let current = createJourneySnapshot(story, identity, NOW)
  const reports: DemoJourneyReport[] = []
  for (let guard = 0; guard < 200 && !current.completedAt; guard += 1) {
    const result = reduceJourney(current, actionFor(current, story), story, new Date(NOW.getTime() + guard * 1000))
    if (!result.ok) throw new Error(`stuck at ${current.stepId}: ${result.error}`)
    reports.push(...journeyReportsBetween(current, result.snapshot))
    current = result.snapshot
  }
  return reports
}

describe("journey reports", () => {
  const reports = walkReports()

  it("the whole story produces reports the server accepts, every one of them", () => {
    expect(reports.length).toBeGreaterThan(20)
    for (const report of reports) {
      const checked = acceptJourneyReport(manifest, report)
      expect(checked.ok, `${report.name} ${report.sectionId} ${report.stepId ?? report.to ?? ""}`).toBe(true)
    }
  })

  it("a story with the live call reports only what the server accepts too", () => {
    const live = withLiveCall(manifest)
    const liveReports = walkReports(live)
    expect(liveReports.some((report) => report.stepId === "ai-call-live" || report.sectionId === "ai-call")).toBe(true)
    for (const report of liveReports) {
      expect(acceptJourneyReport(live, report).ok, `${report.name} ${report.sectionId} ${report.stepId ?? report.to ?? ""}`).toBe(true)
    }
  })

  it("reports each section opening, the state it reached and the end of the story", () => {
    const opened = reports.filter((report) => report.name === "journey.section_opened").map((report) => report.sectionId)
    expect(opened).toEqual(activeSections(manifest).slice(1).map((section) => section.id))
    expect(reports.filter((report) => report.name === "journey.transition").map((report) => report.to)).toContain("CLOSED_WON")
    expect(reports.filter((report) => report.name === "journey.completed")).toHaveLength(1)
  })

  it("refuses names the grant's scenario does not have", () => {
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "journey.section_opened", sectionId: "nowhere" }).ok).toBe(false)
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "journey.step_completed", sectionId: "source", stepId: "task-open" }).ok).toBe(false)
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "journey.transition", sectionId: "source", to: "CLOSED_WON" }).ok).toBe(false)
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "journey.completed", sectionId: "source" }).ok).toBe(false)
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "journey.step_skipped", sectionId: "orientation", stepId: "orientation-sidebar" }).ok).toBe(false)
  })

  it("ties a clip report to the clip the section really plays", () => {
    const withClip = activeSections(manifest).find((section) => section.intro?.status === "available")!
    const without = activeSections(manifest).find((section) => !section.intro)!
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "video.started", sectionId: withClip.id }))
      .toEqual({ ok: true, stepId: null, metadata: { sectionId: withClip.id, slug: withClip.intro!.slug } })
    expect(acceptJourneyReport(manifest, { eventType: "JOURNEY", name: "video.started", sectionId: without.id }).ok).toBe(false)
  })

  it("accepts the live call's outcomes only for a grant that has the call", () => {
    const outcome: DemoJourneyReport = { eventType: "JOURNEY", name: "journey.transition", sectionId: "ai-call", to: "CALL_NO_ANSWER" }
    expect(acceptJourneyReport(manifest, outcome).ok).toBe(false)
    expect(acceptJourneyReport(withLiveCall(manifest), outcome).ok).toBe(true)
  })

  it("summarises a finished story as finished, and a stopped one where it stopped", () => {
    const rows: JourneyEventRow[] = reports.map((report, index) => {
      const checked = acceptJourneyReport(manifest, report)
      if (!checked.ok) throw new Error(checked.reason)
      return { eventType: report.name, stepId: checked.stepId, metadata: checked.metadata, occurredAt: new Date(NOW.getTime() + index * 1000) }
    })
    const done = summarizeJourney(manifest, rows)
    expect(done).toMatchObject({ completed: true, sectionsReached: done.sectionsTotal, lastState: "COMPLETED" })
    expect(done.stepsDone).toBe(done.stepsRequired)

    const stopped = summarizeJourney(manifest, rows.slice(0, rows.findIndex((row) => row.eventType === "journey.section_opened" && (row.metadata as { sectionId: string }).sectionId === "lead-created") + 1))
    expect(stopped).toMatchObject({ completed: false, furthestSectionId: "lead-created" })
    expect(stopped.stepsDone).toBeLessThan(stopped.stepsRequired)
  })

  it("counts a clip as watched only when it played to the end", () => {
    const clipSection = activeSections(manifest).find((section) => section.intro?.status === "available")!
    const slug = clipSection.intro!.slug
    const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)
    const summary = summarizeJourney(manifest, [
      { eventType: "video.started", stepId: null, metadata: { sectionId: clipSection.id, slug }, occurredAt: at(1) },
    ])
    expect(summary.clipsStarted).toEqual([slug])
    expect(summary.clipsCompleted).toEqual([])
  })
})

describe("the events route takes journey reports", () => {
  const TOKEN = "b".repeat(64)
  const FUTURE = new Date("2099-09-19T14:00:00.000Z")
  const session = issueBrowserCredential()

  function grant(overrides: Record<string, unknown> = {}) {
    return {
      id: "grant-j",
      requestId: "request-j",
      status: "ACTIVE",
      linkExpiresAt: FUTURE,
      sessionStartedAt: new Date(),
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: FUTURE,
      inactivityMinutes: 30,
      sessionHash: session.credentialHash,
      moduleIds: ["crm", "sales"],
      scenarioId: PROSPECT_TO_CLOSED_WON.scenarioId,
      liveCallEnabled: false,
      ...overrides,
    }
  }

  function post(body: unknown) {
    return recordDemoEvent(
      new NextRequest(new URL(`/api/v1/public/demo-access/${TOKEN}/events`, "http://localhost:3000"), {
        method: "POST",
        headers: { Cookie: `${demoSessionCookieName(TOKEN)}=${session.credential}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const run = callback as unknown as (client: typeof prisma) => Promise<unknown>
      return await run(prisma) as never
    })
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant() as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.count).mockResolvedValue(3)
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-j" } as never)
  })

  it("stores a move of the story and refreshes the idle clock", async () => {
    const response = await post({ eventType: "JOURNEY", name: "journey.step_completed", sectionId: "source", stepId: "source-open-campaign" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, idleExpiresAt: expect.any(String) })
    expect(prisma.demoGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { sessionLastSeenAt: expect.any(Date) } }))
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: { grantId: "grant-j", eventType: "journey.step_completed", stepId: "source-open-campaign", metadata: { sectionId: "source" } },
    })
  })

  it("keeps an activity ping out of the timeline", async () => {
    const response = await post({ eventType: "JOURNEY", name: "journey.step_viewed", sectionId: "source" })
    expect(response.status).toBe(200)
    expect(prisma.demoGrant.updateMany).toHaveBeenCalled()
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })

  it("refuses a step that is not in the grant's scenario", async () => {
    const response = await post({ eventType: "JOURNEY", name: "journey.step_completed", sectionId: "source", stepId: "made-up" })
    expect(response.status).toBe(400)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })

  it("refuses a journey report from a grant that is not a story", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ scenarioId: null }) as never)
    const response = await post({ eventType: "JOURNEY", name: "journey.section_opened", sectionId: "source" })
    expect(response.status).toBe(400)
    expect(prisma.demoGrant.updateMany).not.toHaveBeenCalled()
  })

  it("refuses without this browser's session", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(grant({ sessionHash: "someone-else" }) as never)
    const response = await post({ eventType: "JOURNEY", name: "journey.section_opened", sectionId: "source" })
    expect(response.status).toBe(401)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })

  it("stops storing past the per-grant cap but still keeps the session alive", async () => {
    vi.mocked(prisma.demoAccessEvent.count).mockResolvedValue(JOURNEY_EVENTS_PER_GRANT)
    const response = await post({ eventType: "JOURNEY", name: "journey.section_opened", sectionId: "source" })
    expect(response.status).toBe(200)
    expect(prisma.demoGrant.updateMany).toHaveBeenCalled()
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
  })

  it("rejects unknown fields instead of storing them", async () => {
    const response = await post({ eventType: "JOURNEY", name: "journey.section_opened", sectionId: "source", note: "<b>x</b>" })
    expect(response.status).toBe(400)
  })
})
