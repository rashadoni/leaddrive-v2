import { featureFlagsToArray } from "@/lib/modules"

/**
 * Tenant-scoped admission flag for Support UX changes that alter persisted
 * state. Presentation-only slices remain independently revertible by commit;
 * authorization and tenant fences are never disabled by this rollout.
 */
export const SUPPORT_UX_V2_CANARY_FLAG = "support_ux_v2_canary"

export function supportUxV2CanaryEnabled(features: unknown): boolean {
  return featureFlagsToArray(features).includes(SUPPORT_UX_V2_CANARY_FLAG)
}
