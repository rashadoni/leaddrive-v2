/**
 * T9 Proactive Service — slice-2 threshold rules.
 *
 * Pure helper that takes a `HealthScore` row + the set of currently
 * active alert types for the same entity and returns the alerts that
 * should be EMITTED on this cron tick. Trigger cron persists what the
 * helper returns; no Prisma here.
 *
 * Rules are ordered by severity descending so the alert UI's "first
 * alert per entity" surface picks the most-critical signal.
 *
 * Each rule decides:
 *   - threshold check on score / factors
 *   - dedup against already-active alerts of the SAME triggerType
 *     (the trigger cron de-dups on the same key so we never emit two
 *     `churn_risk` alerts for the same Contact in the same window)
 *
 * Rules are exported as `THRESHOLD_RULES` so the slice-3 admin UI
 * could surface them (read-only) or a future PR could move them to
 * a per-tenant config table without rewriting the cron.
 */
import type { TriggerType, Severity, EntityType } from "./types"
import { SCORE_WEIGHTS, THRESHOLDS } from "./constants"

// Re-export so existing imports of `THRESHOLDS` from this file keep working.
export { THRESHOLDS }

export interface HealthScoreSnapshot {
  organizationId: string
  entityType: EntityType
  entityId: string
  score: number
  factors: {
    churnRiskPenalty?: number
    engagementBonus?: number
    activityPenalty?: number
    paymentOverduePenalty?: number
    contractExpiringPenalty?: number
    baseline?: number
  }
}

export interface AlertDecision {
  triggerType: TriggerType
  severity: Severity
  message: string
  context: Record<string, unknown>
}

// THRESHOLDS lives in ./constants.ts (extracted alongside SCORE_WEIGHTS
// so both helpers share the same source). Re-exported above for
// backwards compat with existing imports of THRESHOLDS from this file.

/**
 * Decide which alerts to emit for this HealthScore snapshot.
 *
 * @param snapshot — current health snapshot.
 * @param activeTriggerTypes — set of triggerTypes already active
 *   (un-dismissed) for the same (entityType, entityId). Same-type
 *   alerts are NOT re-emitted — operator must dismiss before the
 *   next one fires (avoids noise).
 */
export function evaluateThresholds(
  snapshot: HealthScoreSnapshot,
  activeTriggerTypes: ReadonlySet<TriggerType>,
): AlertDecision[] {
  const decisions: AlertDecision[] = []
  const f = snapshot.factors

  // ── Critical: churn risk → score floor + churn-specific factor ─
  if (
    snapshot.score < THRESHOLDS.churnRiskCriticalScore &&
    !activeTriggerTypes.has("churn_risk") &&
    (f.churnRiskPenalty ?? 0) >= THRESHOLDS.churnRiskMinPenalty
  ) {
    decisions.push({
      triggerType: "churn_risk",
      severity: "critical",
      message: `${snapshot.entityType.charAt(0).toUpperCase() + snapshot.entityType.slice(1)} health score ${snapshot.score} indicates high churn risk.`,
      context: {
        score: snapshot.score,
        churnRiskPenalty: f.churnRiskPenalty,
      },
    })
  }

  // ── Payment overdue: hard flag, critical, distinct from churn ──
  if (
    (f.paymentOverduePenalty ?? 0) > 0 &&
    !activeTriggerTypes.has("payment_overdue")
  ) {
    decisions.push({
      triggerType: "payment_overdue",
      severity: "critical",
      message: `Outstanding invoice past due — score lost ${f.paymentOverduePenalty} points.`,
      context: { paymentOverduePenalty: f.paymentOverduePenalty },
    })
  }

  // ── Health drop: warning when score sub-optimal but no churn ──
  if (
    snapshot.score < THRESHOLDS.healthDropWarningScore &&
    snapshot.score >= THRESHOLDS.churnRiskCriticalScore &&
    !activeTriggerTypes.has("health_drop") &&
    !activeTriggerTypes.has("churn_risk")
  ) {
    decisions.push({
      triggerType: "health_drop",
      severity: "warning",
      message: `Health score dropped to ${snapshot.score}.`,
      context: { score: snapshot.score },
    })
  }

  // ── No activity: penalty crossed the configured fraction ───────
  // `SCORE_WEIGHTS.activityPenaltyMax` is the source-of-truth from
  // constants.ts — both helper files import it so a future tweak
  // can't drift between the score helper and the threshold rule.
  if (
    (f.activityPenalty ?? 0) >=
      SCORE_WEIGHTS.activityPenaltyMax * THRESHOLDS.noActivityPenaltyMinFraction &&
    !activeTriggerTypes.has("no_activity")
  ) {
    decisions.push({
      triggerType: "no_activity",
      severity: "warning",
      message: `Long silence — last activity penalty ${(f.activityPenalty ?? 0).toFixed(0)} of max ${SCORE_WEIGHTS.activityPenaltyMax}.`,
      context: { activityPenalty: f.activityPenalty },
    })
  }

  // ── Contract expiring: info-level signal ───────────────────────
  if (
    (f.contractExpiringPenalty ?? 0) > 0 &&
    !activeTriggerTypes.has("contract_expiring")
  ) {
    decisions.push({
      triggerType: "contract_expiring",
      severity: "info",
      message: `Contract expiring soon — score lost ${f.contractExpiringPenalty} points.`,
      context: { contractExpiringPenalty: f.contractExpiringPenalty },
    })
  }

  // Sort critical → warning → info for stable downstream rendering.
  const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
  decisions.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

  return decisions
}
