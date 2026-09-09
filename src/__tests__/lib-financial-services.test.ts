/**
 * Tests for R1 Financial Services slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  accountAllowedNext,
  canAccountTransition,
  canGoalTransition,
  canHouseholdTransition,
  canKycTransition,
  canLifeEventOutreachTransition,
  goalAllowedNext,
  householdAllowedNext,
  isAccountStatus,
  isAccountTerminal,
  isGoalStatus,
  isGoalTerminal,
  isHouseholdStatus,
  isHouseholdTerminal,
  isKycStatus,
  isKycTerminal,
  isLifeEventOutreachStatus,
  isLifeEventOutreachTerminal,
  kycAllowedNext,
  lifeEventOutreachAllowedNext,
} from "@/lib/financial-services/state-machine"
import { calculateAum } from "@/lib/financial-services/aum-calculator"
import { calculateGoalProgress } from "@/lib/financial-services/goal-progress-calculator"
import { validateKyc } from "@/lib/financial-services/kyc-validator"
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TRANSITIONS,
  ACCOUNT_TYPES,
  DEFAULT_KYC_REQUIREMENTS,
  GOAL_STATUSES,
  GOAL_TRANSITIONS,
  GOAL_TYPES,
  HOUSEHOLD_STATUSES,
  HOUSEHOLD_TRANSITIONS,
  KYC_FIELDS,
  KYC_STATUSES,
  KYC_TRANSITIONS,
  LIABILITY_ACCOUNT_TYPES,
  LIFE_EVENT_OUTREACH_STATUSES,
  LIFE_EVENT_OUTREACH_TRANSITIONS,
  LIFE_EVENT_TYPES,
  MEMBER_ROLES,
  type AccountSnapshot,
  type KycMemberData,
} from "@/lib/financial-services/types"

/* ─── State machines ──────────────────────────────────────────────────── */

describe("R1 — household state-machine", () => {
  it("accepts every canonical status", () => {
    for (const s of HOUSEHOLD_STATUSES) expect(isHouseholdStatus(s)).toBe(true)
  })

  it("prospect → active / closed", () => {
    expect(canHouseholdTransition("prospect", "active").ok).toBe(true)
    expect(canHouseholdTransition("prospect", "closed").ok).toBe(true)
  })

  it("active → inactive / closed", () => {
    expect(canHouseholdTransition("active", "inactive").ok).toBe(true)
    expect(canHouseholdTransition("active", "closed").ok).toBe(true)
  })

  it("inactive → active resumes the relationship", () => {
    expect(canHouseholdTransition("inactive", "active").ok).toBe(true)
  })

  it("closed is terminal", () => {
    expect(isHouseholdTerminal("closed")).toBe(true)
  })

  it("rejects self-transition", () => {
    for (const s of HOUSEHOLD_STATUSES) {
      expect(canHouseholdTransition(s, s).ok).toBe(false)
    }
  })

  it("householdAllowedNext matches table", () => {
    for (const s of HOUSEHOLD_STATUSES) {
      expect(householdAllowedNext(s)).toEqual(HOUSEHOLD_TRANSITIONS[s])
    }
  })
})

describe("R1 — KYC state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of KYC_STATUSES) expect(isKycStatus(s)).toBe(true)
  })

  it("not_started → in_review only", () => {
    expect(canKycTransition("not_started", "in_review").ok).toBe(true)
    expect(canKycTransition("not_started", "approved").ok).toBe(false)
  })

  it("in_review → approved / rejected", () => {
    expect(canKycTransition("in_review", "approved").ok).toBe(true)
    expect(canKycTransition("in_review", "rejected").ok).toBe(true)
  })

  it("rejected → in_review (reapply)", () => {
    expect(canKycTransition("rejected", "in_review").ok).toBe(true)
  })

  it("expired → in_review (renewal)", () => {
    expect(canKycTransition("expired", "in_review").ok).toBe(true)
  })

  it("approved → expired (periodic re-verification)", () => {
    expect(canKycTransition("approved", "expired").ok).toBe(true)
  })

  it("kycAllowedNext matches table", () => {
    for (const s of KYC_STATUSES) {
      expect(kycAllowedNext(s)).toEqual(KYC_TRANSITIONS[s])
    }
  })
})

describe("R1 — account state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of ACCOUNT_STATUSES) expect(isAccountStatus(s)).toBe(true)
  })

  it("pending → open / closed", () => {
    expect(canAccountTransition("pending", "open").ok).toBe(true)
    expect(canAccountTransition("pending", "closed").ok).toBe(true)
  })

  it("open → frozen / closed", () => {
    expect(canAccountTransition("open", "frozen").ok).toBe(true)
    expect(canAccountTransition("open", "closed").ok).toBe(true)
  })

  it("frozen → open / closed (compliance unfreeze)", () => {
    expect(canAccountTransition("frozen", "open").ok).toBe(true)
  })

  it("closed is terminal", () => {
    expect(isAccountTerminal("closed")).toBe(true)
  })

  it("accountAllowedNext matches table", () => {
    for (const s of ACCOUNT_STATUSES) {
      expect(accountAllowedNext(s)).toEqual(ACCOUNT_TRANSITIONS[s])
    }
  })
})

describe("R1 — goal state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of GOAL_STATUSES) expect(isGoalStatus(s)).toBe(true)
  })

  it("active → achieved / abandoned / paused", () => {
    for (const to of ["achieved", "abandoned", "paused"] as const) {
      expect(canGoalTransition("active", to).ok).toBe(true)
    }
  })

  it("paused → active / abandoned", () => {
    expect(canGoalTransition("paused", "active").ok).toBe(true)
    expect(canGoalTransition("paused", "abandoned").ok).toBe(true)
  })

  it("achieved / abandoned are terminal", () => {
    expect(isGoalTerminal("achieved")).toBe(true)
    expect(isGoalTerminal("abandoned")).toBe(true)
  })

  it("goalAllowedNext matches table", () => {
    for (const s of GOAL_STATUSES) {
      expect(goalAllowedNext(s)).toEqual(GOAL_TRANSITIONS[s])
    }
  })
})

describe("R1 — life event outreach state-machine", () => {
  it("accepts canonical statuses", () => {
    for (const s of LIFE_EVENT_OUTREACH_STATUSES) {
      expect(isLifeEventOutreachStatus(s)).toBe(true)
    }
  })

  it("logged → acknowledged / actioned / dismissed", () => {
    for (const to of ["acknowledged", "actioned", "dismissed"] as const) {
      expect(canLifeEventOutreachTransition("logged", to).ok).toBe(true)
    }
  })

  it("acknowledged → actioned / dismissed", () => {
    expect(canLifeEventOutreachTransition("acknowledged", "actioned").ok).toBe(true)
    expect(canLifeEventOutreachTransition("acknowledged", "dismissed").ok).toBe(true)
  })

  it("actioned / dismissed are terminal", () => {
    expect(isLifeEventOutreachTerminal("actioned")).toBe(true)
    expect(isLifeEventOutreachTerminal("dismissed")).toBe(true)
  })

  it("lifeEventOutreachAllowedNext matches table", () => {
    for (const s of LIFE_EVENT_OUTREACH_STATUSES) {
      expect(lifeEventOutreachAllowedNext(s)).toEqual(LIFE_EVENT_OUTREACH_TRANSITIONS[s])
    }
  })
})

/* ─── AUM calculator ──────────────────────────────────────────────────── */

describe("R1 — aum-calculator", () => {
  function mkAcct(
    accountType: AccountSnapshot["accountType"],
    balanceMinor: number,
    status: AccountSnapshot["status"] = "open",
    currency = "USD"
  ): AccountSnapshot {
    return { accountType, status, balanceMinor, currency }
  }

  it("sums asset accounts (positive net AUM)", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 1_000_00), // $1,000
        mkAcct("savings", 5_000_00), // $5,000
        mkAcct("brokerage", 50_000_00), // $50,000
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aum.totalAumMinor).toBe(56_000_00)
      expect(r.aum.totalAssetsMinor).toBe(56_000_00)
      expect(r.aum.totalLiabilitiesMinor).toBe(0)
      expect(r.aum.assetCount).toBe(3)
      expect(r.aum.liabilityCount).toBe(0)
    }
  })

  it("nets liabilities against assets", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 10_000_00),
        mkAcct("mortgage", 200_000_00),
        mkAcct("credit_card", 2_000_00),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aum.totalAssetsMinor).toBe(10_000_00)
      expect(r.aum.totalLiabilitiesMinor).toBe(202_000_00)
      expect(r.aum.totalAumMinor).toBe(-192_000_00)
      expect(r.aum.assetCount).toBe(1)
      expect(r.aum.liabilityCount).toBe(2)
    }
  })

  it("excludes pending accounts", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 10_000_00),
        mkAcct("brokerage", 50_000_00, "pending"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.aum.totalAumMinor).toBe(10_000_00)
  })

  it("excludes closed accounts", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 10_000_00),
        mkAcct("savings", 100_000_00, "closed"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.aum.totalAumMinor).toBe(10_000_00)
  })

  it("includes frozen accounts (compliance hold doesn't erase balance)", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 10_000_00),
        mkAcct("brokerage", 50_000_00, "frozen"),
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.aum.totalAumMinor).toBe(60_000_00)
  })

  it("uses absolute value of balance (sign-convention tolerant)", () => {
    // Some institutions feed mortgage balance as negative; others positive.
    // Helper uses abs() so liability sign convention is uniform.
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 10_000_00),
        mkAcct("mortgage", -200_000_00), // negative
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aum.totalLiabilitiesMinor).toBe(200_000_00)
      expect(r.aum.totalAumMinor).toBe(-190_000_00)
    }
  })

  it("rejects mixed currencies (no FX in slice 1)", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [
        mkAcct("checking", 10_000_00, "open", "USD"),
        mkAcct("savings", 5_000_00, "open", "EUR"),
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/FX/)
  })

  it("rejects bad baseCurrency", () => {
    const r = calculateAum({
      baseCurrency: "usd", // lowercase
      accounts: [],
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-integer balance", () => {
    const r = calculateAum({
      baseCurrency: "USD",
      accounts: [{ ...mkAcct("checking", 0), balanceMinor: 100.5 as never }],
    })
    expect(r.ok).toBe(false)
  })

  it("zero accounts yields zero AUM", () => {
    const r = calculateAum({ baseCurrency: "USD", accounts: [] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.aum.totalAumMinor).toBe(0)
      expect(r.aum.assetCount).toBe(0)
      expect(r.aum.liabilityCount).toBe(0)
    }
  })

  it("LIABILITY_ACCOUNT_TYPES set has exactly 3 entries", () => {
    expect(LIABILITY_ACCOUNT_TYPES.size).toBe(3)
    expect(LIABILITY_ACCOUNT_TYPES.has("mortgage")).toBe(true)
    expect(LIABILITY_ACCOUNT_TYPES.has("credit_card")).toBe(true)
    expect(LIABILITY_ACCOUNT_TYPES.has("personal_loan")).toBe(true)
  })
})

/* ─── Goal progress calculator ────────────────────────────────────────── */

describe("R1 — goal-progress-calculator", () => {
  const NOW = new Date("2026-05-18T00:00:00Z")

  it("computes progress percentage", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 100_000_00,
      currentAmountMinor: 25_000_00,
      targetDate: new Date("2027-05-18T00:00:00Z"), // 12 months out
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.progressPct).toBe(25)
      expect(r.progress.remainingMinor).toBe(75_000_00)
      expect(r.progress.isAchieved).toBe(false)
    }
  })

  it("computes monthsRemaining and requiredMonthly", () => {
    // $12,000 target, $0 current, 12 months → $1000/month
    const r = calculateGoalProgress({
      targetAmountMinor: 12_000_00,
      currentAmountMinor: 0,
      targetDate: new Date("2027-05-18T00:00:00Z"),
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.monthsRemaining).toBeGreaterThanOrEqual(11)
      expect(r.progress.monthsRemaining).toBeLessThanOrEqual(12)
      // requiredMonthly approx $1000/month
      expect(r.progress.requiredMonthlyMinor).toBeGreaterThanOrEqual(100_000)
      expect(r.progress.requiredMonthlyMinor).toBeLessThanOrEqual(110_000)
    }
  })

  it("isAchieved when current >= target", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: 50_000_00,
      targetDate: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.isAchieved).toBe(true)
      expect(r.progress.remainingMinor).toBe(0)
    }
  })

  it("caps progressPct at 100 when over-funded", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: 75_000_00,
      targetDate: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.progressPct).toBe(100)
      expect(r.progress.isAchieved).toBe(true)
    }
  })

  it("isOverdue when target date past + not achieved", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: 10_000_00,
      targetDate: new Date("2025-05-18T00:00:00Z"), // past
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.isOverdue).toBe(true)
      expect(r.progress.monthsRemaining).toBe(0)
      expect(r.progress.requiredMonthlyMinor).toBeNull()
    }
  })

  it("not overdue when target past but already achieved", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: 60_000_00,
      targetDate: new Date("2025-05-18T00:00:00Z"),
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.isOverdue).toBe(false)
      expect(r.progress.isAchieved).toBe(true)
    }
  })

  it("null target date yields null months / required", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: 10_000_00,
      targetDate: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.progress.monthsRemaining).toBeNull()
      expect(r.progress.requiredMonthlyMinor).toBeNull()
      expect(r.progress.isOverdue).toBe(false)
    }
  })

  it("rejects 0 target", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 0,
      currentAmountMinor: 0,
      targetDate: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative current", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: -1000,
      targetDate: null,
      asOf: NOW,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects invalid Date", () => {
    const r = calculateGoalProgress({
      targetAmountMinor: 50_000_00,
      currentAmountMinor: 0,
      targetDate: null,
      asOf: new Date(NaN),
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── KYC validator ───────────────────────────────────────────────────── */

describe("R1 — kyc-validator", () => {
  function mkPrimary(overrides: Partial<KycMemberData> = {}): KycMemberData {
    return {
      contactId: "contact_primary",
      role: "primary",
      legalFirstName: "Jane",
      legalLastName: "Doe",
      dateOfBirth: new Date("1980-01-01"),
      taxId: "123-45-6789",
      addressLine1: "1 Main St",
      city: "Boston",
      postalCode: "02108",
      country: "US",
      ownershipPct: 100,
      ...overrides,
    }
  }

  it("accepts a complete single-member household", () => {
    const r = validateKyc({ members: [mkPrimary()] })
    expect(r.ok).toBe(true)
    expect(r.hasPrimary).toBe(true)
    expect(r.ownershipBalanced).toBe(true)
  })

  it("rejects when primary is missing", () => {
    const r = validateKyc({
      members: [{ ...mkPrimary(), role: "spouse", ownershipPct: 100 }],
    })
    expect(r.ok).toBe(false)
    expect(r.hasPrimary).toBe(false)
  })

  it("rejects when ownership doesn't sum to 100", () => {
    const r = validateKyc({
      members: [{ ...mkPrimary(), ownershipPct: 60 }],
    })
    expect(r.ok).toBe(false)
    expect(r.ownershipBalanced).toBe(false)
    expect(r.ownershipSumPct).toBe(60)
  })

  it("accepts 50/50 spouse split", () => {
    const r = validateKyc({
      members: [
        { ...mkPrimary(), ownershipPct: 50 },
        { ...mkPrimary(), contactId: "c2", role: "spouse", ownershipPct: 50 },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("reports missing fields per member", () => {
    const r = validateKyc({
      members: [{ ...mkPrimary(), taxId: null, addressLine1: null }],
    })
    expect(r.ok).toBe(false)
    expect(r.memberIssues).toHaveLength(1)
    expect(r.memberIssues[0].missingFields.sort()).toEqual(
      ["addressLine1", "taxId"].sort()
    )
  })

  it("empty-string field treated as missing", () => {
    const r = validateKyc({
      members: [{ ...mkPrimary(), legalFirstName: "" }],
    })
    expect(r.ok).toBe(false)
    expect(r.memberIssues[0].missingFields).toContain("legalFirstName")
  })

  it("whitespace-only field treated as missing", () => {
    const r = validateKyc({
      members: [{ ...mkPrimary(), city: "   " }],
    })
    expect(r.ok).toBe(false)
    expect(r.memberIssues[0].missingFields).toContain("city")
  })

  it("child / dependent only require name + DoB (default reqs)", () => {
    const r = validateKyc({
      members: [
        { ...mkPrimary(), ownershipPct: 100 },
        {
          contactId: "c2",
          role: "child",
          legalFirstName: "Junior",
          legalLastName: "Doe",
          dateOfBirth: new Date("2015-01-01"),
          taxId: null, // not required for child
          addressLine1: null,
          city: null,
          postalCode: null,
          country: null,
          ownershipPct: 0,
        },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("rejects child missing legalFirstName", () => {
    const r = validateKyc({
      members: [
        { ...mkPrimary(), ownershipPct: 100 },
        {
          contactId: "c2",
          role: "child",
          legalFirstName: null,
          legalLastName: "Doe",
          dateOfBirth: new Date("2015-01-01"),
          taxId: null,
          addressLine1: null,
          city: null,
          postalCode: null,
          country: null,
          ownershipPct: 0,
        },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.memberIssues[0].missingFields).toContain("legalFirstName")
  })

  it("ownership tolerance accepts 99.99 / 100.01", () => {
    const r1 = validateKyc({
      members: [{ ...mkPrimary(), ownershipPct: 99.99 }],
    })
    expect(r1.ownershipBalanced).toBe(true)
    const r2 = validateKyc({
      members: [{ ...mkPrimary(), ownershipPct: 100.01 }],
    })
    expect(r2.ownershipBalanced).toBe(true)
  })

  it("ownership of 99.9 is OUTSIDE tolerance (0.05)", () => {
    const r = validateKyc({
      members: [{ ...mkPrimary(), ownershipPct: 99.9 }],
    })
    expect(r.ownershipBalanced).toBe(false)
  })

  it("custom required override", () => {
    // Caller demands taxId on child too — should fail without it.
    const r = validateKyc({
      members: [
        { ...mkPrimary(), ownershipPct: 100 },
        {
          contactId: "c2",
          role: "child",
          legalFirstName: "Junior",
          legalLastName: "Doe",
          dateOfBirth: new Date("2015-01-01"),
          taxId: null,
          addressLine1: null,
          city: null,
          postalCode: null,
          country: null,
          ownershipPct: 0,
        },
      ],
      required: {
        ...DEFAULT_KYC_REQUIREMENTS,
        child: ["legalFirstName", "legalLastName", "dateOfBirth", "taxId"],
      },
    })
    expect(r.ok).toBe(false)
    expect(r.memberIssues[0].missingFields).toContain("taxId")
  })
})

/* ─── Drift guards ────────────────────────────────────────────────────── */

describe("R1 — registry drift guards", () => {
  it("HOUSEHOLD_STATUSES exactly 4", () => {
    expect(HOUSEHOLD_STATUSES).toEqual(["prospect", "active", "inactive", "closed"])
  })

  it("KYC_STATUSES exactly 5", () => {
    expect(KYC_STATUSES).toEqual([
      "not_started",
      "in_review",
      "approved",
      "rejected",
      "expired",
    ])
  })

  it("MEMBER_ROLES exactly 6", () => {
    expect(MEMBER_ROLES).toEqual([
      "primary",
      "spouse",
      "child",
      "dependent",
      "trustee",
      "beneficiary",
    ])
  })

  it("ACCOUNT_TYPES exactly 12", () => {
    expect(ACCOUNT_TYPES).toHaveLength(12)
  })

  it("ACCOUNT_STATUSES exactly 4", () => {
    expect(ACCOUNT_STATUSES).toEqual(["pending", "open", "frozen", "closed"])
  })

  it("GOAL_TYPES exactly 7", () => {
    expect(GOAL_TYPES).toEqual([
      "retirement",
      "college",
      "home_purchase",
      "emergency_fund",
      "major_purchase",
      "debt_payoff",
      "custom",
    ])
  })

  it("GOAL_STATUSES exactly 4", () => {
    expect(GOAL_STATUSES).toEqual(["active", "achieved", "abandoned", "paused"])
  })

  it("LIFE_EVENT_TYPES exactly 11", () => {
    expect(LIFE_EVENT_TYPES).toHaveLength(11)
  })

  it("LIFE_EVENT_OUTREACH_STATUSES exactly 4", () => {
    expect(LIFE_EVENT_OUTREACH_STATUSES).toEqual([
      "logged",
      "acknowledged",
      "actioned",
      "dismissed",
    ])
  })

  it("KYC_FIELDS exactly 8", () => {
    expect(KYC_FIELDS).toHaveLength(8)
  })

  it("Transition coverage", () => {
    for (const s of HOUSEHOLD_STATUSES) expect(HOUSEHOLD_TRANSITIONS[s]).toBeDefined()
    for (const s of KYC_STATUSES) expect(KYC_TRANSITIONS[s]).toBeDefined()
    for (const s of ACCOUNT_STATUSES) expect(ACCOUNT_TRANSITIONS[s]).toBeDefined()
    for (const s of GOAL_STATUSES) expect(GOAL_TRANSITIONS[s]).toBeDefined()
    for (const s of LIFE_EVENT_OUTREACH_STATUSES) {
      expect(LIFE_EVENT_OUTREACH_TRANSITIONS[s]).toBeDefined()
    }
  })

  it("Terminal household = [closed]", () => {
    const terminals = HOUSEHOLD_STATUSES.filter((s) => HOUSEHOLD_TRANSITIONS[s].length === 0)
    expect(terminals).toEqual(["closed"])
  })

  it("Terminal goals = [achieved, abandoned]", () => {
    const terminals = GOAL_STATUSES.filter((s) => GOAL_TRANSITIONS[s].length === 0)
    expect(terminals.sort()).toEqual(["abandoned", "achieved"])
  })

  it("DEFAULT_KYC_REQUIREMENTS covers all roles", () => {
    for (const r of MEMBER_ROLES) {
      expect(DEFAULT_KYC_REQUIREMENTS[r]).toBeDefined()
    }
  })

  it("KYC has no terminal statuses (architect-pass invariant)", () => {
    // Architect-pass-1 suggestion: pin the "no terminal KYC" invariant
    // so a future edit that closes off the graph (e.g. final rejection
    // becoming terminal) is caught loudly.
    for (const s of KYC_STATUSES) {
      expect(isKycTerminal(s)).toBe(false)
      expect(KYC_TRANSITIONS[s].length).toBeGreaterThan(0)
    }
  })
})
