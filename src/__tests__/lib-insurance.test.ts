/**
 * Tests for R7 Insurance Cloud slice 1 — 4 pure helpers + types.
 * No DB.
 */
import { describe, expect, it } from "vitest"
import {
  allowedNextClaim,
  allowedNextHolder,
  allowedNextPolicy,
  canTransitionClaim,
  isClaimTerminal,
  isHolderTerminal,
  isPolicyTerminal,
  transitionClaim,
  transitionHolder,
  transitionPolicy,
} from "@/lib/insurance/state-machine"
import {
  __PREMIUM_INTERNALS,
  calculatePremium,
} from "@/lib/insurance/premium-calculator"
import {
  __SEVERITY_INTERNALS,
  classifyClaimSeverity,
} from "@/lib/insurance/claim-severity-classifier"
import { validateBeneficiaries } from "@/lib/insurance/beneficiary-allocation-validator"
import {
  BENEFICIARY_TIERS,
  BENEFICIARY_TYPES,
  BILLING_FREQUENCIES,
  CLAIM_LOSS_TYPES,
  CLAIM_SEVERITIES,
  CLAIM_STATUSES,
  CLAIM_TRANSITIONS,
  HOLDER_STATUSES,
  HOLDER_TRANSITIONS,
  LINES_OF_BUSINESS,
  POLICY_STATUSES,
  POLICY_TRANSITIONS,
  RISK_TIERS,
  SERVICE_TEAM_ROLES,
  type BeneficiaryAllocation,
  type ClaimStatus,
  type HolderStatus,
  type LineOfBusiness,
  type PolicyStatus,
} from "@/lib/insurance/types"

/* ─── Drift guards ───────────────────────────────────────────────────── */

describe("R7 — enum drift guards", () => {
  it("holder statuses cardinality is 4", () => {
    expect(HOLDER_STATUSES).toHaveLength(4)
  })
  it("policy statuses cardinality is 6", () => {
    expect(POLICY_STATUSES).toHaveLength(6)
  })
  it("claim statuses cardinality is 6", () => {
    expect(CLAIM_STATUSES).toHaveLength(6)
  })
  it("claim loss types cardinality is 10", () => {
    expect(CLAIM_LOSS_TYPES).toHaveLength(10)
  })
  it("claim severities cardinality is 4", () => {
    expect(CLAIM_SEVERITIES).toHaveLength(4)
  })
  it("service team roles cardinality is 6", () => {
    expect(SERVICE_TEAM_ROLES).toHaveLength(6)
  })
  it("lines of business cardinality is 7", () => {
    expect(LINES_OF_BUSINESS).toHaveLength(7)
  })
  it("billing frequencies cardinality is 4", () => {
    expect(BILLING_FREQUENCIES).toHaveLength(4)
  })
  it("risk tiers cardinality is 4", () => {
    expect(RISK_TIERS).toHaveLength(4)
  })
  it("beneficiary tiers cardinality is 2", () => {
    expect(BENEFICIARY_TIERS).toHaveLength(2)
  })
  it("beneficiary types cardinality is 4", () => {
    expect(BENEFICIARY_TYPES).toHaveLength(4)
  })

  it("holder transition targets all valid", () => {
    for (const s of HOLDER_STATUSES) {
      for (const t of HOLDER_TRANSITIONS[s]) {
        expect(HOLDER_STATUSES).toContain(t)
      }
    }
  })
  it("policy transition targets all valid", () => {
    for (const s of POLICY_STATUSES) {
      for (const t of POLICY_TRANSITIONS[s]) {
        expect(POLICY_STATUSES).toContain(t)
      }
    }
  })
  it("claim transition targets all valid", () => {
    for (const s of CLAIM_STATUSES) {
      for (const t of CLAIM_TRANSITIONS[s]) {
        expect(CLAIM_STATUSES).toContain(t)
      }
    }
  })
})

/* ─── Holder state machine ───────────────────────────────────────────── */

describe("R7 — holder state machine", () => {
  it("prospect → active legal", () => {
    expect(transitionHolder("prospect", "active").ok).toBe(true)
  })
  it("active → inactive → active round-trip legal", () => {
    expect(transitionHolder("active", "inactive").ok).toBe(true)
    expect(transitionHolder("inactive", "active").ok).toBe(true)
  })
  it("deceased terminal", () => {
    expect(isHolderTerminal("deceased")).toBe(true)
    for (const t of HOLDER_STATUSES) {
      if (t === "deceased") continue
      expect(transitionHolder("deceased", t).ok).toBe(false)
    }
  })
  it("no-op rejected", () => {
    expect(transitionHolder("active", "active").ok).toBe(false)
  })
  it("unknown rejected", () => {
    expect(transitionHolder("alien" as HolderStatus, "active").ok).toBe(false)
    expect(transitionHolder(null, "active").ok).toBe(false)
  })
  it("allowedNextHolder surfaces table", () => {
    expect([...allowedNextHolder("active")]).toEqual(["inactive", "deceased"])
    expect([...allowedNextHolder("deceased")]).toEqual([])
  })
})

/* ─── Policy state machine ───────────────────────────────────────────── */

describe("R7 — policy state machine", () => {
  it("quote → bound → active happy path", () => {
    expect(transitionPolicy("quote", "bound").ok).toBe(true)
    expect(transitionPolicy("bound", "active").ok).toBe(true)
  })
  it("active → expired legal (term end)", () => {
    expect(transitionPolicy("active", "expired").ok).toBe(true)
  })
  it("active → lapsed legal (non-payment)", () => {
    expect(transitionPolicy("active", "lapsed").ok).toBe(true)
  })
  it("can cancel from quote, bound, active (operator-initiated)", () => {
    expect(transitionPolicy("quote", "cancelled").ok).toBe(true)
    expect(transitionPolicy("bound", "cancelled").ok).toBe(true)
    expect(transitionPolicy("active", "cancelled").ok).toBe(true)
  })
  it("cannot skip bound (quote → active blocked)", () => {
    expect(transitionPolicy("quote", "active").ok).toBe(false)
  })
  it("expired / lapsed / cancelled terminal — no resurrection", () => {
    expect(isPolicyTerminal("expired")).toBe(true)
    expect(isPolicyTerminal("lapsed")).toBe(true)
    expect(isPolicyTerminal("cancelled")).toBe(true)
    expect(transitionPolicy("expired", "active").ok).toBe(false)
    expect(transitionPolicy("lapsed", "active").ok).toBe(false)
  })
  it("allowedNextPolicy table introspection", () => {
    expect([...allowedNextPolicy("active")]).toEqual([
      "expired",
      "lapsed",
      "cancelled",
    ])
  })
})

/* ─── Claim state machine ────────────────────────────────────────────── */

describe("R7 — claim state machine", () => {
  it("reported → under_review → approved → settled happy path", () => {
    expect(transitionClaim("reported", "under_review").ok).toBe(true)
    expect(transitionClaim("under_review", "approved").ok).toBe(true)
    expect(transitionClaim("approved", "settled").ok).toBe(true)
  })
  it("can deny from reported or under_review", () => {
    expect(transitionClaim("reported", "denied").ok).toBe(true)
    expect(transitionClaim("under_review", "denied").ok).toBe(true)
  })
  it("can close_no_action from reported or under_review", () => {
    expect(transitionClaim("reported", "closed_no_action").ok).toBe(true)
    expect(transitionClaim("under_review", "closed_no_action").ok).toBe(true)
  })
  it("cannot deny DIRECTLY from approved — must walk back via under_review (audit-trail clarity)", () => {
    // Direct edge approved → denied is intentionally blocked; SIU
    // adjusters must use the un-approve reversal step first.
    expect(transitionClaim("approved", "denied").ok).toBe(false)
  })
  it("can un-approve: approved → under_review (slice-2 fraud-discovery reversal)", () => {
    // The new edge that makes the SIU adjuster mid-review fraud
    // workflow possible. Audit-log row MUST accompany this write
    // at the route layer (caller responsibility, not state machine).
    expect(transitionClaim("approved", "under_review").ok).toBe(true)
  })
  it("un-approve → re-review → deny full flow", () => {
    // SIU canonical path: approve, discover fraud, un-approve back
    // to review queue, then deny on the second pass.
    expect(transitionClaim("under_review", "approved").ok).toBe(true)
    expect(transitionClaim("approved", "under_review").ok).toBe(true)
    expect(transitionClaim("under_review", "denied").ok).toBe(true)
  })
  it("cannot skip under_review (reported → approved blocked)", () => {
    expect(transitionClaim("reported", "approved").ok).toBe(false)
  })
  it("settled / denied / closed_no_action terminal", () => {
    expect(isClaimTerminal("settled")).toBe(true)
    expect(isClaimTerminal("denied")).toBe(true)
    expect(isClaimTerminal("closed_no_action")).toBe(true)
    // approved is NOT terminal anymore (it now has settled + under_review out-edges).
    expect(isClaimTerminal("approved")).toBe(false)
  })
  it("allowedNextClaim table introspection", () => {
    expect([...allowedNextClaim("reported")]).toEqual([
      "under_review",
      "denied",
      "closed_no_action",
    ])
    // approved now has BOTH settled (forward) and under_review (un-approve).
    expect([...allowedNextClaim("approved")]).toEqual(["settled", "under_review"])
  })

  it("non-string rejected", () => {
    expect(transitionClaim(42, "approved").ok).toBe(false)
  })
})

/* ─── Context-aware claim transition (slice-2 wrapper) ──────────────── */

describe("R7 — canTransitionClaim (slice-2 context-aware wrapper)", () => {
  const LOSS = new Date("2026-04-01T00:00:00Z")

  it("un-approve allowed with assigned adjuster (SIU audit trail satisfied)", () => {
    const r = canTransitionClaim("approved", "under_review", {
      lossDate: LOSS,
      adjusterId: "adj-123",
    })
    expect(r.ok).toBe(true)
  })

  it("un-approve REJECTED when adjusterId is null", () => {
    const r = canTransitionClaim("approved", "under_review", {
      lossDate: LOSS,
      adjusterId: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("assigned adjuster")
    }
  })

  it("un-approve REJECTED when adjusterId is empty string", () => {
    const r = canTransitionClaim("approved", "under_review", {
      lossDate: LOSS,
      adjusterId: "",
    })
    expect(r.ok).toBe(false)
  })

  it("non-reversal transitions ignore adjusterId context (under_review → approved still works)", () => {
    // Adjuster may be unassigned during the initial under_review →
    // approved decision (e.g. claims_examiner role approves
    // without a personal adjuster owner). Only un-approve needs
    // the assigned-adjuster gate.
    const r = canTransitionClaim("under_review", "approved", {
      lossDate: LOSS,
      adjusterId: null,
    })
    expect(r.ok).toBe(true)
  })

  it("illegal state-machine transition short-circuits BEFORE context check (clearer error)", () => {
    // reported → approved is illegal (must go via under_review).
    // Even with a valid adjuster, the pure state-machine error
    // wins so the operator sees the right cause.
    const r = canTransitionClaim("reported", "approved", {
      lossDate: LOSS,
      adjusterId: "adj-123",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("illegal claim transition")
    }
  })

  it("approved → settled (forward path) is passthrough — no context gate", () => {
    const r = canTransitionClaim("approved", "settled", {
      lossDate: LOSS,
      adjusterId: null,
    })
    expect(r.ok).toBe(true)
  })
})

/* ─── Premium calculator ─────────────────────────────────────────────── */

describe("R7 — premium calculator", () => {
  it("auto policy — $100K coverage, standard, no deductible, 1 yr → $1500", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "standard",
      termYears: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 100K × 0.015 × 1 = 1500; standard × 1.0 = 1500
      expect(r.breakdown.annualPremium).toBe(1500)
      expect(r.breakdown.riskMultiplier).toBe(1.0)
    }
  })

  it("auto preferred (×0.8) → $1200", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "preferred",
      termYears: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.breakdown.annualPremium).toBe(1200)
  })

  it("auto substandard (×1.4) → $2100", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "substandard",
      termYears: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.breakdown.annualPremium).toBe(2100)
  })

  it("declined risk tier rejected", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "declined",
      termYears: 1,
    })
    expect(r.ok).toBe(false)
  })

  it("home policy with $1000 deductible gets $100 credit", () => {
    const r = calculatePremium({
      lineOfBusiness: "home",
      coverageLimit: 500_000,
      deductible: 1000,
      riskTier: "standard",
      termYears: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 500K × 0.008 × 1 × 1.0 = 4000; minus 1000 × 0.10 = 100 → 3900
      expect(r.breakdown.annualPremium).toBe(3900)
      expect(r.breakdown.deductibleCredit).toBe(100)
    }
  })

  it("life policy ignores deductible (rate 0)", () => {
    const r = calculatePremium({
      lineOfBusiness: "life",
      coverageLimit: 500_000,
      deductible: 10_000, // huge but ignored
      riskTier: "standard",
      termYears: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 500K × 0.002 × 1 × 1.0 = 1000; deductible credit = 0
      expect(r.breakdown.annualPremium).toBe(1000)
      expect(r.breakdown.deductibleCredit).toBe(0)
    }
  })

  it("20-yr term life — annualized correctly", () => {
    const r = calculatePremium({
      lineOfBusiness: "life",
      coverageLimit: 500_000,
      riskTier: "standard",
      termYears: 20,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 500K × 0.002 × 20 = 20K total / 20 = $1000/yr
      expect(r.breakdown.annualPremium).toBe(1000)
    }
  })

  it("multiplierOverride bypasses risk tier", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "standard",
      termYears: 1,
      multiplierOverride: 0.5, // promotional
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.breakdown.annualPremium).toBe(750) // 1500 × 0.5
      expect(r.breakdown.riskMultiplier).toBe(0.5)
    }
  })

  it("deductible credit cannot push premium below 0", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 1000,
      deductible: 100_000, // huge — would over-credit
      riskTier: "standard",
      termYears: 1,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.breakdown.annualPremium).toBe(0)
  })

  it("rejects unknown lineOfBusiness", () => {
    const r = calculatePremium({
      lineOfBusiness: "spaceship" as LineOfBusiness,
      coverageLimit: 1000,
      riskTier: "standard",
      termYears: 1,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative coverage", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: -1,
      riskTier: "standard",
      termYears: 1,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-integer termYears", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "standard",
      termYears: 1.5,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects zero termYears", () => {
    const r = calculatePremium({
      lineOfBusiness: "auto",
      coverageLimit: 100_000,
      riskTier: "standard",
      termYears: 0,
    })
    expect(r.ok).toBe(false)
  })

  it("BASE_RATES pins every line of business", () => {
    for (const line of LINES_OF_BUSINESS) {
      expect(__PREMIUM_INTERNALS.BASE_RATES[line]).toBeGreaterThan(0)
    }
  })

  it("RISK_MULTIPLIERS — preferred < standard < substandard", () => {
    expect(__PREMIUM_INTERNALS.RISK_MULTIPLIERS.preferred).toBeLessThan(
      __PREMIUM_INTERNALS.RISK_MULTIPLIERS.standard
    )
    expect(__PREMIUM_INTERNALS.RISK_MULTIPLIERS.standard).toBeLessThan(
      __PREMIUM_INTERNALS.RISK_MULTIPLIERS.substandard
    )
  })

  it("DEDUCTIBLE_CREDIT_RATES — life/health/umbrella = 0", () => {
    expect(__PREMIUM_INTERNALS.DEDUCTIBLE_CREDIT_RATES.life).toBe(0)
    expect(__PREMIUM_INTERNALS.DEDUCTIBLE_CREDIT_RATES.health).toBe(0)
    expect(__PREMIUM_INTERNALS.DEDUCTIBLE_CREDIT_RATES.umbrella).toBe(0)
  })
})

/* ─── Claim severity classifier ──────────────────────────────────────── */

describe("R7 — claim severity classifier", () => {
  it("$500 collision → minor", () => {
    const r = classifyClaimSeverity({
      totalAmount: 500,
      lossType: "collision",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("minor")
  })

  it("$10K collision → moderate", () => {
    const r = classifyClaimSeverity({
      totalAmount: 10_000,
      lossType: "collision",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("moderate")
  })

  it("$100K theft → major", () => {
    const r = classifyClaimSeverity({
      totalAmount: 100_000,
      lossType: "theft",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("major")
  })

  it("$1M fire → catastrophic", () => {
    const r = classifyClaimSeverity({
      totalAmount: 1_000_000,
      lossType: "fire",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("catastrophic")
  })

  it("death is always catastrophic regardless of amount", () => {
    const r = classifyClaimSeverity({ totalAmount: 100, lossType: "death" })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.severity).toBe("catastrophic")
      expect(r.rationale).toMatch(/death/)
    }
  })

  it("disability bumps moderate→major", () => {
    const r = classifyClaimSeverity({
      totalAmount: 10_000, // would be moderate
      lossType: "disability",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("major")
  })

  it("medical bumps minor→moderate", () => {
    const r = classifyClaimSeverity({
      totalAmount: 1_000,
      lossType: "medical",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("moderate")
  })

  it("medical bump caps at catastrophic", () => {
    const r = classifyClaimSeverity({
      totalAmount: 1_000_000,
      lossType: "medical",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("catastrophic")
  })

  it("coverage-ratio override — $30K claim on $35K policy = catastrophic", () => {
    const r = classifyClaimSeverity({
      totalAmount: 30_000,
      lossType: "collision",
      policyCoverageLimit: 35_000,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.severity).toBe("catastrophic")
      expect(r.rationale).toMatch(/coverage ratio/)
    }
  })

  it("coverage-ratio override does NOT fire under $25K total", () => {
    const r = classifyClaimSeverity({
      totalAmount: 20_000,
      lossType: "collision",
      policyCoverageLimit: 22_000, // ratio > 0.80 but amount < $25K
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.severity).toBe("moderate")
  })

  it("rejects unknown lossType", () => {
    const r = classifyClaimSeverity({
      totalAmount: 10_000,
      lossType: "alien_abduction" as never,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative totalAmount", () => {
    const r = classifyClaimSeverity({
      totalAmount: -100,
      lossType: "collision",
    })
    expect(r.ok).toBe(false)
  })

  it("TIER_RANK strictly ordered", () => {
    expect(__SEVERITY_INTERNALS.TIER_RANK.catastrophic).toBeGreaterThan(
      __SEVERITY_INTERNALS.TIER_RANK.major
    )
    expect(__SEVERITY_INTERNALS.TIER_RANK.major).toBeGreaterThan(
      __SEVERITY_INTERNALS.TIER_RANK.moderate
    )
    expect(__SEVERITY_INTERNALS.TIER_RANK.moderate).toBeGreaterThan(
      __SEVERITY_INTERNALS.TIER_RANK.minor
    )
  })
})

/* ─── Beneficiary allocation validator ───────────────────────────────── */

describe("R7 — beneficiary allocation validator", () => {
  function ben(
    id: string,
    pct: number,
    tier: "primary" | "contingent" = "primary",
    revoked = false
  ): BeneficiaryAllocation {
    return {
      id,
      tier,
      allocationPct: pct,
      beneficiaryType: "person",
      revokedAt: revoked ? new Date() : null,
    }
  }

  it("life policy with single 100% primary passes", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 100)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.primarySumPct).toBe(100)
  })

  it("life policy with 50/50 split passes", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 50), ben("b2", 50)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.primarySumPct).toBe(100)
  })

  it("life policy with primary sum < 100 rejected", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 50)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("life policy with primary sum > 100 rejected", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 60), ben("b2", 60)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("life policy with NO active primary rejected", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 100, "primary", true)], // revoked
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("revoked records skipped in sum", () => {
    const r = validateBeneficiaries({
      beneficiaries: [
        ben("b1", 100, "primary"),
        ben("b2", 100, "primary", true), // revoked, ignored
      ],
      isLifeLine: true,
    })
    expect(r.ok).toBe(true)
  })

  it("non-life policy: primary < 100 OK (advisory)", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 50)],
      isLifeLine: false,
    })
    expect(r.ok).toBe(true)
  })

  it("non-life policy: primary > 100 rejected", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 60), ben("b2", 60)],
      isLifeLine: false,
    })
    expect(r.ok).toBe(false)
  })

  it("contingent sum > 100 rejected", () => {
    const r = validateBeneficiaries({
      beneficiaries: [
        ben("b1", 100, "primary"),
        ben("b2", 60, "contingent"),
        ben("b3", 60, "contingent"),
      ],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("contingent sum < 100 OK", () => {
    const r = validateBeneficiaries({
      beneficiaries: [
        ben("b1", 100, "primary"),
        ben("b2", 30, "contingent"),
      ],
      isLifeLine: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.contingentSumPct).toBe(30)
    }
  })

  it("rejects duplicate id", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("dup", 50), ben("dup", 50)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects negative allocation", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", -10)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects allocation > 100", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 150)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects empty id", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("", 100)],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown tier", () => {
    const r = validateBeneficiaries({
      beneficiaries: [
        {
          id: "b1",
          tier: "ghost" as never,
          allocationPct: 100,
          beneficiaryType: "person",
        },
      ],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects unknown beneficiaryType", () => {
    const r = validateBeneficiaries({
      beneficiaries: [
        {
          id: "b1",
          tier: "primary",
          allocationPct: 100,
          beneficiaryType: "alien" as never,
        },
      ],
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-array beneficiaries", () => {
    const r = validateBeneficiaries({
      beneficiaries: null as never,
      isLifeLine: true,
    })
    expect(r.ok).toBe(false)
  })

  it("rejects non-boolean isLifeLine", () => {
    const r = validateBeneficiaries({
      beneficiaries: [ben("b1", 100)],
      isLifeLine: "yes" as never,
    })
    expect(r.ok).toBe(false)
  })

  it("empty beneficiaries on non-life policy = OK", () => {
    const r = validateBeneficiaries({ beneficiaries: [], isLifeLine: false })
    expect(r.ok).toBe(true)
  })

  it("empty beneficiaries on life policy = rejected", () => {
    const r = validateBeneficiaries({ beneficiaries: [], isLifeLine: true })
    expect(r.ok).toBe(false)
  })

  it("primary sum within 0.01 tolerance accepted (FP noise)", () => {
    const r = validateBeneficiaries({
      beneficiaries: [
        ben("b1", 33.33),
        ben("b2", 33.33),
        ben("b3", 33.34),
      ],
      isLifeLine: true,
    })
    expect(r.ok).toBe(true)
  })
})

/* ─── Terminal-set drift ─────────────────────────────────────────────── */

describe("R7 — terminal-set drift", () => {
  it("holder terminals: { deceased }", () => {
    const terminals = HOLDER_STATUSES.filter((s) => isHolderTerminal(s))
    expect([...terminals].sort()).toEqual(["deceased"])
  })

  it("policy terminals: { cancelled, expired, lapsed }", () => {
    const terminals = POLICY_STATUSES.filter((s) => isPolicyTerminal(s))
    expect([...terminals].sort()).toEqual(["cancelled", "expired", "lapsed"])
  })

  it("claim terminals: { closed_no_action, denied, settled }", () => {
    const terminals = CLAIM_STATUSES.filter((s) => isClaimTerminal(s))
    expect([...terminals].sort()).toEqual([
      "closed_no_action",
      "denied",
      "settled",
    ])
  })

  it("active is NOT terminal for all 3 entities", () => {
    expect(isHolderTerminal("active" as HolderStatus)).toBe(false)
    expect(isPolicyTerminal("active" as PolicyStatus)).toBe(false)
    expect(isClaimTerminal("approved" as ClaimStatus)).toBe(false)
  })
})
