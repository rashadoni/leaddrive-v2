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
import { isLiveMapAgentPositionVisible, presentMtmDashboardAgent } from "@/lib/mtm-types"
import { combineMtmDayRoutes, deriveMtmLiveFieldStatus } from "@/lib/mtm/live-field-status"
import { mtmSpeedMoving } from "@/lib/mtm/gps-speed"
import {
  MTM_DEMO_AGENTS,
  MTM_DEMO_CLOCK,
  MTM_DEMO_ELVIN_DAY,
  MTM_DEMO_FRESHNESS,
  MTM_DEMO_PLACES,
  mtmDemoAt,
  mtmDemoAttention,
  mtmDemoElvinSteps,
  mtmDemoMapClients,
  mtmDemoPlaceRequest,
  mtmDemoPlannerCandidates,
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

/**
 * What the demo shows must be something the product could have produced from
 * the same morning (audit of the intro clip, 2026-10-20): the product's own
 * rules, run over the demo's own facts.
 */
describe("the morning, as the product would have recorded it", () => {
  const noonMs = Date.parse(mtmDemoAt(TODAY, MTM_DEMO_CLOCK))

  it("has the place request waiting before the visit it covers, as a check-in needs it to be", () => {
    const request = mtmDemoPlaceRequest(TODAY)
    const visit = mtmDemoVisitHistory(TODAY).find((candidate) => candidate.agentId === "agent-nermin" && candidate.customer === request.customer)!
    // `waitingLocationRequestCovers` lets a check-in in, and ties it to the request, only while the request is SUBMITTED.
    expect(visit.locationRequest).toBe("SUBMITTED")
    expect(visit.checkInAt).toBe(request.checkedInFromHereAt)
    expect(Date.parse(request.sentAt)).toBeLessThan(Date.parse(visit.checkInAt))
    // «Bu gün» waits on it since it was sent.
    expect(mtmDemoAttention(TODAY).items.find((item) => item.kind === "customerLocationRequests")?.since).toBe(request.sentAt)
  })

  it("counts the planner's month from every visit checked out by the demo's clock, as its candidates answer does", () => {
    const visits = mtmDemoVisitHistory(TODAY).filter((visit) => visit.status === "CHECKED_OUT")
    const placeOf = (name: string) => MTM_DEMO_PLACES.find((place) => place.name === name)!
    for (const placeApproved of [false, true]) {
      const candidates = mtmDemoPlannerCandidates(placeApproved)
      for (const candidate of candidates) {
        const place = MTM_DEMO_PLACES.find((row) => row.id === candidate.customerId)!
        const earlier = candidate.contactId ? place.doctors.find((doctor) => doctor.id === candidate.contactId)!.earlierThisMonth : place.earlierThisMonth
        const today = visits.filter((visit) => placeOf(visit.customer).id === candidate.customerId && (candidate.contactId === null || visit.contactId === candidate.contactId)).length
        expect(candidate.monthlyVisitCount, candidate.name).toBe(earlier + today)
      }
    }
    // At a clinic a visit is to one of its doctors; at a pharmacy to the pharmacy.
    for (const visit of visits) {
      const place = placeOf(visit.customer)
      if (place.doctors.length) expect(place.doctors.map((doctor) => doctor.id), `${visit.agent} at ${visit.customer}`).toContain(visit.contactId)
      else expect(visit.contactId).toBeNull()
    }
    // Aptek 24, where Nərmin was this morning, is not «not visited this month».
    expect(mtmDemoPlannerCandidates().find((candidate) => candidate.customerId === "pl-apt24")!.monthlyVisitCount).toBeGreaterThan(0)
  })

  it("keeps the live map's limits at the product's defaults, as its answer would carry them", () => {
    // locations/route.ts: onlineSeconds = offlineThresholdSeconds, delayedSeconds = max(that, locationWindowMinutes × 60).
    expect(MTM_DEMO_FRESHNESS).toEqual({
      onlineSeconds: MTM_SETTING_DEFAULTS.offlineThresholdSeconds,
      delayedSeconds: Math.max(MTM_SETTING_DEFAULTS.offlineThresholdSeconds, MTM_SETTING_DEFAULTS.locationWindowMinutes * 60),
    })
  })

  it("gives everyone on the live map the status the product derives from their own facts", () => {
    for (const agent of mtmDemoRosterAgents(TODAY)) {
      const demo = MTM_DEMO_AGENTS.find((candidate) => candidate.id === agent.agentId)!
      const derived = deriveMtmLiveFieldStatus({
        freshness: agent.freshness,
        isCheckedIn: Boolean(agent.openVisitSince),
        isOnline: agent.isOnline,
        isMoving: mtmSpeedMoving(agent.speed),
        dayRoutes: combineMtmDayRoutes([{ status: demo.visited === 0 ? "PLANNED" : "IN_PROGRESS", totalPoints: demo.total, visitedPoints: demo.visited }]),
        tenantHour: Number(MTM_DEMO_CLOCK.slice(0, 2)),
        lateAfterHour: MTM_SETTING_DEFAULTS.lateAfterHour,
      })
      expect(agent.fieldStatus, agent.name).toBe(derived)
      // And the page, presenting the answer at noon with the default limits, changes nothing in it:
      // nobody is «in the app» who sent the server nothing for minutes (a break stores no points).
      const presented = presentMtmDashboardAgent(agent, MTM_DEMO_FRESHNESS, noonMs)
      expect({ isOnline: presented.isOnline, freshness: presented.freshness, fieldStatus: presented.fieldStatus }, agent.name)
        .toEqual({ isOnline: agent.isOnline, freshness: agent.freshness, fieldStatus: agent.fieldStatus })
    }
    // The server hears from the app only through the points it stores: on a break, nothing after the last one.
    const rauf = mtmDemoRosterAgents(TODAY).find((agent) => agent.agentId === "agent-rauf")!
    expect(rauf.isOnline).toBe(false)
    expect(Date.parse(rauf.lastSeenAt!)).toBeLessThanOrEqual(Date.parse(rauf.recordedAt!))
  })
})

describe("the demo's scenes in the browser", () => {
  it("import none of the modules that read the database: their figures come as data, kept equal by these tests", async () => {
    const { readdirSync, readFileSync } = await import("node:fs")
    const dir = "src/components/demo-center/journey/scenes"
    const serverOnly = /from "@\/lib\/(?:prisma|rls-context|mtm-settings|mtm\/workday|mtm\/attendance-risk-detection|mtm\/attendance-risk-policy)"/
    const found = readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && serverOnly.test(readFileSync(`${dir}/${name}`, "utf8")))
    expect(found).toEqual([])
  })
})
