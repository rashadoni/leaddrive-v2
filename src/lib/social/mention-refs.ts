import { prisma } from "@/lib/prisma"
import { CONVERTED_STATUS, type MentionRef } from "@/lib/social/mention-status"

/**
 * Clear dangling SocialMention back-references after the converted entity
 * (lead / ticket / task) is deleted.
 *
 * `SocialMention.{leadId,ticketId,taskId}` are plain `String?` columns with NO
 * foreign key, so the database does not null them when the target row is
 * deleted (or, for tasks, soft-deleted). Without this cleanup the Social
 * Monitoring row keeps showing the green "view lead/ticket/task" link pointing
 * at a row that no longer exists, and the mention can never be re-converted
 * (the convert routes 409 while the ref is set).
 *
 * Two-step so we don't clobber a mention that was later re-converted to a
 * different entity (it would still carry this ref but a different status):
 *   1. revert status → "reviewed" only for rows still marked as THIS conversion;
 *   2. null the reference column on every matching row.
 * Step 1 runs first, while the ref is still set, so its WHERE still matches.
 */
export async function clearDeletedMentionRefs(
  orgId: string,
  ref: MentionRef,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  await prisma.socialMention.updateMany({
    where: { organizationId: orgId, [ref]: { in: ids }, status: CONVERTED_STATUS[ref] },
    data: { status: "reviewed" },
  })
  await prisma.socialMention.updateMany({
    where: { organizationId: orgId, [ref]: { in: ids } },
    data: { [ref]: null },
  })
}
