/**
 * T9 Proactive Service — slice-2 threshold-rules tests.
 *
 * Pins every threshold + dedup rule so a future weight tweak surfaces
 * as one intentional commit rather than silent drift.
 */
import { describe, it, expect } from "vitest"
import {
  evaluateThresholds,
  THRESHOLDS,
  type HealthScoreSnapshot,
} from "@/lib/proactive/threshold-rules"
import type { TriggerType } from "@/lib/proactive/types"

const EMPTY_ACTIVE = new Set<TriggerType>()

function snap(overrides: Partial<HealthScoreSnapshot> = {}): HealthScoreSnapshot {
  return {
    organizationId: "org-1",
    entityType: "contact",
    entityId: "c-1",
    score: 80,
    factors: {},
    ...overrides,
  }
}

describe("evaluateThresholds — happy path (no alerts)", () => {
  it("healthy contact (score 80, no penalties) emits no alerts", () => {
    expect(evaluateThresholds(snap(), EMPTY_ACTIVE)).toEqual([])
  })

  it("mid-tier health (score 60, no major penalties) emits no alerts", () => {
    expect(evaluateThresholds(snap({ score: 60 }), EMPTY_ACTIVE)).toEqual([])
  })
})

describe("evaluateThresholds — churn risk", () => {
  it("score below 30 + high churn penalty emits critical churn_risk alert", () => {
    const result = evaluateThresholds(
      snap({ score: 20, factors: { churnRiskPenalty: 40 } }),
      EMPTY_ACTIVE,
    )
    const churn = result.find((d) => d.triggerType === "churn_risk")
    expect(churn).toBeDefined()
    expect(churn?.severity).toBe("critical")
    expect(churn?.context.score).toBe(20)
  })

  it("score below 30 but LOW churn penalty does NOT emit churn alert", () => {
    // Helper-test invariant: churn alert requires churnRiskPenalty >= 25.
    // Low churn but low score → still warning health_drop, not critical.
    const result = evaluateThresholds(
      snap({ score: 20, factors: { churnRiskPenalty: 5 } }),
      EMPTY_ACTIVE,
    )
    expect(result.some((d) => d.triggerType === "churn_risk")).toBe(false)
  })

  it("idempotent — existing active churn_risk alert prevents re-emission", () => {
    const active = new Set<TriggerType>(["churn_risk"])
    const result = evaluateThresholds(
      snap({ score: 20, factors: { churnRiskPenalty: 40 } }),
      active,
    )
    expect(result.some((d) => d.triggerType === "churn_risk")).toBe(false)
  })
})

describe("evaluateThresholds — payment overdue", () => {
  it("emits critical payment_overdue when penalty > 0", () => {
    const result = evaluateThresholds(
      snap({ score: 60, factors: { paymentOverduePenalty: 20 } }),
      EMPTY_ACTIVE,
    )
    const overdue = result.find((d) => d.triggerType === "payment_overdue")
    expect(overdue).toBeDefined()
    expect(overdue?.severity).toBe("critical")
  })

  it("no overdue penalty → no alert", () => {
    const result = evaluateThresholds(
      snap({ score: 60, factors: { paymentOverduePenalty: 0 } }),
      EMPTY_ACTIVE,
    )
    expect(result.some((d) => d.triggerType === "payment_overdue")).toBe(false)
  })

  it("idempotent — active overdue alert prevents re-emission", () => {
    const active = new Set<TriggerType>(["payment_overdue"])
    const result = evaluateThresholds(
      snap({ score: 60, factors: { paymentOverduePenalty: 20 } }),
      active,
    )
    expect(result.some((d) => d.triggerType === "payment_overdue")).toBe(false)
  })
})

describe("evaluateThresholds — health drop", () => {
  it("score in [30, 55) emits warning health_drop alert", () => {
    const result = evaluateThresholds(snap({ score: 45 }), EMPTY_ACTIVE)
    const drop = result.find((d) => d.triggerType === "health_drop")
    expect(drop).toBeDefined()
    expect(drop?.severity).toBe("warning")
    expect(drop?.context.score).toBe(45)
  })

  it("score at threshold (55) does NOT emit", () => {
    const result = evaluateThresholds(snap({ score: 55 }), EMPTY_ACTIVE)
    expect(result.some((d) => d.triggerType === "health_drop")).toBe(false)
  })

  it("score below 30 → churn_risk fires INSTEAD of health_drop (not both)", () => {
    const result = evaluateThresholds(
      snap({ score: 20, factors: { churnRiskPenalty: 40 } }),
      EMPTY_ACTIVE,
    )
    // Critical signals win over warning at the same time.
    expect(result.some((d) => d.triggerType === "health_drop")).toBe(false)
    expect(result.some((d) => d.triggerType === "churn_risk")).toBe(true)
  })

  it("idempotent — active health_drop OR active churn_risk prevents re-emission", () => {
    const withDrop = new Set<TriggerType>(["health_drop"])
    const r1 = evaluateThresholds(snap({ score: 45 }), withDrop)
    expect(r1.some((d) => d.triggerType === "health_drop")).toBe(false)

    const withChurn = new Set<TriggerType>(["churn_risk"])
    const r2 = evaluateThresholds(snap({ score: 45 }), withChurn)
    // health_drop is suppressed when churn_risk is already active (the
    // critical signal "covers" the warning per the rule comment).
    expect(r2.some((d) => d.triggerType === "health_drop")).toBe(false)
  })
})

describe("evaluateThresholds — no activity", () => {
  it("activityPenalty >= 66% of max → warning no_activity alert", () => {
    // SCORE_WEIGHTS.activityPenaltyMax = 30, so 0.66 * 30 = 19.8
    const result = evaluateThresholds(
      snap({ score: 60, factors: { activityPenalty: 25 } }),
      EMPTY_ACTIVE,
    )
    const inactive = result.find((d) => d.triggerType === "no_activity")
    expect(inactive).toBeDefined()
    expect(inactive?.severity).toBe("warning")
  })

  it("activityPenalty below the fraction threshold → no alert", () => {
    const result = evaluateThresholds(
      snap({ score: 60, factors: { activityPenalty: 10 } }),
      EMPTY_ACTIVE,
    )
    expect(result.some((d) => d.triggerType === "no_activity")).toBe(false)
  })
})

describe("evaluateThresholds — contract expiring", () => {
  it("contractExpiringPenalty > 0 → info-level contract_expiring alert", () => {
    const result = evaluateThresholds(
      snap({ score: 70, factors: { contractExpiringPenalty: 10 } }),
      EMPTY_ACTIVE,
    )
    const exp = result.find((d) => d.triggerType === "contract_expiring")
    expect(exp).toBeDefined()
    expect(exp?.severity).toBe("info")
  })
})

describe("evaluateThresholds — ordering + multi-signal", () => {
  it("returns alerts sorted critical → warning → info", () => {
    const result = evaluateThresholds(
      snap({
        score: 20,
        factors: {
          churnRiskPenalty: 40, // critical
          activityPenalty: 25, // warning
          contractExpiringPenalty: 10, // info
        },
      }),
      EMPTY_ACTIVE,
    )
    expect(result.map((d) => d.severity)).toEqual([
      "critical",
      "warning",
      "info",
    ])
  })
})

describe("THRESHOLDS — exported constants", () => {
  it("constants are typed and match documented defaults", () => {
    expect(THRESHOLDS.churnRiskCriticalScore).toBe(30)
    expect(THRESHOLDS.healthDropWarningScore).toBe(55)
    expect(THRESHOLDS.noActivityPenaltyMinFraction).toBeCloseTo(0.66, 2)
  })
})
