import type { Prisma } from "@prisma/client"
import { assertIdentityScope } from "./contract"

/** Allocation accounting, never authentication or grant authorization.
 * Preserve the old all-User count for unconverted/shadow people. Once authority
 * is canonical, only an allocated ACTIVE CRM grant occupies a CRM seat; Time
 * and Field grants do not. Disabling a User does not silently free an allocated
 * CRM seat, matching the legacy treatment of disabled accounts. A future live
 * CRM grant writer must check the quota under its tenant mutation lock.
 */
export function identityCrmSeatUserWhere(organizationId: string): Prisma.UserWhereInput {
  assertIdentityScope(organizationId, "crm-seat-count")
  return {
    organizationId,
    OR: [
      { identityAccount: { is: null } },
      { identityAccount: { is: { cutoverAt: null } } },
      { identityAccount: { is: { cutoverAt: { not: null }, grants: { some: { application: "CRM", status: "ACTIVE" } } } } },
    ],
  }
}
