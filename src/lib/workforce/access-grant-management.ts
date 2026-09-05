import {
  decidePersistedWorkforceAccess,
  type WorkforceAccessGrantReaderDb,
} from "@/lib/workforce/access-grant-resolution"

/**
 * Shared transaction-safe C7 authority check for role-ledger mutations.
 * Callers must still use the session-only rollout wrapper before reaching a
 * mutation route; this helper is repeated inside the database transaction to
 * close the boundary-to-write revocation race.
 */
export async function canManageWorkforceAccessGrants(input: {
  db: WorkforceAccessGrantReaderDb
  organizationId: string
  userId: string
}): Promise<boolean> {
  const access = await decidePersistedWorkforceAccess({
    db: input.db,
    organizationId: input.organizationId,
    principalUserId: input.userId,
    selfAgentId: null,
    permission: "ROLE_GRANT_MANAGE",
    resource: { organizationId: input.organizationId },
  })
  return access.allowed
}
