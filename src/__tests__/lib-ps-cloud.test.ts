/**
 * Tests for R12 Professional Services Cloud slice 1 — utilization engine
 * and skill-matching. Pure-functional, no Prisma.
 */
import { describe, it, expect } from "vitest"
import {
  computeUtilization,
  classifyUtilization,
  rollupFirm,
  type UserCapacity,
  type ProjectMemberHoursRow,
} from "@/lib/ps-cloud/utilization"
import {
  matchUsersToSkills,
  findHiringGap,
  type CandidateUser,
} from "@/lib/ps-cloud/skill-match"

/* ─── Utilization engine ──────────────────────────────────────────────── */

const cap = (userId: string, weeklyHours: number = 40): UserCapacity => ({ userId, weeklyHours })
const row = (
  userId: string, projectId: string, hours: number, rate: number | null, billable: boolean
): ProjectMemberHoursRow => ({ userId, projectId, hoursLogged: hours, hourlyRate: rate, isBillable: billable })

describe("R12 utilization — computeUtilization", () => {
  it("zero rows → all users at 0 utilization", () => {
    const r = computeUtilization([cap("u1"), cap("u2")], [], 1)
    expect(r).toHaveLength(2)
    for (const s of r) {
      expect(s.utilization).toBe(0)
      expect(s.billableHours).toBe(0)
      expect(s.totalLoggedHours).toBe(0)
      expect(s.benchHours).toBe(40)
    }
  })

  it("100% billable utilization", () => {
    const r = computeUtilization([cap("u1")], [row("u1", "p1", 40, 100, true)], 1)
    expect(r[0].billableHours).toBe(40)
    expect(r[0].utilization).toBe(1)
    expect(r[0].benchHours).toBe(0)
    expect(r[0].billableRevenue).toBe(4000)
  })

  it("50% billable utilization", () => {
    const r = computeUtilization([cap("u1")], [row("u1", "p1", 20, 150, true)], 1)
    expect(r[0].utilization).toBe(0.5)
    expect(r[0].billableHours).toBe(20)
    expect(r[0].billableRevenue).toBe(3000)
  })

  it("non-billable hours don't count toward utilization", () => {
    const r = computeUtilization([cap("u1")], [
      row("u1", "p1", 30, 100, true),
      row("u1", "p_internal", 10, 0, false),
    ], 1)
    expect(r[0].billableHours).toBe(30)
    expect(r[0].nonBillableHours).toBe(10)
    expect(r[0].totalLoggedHours).toBe(40)
    expect(r[0].utilization).toBe(0.75)
    expect(r[0].benchHours).toBe(0)
  })

  it("over-utilization > 1.0", () => {
    const r = computeUtilization([cap("u1")], [row("u1", "p1", 50, 100, true)], 1)
    expect(r[0].utilization).toBe(1.25)
    expect(r[0].benchHours).toBe(-10) // overtime
  })

  it("multi-project sums per user", () => {
    const r = computeUtilization([cap("u1")], [
      row("u1", "p1", 15, 100, true),
      row("u1", "p2", 10, 200, true),
    ], 1)
    expect(r[0].billableHours).toBe(25)
    expect(r[0].billableRevenue).toBe(15 * 100 + 10 * 200)
  })

  it("multiple users isolated", () => {
    const r = computeUtilization(
      [cap("u1"), cap("u2")],
      [row("u1", "p1", 40, 100, true), row("u2", "p1", 10, 100, true)],
      1
    )
    expect(r.find(s => s.userId === "u1")?.utilization).toBe(1)
    expect(r.find(s => s.userId === "u2")?.utilization).toBe(0.25)
  })

  it("periodWeeks multiplies capacity", () => {
    // 40h/week × 13 weeks = 520h capacity per user
    const r = computeUtilization([cap("u1")], [row("u1", "p1", 200, 100, true)], 13)
    expect(r[0].capacityHours).toBe(520)
    expect(r[0].utilization).toBeCloseTo(200 / 520, 3)
  })

  it("user with capacity 0 yields utilization 0 (no div by zero)", () => {
    const r = computeUtilization([cap("u1", 0)], [row("u1", "p1", 10, 100, true)], 1)
    expect(r[0].utilization).toBe(0)
    expect(r[0].capacityHours).toBe(0)
  })

  it("hourlyRate null treats revenue as 0", () => {
    const r = computeUtilization([cap("u1")], [row("u1", "p1", 40, null, true)], 1)
    expect(r[0].billableHours).toBe(40)
    expect(r[0].billableRevenue).toBe(0)
  })
})

describe("R12 utilization — classifyUtilization", () => {
  const make = (u: number, totalLogged: number = 1): ReturnType<typeof computeUtilization>[number] => ({
    userId: "u1", capacityHours: 40, billableHours: u * 40, nonBillableHours: 0,
    totalLoggedHours: totalLogged, utilization: u, benchHours: 0, billableRevenue: 0,
  })

  it("0 hours logged → bench", () => {
    expect(classifyUtilization(make(0, 0)).status).toBe("bench")
  })

  it("<40% → underutilized", () => {
    expect(classifyUtilization(make(0.3)).status).toBe("underutilized")
    expect(classifyUtilization(make(0.39)).status).toBe("underutilized")
  })

  it("40-85% → healthy (target band for most consultants)", () => {
    expect(classifyUtilization(make(0.4)).status).toBe("healthy")
    expect(classifyUtilization(make(0.65)).status).toBe("healthy")
    expect(classifyUtilization(make(0.84)).status).toBe("healthy")
  })

  it("85-100% → high (target for senior consultants, NOT a red flag)", () => {
    expect(classifyUtilization(make(0.85)).status).toBe("high")
    expect(classifyUtilization(make(0.95)).status).toBe("high")
    expect(classifyUtilization(make(1.0)).status).toBe("high")
  })

  it(">100% → over_utilized (sustained overtime)", () => {
    expect(classifyUtilization(make(1.01)).status).toBe("over_utilized")
    expect(classifyUtilization(make(1.25)).status).toBe("over_utilized")
  })
})

describe("R12 utilization — rollupFirm", () => {
  it("empty input → zero totals", () => {
    const r = rollupFirm([])
    expect(r.userCount).toBe(0)
    expect(r.averageUtilization).toBe(0)
  })

  it("aggregates across users", () => {
    const sums = computeUtilization(
      [cap("u1"), cap("u2"), cap("u3")],
      [
        row("u1", "p1", 40, 100, true),
        row("u2", "p1", 30, 150, true),
        row("u3", "p_int", 20, 0, false),
      ],
      1
    )
    const r = rollupFirm(sums)
    expect(r.totalCapacityHours).toBe(120)
    expect(r.totalBillableHours).toBe(70)
    expect(r.totalNonBillableHours).toBe(20)
    expect(r.totalBenchHours).toBe(30)
    expect(r.totalBillableRevenue).toBe(40 * 100 + 30 * 150)
    expect(r.averageUtilization).toBeCloseTo(70 / 120, 3)
    expect(r.userCount).toBe(3)
  })
})

/* ─── Skill-matching ──────────────────────────────────────────────────── */

const user = (id: string, name: string, skills: string[], opts: Partial<CandidateUser> = {}): CandidateUser => ({
  id, name, skills, isActive: true, isAvailable: true, ...opts,
})

describe("R12 skill-match — matchUsersToSkills", () => {
  it("empty required skills → empty result", () => {
    expect(matchUsersToSkills([user("u1", "A", ["js", "go"])], [])).toEqual([])
  })

  it("filters out inactive users by default", () => {
    const r = matchUsersToSkills(
      [
        user("u1", "Active", ["js"]),
        user("u2", "Inactive", ["js"], { isActive: false }),
      ],
      ["js"]
    )
    expect(r.map(c => c.userId)).toEqual(["u1"])
  })

  it("can include unavailable when requested", () => {
    const r = matchUsersToSkills(
      [
        user("u1", "Available", ["js"]),
        user("u2", "Unavailable", ["js"], { isAvailable: false }),
      ],
      ["js"],
      { excludeUnavailable: false }
    )
    expect(r).toHaveLength(2)
  })

  it("ranks by score desc", () => {
    const r = matchUsersToSkills(
      [
        user("u_partial", "Partial", ["js"]),
        user("u_full", "Full", ["js", "go", "k8s"]),
        user("u_none", "None", ["python"]),
      ],
      ["js", "go", "k8s"]
    )
    expect(r[0].userId).toBe("u_full")
    expect(r[0].score).toBe(1)
    expect(r[0].fullyCovered).toBe(true)
    expect(r[1].userId).toBe("u_partial")
    expect(r[1].score).toBeCloseTo(1 / 3, 3)
    expect(r[2].userId).toBe("u_none")
    expect(r[2].score).toBe(0)
  })

  it("tie-break by bonus skills ASC (prefer right-fit, not over-qualification)", () => {
    const r = matchUsersToSkills(
      [
        user("u_senior", "Senior", ["js", "go", "k8s", "aws", "terraform", "rust"]),
        user("u_focused", "Focused", ["js", "go"]),
      ],
      ["js", "go"]
    )
    // Both fully cover. Focused (0 bonus) ranks above Senior (4 bonus).
    expect(r[0].userId).toBe("u_focused")
    expect(r[1].userId).toBe("u_senior")
    expect(r[0].bonusSkills).toHaveLength(0)
    expect(r[1].bonusSkills).toHaveLength(4)
  })

  it("case-insensitive matching", () => {
    const r = matchUsersToSkills([user("u1", "A", ["JavaScript", "GoLang"])], ["javascript", "golang"])
    expect(r[0].fullyCovered).toBe(true)
    expect(r[0].score).toBe(1)
  })

  it("reports missing skills", () => {
    const r = matchUsersToSkills([user("u1", "A", ["js"])], ["js", "go", "k8s"])
    expect(r[0].matchedSkills.sort()).toEqual(["js"])
    expect(r[0].missingSkills.sort()).toEqual(["go", "k8s"])
  })

  it("propagates available flag", () => {
    const a = user("u1", "Yes", ["js"])
    const b = user("u2", "No", ["js"], { isAvailable: false })
    const r = matchUsersToSkills([a, b], ["js"], { excludeUnavailable: false })
    const ya = r.find(c => c.userId === "u1")!
    const yb = r.find(c => c.userId === "u2")!
    expect(ya.available).toBe(true)
    expect(yb.available).toBe(false)
  })

  it("respects limit", () => {
    const users = Array.from({ length: 100 }, (_, i) => user(`u${i}`, `User${i}`, ["js"]))
    const r = matchUsersToSkills(users, ["js"], { limit: 5 })
    expect(r).toHaveLength(5)
  })

  it("skips empty required-skill strings", () => {
    const r = matchUsersToSkills([user("u1", "A", ["js"])], ["", "  ", "js"])
    expect(r[0].matchedSkills).toEqual(["js"])
    expect(r[0].score).toBe(1)
  })

  it("user with no skills → score 0", () => {
    const r = matchUsersToSkills([user("u1", "A", [])], ["js"])
    expect(r[0].score).toBe(0)
    expect(r[0].fullyCovered).toBe(false)
  })
})

describe("R12 skill-match — findHiringGap", () => {
  it("returns skills no active user has", () => {
    const users = [
      user("u1", "A", ["js", "go"]),
      user("u2", "B", ["python"]),
    ]
    expect(findHiringGap(users, ["js", "python", "rust", "k8s"]).sort()).toEqual(["k8s", "rust"])
  })

  it("excludes inactive users from coverage check", () => {
    const users = [
      user("u1", "Active", ["js"]),
      user("u2", "Inactive", ["k8s"], { isActive: false }),
    ]
    // k8s is only on inactive user → counts as gap
    expect(findHiringGap(users, ["js", "k8s"])).toContain("k8s")
  })

  it("case-insensitive", () => {
    const users = [user("u1", "A", ["JavaScript"])]
    expect(findHiringGap(users, ["javascript", "rust"])).toEqual(["rust"])
  })

  it("no gap when all required skills covered", () => {
    const users = [user("u1", "A", ["js", "go", "k8s"])]
    expect(findHiringGap(users, ["js", "go"])).toEqual([])
  })

  it("empty users → all required are gaps", () => {
    expect(findHiringGap([], ["js", "go"]).sort()).toEqual(["go", "js"])
  })
})
