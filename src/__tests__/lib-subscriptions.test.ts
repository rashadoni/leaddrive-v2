/**
 * Tests for D4 Subscription Management slice 1 — subscription state
 * machine + proration calculator + dunning scheduler + billing-period
 * calculator. No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import {
  advanceSubscriptionState,
  isTerminalSubscriptionState,
} from "@/lib/subscriptions/subscription-state-machine"
import { calculateProration } from "@/lib/subscriptions/proration-calculator"
import { scheduleNextDunningAttempt } from "@/lib/subscriptions/dunning-scheduler"
import {
  calculateInitialPeriod,
  calculateNextPeriod,
} from "@/lib/subscriptions/billing-period-calculator"
import type {
  BillingIntervalConfig,
  DunningConfig,
  SubscriptionStatus,
} from "@/lib/subscriptions/types"

/* ─── Subscription state machine ──────────────────────────────────────── */

describe("D4 — advanceSubscriptionState", () => {
  it("trial → active emits trialEnding side-effect (not 'activating')", () => {
    // Distinct from 'activating' because the caller emits a
    // `trial_ended` event in addition to the activation event.
    const r = advanceSubscriptionState({ from: "trial", to: "active" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("trialEnding")
  })

  it("trial → past_due also emits trialEnding side-effect", () => {
    // Same logic as above — the trial ending is what's being audited.
    const r = advanceSubscriptionState({ from: "trial", to: "past_due" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("trialEnding")
  })

  it("trial → cancelled emits cancelling (no trial_ended event needed)", () => {
    const r = advanceSubscriptionState({ from: "trial", to: "cancelled" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("cancelling")
  })

  it("active → past_due emits suspending", () => {
    const r = advanceSubscriptionState({ from: "active", to: "past_due" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("suspending")
  })

  it("active → paused emits pausing", () => {
    const r = advanceSubscriptionState({ from: "active", to: "paused" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("pausing")
  })

  it("active → cancelled emits cancelling", () => {
    const r = advanceSubscriptionState({ from: "active", to: "cancelled" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("cancelling")
  })

  it("past_due → active emits activating (dunning recovery)", () => {
    const r = advanceSubscriptionState({ from: "past_due", to: "active" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("activating")
  })

  it("past_due → cancelled emits cancelling (dunning exhausted)", () => {
    const r = advanceSubscriptionState({ from: "past_due", to: "cancelled" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("cancelling")
  })

  it("paused → active emits resuming (NOT activating)", () => {
    // Distinct from past_due → active because the side-effect
    // populates `resumedAt`, not just status.
    const r = advanceSubscriptionState({ from: "paused", to: "active" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("resuming")
  })

  it("paused → cancelled emits cancelling", () => {
    const r = advanceSubscriptionState({ from: "paused", to: "cancelled" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("cancelling")
  })

  it("rejects same-state no-op", () => {
    const r = advanceSubscriptionState({ from: "active", to: "active" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no-op/i)
  })

  it("rejects leaving the cancelled terminal", () => {
    const r = advanceSubscriptionState({ from: "cancelled", to: "active" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects trial → paused (must go through active first)", () => {
    const r = advanceSubscriptionState({ from: "trial", to: "paused" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("rejects past_due → paused (must recover to active first)", () => {
    const r = advanceSubscriptionState({ from: "past_due", to: "paused" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("rejects paused → past_due (paused billing is halted — no due charge)", () => {
    const r = advanceSubscriptionState({ from: "paused", to: "past_due" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("isTerminalSubscriptionState matches documented terminals", () => {
    const terminal: SubscriptionStatus[] = ["cancelled"]
    const nonTerminal: SubscriptionStatus[] = ["trial", "active", "past_due", "paused"]
    for (const s of terminal) expect(isTerminalSubscriptionState(s)).toBe(true)
    for (const s of nonTerminal) expect(isTerminalSubscriptionState(s)).toBe(false)
  })
})

/* ─── Proration calculator ────────────────────────────────────────────── */

const PERIOD_START = new Date("2026-05-01T00:00:00Z")
const PERIOD_END = new Date("2026-05-31T00:00:00Z") // 30-day period
const MID_PERIOD = new Date("2026-05-16T00:00:00Z") // 15 days remaining

describe("D4 — calculateProration", () => {
  it("upgrade mid-cycle yields positive prorationAmount (net charge)", () => {
    // Old: $10/mo, New: $30/mo, 15/30 days remaining
    //   unusedCredit = 10 * 0.5 = 5
    //   newCharge    = 30 * 0.5 = 15
    //   net = 15 - 5 = +10 (customer owes)
    const r = calculateProration({
      currentUnitAmount: 10,
      newUnitAmount: 30,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: MID_PERIOD,
    })
    expect(r.daysInPeriod).toBe(30)
    expect(r.daysRemaining).toBe(15)
    expect(r.unusedCredit).toBe(5)
    expect(r.newCharge).toBe(15)
    expect(r.prorationAmount).toBe(10)
  })

  it("downgrade mid-cycle yields negative prorationAmount (credit)", () => {
    // Old: $30/mo, New: $10/mo, 15 days remaining
    //   unusedCredit = 30 * 0.5 = 15
    //   newCharge    = 10 * 0.5 = 5
    //   net = 5 - 15 = -10 (credit)
    const r = calculateProration({
      currentUnitAmount: 30,
      newUnitAmount: 10,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: MID_PERIOD,
    })
    expect(r.prorationAmount).toBe(-10)
  })

  it("lateral move (same price) yields zero prorationAmount", () => {
    const r = calculateProration({
      currentUnitAmount: 20,
      newUnitAmount: 20,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: MID_PERIOD,
    })
    expect(r.prorationAmount).toBe(0)
    expect(r.unusedCredit).toBe(10) // half of 20
    expect(r.newCharge).toBe(10)
  })

  it("change AT period end yields zero proration (no time remaining)", () => {
    const r = calculateProration({
      currentUnitAmount: 10,
      newUnitAmount: 30,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: PERIOD_END,
    })
    expect(r.prorationAmount).toBe(0)
    expect(r.daysRemaining).toBe(0)
  })

  it("change AFTER period end yields zero proration (past boundary)", () => {
    const r = calculateProration({
      currentUnitAmount: 10,
      newUnitAmount: 30,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: new Date("2026-06-15T00:00:00Z"),
    })
    expect(r.prorationAmount).toBe(0)
  })

  it("change AT period start yields full delta (full period remaining)", () => {
    // 30 days remaining of 30 → full price delta
    const r = calculateProration({
      currentUnitAmount: 10,
      newUnitAmount: 30,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: PERIOD_START,
    })
    expect(r.daysRemaining).toBe(30)
    expect(r.prorationAmount).toBe(20) // (30 - 10) full
  })

  it("degenerate period (start == end) returns zero proration", () => {
    const r = calculateProration({
      currentUnitAmount: 10,
      newUnitAmount: 30,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_START,
      asOf: PERIOD_START,
    })
    expect(r.prorationAmount).toBe(0)
    expect(r.daysInPeriod).toBe(0)
  })

  it("clamps asOf earlier than period start to NOT exceed 100% fraction", () => {
    // If caller passes asOf < start (clock skew / UI bug), the
    // daysRemaining math would technically yield > daysInPeriod —
    // clamp it to daysInPeriod so we never produce > full-delta.
    const r = calculateProration({
      currentUnitAmount: 10,
      newUnitAmount: 30,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      // asOf is one full year BEFORE start (deliberately bonkers)
      asOf: new Date("2025-05-01T00:00:00Z"),
    })
    // After clamping, daysRemaining must equal daysInPeriod.
    expect(r.daysRemaining).toBe(r.daysInPeriod)
    expect(r.prorationAmount).toBe(20)
  })

  it("rounds prorationAmount to 2 decimals", () => {
    // $9.99 → $11.99 mid-cycle (15/30 days) →
    //   unused = round2(9.99 * 0.5)  = round2(4.995)  = 5.00
    //   new    = round2(11.99 * 0.5) = round2(5.995)  = 6.00
    //   net    = round2(6.00 - 5.00) = 1.00
    const r = calculateProration({
      currentUnitAmount: 9.99,
      newUnitAmount: 11.99,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      asOf: MID_PERIOD,
    })
    expect(r.prorationAmount).toBe(1)
  })
})

/* ─── Dunning scheduler ───────────────────────────────────────────────── */

const FAILURE_AT = new Date("2026-05-01T00:00:00Z")
const DAY = 24 * 60 * 60 * 1000

describe("D4 — scheduleNextDunningAttempt", () => {
  it("attempt 1 schedules 1 day after initial failure (default config)", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 1,
      initialFailureAt: FAILURE_AT,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scheduledAt.getTime()).toBe(FAILURE_AT.getTime() + 1 * DAY)
      expect(r.isFinalAttempt).toBe(false)
    }
  })

  it("attempt 2 schedules 3 days after initial failure", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 2,
      initialFailureAt: FAILURE_AT,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.scheduledAt.getTime()).toBe(FAILURE_AT.getTime() + 3 * DAY)
  })

  it("attempt 3 schedules 7 days after initial failure", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 3,
      initialFailureAt: FAILURE_AT,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.scheduledAt.getTime()).toBe(FAILURE_AT.getTime() + 7 * DAY)
  })

  it("attempt 4 (default final) flags isFinalAttempt=true", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 4,
      initialFailureAt: FAILURE_AT,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scheduledAt.getTime()).toBe(FAILURE_AT.getTime() + 14 * DAY)
      expect(r.isFinalAttempt).toBe(true)
    }
  })

  it("rejects attempt 5 with default config (exceeds max)", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 5,
      initialFailureAt: FAILURE_AT,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds configured maximum 4/)
  })

  it("rejects attempt 0 and negative attempts", () => {
    for (const n of [0, -1]) {
      const r = scheduleNextDunningAttempt({
        attemptNumber: n,
        initialFailureAt: FAILURE_AT,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/positive integer/i)
    }
  })

  it("rejects non-integer attemptNumber", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 1.5,
      initialFailureAt: FAILURE_AT,
    })
    expect(r.ok).toBe(false)
  })

  it("honors custom dunning config (e.g. 2/4/8 days, 3-attempt max)", () => {
    const config: DunningConfig = { retryDelayDays: [2, 4, 8] }
    const r3 = scheduleNextDunningAttempt({
      attemptNumber: 3,
      initialFailureAt: FAILURE_AT,
      config,
    })
    expect(r3.ok).toBe(true)
    if (r3.ok) {
      expect(r3.scheduledAt.getTime()).toBe(FAILURE_AT.getTime() + 8 * DAY)
      expect(r3.isFinalAttempt).toBe(true)
    }
  })

  it("rejects empty retryDelayDays config", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 1,
      initialFailureAt: FAILURE_AT,
      config: { retryDelayDays: [] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty retryDelayDays/)
  })

  it("rejects non-positive entries in retryDelayDays", () => {
    const r = scheduleNextDunningAttempt({
      attemptNumber: 2,
      initialFailureAt: FAILURE_AT,
      config: { retryDelayDays: [1, 0, 7] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/retryDelayDays\[1\] = 0/)
  })
})

/* ─── Billing-period calculator ───────────────────────────────────────── */

const MAY_1 = new Date("2026-05-01T00:00:00Z")

describe("D4 — calculateNextPeriod", () => {
  it("monthly count=1: May 1 → May 1 to June 1", () => {
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "month", billingIntervalCount: 1 },
    })
    expect(r.currentPeriodStart.toISOString()).toBe(MAY_1.toISOString())
    expect(r.currentPeriodEnd.toISOString()).toBe("2026-06-01T00:00:00.000Z")
    expect(r.nextBillingAt.toISOString()).toBe(MAY_1.toISOString())
  })

  it("monthly count=3 (quarterly): May 1 → May 1 to Aug 1", () => {
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "month", billingIntervalCount: 3 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2026-08-01T00:00:00.000Z")
  })

  it("yearly count=1: May 1 2026 → May 1 2027", () => {
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "year", billingIntervalCount: 1 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2027-05-01T00:00:00.000Z")
  })

  it("weekly count=2: May 1 → May 15 (14 days)", () => {
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "week", billingIntervalCount: 2 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2026-05-15T00:00:00.000Z")
  })

  it("daily count=7: May 1 → May 8", () => {
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "day", billingIntervalCount: 7 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2026-05-08T00:00:00.000Z")
  })

  it("month-end clamping: Jan 31 + 1 month → Feb 28 (non-leap year)", () => {
    // Documented in module header — JS Date setUTCMonth clamps overflow.
    const r = calculateNextPeriod({
      from: new Date("2026-01-31T00:00:00Z"),
      config: { billingInterval: "month", billingIntervalCount: 1 },
    })
    // 2026 is non-leap → Feb 28
    expect(r.currentPeriodEnd.toISOString()).toBe("2026-02-28T00:00:00.000Z")
  })

  it("month-end clamping: Jan 31 + 1 month → Feb 29 (leap year 2024)", () => {
    const r = calculateNextPeriod({
      from: new Date("2024-01-31T00:00:00Z"),
      config: { billingInterval: "month", billingIntervalCount: 1 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2024-02-29T00:00:00.000Z")
  })

  it("yearly leap-day clamp: Feb 29 2024 + 1 year → Feb 28 2025", () => {
    const r = calculateNextPeriod({
      from: new Date("2024-02-29T00:00:00Z"),
      config: { billingInterval: "year", billingIntervalCount: 1 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2025-02-28T00:00:00.000Z")
  })

  it("returns nextBillingAt === currentPeriodStart (Stripe convention)", () => {
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "month", billingIntervalCount: 1 },
    })
    expect(r.nextBillingAt.getTime()).toBe(r.currentPeriodStart.getTime())
  })

  it("rejects non-positive billingIntervalCount via defensive no-op", () => {
    // Defense-in-depth — DB CHECK prevents this, but the helper
    // should not produce a negative-length period if a stale row
    // somehow has count <= 0. Returns degenerate (start = end).
    const r = calculateNextPeriod({
      from: MAY_1,
      config: { billingInterval: "month", billingIntervalCount: 0 } as BillingIntervalConfig,
    })
    expect(r.currentPeriodStart.getTime()).toBe(r.currentPeriodEnd.getTime())
  })
})

/* ─── Initial-period calculator (trial-aware) ─────────────────────────── */

describe("D4 — calculateInitialPeriod", () => {
  const MONTHLY: BillingIntervalConfig = {
    billingInterval: "month",
    billingIntervalCount: 1,
  }

  it("with trialDays=14, creates a trial-status initial period ending 14d later", () => {
    const r = calculateInitialPeriod({
      anchor: MAY_1,
      trialDays: 14,
      config: MONTHLY,
    })
    expect(r.initialStatus).toBe("trial")
    expect(r.currentPeriodStart.toISOString()).toBe(MAY_1.toISOString())
    expect(r.trialEndsAt).not.toBeNull()
    expect(r.trialEndsAt!.toISOString()).toBe("2026-05-15T00:00:00.000Z")
    // For a trial, the period IS the trial — currentPeriodEnd === trialEndsAt.
    expect(r.currentPeriodEnd.toISOString()).toBe(r.trialEndsAt!.toISOString())
    // nextBillingAt fires at trial conversion.
    expect(r.nextBillingAt.toISOString()).toBe(r.trialEndsAt!.toISOString())
  })

  it("with trialDays=0, creates an active-status paid period immediately", () => {
    const r = calculateInitialPeriod({
      anchor: MAY_1,
      trialDays: 0,
      config: MONTHLY,
    })
    expect(r.initialStatus).toBe("active")
    expect(r.trialEndsAt).toBeNull()
    expect(r.currentPeriodStart.toISOString()).toBe(MAY_1.toISOString())
    expect(r.currentPeriodEnd.toISOString()).toBe("2026-06-01T00:00:00.000Z")
    // No trial → bill now (Stripe convention).
    expect(r.nextBillingAt.toISOString()).toBe(MAY_1.toISOString())
  })

  it("trial-day count uses calendar days, NOT month-clamping", () => {
    // Anchor Jan 31, trial 31 days → trial ends Mar 3 (straight calendar
    // days; trial is denominated in DAYS not months, so the addMonths
    // clamp does NOT apply here). Matches Stripe's trial_period_days
    // semantics.
    const r = calculateInitialPeriod({
      anchor: new Date("2026-01-31T00:00:00Z"),
      trialDays: 31,
      config: MONTHLY,
    })
    expect(r.trialEndsAt!.toISOString()).toBe("2026-03-03T00:00:00.000Z")
  })

  it("negative trialDays treated as no-trial (defense-in-depth — DB CHECK rejects writes)", () => {
    const r = calculateInitialPeriod({
      anchor: MAY_1,
      trialDays: -7,
      config: MONTHLY,
    })
    expect(r.initialStatus).toBe("active")
    expect(r.trialEndsAt).toBeNull()
  })

  it("yearly plan with no trial: full year period", () => {
    const r = calculateInitialPeriod({
      anchor: MAY_1,
      trialDays: 0,
      config: { billingInterval: "year", billingIntervalCount: 1 },
    })
    expect(r.currentPeriodEnd.toISOString()).toBe("2027-05-01T00:00:00.000Z")
  })
})
