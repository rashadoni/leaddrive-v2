import { describe, it, expect } from "vitest"
import {
  statusFromAttainment,
  periodStart,
  round1,
  isLeaderboardGroup,
  isLeaderboardPeriod,
} from "@/lib/leaderboard/types"
import { attainmentColor, STATUS_COLOR } from "@/lib/leaderboard/colors"
import { isManager, visibleGroups, canViewGroup } from "@/lib/leaderboard/visibility"

describe("statusFromAttainment", () => {
  it("maps the 5 bands at their boundaries", () => {
    expect(statusFromAttainment(150)).toBe("exceeding")
    expect(statusFromAttainment(110)).toBe("exceeding")
    expect(statusFromAttainment(109.9)).toBe("on_track")
    expect(statusFromAttainment(90)).toBe("on_track")
    expect(statusFromAttainment(89)).toBe("behind")
    expect(statusFromAttainment(70)).toBe("behind")
    expect(statusFromAttainment(69)).toBe("at_risk")
    expect(statusFromAttainment(50)).toBe("at_risk")
    expect(statusFromAttainment(49)).toBe("critical")
    expect(statusFromAttainment(0)).toBe("critical")
  })
})

describe("periodStart", () => {
  const now = new Date("2026-06-19T12:00:00Z")
  it("day = rolling 24h back", () => {
    const s = periodStart("day", now)!
    expect(s.getTime()).toBe(now.getTime() - 86_400_000)
  })
  it("year = Jan 1 of the current year (local)", () => {
    const s = periodStart("year", now)!
    expect(s.getFullYear()).toBe(now.getFullYear())
    expect(s.getMonth()).toBe(0)
    expect(s.getDate()).toBe(1)
  })
  it("week = rolling 7 days back", () => {
    const s = periodStart("week", now)!
    expect(s.getTime()).toBe(now.getTime() - 7 * 86_400_000)
  })
  it("month = first of the current month (local)", () => {
    const s = periodStart("month", now)!
    expect(s.getFullYear()).toBe(now.getFullYear())
    expect(s.getMonth()).toBe(now.getMonth())
    expect(s.getDate()).toBe(1)
  })
  it("quarter = first month of the quarter (June → April 1)", () => {
    const s = periodStart("quarter", now)!
    expect(s.getMonth()).toBe(3) // April (Q2 = months 3,4,5)
    expect(s.getDate()).toBe(1)
  })
  it("all = undefined (lifetime)", () => {
    expect(periodStart("all", now)).toBeUndefined()
  })
  it("uses the authenticated timezone for calendar periods", () => {
    const aroundBakuMidnight = new Date("2026-08-31T20:30:00.000Z")
    expect(periodStart("month", aroundBakuMidnight, "Asia/Baku")?.toISOString())
      .toBe("2026-08-31T20:00:00.000Z")
    expect(periodStart("quarter", aroundBakuMidnight, "Asia/Baku")?.toISOString())
      .toBe("2026-06-30T20:00:00.000Z")
    expect(periodStart("year", aroundBakuMidnight, "Asia/Baku")?.toISOString())
      .toBe("2025-12-31T20:00:00.000Z")
  })
})

describe("round1 / guards", () => {
  it("rounds to one decimal", () => {
    expect(round1(87.04)).toBe(87)
    expect(round1(50.05)).toBe(50.1)
  })
  it("validates groups & periods", () => {
    expect(isLeaderboardGroup("sales")).toBe(true)
    expect(isLeaderboardGroup("nope")).toBe(false)
    expect(isLeaderboardPeriod("quarter")).toBe(true)
    expect(isLeaderboardPeriod("day")).toBe(true)
    expect(isLeaderboardPeriod("year")).toBe(true)
    expect(isLeaderboardPeriod("yearly")).toBe(false)
  })
})

describe("attainmentColor", () => {
  it("clamps ≥150% to the same deep-green hue as 150%", () => {
    expect(attainmentColor(400).fill).toBe(attainmentColor(150).fill)
  })
  it("low attainment is red, high is green (hue increases with pct)", () => {
    const hue = (s: string) => parseInt(s.match(/hsl\((\d+)/)![1], 10)
    expect(hue(attainmentColor(10).fill)).toBeLessThan(hue(attainmentColor(120).fill))
  })
  it("carries the matching status + has a token per status", () => {
    expect(attainmentColor(95).status).toBe("on_track")
    expect(Object.keys(STATUS_COLOR)).toHaveLength(5)
  })
  it("colour tracks the status bands: on_track (≥90) is green, behind (<90) is amber", () => {
    const hue = (s: string) => parseInt(s.match(/hsl\((\d+)/)![1], 10)
    // 91% is on_track → green (hue ≥ 90); 89% is behind → amber/yellow (hue < 90).
    expect(hue(attainmentColor(91).fill)).toBeGreaterThanOrEqual(90)
    expect(hue(attainmentColor(89).fill)).toBeLessThan(90)
    expect(attainmentColor(91).status).toBe("on_track")
  })
})

describe("visibility (RBAC)", () => {
  it("managers see every group", () => {
    expect(isManager("manager")).toBe(true)
    expect(visibleGroups("admin")).toEqual(["sales", "mtm", "tickets", "projects", "tasks"])
    expect(canViewGroup("superadmin", "mtm")).toBe(true)
  })
  it("sales reps see ONLY their own department — not cross-cutting org views", () => {
    expect(visibleGroups("sales")).toEqual(["sales"])
    expect(canViewGroup("sales", "sales")).toBe(true)
    // tasks/projects/mtm return an org-wide roster → manager-only
    expect(canViewGroup("sales", "tasks")).toBe(false)
    expect(canViewGroup("sales", "projects")).toBe(false)
    expect(canViewGroup("sales", "tickets")).toBe(false)
    expect(canViewGroup("sales", "mtm")).toBe(false)
  })
  it("support reps see ONLY tickets", () => {
    expect(visibleGroups("support")).toEqual(["tickets"])
    expect(canViewGroup("support", "tickets")).toBe(true)
    expect(canViewGroup("support", "tasks")).toBe(false)
    expect(canViewGroup("support", "sales")).toBe(false)
  })
  it("unknown / viewer roles see nothing", () => {
    expect(visibleGroups("viewer")).toEqual([])
    expect(canViewGroup("viewer", "tasks")).toBe(false)
  })
})
