import { featureFlagsToArray } from "@/lib/modules";

/**
 * A scheduled absence review is a tenant-specific operational change. The
 * Workforce entitlement alone must never begin creating cases, even though a
 * review case remains deliberately non-disciplinary and non-payroll.
 */
export const WORKFORCE_NO_SHOW_REVIEW_FLAG = "workforce-no-show-review-v1";

export function workforceNoShowReviewEnabled(features: unknown): boolean {
  return featureFlagsToArray(features).includes(WORKFORCE_NO_SHOW_REVIEW_FLAG);
}
