/**
 * Tests for A4 Quota Management — pure quota engine.
 * No DB, no Prisma — only the math kernel.
 */
import { describe, it, expect } from "vitest"
import {
  quarterBoundaries,
  computeAttainment,
  computePacing,
  buildLeaderboard,
  type Quota,
} from "@/lib/quota-engine"

function quota(overrides: Partial<Quota> = {}): Quota {
  return {
    id: "q_1",
    userId: "u_1",
    year: 2026,
    quarter: 2,
    amount: 100_000,
    currency: "USD",
    ...overrides,
  }
}

describe("A4 quota — quarterBoundaries", () => {
  it("Q1 2026: Jan 1 → Mar 31 23:59:59.999", () => {
    const { start, end } = quarterBoundaries(2026, 1)
    // Use local-date methods (test TZ may not be UTC; quarterBoundaries
    // intentionally constructs local-time Date for consistent business sem).
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(0) // January
    expect(start.getDate()).toBe(1)
    expect(end.getMonth()).toBe(2) // March
    expect(end.getDate()).toBe(31)
    expect(end.getHours()).toBe(23)
  })

  it("Q2 starts April 1", () => {
    const { start } = quarterBoundaries(2026, 2)
    expect(start.getMonth()).toBe(3)
    expect(start.getDate()).toBe(1)
  })

  it("Q4 ends Dec 31", () => {
    const { end } = quarterBoundaries(2026, 4)
    expect(end.getMonth()).toBe(11)
    expect(end.getDate()).toBe(31)
  })

  it("clamps invalid quarter inputs", () => {
    const { start: s0 } = quarterBoundaries(2026, 0)
    expect(s0.getMonth()).toBe(0) // clamped up to 1
    const { start: s9 } = quarterBoundaries(2026, 9)
    expect(s9.getMonth()).toBe(9) // clamped down to 4 = Q4 starting Oct
  })
})

describe("A4 quota — computeAttainment", () => {
  it("zero quota → 0%", () => {
    const r = computeAttainment(quota({ amount: 0 }), 50_000)
    expect(r.attainmentPercent).toBe(0)
  })

  it("exactly 100% attainment", () => {
    const r = computeAttainment(quota({ amount: 100_000 }), 100_000)
    expect(r.attainmentPercent).toBe(100)
  })

  it("over-attainment can exceed 100", () => {
    const r = computeAttainment(quota({ amount: 100_000 }), 150_000)
    expect(r.attainmentPercent).toBe(150)
  })

  it("rounds to 1 decimal", () => {
    const r = computeAttainment(quota({ amount: 30_000 }), 10_000)
    // 10000/30000 = 0.33333… → 33.3
    expect(r.attainmentPercent).toBe(33.3)
  })

  it("propagates currency", () => {
    const r = computeAttainment(quota({ currency: "EUR" }), 50_000)
    expect(r.currency).toBe("EUR")
  })
})

describe("A4 quota — computePacing", () => {
  // Q2 2026: Apr 1 → Jun 30. Mid-point is around May 16.
  const midQ2 = new Date(2026, 4, 16, 12, 0, 0) // May 16 noon

  it("at period midpoint with 50% actual → on_track", () => {
    const r = computePacing(quota({ amount: 100_000 }), 50_000, midQ2)
    expect(r.status).toBe("on_track")
    expect(r.paceIndex).toBeCloseTo(1, 1)
    expect(r.periodProgress).toBeCloseTo(0.5, 1)
  })

  it("at midpoint with 60% actual → exceeding (>110% of pace)", () => {
    const r = computePacing(quota({ amount: 100_000 }), 60_000, midQ2)
    expect(r.status).toBe("exceeding")
    expect(r.paceIndex).toBeGreaterThan(1.1)
  })

  it("at midpoint with 40% actual → behind (70-90% of pace)", () => {
    const r = computePacing(quota({ amount: 100_000 }), 40_000, midQ2)
    expect(r.status).toBe("behind")
    expect(r.behindBy).toBeGreaterThan(0)
  })

  it("at midpoint with 30% actual → at_risk (50-70% of pace)", () => {
    const r = computePacing(quota({ amount: 100_000 }), 30_000, midQ2)
    expect(r.status).toBe("at_risk")
  })

  it("at midpoint with 10% actual → critical (<50% of pace)", () => {
    const r = computePacing(quota({ amount: 100_000 }), 10_000, midQ2)
    expect(r.status).toBe("critical")
  })

  it("before period starts → not_started", () => {
    const beforeQ2 = new Date(2026, 2, 15) // March (Q1)
    const r = computePacing(quota({ amount: 100_000, quarter: 2 }), 0, beforeQ2)
    expect(r.status).toBe("not_started")
  })

  it("hitting full quota mid-period → exceeded (period-locked status takes precedence)", () => {
    const r = computePacing(quota({ amount: 100_000 }), 100_000, midQ2)
    expect(r.status).toBe("exceeded")
  })

  it("over 100% mid-period → exceeded", () => {
    const r = computePacing(quota({ amount: 100_000 }), 130_000, midQ2)
    expect(r.status).toBe("exceeded")
  })

  it("after period ends with 95% → behind (final attainment <100%)", () => {
    const afterQ2 = new Date(2026, 7, 1) // August
    const r = computePacing(quota({ amount: 100_000 }), 95_000, afterQ2)
    expect(r.status).toBe("behind")
  })

  it("after period ends with 50% → critical (<70%)", () => {
    const afterQ2 = new Date(2026, 7, 1)
    const r = computePacing(quota({ amount: 100_000 }), 50_000, afterQ2)
    expect(r.status).toBe("critical")
  })

  it("after period ends with 100% → exceeded", () => {
    const afterQ2 = new Date(2026, 7, 1)
    const r = computePacing(quota({ amount: 100_000 }), 100_000, afterQ2)
    expect(r.status).toBe("exceeded")
  })

  it("zero quota → paceIndex is Infinity for any positive actual", () => {
    const r = computePacing(quota({ amount: 0 }), 10_000, midQ2)
    expect(r.paceIndex).toBe(Infinity)
  })

  it("zero quota + zero actual → paceIndex 0", () => {
    const r = computePacing(quota({ amount: 0 }), 0, midQ2)
    expect(r.paceIndex).toBe(0)
  })

  it("daysElapsed and totalDays reasonable for Q2", () => {
    const r = computePacing(quota(), 50_000, midQ2)
    expect(r.totalDays).toBeGreaterThan(85) // Q2 is 91 days
    expect(r.totalDays).toBeLessThanOrEqual(91)
    expect(r.daysElapsed).toBeGreaterThan(40)
    expect(r.daysElapsed).toBeLessThan(50)
  })

  it("behindBy = 0 when ahead of pace", () => {
    const r = computePacing(quota({ amount: 100_000 }), 80_000, midQ2)
    expect(r.behindBy).toBe(0)
  })
})

describe("A4 quota — buildLeaderboard", () => {
  const midQ2 = new Date(2026, 4, 16, 12, 0, 0)

  it("ranks by attainment percent desc", () => {
    const rows = [
      { quota: quota({ id: "q1", userId: "u1", amount: 100_000 }), actualAmount: 30_000, userName: "Alice" },
      { quota: quota({ id: "q2", userId: "u2", amount: 100_000 }), actualAmount: 80_000, userName: "Bob" },
      { quota: quota({ id: "q3", userId: "u3", amount: 100_000 }), actualAmount: 50_000, userName: "Carol" },
    ]
    const board = buildLeaderboard(rows, midQ2)
    expect(board.map(r => r.userId)).toEqual(["u2", "u3", "u1"])
    expect(board[0].rank).toBe(1)
    expect(board[2].rank).toBe(3)
  })

  it("breaks ties by actual amount desc", () => {
    const rows = [
      { quota: quota({ id: "q1", userId: "u1", amount: 50_000 }), actualAmount: 50_000, userName: "A" }, // 100%
      { quota: quota({ id: "q2", userId: "u2", amount: 100_000 }), actualAmount: 100_000, userName: "B" }, // 100%
    ]
    const board = buildLeaderboard(rows, midQ2)
    // Same %, B has higher actual → ranks first
    expect(board[0].userId).toBe("u2")
    expect(board[1].userId).toBe("u1")
  })

  it("places no-quota rows last regardless of actual", () => {
    const rows = [
      { quota: quota({ id: "q1", userId: "u1", amount: 100_000 }), actualAmount: 10_000, userName: "A" },
      { quota: quota({ id: "q2", userId: "u2", amount: 0 }), actualAmount: 999_999, userName: "B" }, // no quota
    ]
    const board = buildLeaderboard(rows, midQ2)
    expect(board[0].userId).toBe("u1")
    expect(board[1].userId).toBe("u2")
    expect(board[1].rank).toBe(2)
  })

  it("populates status from pacing", () => {
    const rows = [
      { quota: quota({ amount: 100_000 }), actualAmount: 50_000 }, // midpoint, on_track
    ]
    const board = buildLeaderboard(rows, midQ2)
    expect(board[0].status).toBe("on_track")
  })

  it("empty input → empty output", () => {
    expect(buildLeaderboard([], midQ2)).toEqual([])
  })

  it("rank starts at 1 not 0", () => {
    const rows = [
      { quota: quota({ id: "q1", userId: "u1", amount: 100_000 }), actualAmount: 50_000 },
    ]
    const board = buildLeaderboard(rows, midQ2)
    expect(board[0].rank).toBe(1)
  })

  it("propagates userName", () => {
    const rows = [
      { quota: quota({ userId: "u1" }), actualAmount: 50_000, userName: "Diana" },
    ]
    const board = buildLeaderboard(rows, midQ2)
    expect(board[0].userName).toBe("Diana")
  })
})
