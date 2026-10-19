/**
 * The Route & Field demo's one field day (owner, 2026-10-19: a day that
 * unfolds through the prospect's own presses). Its evening history is Elvin's
 * fixes and visits run through the product's own history functions
 * (src/components/demo-center/journey/scenes/mtm-demo-day.ts), on streets
 * computed once offline (`mtm-demo-roads.ts`); the live map moves Nərmin down
 * the same kind of street. What is checked here is behaviour on that data: no
 * fix inside a break, the same visits on every screen, kilometres along the
 * roads, and the live map's «who is nearest» measuring only the people it draws.
 */
import { describe, expect, it } from "vitest"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { isDuringMtmWorkdayPause, mtmWorkdayPauses } from "@/lib/mtm/workday-pauses"
import { rosterDistanceToPoint } from "@/lib/mtm/live-map-roster"
import { isLiveMapAgentPositionVisible } from "@/lib/mtm-types"
import {
  MTM_DEMO_AGENTS,
  MTM_DEMO_CLOCK,
  MTM_DEMO_ELVIN_DAY,
  mtmDemoAt,
  mtmDemoElvinSteps,
  mtmDemoMapClients,
  mtmDemoRosterAgents,
  mtmDemoVisitHistory,
} from "@/components/demo-center/journey/scenes/mtm-demo-data"
import {
  MTM_DEMO_ELVIN_WORKDAY,
  MTM_DEMO_HISTORY_POLICY,
  mtmDemoElvinFacts,
  mtmDemoElvinHistoryView,
  mtmDemoMetresBetween,
} from "@/components/demo-center/journey/scenes/mtm-demo-day"
import { mtmDemoRoadMeters } from "@/components/demo-center/journey/scenes/mtm-demo-motion"
import { MTM_DEMO_ROADS, type MtmDemoRoadId } from "@/components/demo-center/journey/scenes/mtm-demo-roads"

const TODAY = "2026-10-15"
const at = (hhmm: string) => new Date(mtmDemoAt(TODAY, hhmm))

describe("the evening's history of Elvin's day", () => {
  const facts = mtmDemoElvinFacts(TODAY)
  const view = mtmDemoElvinHistoryView(TODAY)

  it("records nothing during his break, by the product's own reading of the workday journal", () => {
    const pauses = mtmWorkdayPauses([
      { type: "PAUSE", occurredAt: at(MTM_DEMO_ELVIN_WORKDAY.paused) },
      { type: "RESUME", occurredAt: at(MTM_DEMO_ELVIN_WORKDAY.resumed) },
      { type: "FINISH", occurredAt: at(MTM_DEMO_ELVIN_WORKDAY.finished) },
    ])
    expect(pauses).toHaveLength(1)
    const inside = facts.points.filter((point) => isDuringMtmWorkdayPause(point.recordedAt, pauses))
    expect(inside).toEqual([])
    // And nothing outside the workday either.
    for (const point of facts.points) {
      expect(point.recordedAt.getTime()).toBeGreaterThanOrEqual(at(MTM_DEMO_ELVIN_WORKDAY.started).getTime())
      expect(point.recordedAt.getTime()).toBeLessThanOrEqual(at(MTM_DEMO_ELVIN_WORKDAY.finished).getTime())
    }
  })

  it("tells the break as one leg with its length — the product's «paused», not a lost signal", () => {
    const pauses = view.trip.entries.filter((entry) => entry.kind === "GAP")
    expect(pauses).toHaveLength(1)
    const pause = pauses[0] as Extract<(typeof view.trip.entries)[number], { kind: "GAP" }>
    expect(pause.reason).toBe("WORKDAY_PAUSED")
    expect(pause.durationSeconds).toBeGreaterThanOrEqual((at(MTM_DEMO_ELVIN_WORKDAY.resumed).getTime() - at(MTM_DEMO_ELVIN_WORKDAY.paused).getTime()) / 1_000)
    expect(view.summary).toMatchObject({ gapCount: 0, pausedGapCount: 1, anomalyCount: 0 })
    // The phone's fix after the break is not the one before it: a resume at
    // the same door would fold the break into the visit's stop.
    const before = facts.points.filter((point) => point.recordedAt < at(MTM_DEMO_ELVIN_WORKDAY.paused)).at(-1)!
    const after = facts.points.find((point) => point.recordedAt >= at(MTM_DEMO_ELVIN_WORKDAY.resumed))!
    expect(mtmDemoMetresBetween(before, after)).toBeGreaterThan(MTM_DEMO_HISTORY_POLICY.stopRadiusMeters)
  })

  it("has one stop per visit, each at its client, in the order of the day", () => {
    const stays = view.trip.entries.filter((entry) => entry.kind === "STAY")
    expect(stays.map((stay) => (stay as { visit: { customerName: string } | null }).visit?.customerName)).toEqual(
      view.visits.map((visit) => visit.customer.name),
    )
    expect(view.summary).toMatchObject({ stopCount: MTM_DEMO_ELVIN_DAY.length, visitCount: MTM_DEMO_ELVIN_DAY.length })
  })

  it("is the same day the live map shows at noon: the same visits, the same fixes", () => {
    const noon = mtmDemoVisitHistory(TODAY).filter((visit) => visit.agentId === "agent-elvin")
    for (const visit of noon) {
      const evening = facts.visits.find((candidate) => candidate.checkInAt.toISOString() === visit.checkInAt)
      expect(evening, visit.customer).toBeDefined()
      expect(evening!.customer.name).toBe(visit.customer)
      expect([evening!.checkInLat, evening!.checkInLng]).toEqual([visit.place.checkInLat, visit.place.checkInLng])
    }
    // At noon the afternoon is still a plan; nothing that happened later is on the live screen.
    const steps = mtmDemoElvinSteps(TODAY)
    for (const step of steps) {
      if (step.checkInAt) expect(step.checkInAt <= mtmDemoAt(TODAY, MTM_DEMO_CLOCK)).toBe(true)
      if (step.checkOutAt) expect(step.checkOutAt <= mtmDemoAt(TODAY, MTM_DEMO_CLOCK)).toBe(true)
    }
    expect(steps.filter((step) => step.state === "IN_VISIT")).toHaveLength(1)
  })

  it("counts the kilometres along the streets it drove", () => {
    const driven: MtmDemoRoadId[] = ["startToNar", "narToAptPlus", "aptPlusToRespublika", "respublikaToSefa", "sefaToUsaq", "usaqToDerman"]
    const roads = driven.reduce((sum, road) => sum + mtmDemoRoadMeters(road), 0)
    // Within a few hundred metres of the streets themselves: the walk to each door is straight.
    expect(Math.abs(view.summary.distanceMeters - roads)).toBeLessThan(600)
    expect(view.trip.summary.movingMeters).toBeLessThanOrEqual(view.summary.distanceMeters)
    // The drawn road is the streets, not the fixes joined straight.
    expect(view.matchedTrack.segments).toHaveLength(driven.length)
  })

  it("keeps the organization's history settings at the product's defaults", () => {
    expect(MTM_DEMO_HISTORY_POLICY).toEqual({
      maxAccuracyMeters: MTM_SETTING_DEFAULTS.historyMaxAccuracyMeters,
      stopRadiusMeters: MTM_SETTING_DEFAULTS.historyStopRadiusMeters,
      stopMinimumMinutes: MTM_SETTING_DEFAULTS.historyStopMinimumMinutes,
      offlineThresholdSeconds: MTM_SETTING_DEFAULTS.offlineThresholdSeconds,
      gpsInterval: MTM_SETTING_DEFAULTS.gpsInterval,
    })
  })

  it("keeps the streets inside Baku", () => {
    for (const road of Object.values(MTM_DEMO_ROADS)) {
      for (const [latitude, longitude] of road) {
        expect(latitude).toBeGreaterThan(40.3)
        expect(latitude).toBeLessThan(40.5)
        expect(longitude).toBeGreaterThan(49.7)
        expect(longitude).toBeLessThan(50.0)
      }
    }
  })
})

describe("the client the manager moved in the morning", () => {
  it("is where the agent showed it on every screen after the approval, and at its old pin before", async () => {
    const { mtmDemoPlaceRequest, mtmDemoPlannerCandidates } = await import("@/components/demo-center/journey/scenes/mtm-demo-data")
    const request = mtmDemoPlaceRequest(TODAY)
    const before = mtmDemoMapClients(false).find((client) => client.id === "pl-apt24")!
    const after = mtmDemoMapClients(true).find((client) => client.id === "pl-apt24")!
    expect([before.latitude, before.longitude]).toEqual([request.previous.latitude, request.previous.longitude])
    expect([after.latitude, after.longitude]).toEqual([request.proposed.latitude, request.proposed.longitude])
    const planned = mtmDemoPlannerCandidates(true).find((candidate) => candidate.customerId === "pl-apt24")!
    expect([planned.latitude, planned.longitude]).toEqual([request.proposed.latitude, request.proposed.longitude])
  })
})

describe("the live map at noon", () => {
  it("moves the agent on the way down her street and nobody else", () => {
    const noon = Date.parse(mtmDemoAt(TODAY, MTM_DEMO_CLOCK))
    const first = mtmDemoRosterAgents(TODAY, noon)
    const later = mtmDemoRosterAgents(TODAY, noon + 5 * 60_000)
    for (const agent of MTM_DEMO_AGENTS) {
      const a = first.find((row) => row.agentId === agent.id)!
      const b = later.find((row) => row.agentId === agent.id)!
      const moved = a.latitude !== undefined && b.latitude !== undefined ? mtmDemoMetresBetween({ latitude: a.latitude, longitude: a.longitude! }, { latitude: b.latitude, longitude: b.longitude! }) : 0
      if (agent.drive) expect(moved, agent.name).toBeGreaterThan(500)
      else expect(moved, agent.name).toBe(0)
      // A visit begun at 11:52 still began at 11:52 a few answers later.
      expect(b.openVisitSince, agent.name).toBe(a.openVisitSince)
    }
    // Somebody on a break stays where his phone last was, before the break.
    const rauf = later.find((row) => row.agentId === "agent-rauf")!
    expect(Date.parse(rauf.recordedAt!)).toBeLessThan(Date.parse(rauf.workdayPausedAt!))
  })

  it("answers «who is nearest» only for people it draws — not for somebody on a break", () => {
    const client = mtmDemoMapClients().find((candidate) => candidate.id === "pl-nar")!
    const rows = mtmDemoRosterAgents(TODAY).map((agent) => ({
      agent,
      distance: isLiveMapAgentPositionVisible(agent.freshness, agent.workdayState) ? rosterDistanceToPoint(agent, client) : null,
    }))
    expect(rows.find((row) => row.agent.agentId === "agent-rauf")!.distance).toBeNull()
    const measured = rows.filter((row) => row.distance !== null).sort((a, b) => a.distance! - b.distance!)
    expect(measured).toHaveLength(MTM_DEMO_AGENTS.length - 1)
    expect(measured[0].agent.name).toBe("Aysu Kərimli")
  })
})
