import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildAgentPeriod, periodDays } from "@/lib/mtm/agent-period"
import { agentPeriodPreset } from "@/components/mtm/agent-period-view"

/**
 * Owner 2026-09-25: «a manager wants to see what one field agent did over a
 * period — here there is only a week»; the first attempt listed only busy
 * days («херня какая-то»). Approved mockup: every day of the period with a
 * verdict, four numbers on top, the day's route on a click.
 */
const TZ = "Asia/Baku"
const at = (iso: string) => new Date(iso)
const point = (id: string, iso: string, latitude: number) => ({
  id, latitude, longitude: 49.85, accuracy: 10, speed: null, heading: null, battery: null, isMoving: true, recordedAt: at(iso), workdayId: null,
})

describe("one agent over a period", () => {
  const period = buildAgentPeriod({
    from: "2026-09-21",
    to: "2026-09-27",
    timezone: TZ,
    now: at("2026-09-26T08:00:00.000Z"), // Saturday noon in Baku
    maxAccuracyMeters: 100,
    workdays: [
      // Monday: 09:02–18:15 Baku, a 15-minute break.
      { workDate: at("2026-09-21T00:00:00.000Z"), startedAt: at("2026-09-21T05:02:00.000Z"), completedAt: at("2026-09-21T14:15:00.000Z"), totalPausedSeconds: 900 },
      // Tuesday: left open (the owner's own test shift ran for days).
      { workDate: at("2026-09-22T00:00:00.000Z"), startedAt: at("2026-09-22T05:20:00.000Z"), completedAt: null, totalPausedSeconds: 0 },
    ],
    visits: [
      { checkInAt: at("2026-09-21T05:45:00.000Z"), status: "CHECKED_OUT" },
      { checkInAt: at("2026-09-21T07:00:00.000Z"), status: "CHECKED_OUT" },
      { checkInAt: at("2026-09-22T06:00:00.000Z"), status: "CHECKED_OUT" },
      { checkInAt: at("2026-09-22T07:00:00.000Z"), status: "CANCELLED" },
    ],
    routes: [
      { date: at("2026-09-21T00:00:00.000Z"), status: "COMPLETED", totalPoints: 2, visitedPoints: 2 },
      { date: at("2026-09-22T00:00:00.000Z"), status: "INCOMPLETE", totalPoints: 3, visitedPoints: 1 },
      { date: at("2026-09-23T00:00:00.000Z"), status: "PLANNED", totalPoints: 4, visitedPoints: 0 },
      { date: at("2026-09-24T00:00:00.000Z"), status: "DRAFT", totalPoints: 5, visitedPoints: 0 },
      { date: at("2026-09-27T00:00:00.000Z"), status: "PLANNED", totalPoints: 2, visitedPoints: 0 },
    ],
    points: [
      point("a", "2026-09-22T05:30:00.000Z", 40.40),
      point("b", "2026-09-22T06:30:00.000Z", 40.45),
      point("c", "2026-09-22T09:00:00.000Z", 40.46),
    ],
  })

  it("has a row for every day, each with a verdict a manager reads at a glance", () => {
    expect(period.days.map((day) => [day.date, day.status, day.remaining])).toEqual([
      ["2026-09-21", "FULL", 0],
      ["2026-09-22", "PARTIAL", 2],
      // Tuesday's shift was never closed: the days after say so (prod 2026-09-26).
      ["2026-09-23", "SHIFT_OPEN", 4],
      ["2026-09-24", "SHIFT_OPEN", 0], // a draft never reached the agent
      ["2026-09-25", "SHIFT_OPEN", 0],
      ["2026-09-26", "SHIFT_OPEN", 0],
      ["2026-09-27", "UPCOMING", 2],
    ])
  })

  it("counts time in the field without the break, and ends an open shift at its last fix that day", () => {
    const [monday, tuesday] = period.days
    expect(monday.fieldSeconds).toBe((9 * 60 + 13) * 60 - 900)
    // 09:20 → last fix 13:00 Baku, not «now» days later.
    expect(tuesday.fieldSeconds).toBe((3 * 60 + 40) * 60)
    expect(tuesday.visits).toBe(1) // the cancelled one does not count
    expect(period.days[0].visitList.map((visit) => visit.checkInAt)).toEqual(["2026-09-21T05:45:00.000Z", "2026-09-21T07:00:00.000Z"])
    // Fixes an hour apart are not driving: nobody knows the road in between.
    expect(tuesday.distanceMeters).toBe(0)
  })

  it("sums the four numbers over past days only", () => {
    expect(period.summary).toMatchObject({ workedDays: 2, plannedDays: 3, visits: 3, planned: 9, visitedPoints: 3 })
  })

  it("never spans more than a month", () => {
    expect(periodDays("2026-01-01", "2026-12-31")).toHaveLength(31)
  })
})

describe("ready periods", () => {
  it("are Monday-based weeks, this month and the last 30 days, never past today", () => {
    const today = "2026-09-26" // Saturday
    expect(agentPeriodPreset("thisWeek", today)).toEqual({ from: "2026-09-21", to: "2026-09-26" })
    expect(agentPeriodPreset("lastWeek", today)).toEqual({ from: "2026-09-14", to: "2026-09-20" })
    expect(agentPeriodPreset("thisMonth", today)).toEqual({ from: "2026-09-01", to: "2026-09-26" })
    expect(agentPeriodPreset("last30", today)).toEqual({ from: "2026-08-28", to: "2026-09-26" })
  })
})

describe("the agent period screen", () => {
  it("reads the new endpoint, shows every day open with its visits, and links to the map", () => {
    // Owner 2026-09-26: «expanded, more informative — whom he met on which
    // date and how long».
    const view = readFileSync("src/components/mtm/agent-period-view.tsx", "utf8")
    expect(view).toContain("/api/v1/mtm/agent-period?")
    expect(view).toContain("day.visitList.map((visit) =>")
    expect(view).toContain('<span className="block truncate font-medium text-foreground">{visit.customerName}</span>')
    expect(view).toContain('data-testid="mtm-agent-period-cards"')
    expect(view).toContain('data-testid="mtm-agent-period-days"')
    expect(view).toContain("/mtm/map?mode=history&agentId=")
    const route = readFileSync("src/app/api/v1/mtm/agent-period/route.ts", "utf8")
    // Same scope rule as the GPS history.
    expect(route).toContain("actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(agentId)")
    const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
    expect(page).toContain('data-testid="mtm-routes-view-agent"')
  })
})

describe("routes audit 2026-09-26: team week and titles", () => {
  it("puts agents with a plan first, folds the rest, and does not call 3 of 5 stops «completed»", () => {
    const week = readFileSync("src/components/mtm/route-week-plan.tsx", "utf8")
    expect(week).toContain("const visibleAgents = foldIdle ? busyAgents : [...busyAgents, ...idleAgents]")
    expect(week).toContain('data-testid="mtm-week-idle-agents"')
    expect(week).toContain('t("weekStopsMissed", { count: route.totalPoints - route.visitedPoints })')
    const page = readFileSync("src/app/(dashboard)/mtm/routes/page.tsx", "utf8")
    expect(page).toContain('t(calendarSurface ? "calendarTitle" : "title")')
  })
})

describe("the agent period on a real phone (prod 2026-09-26, the owner's own)", () => {
  // A shift opened on 20.09 and never closed; the phone flew Baku → Frankfurt
  // → Milan → Barcelona and drove there. Every day read «day off» with 5 810 km.
  const flight = [
    { id: "a", latitude: 40.40, longitude: 49.85, accuracy: 10, speed: null, heading: null, battery: null, isMoving: true, recordedAt: new Date("2026-09-23T03:00:00.000Z"), workdayId: null },
    { id: "b", latitude: 50.05, longitude: 8.57, accuracy: 10, speed: null, heading: null, battery: null, isMoving: true, recordedAt: new Date("2026-09-23T08:30:00.000Z"), workdayId: null },
    { id: "c", latitude: 50.06, longitude: 8.60, accuracy: 10, speed: null, heading: null, battery: null, isMoving: true, recordedAt: new Date("2026-09-23T08:35:00.000Z"), workdayId: null },
  ]
  const period = buildAgentPeriod({
    from: "2026-09-23", to: "2026-09-23", timezone: "Asia/Baku", now: new Date("2026-09-26T08:00:00.000Z"), maxAccuracyMeters: 100,
    workdays: [{ workDate: new Date("2026-09-20T00:00:00.000Z"), startedAt: new Date("2026-09-19T23:48:18.000Z"), completedAt: null, totalPausedSeconds: 0 }],
    visits: [], routes: [], points: flight,
  })

  it("says the shift was left open, not «day off», and counts no field time for it", () => {
    expect(period.days[0]).toMatchObject({ status: "SHIFT_OPEN", fieldSeconds: 0, workday: { carriedOver: true } })
    expect(period.summary.workedDays).toBe(0)
  })

  it("counts driving only — a flight or a silence is not road", () => {
    // Baku → Frankfurt in 5.5 h is dropped; the 5-minute taxi hop stays.
    expect(period.days[0].distanceMeters).toBeGreaterThan(1_000)
    expect(period.days[0].distanceMeters).toBeLessThan(5_000)
  })
})
