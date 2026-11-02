import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { assertIdentityRequestId, assertIdentityScope, normalizeIdentityPhone, IdentityRegistryError } from "./contract"
import type { IdentityMobileApplication } from "./mobile-session-contract"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"

/** Eligibility for a password-recovery challenge, never authentication. Only
 * possession of the separately delivered secret can authorize the reset. */
export type IdentityRecoveryAuthority = {
  version: 3; purpose: "COMMON_PASSWORD_RECOVERY"; organizationId: string; userId: string;
  application: IdentityMobileApplication; claimId: string; normalizedPhone: string; actorId: string;
  accountVersion: number; credentialEpoch: number; contactRevision: number;
  grantVersion: number; membershipVersion: number;
}
const names = ["version", "purpose", "organizationId", "userId", "application", "claimId", "normalizedPhone", "actorId",
  "accountVersion", "credentialEpoch", "contactRevision", "grantVersion", "membershipVersion"] as const
export function parseIdentityRecoveryAuthority(value: unknown): IdentityRecoveryAuthority | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name))) return null
  const row = value as IdentityRecoveryAuthority
  if (row.version !== 3 || row.purpose !== "COMMON_PASSWORD_RECOVERY" || !["TIME", "ROUTE_FIELD"].includes(row.application)
    || ![row.accountVersion, row.credentialEpoch, row.contactRevision, row.grantVersion, row.membershipVersion]
      .every(n => Number.isInteger(n) && n > 0 && n <= 2_147_483_647)) return null
  try { assertIdentityScope(row.organizationId, row.userId); assertIdentityRequestId(row.claimId); assertIdentityRequestId(row.actorId); if (normalizeIdentityPhone(row.normalizedPhone) !== row.normalizedPhone) return null } catch { return null }
  return row
}
export function identityRecoveryAuthorityHash(value: IdentityRecoveryAuthority): string {
  const parsed = parseIdentityRecoveryAuthority(value)
  if (!parsed) throw new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
  return createHash("sha256").update(JSON.stringify(names.map(name => parsed[name]))).digest("hex")
}

/** Caller holds the tenant identity writer lock. Source locks order direct
 * revocation with delivery/confirmation/reset; no fabricated JWT is involved. */
export async function freezeIdentityRecoveryAuthority(tx: Prisma.TransactionClient, organizationId: string, userId: string,
  application: IdentityMobileApplication): Promise<IdentityRecoveryAuthority> {
  assertIdentityScope(organizationId, userId)
  if (!["TIME", "ROUTE_FIELD"].includes(application)) throw new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
  const [person] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE "organizationId"=${organizationId}
    AND id=${userId} AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  const [account] = await tx.$queryRaw<Array<{ version: number; credentialEpoch: number; contactRevision: number }>>`
    SELECT version,"credentialEpoch","contactRevision" FROM identity_accounts WHERE "organizationId"=${organizationId}
    AND "userId"=${userId} AND "cutoverAt" IS NOT NULL AND "cutoverAt" <= clock_timestamp() FOR SHARE`
  const [claim] = await tx.$queryRaw<Array<{ id: string; normalizedPhone: string }>>`SELECT id,"normalizedPhone" FROM identity_phone_claims
    WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR SHARE`
  const [grant] = await tx.$queryRaw<Array<{ version: number; role: string }>>`SELECT version,role FROM identity_application_grants
    WHERE "organizationId"=${organizationId} AND "userId"=${userId} AND application=${application} AND status='ACTIVE' FOR SHARE`
  const [membership] = await tx.$queryRaw<Array<{ version: number; actorId: string }>>`SELECT version,"actorId" FROM identity_application_memberships
    WHERE "organizationId"=${organizationId} AND "userId"=${userId} AND application=${application} AND status='ACTIVE' FOR SHARE`
  if (!person || !account || !claim || !grant || !membership) throw new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
  const [card] = await tx.$queryRaw<Array<{ role: string; attendanceParticipant: boolean; attendanceExcluded: boolean }>>`
    SELECT role,"attendanceParticipant","attendanceExcluded" FROM mtm_agents WHERE "organizationId"=${organizationId}
    AND id=${membership.actorId} AND "userId"=${userId} AND status='ACTIVE' FOR SHARE`
  const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId, actorId: membership.actorId } } })
  const policy = await readIdentityMobileTenantPolicy(tx, organizationId, application)
  if (!card || binding?.userId !== userId || !policy.identityEnabled || !policy.licensed || card.role !== grant.role
    || (application === "TIME" ? card.role !== "EMPLOYEE" || !card.attendanceParticipant || card.attendanceExcluded
      : !["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"].includes(card.role))) throw new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
  return { version: 3, purpose: "COMMON_PASSWORD_RECOVERY", organizationId, userId, application, claimId: claim.id, normalizedPhone: claim.normalizedPhone, actorId: membership.actorId,
    accountVersion: account.version, credentialEpoch: account.credentialEpoch, contactRevision: account.contactRevision,
    grantVersion: grant.version, membershipVersion: membership.version }
}
export async function revalidateIdentityRecoveryAuthority(tx: Prisma.TransactionClient, value: unknown, organizationId: string, userId: string) {
  const frozen = parseIdentityRecoveryAuthority(value)
  if (!frozen || frozen.organizationId !== organizationId || frozen.userId !== userId) throw new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
  const current = await freezeIdentityRecoveryAuthority(tx, organizationId, userId, frozen.application)
  if (identityRecoveryAuthorityHash(current) !== identityRecoveryAuthorityHash(frozen)) throw new IdentityRegistryError("IDENTITY_RECOVERY_UNAVAILABLE")
  return current
}
