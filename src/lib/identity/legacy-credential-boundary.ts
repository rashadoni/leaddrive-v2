import type { Prisma } from "@prisma/client"
import { assertIdentityScope } from "./contract"
import type { RegistryClient } from "./registry"
import { withIdentityMobileReadSnapshot } from "./mobile-session-resolver"
import { phoneDigits, phonesMatch } from "../mtm/mobile-login-phone"

export type LegacyCredentialPrincipal = { kind: "USER"; userId: string } | { kind: "ACTOR"; actorId: string }
export type LegacyCredentialBoundary = "LEGACY" | "MIGRATED" | "UNAVAILABLE"

/**
 * Compatibility eligibility boundary, NOT authentication or an activation API.
 * The caller supplies the server-selected tenant and a principal from its
 * actual legacy lookup/verified session. Only LEGACY permits proceeding to
 * the existing password/MFA/role/license checks. Errors never permit fallback.
 * Ignore rollout flags: irreversible authority remains authoritative when a
 * feature is switched off. For actors, check both the current User link and
 * immutable reviewed owner so unlinking/relinking cannot restore legacy auth.
 * A business write needs its own transactional guard; this snapshot holds no
 * lock for later writes. Fencing legacy requests never activates a person or
 * replaces their password/login flow with the new canonical implementation.
 */
export async function readLegacyCredentialBoundary(client: RegistryClient, organizationId: string,
  principal: LegacyCredentialPrincipal): Promise<LegacyCredentialBoundary> {
  try {
    if (!principal || typeof principal !== "object" || Array.isArray(principal) || Object.keys(principal).length !== 2
      || !Object.hasOwn(principal, "kind")) return "UNAVAILABLE"
    const kind = principal.kind
    const id = kind === "USER" && Object.hasOwn(principal, "userId") ? principal.userId
      : kind === "ACTOR" && Object.hasOwn(principal, "actorId") ? principal.actorId : null
    if (id === null) return "UNAVAILABLE"
    assertIdentityScope(organizationId, id)
    const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
      return readLegacyCredentialBoundaryInTransaction(tx, organizationId, principal)
    })
    return snapshot.value
  } catch { return "UNAVAILABLE" }
}

/**
 * Phone-only legacy admission. A different, unconverted card must not capture
 * the namespace of a verified canonical phone through an old national alias.
 * Suffix comparison only REFUSES legacy admission; it never chooses a person,
 * changes a claim, infers a country or authorizes canonical authentication.
 * Shadow claims/reservations do not change the existing admission policy.
 */
export async function readLegacyPhoneCredentialBoundary(client: RegistryClient, organizationId: string,
  actorId: string, enteredPhone: string): Promise<LegacyCredentialBoundary> {
  try {
    assertIdentityScope(organizationId, actorId)
    if (typeof enteredPhone !== "string" || enteredPhone.length > 128) return "UNAVAILABLE"
    const digits = phoneDigits(enteredPhone)
    if (digits.length < 8 || digits.length > 15) return "UNAVAILABLE"
    const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
      const principal = await readLegacyCredentialBoundaryInTransaction(tx, organizationId, { kind: "ACTOR", actorId })
      if (principal !== "LEGACY") return principal
      const actor = await tx.mtmAgent.findFirst({ where: { id: actorId, organizationId }, select: { phone: true, userId: true } })
      if (!actor) return "UNAVAILABLE" as const
      const user = !actor.phone && actor.userId ? await tx.user.findFirst({
        where: { id: actor.userId, organizationId, isActive: true, anonymizedAt: null }, select: { phone: true },
      }) : null
      const effectivePhone = actor.phone ?? user?.phone ?? null
      // Recheck the original lookup inside this snapshot; a changed phone must
      // not authenticate a stale selected actor. Preserve the existing alias
      // semantics, including the card's own phone taking priority.
      if (!phonesMatch(effectivePhone, enteredPhone)) return "UNAVAILABLE" as const
      const alternatives = [digits, phoneDigits(effectivePhone)].map(value => value.startsWith("0")
        ? { normalizedPhone: { endsWith: value.slice(1) } }
        : { normalizedPhone: `+${value}` })
      const canonicalClaim = await tx.identityPhoneClaim.findFirst({
        where: { organizationId, account: { cutoverAt: { not: null } }, OR: alternatives },
        select: { id: true },
      })
      return canonicalClaim ? "MIGRATED" as const : "LEGACY" as const
    })
    return snapshot.value
  } catch { return "UNAVAILABLE" }
}

/** Internal eligibility only: caller owns a verified scope and transaction. */
export async function readLegacyCredentialBoundaryInTransaction(tx: Prisma.TransactionClient, organizationId: string,
  principal: LegacyCredentialPrincipal): Promise<LegacyCredentialBoundary> {
  return readLegacyBoundaryState(tx, organizationId, principal, true)
}

/** Internal maintenance eligibility; caller must separately authorize the change.
 * Disabled principals may be maintained without being admitted to sign in.
 * Anonymized/missing/foreign/canonical ownership still refuses old credentials. */
export async function readLegacyCredentialMaintenanceBoundaryInTransaction(tx: Prisma.TransactionClient, organizationId: string,
  principal: LegacyCredentialPrincipal): Promise<LegacyCredentialBoundary> {
  return readLegacyBoundaryState(tx, organizationId, principal, false)
}

async function readLegacyBoundaryState(tx: Prisma.TransactionClient, organizationId: string,
  principal: LegacyCredentialPrincipal, requireActive: boolean): Promise<LegacyCredentialBoundary> {
  const company = await tx.organization.findFirst({ where: { id: organizationId }, select: { id: true, isActive: true } })
  if (!company || (requireActive && company.isActive !== true)) return "UNAVAILABLE" as const
  const userIds = new Set<string>()
  let linkedUserId: string | null = null
  if (principal.kind === "USER") {
    linkedUserId = principal.userId
    userIds.add(principal.userId)
  } else {
    const actor = await tx.mtmAgent.findFirst({ where: { id: principal.actorId, organizationId }, select: { userId: true, status: true } })
    if (!actor || (requireActive && actor.status !== "ACTIVE")) return "UNAVAILABLE" as const
    linkedUserId = actor.userId
    if (linkedUserId) userIds.add(linkedUserId)
    const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId, actorId: principal.actorId } }, select: { userId: true } })
    if (binding) userIds.add(binding.userId)
  }
  if (userIds.size) {
    const accounts = await tx.identityAccount.findMany({ where: { organizationId, userId: { in: [...userIds] } }, select: { cutoverAt: true } })
    if (accounts.some(account => account.cutoverAt !== null)) return "MIGRATED" as const
  }
  if (linkedUserId && !await tx.user.findFirst({ where: { id: linkedUserId, organizationId, anonymizedAt: null, ...(requireActive ? { isActive: true } : {}) }, select: { id: true } })) return "UNAVAILABLE" as const
  return "LEGACY" as const
}
