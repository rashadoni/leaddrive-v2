/**
 * Tests for R9 Nonprofit Cloud slice 1 — donor roll-up + grant utilisation + volunteer aggregator.
 * No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import { aggregateDonorGiving } from "@/lib/nonprofit/donor-rollup"
import { computeGrantUtilisation } from "@/lib/nonprofit/grant-utilisation"
import { aggregateVolunteerHours } from "@/lib/nonprofit/volunteer-aggregator"
import type {
  DonationRow,
  GrantRow,
  VolunteerActivityRow,
} from "@/lib/nonprofit/types"

/* ─── aggregateDonorGiving ────────────────────────────────────────────── */

describe("R9 — aggregateDonorGiving", () => {
  const mk = (over: Partial<DonationRow>): DonationRow => ({
    id: "d_1",
    donorId: "donor_1",
    programId: null,
    amount: 100,
    currency: "USD",
    receivedAt: new Date("2026-01-15T00:00:00Z"),
    donationType: "one_time",
    ...over,
  })

  it("returns zero-everything rollup for a donor with no donations", () => {
    const r = aggregateDonorGiving({ donorId: "donor_1", donations: [] })
    expect(r).toMatchObject({
      donorId: "donor_1",
      lifetimeTotal: 0,
      donationCount: 0,
      largestGift: 0,
      firstGiftAt: null,
      mostRecentGiftAt: null,
      recurringTotal: 0,
      oneTimeTotal: 0,
      byYear: [],
      byProgram: [],
    })
  })

  it("sums lifetime + tracks count, largest, first, most recent", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ id: "1", amount: 100, receivedAt: new Date("2024-03-10T00:00:00Z") }),
        mk({ id: "2", amount: 500, receivedAt: new Date("2025-07-22T00:00:00Z") }),
        mk({ id: "3", amount: 250, receivedAt: new Date("2026-02-05T00:00:00Z") }),
      ],
    })
    expect(r.lifetimeTotal).toBe(850)
    expect(r.donationCount).toBe(3)
    expect(r.largestGift).toBe(500)
    expect(r.firstGiftAt?.toISOString()).toBe("2024-03-10T00:00:00.000Z")
    expect(r.mostRecentGiftAt?.toISOString()).toBe("2026-02-05T00:00:00.000Z")
  })

  it("splits recurring vs one-time totals", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ amount: 100, donationType: "one_time" }),
        mk({ amount: 50, donationType: "recurring" }),
        mk({ amount: 50, donationType: "recurring" }),
        mk({ amount: 200, donationType: "one_time" }),
      ],
    })
    expect(r.oneTimeTotal).toBe(300)
    expect(r.recurringTotal).toBe(100)
  })

  it("buckets by UTC year, descending, capped at maxYearBuckets", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ amount: 100, receivedAt: new Date("2022-01-01T00:00:00Z") }),
        mk({ amount: 200, receivedAt: new Date("2023-01-01T00:00:00Z") }),
        mk({ amount: 300, receivedAt: new Date("2024-01-01T00:00:00Z") }),
        mk({ amount: 400, receivedAt: new Date("2025-01-01T00:00:00Z") }),
        mk({ amount: 500, receivedAt: new Date("2026-01-01T00:00:00Z") }),
        mk({ amount: 600, receivedAt: new Date("2021-01-01T00:00:00Z") }), // 6th year — dropped
      ],
    })
    expect(r.byYear).toEqual([
      { year: 2026, total: 500, count: 1 },
      { year: 2025, total: 400, count: 1 },
      { year: 2024, total: 300, count: 1 },
      { year: 2023, total: 200, count: 1 },
      { year: 2022, total: 100, count: 1 },
    ])
  })

  it("buckets by program (sorted desc by total)", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ amount: 100, programId: "prog_A" }),
        mk({ amount: 300, programId: "prog_B" }),
        mk({ amount: 200, programId: "prog_A" }),
        mk({ amount: 50, programId: null }), // unaffiliated — excluded from byProgram
      ],
    })
    expect(r.byProgram).toEqual([
      { programId: "prog_A", total: 300, count: 2 },
      { programId: "prog_B", total: 300, count: 1 },
    ])
    // Lifetime still includes the unaffiliated 50.
    expect(r.lifetimeTotal).toBe(650)
  })

  it("ignores rows for other donors", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ donorId: "donor_1", amount: 100 }),
        mk({ donorId: "donor_2", amount: 999 }), // ignored
      ],
    })
    expect(r.lifetimeTotal).toBe(100)
  })

  it("ignores rows with invalid amount or date (defensive)", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ amount: 100 }),
        mk({ amount: NaN }),
        mk({ amount: -50 }),
        // Date.parse of garbage yields Invalid Date — receivedAt's
        // getTime() returns NaN, caught by the guard.
        mk({ amount: 50, receivedAt: new Date("not a date") }),
      ],
    })
    expect(r.lifetimeTotal).toBe(100)
    expect(r.donationCount).toBe(1)
  })

  it("custom maxYearBuckets caps the returned year list", () => {
    const r = aggregateDonorGiving({
      donorId: "donor_1",
      donations: [
        mk({ amount: 100, receivedAt: new Date("2023-01-01T00:00:00Z") }),
        mk({ amount: 200, receivedAt: new Date("2024-01-01T00:00:00Z") }),
        mk({ amount: 300, receivedAt: new Date("2025-01-01T00:00:00Z") }),
      ],
      maxYearBuckets: 2,
    })
    expect(r.byYear).toHaveLength(2)
    expect(r.byYear[0].year).toBe(2025)
    expect(r.byYear[1].year).toBe(2024)
  })
})

/* ─── computeGrantUtilisation ─────────────────────────────────────────── */

describe("R9 — computeGrantUtilisation", () => {
  const mk = (over: Partial<GrantRow> = {}): GrantRow => ({
    awardedAmount: 100_000,
    disbursedAmount: 60_000,
    spentAmount: 30_000,
    periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-12-31T23:59:59Z"),
    status: "active",
    ...over,
  })

  it("computes disbursed%, spent%, overall utilisation, remaining funds + pending disbursement", () => {
    const r = computeGrantUtilisation({
      grant: mk(),
      asOf: new Date("2026-06-30T00:00:00Z"),
    })
    expect(r.disbursedPct).toBeCloseTo(0.6, 6)
    expect(r.spentPct).toBeCloseTo(0.5, 6)
    expect(r.overallUtilisationPct).toBeCloseTo(0.3, 6)
    expect(r.remainingFunds).toBe(30_000)
    expect(r.pendingDisbursement).toBe(40_000)
    expect(r.daysRemainingInPeriod).toBeGreaterThan(0)
  })

  it("zero awarded → all percentages null", () => {
    const r = computeGrantUtilisation({
      grant: mk({ awardedAmount: 0, disbursedAmount: 0, spentAmount: 0 }),
    })
    expect(r.disbursedPct).toBeNull()
    expect(r.spentPct).toBeNull()
    expect(r.overallUtilisationPct).toBeNull()
  })

  it("zero disbursed → spentPct null", () => {
    const r = computeGrantUtilisation({
      grant: mk({ disbursedAmount: 0, spentAmount: 0 }),
    })
    expect(r.spentPct).toBeNull()
    expect(r.disbursedPct).toBe(0)
  })

  it("clamps negative storage corruption to 0 (defensive)", () => {
    const r = computeGrantUtilisation({
      grant: mk({ awardedAmount: -100, disbursedAmount: -50, spentAmount: -10 }),
    })
    expect(r.remainingFunds).toBe(0)
    expect(r.pendingDisbursement).toBe(0)
    expect(r.overallUtilisationPct).toBeNull()
  })

  it("clamps disbursed > awarded and spent > disbursed (data corruption guard)", () => {
    const r = computeGrantUtilisation({
      grant: mk({ awardedAmount: 100, disbursedAmount: 200, spentAmount: 300 }),
    })
    expect(r.disbursedPct).toBe(1) // clamped to 100/100
    expect(r.spentPct).toBe(1) // clamped to disbursed/disbursed
  })

  it("at-risk flag fires when spend lags elapsed by more than margin", () => {
    // Period 2026-01-01 to 2026-12-31. As of mid-year, expect ~50%
    // utilisation. Grant has only 10% spent → 40pp behind, > 20% margin.
    const r = computeGrantUtilisation({
      grant: mk({
        awardedAmount: 100_000,
        disbursedAmount: 60_000,
        spentAmount: 10_000, // 10% overall
      }),
      asOf: new Date("2026-07-01T00:00:00Z"), // ~50% elapsed
    })
    expect(r.atRisk).toBe(true)
  })

  it("at-risk false when on-track", () => {
    const r = computeGrantUtilisation({
      grant: mk({
        awardedAmount: 100_000,
        disbursedAmount: 60_000,
        spentAmount: 50_000, // 50% overall ≈ 50% elapsed
      }),
      asOf: new Date("2026-07-01T00:00:00Z"),
    })
    expect(r.atRisk).toBe(false)
  })

  it("at-risk false when period has ended (post-period, can't be at-risk)", () => {
    const r = computeGrantUtilisation({
      grant: mk({
        awardedAmount: 100_000,
        disbursedAmount: 60_000,
        spentAmount: 10_000,
      }),
      asOf: new Date("2027-06-01T00:00:00Z"), // way after period
    })
    expect(r.atRisk).toBe(false) // can't be at-risk after period end
    expect(r.daysRemainingInPeriod).toBeLessThan(0)
  })

  it("at-risk false when grant is not 'active' (e.g. reporting or closed)", () => {
    const r = computeGrantUtilisation({
      grant: mk({ spentAmount: 10_000, status: "reporting" }),
      asOf: new Date("2026-07-01T00:00:00Z"),
    })
    expect(r.atRisk).toBe(false)
  })

  it("daysRemainingInPeriod is null when no periodEnd set", () => {
    const r = computeGrantUtilisation({ grant: mk({ periodEnd: null }) })
    expect(r.daysRemainingInPeriod).toBeNull()
  })

  it("at-risk margin can be customised", () => {
    // Default 0.2 — would fire on a 20pp lag. Set 0.5 → 40pp lag is NOT at-risk.
    const r = computeGrantUtilisation({
      grant: mk({ spentAmount: 10_000 }), // 10% overall vs ~50% elapsed = 40pp lag
      asOf: new Date("2026-07-01T00:00:00Z"),
      atRiskMargin: 0.5,
    })
    expect(r.atRisk).toBe(false)
  })
})

/* ─── aggregateVolunteerHours ─────────────────────────────────────────── */

describe("R9 — aggregateVolunteerHours", () => {
  const mk = (over: Partial<VolunteerActivityRow>): VolunteerActivityRow => ({
    contactId: null,
    volunteerName: "Alice",
    programId: null,
    hoursLogged: 4,
    activityType: "event",
    occurredAt: new Date("2026-03-15T00:00:00Z"),
    ...over,
  })

  it("groups by volunteer (contactId preferred over name)", () => {
    const r = aggregateVolunteerHours({
      groupBy: "volunteer",
      activities: [
        mk({ contactId: "c1", volunteerName: "Alice", hoursLogged: 3 }),
        mk({ contactId: "c1", volunteerName: "Alice", hoursLogged: 2 }),
        mk({ contactId: null, volunteerName: "Bob", hoursLogged: 5 }),
      ],
    })
    const alice = r.find(b => b.label === "Alice")!
    expect(alice.totalHours).toBe(5)
    expect(alice.sessionCount).toBe(2)
    expect(alice.key).toBe("contact:c1")
    const bob = r.find(b => b.label === "Bob")!
    expect(bob.totalHours).toBe(5)
    expect(bob.key).toBe("name:Bob")
  })

  it("groups by program; unaffiliated rolls into a single bucket", () => {
    const r = aggregateVolunteerHours({
      groupBy: "program",
      activities: [
        mk({ programId: "prog_A", hoursLogged: 2 }),
        mk({ programId: "prog_A", hoursLogged: 3 }),
        mk({ programId: "prog_B", hoursLogged: 1 }),
        mk({ programId: null, hoursLogged: 4 }),
      ],
    })
    expect(r.find(b => b.label === "prog_A")?.totalHours).toBe(5)
    expect(r.find(b => b.label === "prog_B")?.totalHours).toBe(1)
    expect(r.find(b => b.label === "Unaffiliated")?.totalHours).toBe(4)
  })

  it("groups by month (UTC YYYY-MM)", () => {
    const r = aggregateVolunteerHours({
      groupBy: "month",
      activities: [
        mk({ hoursLogged: 2, occurredAt: new Date("2026-01-15T00:00:00Z") }),
        mk({ hoursLogged: 3, occurredAt: new Date("2026-01-31T23:59:59Z") }),
        mk({ hoursLogged: 5, occurredAt: new Date("2026-02-01T00:00:00Z") }),
      ],
    })
    expect(r.find(b => b.key === "2026-01")?.totalHours).toBe(5)
    expect(r.find(b => b.key === "2026-02")?.totalHours).toBe(5)
  })

  it("groups by activityType", () => {
    const r = aggregateVolunteerHours({
      groupBy: "type",
      activities: [
        mk({ activityType: "event", hoursLogged: 4 }),
        mk({ activityType: "event", hoursLogged: 2 }),
        mk({ activityType: "fundraising", hoursLogged: 3 }),
      ],
    })
    expect(r.find(b => b.key === "event")?.totalHours).toBe(6)
    expect(r.find(b => b.key === "fundraising")?.totalHours).toBe(3)
  })

  it("results sorted by totalHours desc", () => {
    const r = aggregateVolunteerHours({
      groupBy: "type",
      activities: [
        mk({ activityType: "event", hoursLogged: 2 }),
        mk({ activityType: "fundraising", hoursLogged: 10 }),
        mk({ activityType: "outreach", hoursLogged: 5 }),
      ],
    })
    expect(r.map(b => b.totalHours)).toEqual([10, 5, 2])
  })

  it("ignores invalid hoursLogged + invalid dates (defensive)", () => {
    const r = aggregateVolunteerHours({
      groupBy: "volunteer",
      activities: [
        mk({ volunteerName: "Alice", hoursLogged: 4 }),
        mk({ volunteerName: "Bob", hoursLogged: NaN }),
        mk({ volunteerName: "Carol", hoursLogged: -1 }),
        mk({ volunteerName: "Dan", hoursLogged: 2, occurredAt: new Date("not a date") }),
      ],
    })
    // Only Alice survives.
    expect(r).toHaveLength(1)
    expect(r[0].label).toBe("Alice")
  })

  it("empty input → empty result", () => {
    expect(aggregateVolunteerHours({ groupBy: "volunteer", activities: [] })).toEqual([])
  })
})
