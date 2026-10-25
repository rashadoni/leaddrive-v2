import { assertIdentityScope } from "./contract.js"
import type { RegistryClient } from "./registry.js"
import { withIdentityMobileReadSnapshot } from "./mobile-session-resolver.js"

export type LegacyCredentialPrincipal = { kind: "USER"; userId: string } | { kind: "ACTOR"; actorId: string }
export type LegacyCredentialBoundary = "LEGACY" | "MIGRATED" | "UNAVAILABLE"

/**
 * Inactive compatibility boundary, NOT authentication or an activation API.
 * The caller supplies the server-selected tenant and a principal from its
 * actual legacy lookup/verified session. Only LEGACY permits proceeding to
 * the existing password/MFA/role/license checks. Errors never permit fallback.
 * Ignore rollout flags: irreversible authority remains authoritative when a
 * feature is switched off. For actors, check both the current User link and
 * immutable reviewed owner so unlinking/relinking cannot restore legacy auth.
 * A business write needs its own transactional guard; this snapshot holds no
 * lock for later writes. No current endpoint calls this helper yet.
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
      const company = await tx.organization.findFirst({ where: { id: organizationId, isActive: true }, select: { id: true } })
      if (!company) return "UNAVAILABLE" as const
      const userIds = new Set<string>()
      let linkedUserId: string | null = null
      if (kind === "USER") {
        linkedUserId = id
        userIds.add(id)
      } else {
        const actor = await tx.mtmAgent.findFirst({ where: { id, organizationId, status: "ACTIVE" }, select: { userId: true } })
        if (!actor) return "UNAVAILABLE" as const
        linkedUserId = actor.userId
        if (linkedUserId) userIds.add(linkedUserId)
        const binding = await tx.identityActorBinding.findUnique({ where: { organizationId_actorId: { organizationId, actorId: id } }, select: { userId: true } })
        if (binding) userIds.add(binding.userId)
      }
      if (userIds.size) {
        const accounts = await tx.identityAccount.findMany({ where: { organizationId, userId: { in: [...userIds] } }, select: { cutoverAt: true } })
        if (accounts.some(account => account.cutoverAt !== null)) return "MIGRATED" as const
      }
      if (linkedUserId && !await tx.user.findFirst({ where: { id: linkedUserId, organizationId, isActive: true, anonymizedAt: null }, select: { id: true } })) return "UNAVAILABLE" as const
      return "LEGACY" as const
    })
    return snapshot.value
  } catch { return "UNAVAILABLE" }
}
