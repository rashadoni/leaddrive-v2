/**
 * Merge-decision resolver — G2 Phase 6 Block B slice 1.
 *
 * Given a fuzzy-match score and threshold config, decide what the
 * caller should do with the candidate pair:
 *
 *   score >= thresholds.autoMerge     → auto_merge
 *   score >= thresholds.manualReview  → manual_review (queue row)
 *   score < thresholds.manualReview   → reject (no queue row)
 *
 * Default thresholds (0.95 / 0.7) ship with slice 1; slice 3 may
 * make these per-tenant via a Config table.
 *
 * Pure synchronous. Slice-2 cron consumes the decision:
 *   auto_merge → emit a `profile_merge_candidates` row with
 *                status='auto_merged' + immediately apply the merge
 *   manual_review → emit a row with status='pending' for operator review
 *   reject → no row emitted (or a separate "rejected" debug log)
 */
import {
  DEFAULT_MERGE_THRESHOLDS,
  type ResolveMergeDecision,
  type ResolveMergeInput,
} from "./types"

export function resolveMergeDecision(
  input: ResolveMergeInput
): ResolveMergeDecision {
  const { score } = input
  const thresholds = input.thresholds ?? DEFAULT_MERGE_THRESHOLDS

  // Defensive: thresholds must be well-ordered. A caller passing
  // autoMerge < manualReview would collapse the "manual_review"
  // band to negative-width; we surface the misconfiguration as a
  // reject with a clear message rather than silently produce
  // unexpected decisions.
  if (
    !Number.isFinite(thresholds.autoMerge) ||
    !Number.isFinite(thresholds.manualReview) ||
    thresholds.autoMerge < thresholds.manualReview
  ) {
    return {
      kind: "reject",
      reason: `Invalid thresholds: autoMerge=${thresholds.autoMerge} < manualReview=${thresholds.manualReview}; caller config error`,
    }
  }

  if (!Number.isFinite(score) || score < 0 || score > 1) {
    return {
      kind: "reject",
      reason: `Invalid score ${score}; must be a finite number in [0, 1]`,
    }
  }

  if (score >= thresholds.autoMerge) {
    return {
      kind: "auto_merge",
      reason: `Score ${score.toFixed(4)} >= autoMerge threshold ${thresholds.autoMerge} — high-confidence match`,
    }
  }
  if (score >= thresholds.manualReview) {
    return {
      kind: "manual_review",
      reason: `Score ${score.toFixed(4)} >= manualReview threshold ${thresholds.manualReview} but < autoMerge ${thresholds.autoMerge}`,
    }
  }
  return {
    kind: "reject",
    reason: `Score ${score.toFixed(4)} < manualReview threshold ${thresholds.manualReview}`,
  }
}
