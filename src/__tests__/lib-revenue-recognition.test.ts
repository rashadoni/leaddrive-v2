/**
 * Tests for M4 Revenue Recognition slice 1 — 5 pure helpers. No DB.
 */
import { describe, expect, it } from "vitest"
import {
  canPoTransition,
  canScheduleTransition,
  isPoStatus,
  isPoTerminal,
  isScheduleStatus,
  isScheduleTerminal,
  poAllowedNext,
  scheduleAllowedNext,
} from "@/lib/revenue-recognition/state-machine"
import { allocateTransactionPrice } from "@/lib/revenue-recognition/allocation-engine"
import { generateSchedule } from "@/lib/revenue-recognition/schedule-generator"
import { calculateRecognition } from "@/lib/revenue-recognition/recognition-calculator"
import {
  PO_STATUSES,
  PO_TRANSITIONS,
  RECOGNITION_METHODS,
  SCHEDULE_STATUSES,
  SCHEDULE_TRANSITIONS,
  type PoStatus,
  type ScheduleStatus,
} from "@/lib/revenue-recognition/types"
import {
  currencyExponent,
  decimalToMinor,
  minorToDecimalString,
} from "@/lib/revenue-recognition/decimal-minor"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("M4 — PO state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of PO_STATUSES) expect(isPoStatus(s)).toBe(true)
  })

  it("rejects unknown values", () => {
    for (const s of ["", "Draft", "ACTIVE", "frob", 42, null]) {
      expect(isPoStatus(s)).toBe(false)
    }
  })

  it("draft → scheduled / cancelled allowed", () => {
    expect(canPoTransition("draft", "scheduled").ok).toBe(true)
    expect(canPoTransition("draft", "cancelled").ok).toBe(true)
  })

  it("draft → completed rejected (must pass through scheduled + in_progress)", () => {
    expect(canPoTransition("draft", "completed").ok).toBe(false)
  })

  it("scheduled → in_progress / cancelled allowed", () => {
    expect(canPoTransition("scheduled", "in_progress").ok).toBe(true)
    expect(canPoTransition("scheduled", "cancelled").ok).toBe(true)
  })

  it("in_progress → completed / cancelled allowed", () => {
    expect(canPoTransition("in_progress", "completed").ok).toBe(true)
    expect(canPoTransition("in_progress", "cancelled").ok).toBe(true)
  })

  it("completed/cancelled are terminal", () => {
    expect(canPoTransition("completed", "draft").ok).toBe(false)
    expect(canPoTransition("cancelled", "scheduled").ok).toBe(false)
    expect(isPoTerminal("completed")).toBe(true)
    expect(isPoTerminal("cancelled")).toBe(true)
  })

  it("rejects self-transition", () => {
    for (const s of PO_STATUSES) {
      expect(canPoTransition(s, s).ok).toBe(false)
    }
  })

  it("poAllowedNext matches table", () => {
    for (const s of PO_STATUSES) {
      expect(poAllowedNext(s)).toEqual(PO_TRANSITIONS[s])
    }
  })
})

describe("M4 — Schedule state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of SCHEDULE_STATUSES) expect(isScheduleStatus(s)).toBe(true)
  })

  it("scheduled → partially_recognized / recognized / cancelled", () => {
    expect(canScheduleTransition("scheduled", "partially_recognized").ok).toBe(true)
    expect(canScheduleTransition("scheduled", "recognized").ok).toBe(true)
    expect(canScheduleTransition("scheduled", "cancelled").ok).toBe(true)
  })

  it("partially_recognized → recognized allowed", () => {
    expect(canScheduleTransition("partially_recognized", "recognized").ok).toBe(true)
  })

  it("recognized → anything rejected (terminal)", () => {
    for (const to of ["scheduled", "partially_recognized", "cancelled"] as const) {
      expect(canScheduleTransition("recognized", to).ok).toBe(false)
    }
    expect(isScheduleTerminal("recognized")).toBe(true)
  })

  it("scheduleAllowedNext matches table", () => {
    for (const s of SCHEDULE_STATUSES) {
      expect(scheduleAllowedNext(s)).toEqual(SCHEDULE_TRANSITIONS[s])
    }
  })
})

/* ─── Allocation engine ───────────────────────────────────────────────── */

describe("M4 — allocation-engine", () => {
  it("single PO gets full contract total", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 100_000,
      currency: "USD",
      obligations: [{ id: "po1", ssp: null }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.allocations[0].allocatedMinor).toBe(100_000)
  })

  it("multi-PO with equal SSPs splits evenly", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 90_000,
      currency: "USD",
      obligations: [
        { id: "a", ssp: 30_000 },
        { id: "b", ssp: 30_000 },
        { id: "c", ssp: 30_000 },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      for (const a of r.allocations) expect(a.allocatedMinor).toBe(30_000)
    }
  })

  it("multi-PO with weighted SSPs allocates proportionally", () => {
    // SSP weights 60:30:10 → 60K / 30K / 10K
    const r = allocateTransactionPrice({
      contractTotalMinor: 100_000,
      currency: "USD",
      obligations: [
        { id: "a", ssp: 60_000 },
        { id: "b", ssp: 30_000 },
        { id: "c", ssp: 10_000 },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const map = Object.fromEntries(r.allocations.map((a) => [a.id, a.allocatedMinor]))
      expect(map.a).toBe(60_000)
      expect(map.b).toBe(30_000)
      expect(map.c).toBe(10_000)
    }
  })

  it("rounding remainder distributed to earliest POs (sum-invariant)", () => {
    // 100 / 3 → 33.33... — base 33 each, remainder 1 → first PO gets +1.
    const r = allocateTransactionPrice({
      contractTotalMinor: 100,
      currency: "USD",
      obligations: [
        { id: "a", ssp: 100 },
        { id: "b", ssp: 100 },
        { id: "c", ssp: 100 },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.allocations[0].allocatedMinor).toBe(34)
      expect(r.allocations[1].allocatedMinor).toBe(33)
      expect(r.allocations[2].allocatedMinor).toBe(33)
      const sum = r.allocations.reduce((acc, a) => acc + a.allocatedMinor, 0)
      expect(sum).toBe(100)
    }
  })

  it("all-null SSP equal-split fallback (sum-invariant)", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 1000,
      currency: "USD",
      obligations: [
        { id: "a", ssp: null },
        { id: "b", ssp: null },
        { id: "c", ssp: null },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const sum = r.allocations.reduce((acc, a) => acc + a.allocatedMinor, 0)
      expect(sum).toBe(1000)
    }
  })

  it("rejects mixed null + non-null SSPs (ambiguous)", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 1000,
      currency: "USD",
      obligations: [
        { id: "a", ssp: 500 },
        { id: "b", ssp: null },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/mixed/)
  })

  it("rejects sum(SSP) == 0 (divide-by-zero guard)", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 1000,
      currency: "USD",
      obligations: [
        { id: "a", ssp: 0 },
        { id: "b", ssp: 0 },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/sum of SSPs is 0/)
  })

  it("rejects non-integer contractTotalMinor", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 100.5 as unknown as number,
      currency: "USD",
      obligations: [{ id: "a", ssp: null }],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative contractTotalMinor", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: -100,
      currency: "USD",
      obligations: [{ id: "a", ssp: null }],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad currency", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 100,
      currency: "usd",
      obligations: [{ id: "a", ssp: null }],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty obligations", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 100,
      currency: "USD",
      obligations: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects zero contract total with single PO (still produces 0)", () => {
    // Zero is non-negative integer → valid input. PO gets 0.
    const r = allocateTransactionPrice({
      contractTotalMinor: 0,
      currency: "USD",
      obligations: [{ id: "a", ssp: 100 }, { id: "b", ssp: 100 }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.allocations.every((a) => a.allocatedMinor === 0)).toBe(true)
    }
  })

  it("100/7 split distributes remainder to first POs", () => {
    const r = allocateTransactionPrice({
      contractTotalMinor: 100,
      currency: "USD",
      obligations: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, ssp: null })),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const sum = r.allocations.reduce((acc, a) => acc + a.allocatedMinor, 0)
      expect(sum).toBe(100)
      // First 2 get 15, rest get 14 (100 = 7*14 + 2).
      expect(r.allocations[0].allocatedMinor).toBe(15)
      expect(r.allocations[1].allocatedMinor).toBe(15)
      expect(r.allocations[2].allocatedMinor).toBe(14)
    }
  })
})

/* ─── Schedule generator ──────────────────────────────────────────────── */

describe("M4 — schedule-generator", () => {
  const periodStart = new Date(Date.UTC(2026, 0, 1))
  const periodEnd = new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999))

  it("point_in_time emits 1 line at periodEnd", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "point_in_time",
      allocatedMinor: 100_000,
      currency: "USD",
      periodStart,
      periodEnd,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lines).toHaveLength(1)
      expect(r.lines[0].scheduledMinor).toBe(100_000)
      expect(r.lines[0].lineNumber).toBe(1)
      expect(r.lines[0].label).toBe("point-in-time")
    }
  })

  it("over_time_straight_line: 12 months for full year", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "over_time_straight_line",
      allocatedMinor: 12_000,
      currency: "USD",
      periodStart,
      periodEnd,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lines).toHaveLength(12)
      for (const line of r.lines) {
        expect(line.scheduledMinor).toBe(1_000)
      }
    }
  })

  it("over_time_straight_line: remainder distributed earliest-first", () => {
    // 1000 / 12 = 83 base + 4 remainder → first 4 months get 84, rest 83.
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "over_time_straight_line",
      allocatedMinor: 1000,
      currency: "USD",
      periodStart,
      periodEnd,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const sum = r.lines.reduce((acc, l) => acc + l.scheduledMinor, 0)
      expect(sum).toBe(1000)
      expect(r.lines[0].scheduledMinor).toBe(84)
      expect(r.lines[3].scheduledMinor).toBe(84)
      expect(r.lines[4].scheduledMinor).toBe(83)
    }
  })

  it("over_time_straight_line: single-month period emits 1 line", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "over_time_straight_line",
      allocatedMinor: 5_000,
      currency: "USD",
      periodStart: new Date(Date.UTC(2026, 5, 1)),
      periodEnd: new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lines).toHaveLength(1)
      expect(r.lines[0].scheduledMinor).toBe(5_000)
    }
  })

  it("milestone: weighted distribution", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "milestone",
      allocatedMinor: 100_000,
      currency: "USD",
      periodStart,
      periodEnd,
      milestones: [
        { label: "Kickoff", dueAt: new Date(Date.UTC(2026, 0, 15)), weight: 1 },
        { label: "Midpoint", dueAt: new Date(Date.UTC(2026, 5, 30)), weight: 2 },
        { label: "Final", dueAt: new Date(Date.UTC(2026, 11, 15)), weight: 1 },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Weights 1:2:1 → 25K : 50K : 25K
      expect(r.lines[0].scheduledMinor).toBe(25_000)
      expect(r.lines[1].scheduledMinor).toBe(50_000)
      expect(r.lines[2].scheduledMinor).toBe(25_000)
      expect(r.lines[0].label).toBe("Kickoff")
    }
  })

  it("milestone: rejects empty milestone list", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "milestone",
      allocatedMinor: 100_000,
      currency: "USD",
      periodStart,
      periodEnd,
      milestones: [],
    })
    expect(r.ok).toBe(false)
  })

  it("milestone: rejects out-of-period dueAt", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "milestone",
      allocatedMinor: 100_000,
      currency: "USD",
      periodStart,
      periodEnd,
      milestones: [
        { label: "Way Future", dueAt: new Date(Date.UTC(2027, 5, 1)), weight: 1 },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it("milestone: rejects zero / negative weight", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "milestone",
      allocatedMinor: 100_000,
      currency: "USD",
      periodStart,
      periodEnd,
      milestones: [{ label: "X", dueAt: periodStart, weight: 0 }],
    })
    expect(r.ok).toBe(false)
  })

  it("usage_based: emits single bookkeeping line", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "usage_based",
      allocatedMinor: 50_000,
      currency: "USD",
      periodStart,
      periodEnd,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lines).toHaveLength(1)
      expect(r.lines[0].label).toBe("usage-based-bucket")
    }
  })

  it("rejects unknown method", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "frob" as never,
      allocatedMinor: 1000,
      currency: "USD",
      periodStart,
      periodEnd,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects periodEnd < periodStart", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "point_in_time",
      allocatedMinor: 1000,
      currency: "USD",
      periodStart: periodEnd,
      periodEnd: periodStart,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bad currency / negative allocation", () => {
    const r1 = generateSchedule({
      performanceObligationId: "po1",
      method: "point_in_time",
      allocatedMinor: -1,
      currency: "USD",
      periodStart,
      periodEnd,
    })
    expect(r1.ok).toBe(false)
    const r2 = generateSchedule({
      performanceObligationId: "po1",
      method: "point_in_time",
      allocatedMinor: 1,
      currency: "usd",
      periodStart,
      periodEnd,
    })
    expect(r2.ok).toBe(false)
  })
})

/* ─── Recognition calculator ──────────────────────────────────────────── */

describe("M4 — recognition-calculator", () => {
  const periodStart = new Date(Date.UTC(2026, 5, 1))
  const periodEnd = new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999))

  it("point_in_time: 0 before periodEnd", () => {
    const r = calculateRecognition({
      scheduledMinor: 10_000,
      postedToDateMinor: 0,
      periodStart,
      periodEnd,
      method: "point_in_time",
      asOf: new Date(Date.UTC(2026, 5, 15)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(0)
      expect(r.calc.suggestedStatus).toBe("scheduled")
    }
  })

  it("point_in_time: full amount at/after periodEnd", () => {
    const r = calculateRecognition({
      scheduledMinor: 10_000,
      postedToDateMinor: 0,
      periodStart,
      periodEnd,
      method: "point_in_time",
      asOf: new Date(Date.UTC(2026, 6, 1)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(10_000)
      expect(r.calc.cumulativeMinor).toBe(10_000)
      expect(r.calc.suggestedStatus).toBe("recognized")
    }
  })

  it("over_time_straight_line: pro-rata at midpoint", () => {
    // June has 30 days. Midpoint (June 15) = ~14.something days in / 29.something.
    // Easier: test exactly at half via custom period.
    const start = new Date(Date.UTC(2026, 0, 1))
    const end = new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999))
    const halfPoint = new Date(Date.UTC(2026, 6, 2, 11, 59, 59, 999)) // ~ exact midpoint of year
    const r = calculateRecognition({
      scheduledMinor: 12_000,
      postedToDateMinor: 0,
      periodStart: start,
      periodEnd: end,
      method: "over_time_straight_line",
      asOf: halfPoint,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // ~50% → ~6000 minor units (within 1 due to integer math).
      expect(Math.abs(r.calc.postNowMinor - 6000)).toBeLessThan(2)
    }
  })

  it("over_time_straight_line: full amount at/after periodEnd", () => {
    const r = calculateRecognition({
      scheduledMinor: 12_000,
      postedToDateMinor: 0,
      periodStart,
      periodEnd,
      method: "over_time_straight_line",
      asOf: new Date(Date.UTC(2027, 0, 1)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(12_000)
      expect(r.calc.suggestedStatus).toBe("recognized")
    }
  })

  it("over_time_straight_line: 0 before periodStart", () => {
    const r = calculateRecognition({
      scheduledMinor: 12_000,
      postedToDateMinor: 0,
      periodStart,
      periodEnd,
      method: "over_time_straight_line",
      asOf: new Date(Date.UTC(2026, 0, 1)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(0)
      expect(r.calc.suggestedStatus).toBe("scheduled")
    }
  })

  it("postNow accounts for postedToDate (catch-up)", () => {
    // Already posted 3000 minor units, asOf at periodEnd → catch up to 12_000.
    const r = calculateRecognition({
      scheduledMinor: 12_000,
      postedToDateMinor: 3_000,
      periodStart,
      periodEnd,
      method: "over_time_straight_line",
      asOf: new Date(Date.UTC(2027, 0, 1)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(9_000)
      expect(r.calc.cumulativeMinor).toBe(12_000)
    }
  })

  it("postNow >= 0 even if ahead of pro-rata (no reversals here)", () => {
    // Posted 10K already, but pro-rata target is 6K. Helper returns 0,
    // not -4K. Reversals are slice-2 caller-side.
    const r = calculateRecognition({
      scheduledMinor: 12_000,
      postedToDateMinor: 10_000,
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)),
      method: "over_time_straight_line",
      asOf: new Date(Date.UTC(2026, 5, 1)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(0)
      expect(r.calc.cumulativeMinor).toBe(10_000)
    }
  })

  it("milestone: all-or-nothing at dueAt", () => {
    const r = calculateRecognition({
      scheduledMinor: 25_000,
      postedToDateMinor: 0,
      // Milestone schedule line has periodStart == periodEnd == dueAt.
      periodStart: new Date(Date.UTC(2026, 5, 15)),
      periodEnd: new Date(Date.UTC(2026, 5, 15)),
      method: "milestone",
      asOf: new Date(Date.UTC(2026, 5, 15)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(25_000)
      expect(r.calc.suggestedStatus).toBe("recognized")
    }
  })

  it("usage_based: surfaces 0 + current cumulative (slice-2 helper handles)", () => {
    const r = calculateRecognition({
      scheduledMinor: 50_000,
      postedToDateMinor: 12_000,
      periodStart,
      periodEnd,
      method: "usage_based",
      asOf: new Date(Date.UTC(2026, 5, 15)),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calc.postNowMinor).toBe(0)
      expect(r.calc.cumulativeMinor).toBe(12_000)
      expect(r.calc.suggestedStatus).toBe("partially_recognized")
    }
  })

  it("rejects postedToDate > scheduled (reversal territory)", () => {
    const r = calculateRecognition({
      scheduledMinor: 1000,
      postedToDateMinor: 1500,
      periodStart,
      periodEnd,
      method: "point_in_time",
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative postedToDate", () => {
    const r = calculateRecognition({
      scheduledMinor: 1000,
      postedToDateMinor: -1,
      periodStart,
      periodEnd,
      method: "point_in_time",
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects invalid Dates / bad period", () => {
    const r = calculateRecognition({
      scheduledMinor: 1000,
      postedToDateMinor: 0,
      periodStart: new Date(NaN),
      periodEnd,
      method: "point_in_time",
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown method", () => {
    const r = calculateRecognition({
      scheduledMinor: 1000,
      postedToDateMinor: 0,
      periodStart,
      periodEnd,
      method: "frob" as never,
      asOf: new Date(),
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("M4 — registry drift guards", () => {
  it("PO_STATUSES exactly 5", () => {
    expect(PO_STATUSES).toEqual(["draft", "scheduled", "in_progress", "completed", "cancelled"])
  })

  it("SCHEDULE_STATUSES exactly 4", () => {
    expect(SCHEDULE_STATUSES).toEqual([
      "scheduled",
      "partially_recognized",
      "recognized",
      "cancelled",
    ])
  })

  it("RECOGNITION_METHODS exactly 4", () => {
    expect(RECOGNITION_METHODS).toEqual([
      "point_in_time",
      "over_time_straight_line",
      "milestone",
      "usage_based",
    ])
  })

  it("PO_TRANSITIONS covers every status", () => {
    for (const s of PO_STATUSES) {
      expect(PO_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("SCHEDULE_TRANSITIONS covers every status", () => {
    for (const s of SCHEDULE_STATUSES) {
      expect(SCHEDULE_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal PO states are exactly completed/cancelled", () => {
    const terminals = PO_STATUSES.filter((s) => PO_TRANSITIONS[s].length === 0)
    expect(terminals.sort()).toEqual(["cancelled", "completed"])
  })

  it("Terminal Schedule states are exactly recognized/cancelled", () => {
    const terminals = SCHEDULE_STATUSES.filter((s) => SCHEDULE_TRANSITIONS[s].length === 0)
    expect(terminals.sort()).toEqual(["cancelled", "recognized"])
  })
})

/* ─── Post-architect fixes (slice-1 pass-1 closes) ────────────────────── */

describe("M4 — milestone integer-weight enforcement (architect-pass)", () => {
  const periodStart = new Date(Date.UTC(2026, 0, 1))
  const periodEnd = new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999))

  it("rejects fractional weight (Float discipline)", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "milestone",
      allocatedMinor: 1000,
      currency: "USD",
      periodStart,
      periodEnd,
      milestones: [
        { label: "Half", dueAt: periodStart, weight: 1.5 },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/positive integer/)
  })

  it("accepts integer weights", () => {
    const r = generateSchedule({
      performanceObligationId: "po1",
      method: "milestone",
      allocatedMinor: 1000,
      currency: "USD",
      periodStart,
      periodEnd,
      milestones: [
        { label: "X", dueAt: periodStart, weight: 1 },
        { label: "Y", dueAt: periodEnd, weight: 3 },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // weights 1:3 → 250 / 750
      expect(r.lines[0].scheduledMinor).toBe(250)
      expect(r.lines[1].scheduledMinor).toBe(750)
    }
  })
})

describe("M4 — BigInt overflow safety (architect-pass)", () => {
  it("allocation: handles contractTotal × ssp > Number.MAX_SAFE_INTEGER", () => {
    // contractTotal = $1B in minor units = 1e11; ssp values similar.
    // Product 1e11 × 1e11 = 1e22 (>> 2^53). BigInt path saves us.
    const r = allocateTransactionPrice({
      contractTotalMinor: 100_000_000_000, // $1B
      currency: "USD",
      obligations: [
        { id: "a", ssp: 100_000_000_000 },
        { id: "b", ssp: 100_000_000_000 },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 50/50 split (both equal SSP).
      expect(r.allocations[0].allocatedMinor).toBe(50_000_000_000)
      expect(r.allocations[1].allocatedMinor).toBe(50_000_000_000)
    }
  })

  it("recognition over_time: handles scheduledMinor × elapsed_ms > 2^53", () => {
    // scheduled = $10M minor (1e9), elapsed ~ 10 years in ms (~3.15e11)
    // → product 3.15e20 > 2^53.
    const start = new Date(Date.UTC(2020, 0, 1))
    const end = new Date(Date.UTC(2030, 0, 1))
    const halfPoint = new Date(Date.UTC(2025, 0, 1))
    const r = calculateRecognition({
      scheduledMinor: 1_000_000_000, // $10M in cents
      postedToDateMinor: 0,
      periodStart: start,
      periodEnd: end,
      method: "over_time_straight_line",
      asOf: halfPoint,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Roughly half — within rounding tolerance.
      expect(Math.abs(r.calc.postNowMinor - 500_000_000)).toBeLessThan(1_000_000)
    }
  })
})

describe("M4 — recognition over_time boundary semantics", () => {
  const start = new Date(Date.UTC(2026, 5, 1))
  const end = new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999))

  it("asOf == periodStart → cumulativeTarget = 0", () => {
    const r = calculateRecognition({
      scheduledMinor: 1000,
      postedToDateMinor: 0,
      periodStart: start,
      periodEnd: end,
      method: "over_time_straight_line",
      asOf: start, // boundary
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.calc.postNowMinor).toBe(0)
  })

  it("asOf == periodEnd → cumulativeTarget = full", () => {
    const r = calculateRecognition({
      scheduledMinor: 1000,
      postedToDateMinor: 0,
      periodStart: start,
      periodEnd: end,
      method: "over_time_straight_line",
      asOf: end, // boundary
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.calc.postNowMinor).toBe(1000)
  })
})

describe("M4 — decimalToMinor + minorToDecimalString helper", () => {
  it("currencyExponent returns 2 for USD/EUR/AZN", () => {
    expect(currencyExponent("USD")).toBe(2)
    expect(currencyExponent("EUR")).toBe(2)
    expect(currencyExponent("AZN")).toBe(2)
  })

  it("currencyExponent returns 0 for JPY/KRW", () => {
    expect(currencyExponent("JPY")).toBe(0)
    expect(currencyExponent("KRW")).toBe(0)
  })

  it("currencyExponent returns 3 for BHD/KWD", () => {
    expect(currencyExponent("BHD")).toBe(3)
    expect(currencyExponent("KWD")).toBe(3)
  })

  it("currencyExponent defaults to 2 for unknown / invalid", () => {
    expect(currencyExponent("XYZ")).toBe(2)
    expect(currencyExponent("invalid")).toBe(2)
  })

  it("decimalToMinor converts USD 12.34 → 1234", () => {
    const r = decimalToMinor("12.34", "USD")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.minor).toBe(1234)
      expect(r.exponent).toBe(2)
    }
  })

  it("decimalToMinor converts USD 12 → 1200 (no fractional part)", () => {
    const r = decimalToMinor("12", "USD")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.minor).toBe(1200)
  })

  it("decimalToMinor converts JPY 12345 → 12345 (0 minor)", () => {
    const r = decimalToMinor("12345", "JPY")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.minor).toBe(12345)
  })

  it("decimalToMinor converts BHD 1.234 → 1234 (3 minor)", () => {
    const r = decimalToMinor("1.234", "BHD")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.minor).toBe(1234)
  })

  it("decimalToMinor rejects USD 12.345 (too many decimals)", () => {
    const r = decimalToMinor("12.345", "USD")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/fractional digits/)
  })

  it("decimalToMinor accepts trailing zeros (USD 12.500)", () => {
    const r = decimalToMinor("12.500", "USD")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.minor).toBe(1250)
  })

  it("decimalToMinor rejects negative", () => {
    const r = decimalToMinor("-1.00", "USD")
    expect(r.ok).toBe(false)
  })

  it("decimalToMinor rejects garbage strings", () => {
    expect(decimalToMinor("not a number", "USD").ok).toBe(false)
    expect(decimalToMinor("1.2.3", "USD").ok).toBe(false)
    expect(decimalToMinor("1e10", "USD").ok).toBe(false)
  })

  it("decimalToMinor rejects NaN / Infinity numbers", () => {
    expect(decimalToMinor(NaN, "USD").ok).toBe(false)
    expect(decimalToMinor(Infinity, "USD").ok).toBe(false)
  })

  it("decimalToMinor accepts a number input", () => {
    const r = decimalToMinor(99.99, "USD")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.minor).toBe(9999)
  })

  it("minorToDecimalString round-trips USD 1234 → '12.34'", () => {
    expect(minorToDecimalString(1234, "USD")).toBe("12.34")
  })

  it("minorToDecimalString handles JPY (no decimals)", () => {
    expect(minorToDecimalString(12345, "JPY")).toBe("12345")
  })

  it("minorToDecimalString pads short numbers (USD 5 → '0.05')", () => {
    expect(minorToDecimalString(5, "USD")).toBe("0.05")
  })
})
