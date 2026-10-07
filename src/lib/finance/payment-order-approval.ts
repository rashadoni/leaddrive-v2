import { isAdmin, type Role } from "@/lib/permissions"

/**
 * Whether this person is the one who raised the order and is therefore not the
 * one to approve it.
 *
 * Owner's rule, 2026-10-07: a manager does not approve their own payment order;
 * an administrator may. The exemption is what keeps the rule usable — in an
 * organization where one person runs the finances, a strict "never your own"
 * would mean no order is ever approved.
 *
 * An order with no recorded author is nobody's own: `createdBy` has been
 * written only since 2026-10-07, and refusing every older order to everyone
 * would help no one.
 *
 * One function for the server and the screen, so the button that is not drawn
 * and the request that is refused cannot disagree.
 */
export function isOwnOrderToApprove(
  order: { createdBy?: string | null },
  actor: { userId: string; role: string },
): boolean {
  if (isAdmin(actor.role as Role)) return false
  return !!order.createdBy && order.createdBy === actor.userId
}
