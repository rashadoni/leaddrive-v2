import { prisma } from "@/lib/prisma"
import { featureFlagsToArray } from "@/lib/modules"

/**
 * Superadmin-controlled entitlement: when set on `Organization.features`, the
 * tenant's Social Monitoring runs in BRAND-PROTECTION-ONLY mode — external
 * watch/sentiment only. Owned-channel controls are hidden while the draft
 * queue and agent configuration remain available. External sending stays
 * disabled and is rejected by the API. Flag ABSENT = full engagement mode.
 */
export const SOCIAL_BRAND_PROTECTION_ONLY_FLAG = "social_brand_protection_only"
export const SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE = "brand_protection_only"
export const SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE =
  "External social replies are disabled while Brand Protection mode is active."

export function featuresIncludeBrandProtectionOnly(features: unknown): boolean {
  return featureFlagsToArray(features).includes(SOCIAL_BRAND_PROTECTION_ONLY_FLAG)
}

/** Loads the org's brand-protection-only entitlement. Defaults false. */
export async function isSocialBrandProtectionOnly(orgId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { features: true },
  })
  return featuresIncludeBrandProtectionOnly(org?.features)
}
