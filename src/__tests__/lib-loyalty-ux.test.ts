import { describe, expect, it } from "vitest"
import {
  buildEarnRuleWizardPayload,
  buildLoyaltyInsights,
  computeLaunchReadiness,
  suggestPosAward,
} from "@/lib/loyalty/ux"
import type { PreviewEarnRule, PreviewTier } from "@/lib/loyalty/preview"

const purchaseRule: PreviewEarnRule = {
  id: "rule_1",
  name: "1 point per AZN",
  trigger: "purchase",
  pointsRate: 1,
  pointsFlat: null,
  minOrderAmount: null,
  productCategory: null,
  priority: 0,
  applyTierMultiplier: true,
  isActive: true,
  validFrom: null,
  validUntil: null,
  createdAt: "2026-01-01T00:00:00.000Z",
}

const tiers: PreviewTier[] = [
  { code: "bronze", name: "Bronze", minLifetimePoints: 0, multiplier: 1, isActive: true },
  { code: "gold", name: "Gold", minLifetimePoints: 1_000, multiplier: 1.5, isActive: true },
]

describe("loyalty UX helpers", () => {
  it("keeps an empty program in setup mode with a clear first step", () => {
    const readiness = computeLaunchReadiness({
      tiersCount: 0,
      earnRulesCount: 0,
      rewardsCount: 0,
      settings: { memberPortalEnabled: false, autoEarnEnabled: false },
      overview: { totalAccounts: 0, recentTransactions: [] },
    })

    expect(readiness.status).toBe("needs_setup")
    expect(readiness.score).toBe(0)
    expect(readiness.nextStep).toBe("tiers")
    expect(readiness.canRunPosTest).toBe(false)
  })

  it("does not mark a configured program live before POS and members exist", () => {
    const readiness = computeLaunchReadiness({
      tiersCount: 3,
      earnRulesCount: 1,
      rewardsCount: 2,
      settings: { memberPortalEnabled: true, autoEarnEnabled: true },
      overview: { totalAccounts: 0, recentTransactions: [] },
    })

    expect(readiness.status).toBe("ready_to_test")
    expect(readiness.canRunPosTest).toBe(true)
    expect(readiness.nextStep).toBe("pos")
  })

  it("infers live status from first earn transaction and existing members", () => {
    const readiness = computeLaunchReadiness({
      tiersCount: 3,
      earnRulesCount: 1,
      rewardsCount: 2,
      settings: { memberPortalEnabled: true, autoEarnEnabled: true },
      overview: {
        totalAccounts: 5,
        recentTransactions: [{ type: "earn", delta: 120 }],
      },
    })

    expect(readiness.status).toBe("live")
    expect(readiness.score).toBe(100)
    expect(readiness.nextStep).toBeNull()
  })

  it("treats explicitly skipped auto-earn as a completed launch decision", () => {
    const readiness = computeLaunchReadiness({
      tiersCount: 3,
      earnRulesCount: 1,
      rewardsCount: 2,
      settings: { memberPortalEnabled: true, autoEarnEnabled: false, autoEarnSkipped: true },
      overview: {
        totalAccounts: 5,
        recentTransactions: [{ type: "earn", delta: 120 }],
      },
    })

    const autoEarnStep = readiness.steps.find((step) => step.key === "autoEarn")
    expect(autoEarnStep).toMatchObject({ complete: true, skipped: true })
    expect(readiness.status).toBe("live")
    expect(readiness.score).toBe(100)
  })

  it("generates operational dashboard insights for weak programs", () => {
    const result = buildLoyaltyInsights({
      tiersCount: 1,
      earnRulesCount: 0,
      rewardsCount: 0,
      settings: { memberPortalEnabled: false, autoEarnEnabled: false },
      overview: {
        totalAccounts: 0,
        thirtyDayTotals: { earn: 0, redeem: 0, expire: 0, adjustmentNet: 0, totalTransactions: 0 },
        recentTransactions: [],
      },
    })

    expect(result.health.setup).toBeLessThan(50)
    expect(result.insights.map((item) => item.id)).toEqual(
      expect.arrayContaining(["no_members", "no_rules", "no_rewards", "portal_disabled"]),
    )
  })

  it("suggests POS points from purchase amount and tier multiplier", () => {
    const suggestion = suggestPosAward({
      amount: 100,
      currency: "AZN",
      memberTier: "gold",
      rules: [purchaseRule],
      tiers,
    })

    expect(suggestion.points).toBe(150)
    expect(suggestion.base).toBe(100)
    expect(suggestion.multiplier).toBe(1.5)
    expect(suggestion.ruleName).toBe("1 point per AZN")
    expect(suggestion.source).toBe("rate")
  })

  it("builds a purchase wizard payload without fixed bonus fields", () => {
    expect(
      buildEarnRuleWizardPayload({
        name: "1 point per AZN",
        scenario: "purchase",
        awardType: "rate",
        pointsRate: 1,
        minOrderAmount: 25,
      }),
    ).toMatchObject({
      trigger: "purchase",
      pointsRate: 1,
      pointsFlat: null,
      minOrderAmount: 25,
      applyTierMultiplier: true,
      isActive: true,
    })
  })

  it("builds a signup wizard payload without purchase-only fields", () => {
    expect(
      buildEarnRuleWizardPayload({
        name: "Welcome bonus",
        scenario: "signup",
        awardType: "flat",
        pointsFlat: 100,
        minOrderAmount: 50,
      }),
    ).toMatchObject({
      trigger: "signup",
      pointsRate: null,
      pointsFlat: 100,
      minOrderAmount: null,
      applyTierMultiplier: false,
    })
  })
})
