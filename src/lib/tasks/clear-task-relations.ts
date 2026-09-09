import { prisma } from "@/lib/prisma"

/**
 * After an entity is hard-deleted, null out relatedType/relatedId on every
 * task that pointed at it — otherwise the task detail view shows a dead
 * "not found" link (and the list/board keep a dangling reference). Mirrors
 * `clearDeletedMentionRefs` (social/mention-refs), which drops social-mention
 * back-references on the same delete paths.
 *
 * org-scoped via the explicit organizationId filter, so it is correct both
 * under RLS and without it. Idempotent (a no-match updateMany is a no-op).
 */
export async function clearTaskRelations(
  orgId: string,
  relatedType: "company" | "contact" | "deal" | "lead" | "ticket",
  id: string,
): Promise<void> {
  await clearTaskRelationsMany(orgId, relatedType, [id])
}

/** Bulk variant — null the relation for every task pointing at any of `ids`
 *  (used by the entity bulk-delete routes). No-op on an empty array. */
export async function clearTaskRelationsMany(
  orgId: string,
  relatedType: "company" | "contact" | "deal" | "lead" | "ticket",
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  await prisma.task.updateMany({
    where: { organizationId: orgId, relatedType, relatedId: { in: ids } },
    data: { relatedType: null, relatedId: null },
  })
}
