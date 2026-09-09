/**
 * Approval-delegation resolver — CLM Slice-3a.
 *
 * Given a userId that is the intended assignee for a contract-approval stage,
 * checks whether that user has an active, in-window UserApprovalDelegate
 * record and returns the resolved (possibly delegated) assignee.
 *
 * One-hop only: the delegate's own delegations are NOT followed.
 * This is a deliberate design constraint to avoid infinite-loop risk.
 *
 * Org-scoped: only delegates within the same organizationId are considered.
 */
import type { PrismaClient } from "@prisma/client"

export type DelegationResult = {
  /** The user ID that should actually receive the approval task. */
  resolvedUserId: string
  /** True when a delegate was found and resolvedUserId ≠ userId. */
  delegated: boolean
  /** The original intended userId (equals resolvedUserId when not delegated). */
  originalUserId: string
}

/**
 * Resolve the approval assignee for `userId` at the given `asOf` timestamp.
 *
 * Looks for the first active, in-window delegation where fromUserId === userId
 * within the same org. Returns the delegate if found, otherwise the user
 * themselves.
 *
 * @param prisma  - Prisma client or transaction client
 * @param orgId   - Org scope (delegation is org-bound)
 * @param userId  - The intended assignee before delegation resolution
 * @param asOf    - The reference timestamp (typically submission time: new Date())
 */
export async function resolveApprovalAssignee(
  prisma: Pick<PrismaClient, "userApprovalDelegate">,
  orgId: string,
  userId: string,
  asOf: Date,
): Promise<DelegationResult> {
  const delegate = await prisma.userApprovalDelegate.findFirst({
    where: {
      organizationId: orgId,
      fromUserId: userId,
      isActive: true,
      startDate: { lte: asOf },
      endDate: { gte: asOf },
    },
    orderBy: { startDate: "desc" },
    select: { toUserId: true },
  })

  if (delegate) {
    return {
      resolvedUserId: delegate.toUserId,
      delegated: true,
      originalUserId: userId,
    }
  }

  return {
    resolvedUserId: userId,
    delegated: false,
    originalUserId: userId,
  }
}
