import {
  getSocialMonitoringSettings,
  saveSocialMonitoringSettings,
  platformApifyTokenAvailable,
} from "@/lib/social/monitoring-settings"
import { getOrCreateMediaPolicy, updateMediaPolicy } from "@/lib/social/media-observations"

/**
 * Tenant provisioning for social monitoring (owner rule 13.07.2026: new
 * tenants must work out of the box — today's tenant needed hand-surgery).
 * Idempotent and additive:
 *  - search index is enabled only when a token is actually available (org or
 *    platform APIFY_API_TOKEN); without a token nothing is flipped — the
 *    readiness surface reports the gap instead of hiding it;
 *  - the media policy is stamped with conservative paid defaults ONLY while
 *    untouched (policyVersion 1, still disabled) — an operator's explicit
 *    disables/budgets are never overwritten;
 *  - live-send style flags are never touched here.
 */
export async function ensureSocialMonitoringTenantDefaults(organizationId: string): Promise<{
  searchIndexEnabled: boolean
  mediaPolicyStamped: boolean
}> {
  const result = { searchIndexEnabled: false, mediaPolicyStamped: false }

  const settings = await getSocialMonitoringSettings(organizationId)
  const tokenAvailable = settings.searchIndex.hasToken || platformApifyTokenAvailable()
  if (!settings.searchIndex.enabled && tokenAvailable) {
    await saveSocialMonitoringSettings(organizationId, { searchIndex: { enabled: true, provider: "apify" } })
    result.searchIndexEnabled = true
  }

  const policy = await getOrCreateMediaPolicy(organizationId)
  if (!policy.enabled && policy.policyVersion <= 1) {
    await updateMediaPolicy(organizationId, undefined, {
      enabled: true,
      coverOcrEnabled: true,
      preferPlatformTranscript: true,
      dailyBudgetUsd: 1,
      monthlyBudgetUsd: 20,
      perObservationBudgetUsd: 0.05,
    })
    result.mediaPolicyStamped = true
  }

  return result
}
