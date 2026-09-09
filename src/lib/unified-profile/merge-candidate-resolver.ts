/**
 * Merge-queue resolution — Wave 2A.
 *
 * Closes the human-in-the-loop gap: the materializer CREATES ProfileMergeCandidate
 * rows (ambiguous identity — email→A, phone→B) but nothing acted on them. This
 * resolves a candidate the operator reviewed:
 *
 *   reject → candidate.status = "rejected" (+ reviewedBy/At) — both profiles kept.
 *   merge  → in a transaction: re-point the secondary's ProfileSource rows onto the
 *            primary, fill the primary's MISSING identity keys from the secondary
 *            (so the merged profile holds both email + phone), then DELETE the
 *            secondary. The route re-aggregates the primary afterward.
 *
 * NOTE on the candidate row after a merge: `ProfileMergeCandidate.secondaryProfile`
 * is `onDelete: Cascade`, so deleting the secondary cascade-removes THIS candidate
 * (and any other candidate referencing the secondary — correct, they're moot once
 * the dup is gone). The durable audit of the merge therefore lives in the app
 * audit log (logAudit in the route), not the candidate row. `reject` keeps the
 * candidate as a persisted terminal record.
 *
 * Injected client (structural subset of PrismaClient) → unit-testable without a DB.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MergeResolverClient {
  profileMergeCandidate: {
    findFirst: (args: any) => Promise<any | null>
    updateMany: (args: any) => Promise<{ count: number }>
  }
  unifiedProfile: {
    findFirst: (args: any) => Promise<any | null>
    delete: (args: any) => Promise<any>
    update: (args: any) => Promise<any>
  }
  profileSource: {
    updateMany: (args: any) => Promise<any>
  }
  $transaction: <T>(fn: (tx: MergeResolverClient) => Promise<T>) => Promise<T>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ResolveAction = "merge" | "reject"

export interface ResolveResult {
  status: "merged" | "rejected" | "not_found" | "already_resolved"
  primaryProfileId?: string
  secondaryProfileId?: string
}

/** Identity columns the primary may inherit from the secondary on merge. */
const IDENTITY_SELECT = {
  id: true,
  emailNormalized: true,
  phoneNormalized: true,
  nameNormalized: true,
  displayEmail: true,
  displayPhone: true,
  displayName: true,
  primaryContactId: true,
  primaryCompanyId: true,
} as const

interface IdentityRow {
  id: string
  emailNormalized: string | null
  phoneNormalized: string | null
  nameNormalized: string | null
  displayEmail: string | null
  displayPhone: string | null
  displayName: string | null
  primaryContactId: string | null
  primaryCompanyId: string | null
}

export async function resolveMergeCandidate(
  client: MergeResolverClient,
  input: {
    orgId: string
    candidateId: string
    action: ResolveAction
    reviewedBy: string
    reviewNote?: string | null
    now?: Date
  },
): Promise<ResolveResult> {
  const { orgId, candidateId, action, reviewedBy, now } = input
  const reviewNote = input.reviewNote ?? null

  const cand = (await client.profileMergeCandidate.findFirst({
    where: { id: candidateId, organizationId: orgId },
    select: { id: true, primaryProfileId: true, secondaryProfileId: true, status: true },
  })) as { id: string; primaryProfileId: string; secondaryProfileId: string; status: string } | null

  if (!cand) return { status: "not_found" }
  if (cand.status !== "pending") return { status: "already_resolved" }

  const reviewedAt = now ?? new Date()

  if (action === "reject") {
    // Conditional write = atomic guard vs a concurrent resolve: the
    // status='pending' predicate is the lock; a raced second caller gets count 0.
    const r = await client.profileMergeCandidate.updateMany({
      where: { id: cand.id, organizationId: orgId, status: "pending" },
      data: { status: "rejected", reviewedBy, reviewedAt, reviewNote },
    })
    if (r.count === 0) return { status: "already_resolved" }
    return { status: "rejected", primaryProfileId: cand.primaryProfileId, secondaryProfileId: cand.secondaryProfileId }
  }

  // ── merge ────────────────────────────────────────────────────────────────
  const [primary, secondary] = (await Promise.all([
    client.unifiedProfile.findFirst({ where: { id: cand.primaryProfileId, organizationId: orgId }, select: IDENTITY_SELECT }),
    client.unifiedProfile.findFirst({ where: { id: cand.secondaryProfileId, organizationId: orgId }, select: IDENTITY_SELECT }),
  ])) as [IdentityRow | null, IdentityRow | null]

  // Either profile already gone (raced/stale) → nothing coherent to merge.
  if (!primary || !secondary) return { status: "not_found" }

  const claimed = await client.$transaction(async (tx) => {
    // 0. Atomic claim: flip pending→manually_merged ONLY while still pending. A
    //    concurrent resolve sees count 0 and bails BEFORE the delete (avoids a
    //    P2025 on an already-deleted secondary → returns already_resolved). The
    //    status write is itself cascade-undone in step 2; its job is the lock.
    const claim = await tx.profileMergeCandidate.updateMany({
      where: { id: cand.id, organizationId: orgId, status: "pending" },
      data: { status: "manually_merged", reviewedBy, reviewedAt },
    })
    if (claim.count === 0) return false
    // 1. Re-point the secondary's sources onto the primary. The ProfileSource
    //    UNIQUE is (org, sourceType, sourceId) — unchanged here — so no collision.
    await tx.profileSource.updateMany({
      where: { organizationId: orgId, unifiedProfileId: secondary.id },
      data: { unifiedProfileId: primary.id },
    })
    // 2. Delete the secondary FIRST — frees its (org, email) / (org, phone) partial
    //    UNIQUEs so the primary can adopt them in step 3 without a collision. This
    //    also cascade-removes this candidate (secondaryProfile onDelete: Cascade);
    //    the durable merge audit is the route's logAudit entry.
    await tx.unifiedProfile.delete({ where: { id: secondary.id } })
    // 3. Fill the primary's MISSING identity keys from the secondary, so the merged
    //    profile carries both (the candidate existed precisely because email matched
    //    the primary and phone matched the secondary, or vice-versa).
    await tx.unifiedProfile.update({
      where: { id: primary.id },
      data: {
        emailNormalized: primary.emailNormalized ?? secondary.emailNormalized,
        phoneNormalized: primary.phoneNormalized ?? secondary.phoneNormalized,
        nameNormalized: primary.nameNormalized ?? secondary.nameNormalized,
        displayEmail: primary.displayEmail ?? secondary.displayEmail,
        displayPhone: primary.displayPhone ?? secondary.displayPhone,
        displayName: primary.displayName ?? secondary.displayName,
        primaryContactId: primary.primaryContactId ?? secondary.primaryContactId,
        primaryCompanyId: primary.primaryCompanyId ?? secondary.primaryCompanyId,
      },
    })
    return true
  })

  if (!claimed) return { status: "already_resolved" }
  return { status: "merged", primaryProfileId: primary.id, secondaryProfileId: secondary.id }
}
