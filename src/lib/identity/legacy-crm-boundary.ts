import { assertIdentityScope } from "./contract"
import type { RegistryClient } from "./registry"
import type { LegacyCredentialBoundary } from "./legacy-credential-boundary"
import { withIdentityMobileReadSnapshot } from "./mobile-session-resolver"

/**
 * Legacy CRM eligibility only, NOT password/MFA authentication. Preserve the
 * existing platform exception using fresh DB role, never a cookie/body role.
 * Canonical authority refuses old password/cookie admission even with rollout
 * off, missing grants, or a malformed converted platform account. No fallback.
 */
export async function readLegacyCrmCredentialBoundary(client: RegistryClient, organizationId: string,
  userId: string): Promise<LegacyCredentialBoundary> {
  try {
    assertIdentityScope(organizationId, userId)
    const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
      const [company, person, account] = await Promise.all([
        tx.organization.findFirst({ where: { id: organizationId }, select: { id: true, isActive: true } }),
        tx.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, organizationId: true, role: true, isActive: true, anonymizedAt: true } }),
        tx.identityAccount.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { cutoverAt: true } }),
      ])
      if (account && account.cutoverAt !== null) return "MIGRATED" as const
      if (!company || company.id !== organizationId || !person || person.id !== userId || person.organizationId !== organizationId
        || person.isActive !== true || person.anonymizedAt !== null
        || (company.isActive !== true && person.role !== "superadmin")) return "UNAVAILABLE" as const
      return "LEGACY" as const
    })
    return snapshot.value
  } catch { return "UNAVAILABLE" }
}
