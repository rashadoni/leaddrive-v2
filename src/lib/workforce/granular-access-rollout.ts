import { featureFlagsToArray } from "@/lib/modules"

/**
 * Explicit per-tenant cutover fence for durable Workforce role grants.
 * Until enabled, established session-admin boundaries remain in place.
 * After enablement, protected routes must not fall back to broad CRM roles.
 */
export const WORKFORCE_GRANULAR_ACCESS_FLAG = "workforce-granular-access-v1"

export function workforceGranularAccessEnabled(features: unknown): boolean {
  return featureFlagsToArray(features).includes(WORKFORCE_GRANULAR_ACCESS_FLAG)
}
