import { prisma } from "@/lib/prisma"
import { isManagerOrAbove } from "@/lib/constants"

/**
 * Apply record-level sharing rules to a Prisma where clause.
 * Admin/Manager see everything. Others see own records + shared via rules.
 */
export async function applyRecordFilter(
  orgId: string,
  userId: string,
  role: string,
  entityType: string,
  baseWhere: any
) {
  if (isManagerOrAbove(role)) return baseWhere

  // Company and Contact currently have no record-owner columns. They are
  // tenant-wide CRM reference data; RLS still enforces organization isolation.
  // Applying assignedTo/createdBy here would be invalid Prisma input and turn
  // both list endpoints into 500s for every non-manager.
  if (entityType === "company" || entityType === "contact") return baseWhere

  const rules = await prisma.sharingRule.findMany({
    where: { organizationId: orgId, entityType, isActive: true },
  })

  // Default: see own records (assigned or created). Ownerless deals remain a
  // shared intake queue, but ownerless leads are manager-only: SMM leads must
  // be assigned by the load balancer before a salesperson can see them.
  // Lead and Deal have an owner (`assignedTo`) but no `createdBy` column.
  // Passing `createdBy` to Prisma makes their list endpoints fail at runtime.
  // Manual lead creation assigns the creator as owner, so ownership filtering
  // remains intact without referencing a phantom field.
  const ownershipConditions = (ownerIds: string | string[]) => {
    const assignedTo = Array.isArray(ownerIds)
      ? { assignedTo: { in: ownerIds } }
      : { assignedTo: ownerIds }
    if (entityType === "lead") {
      return [assignedTo]
    }
    if (entityType === "deal") {
      return Array.isArray(ownerIds)
        ? [assignedTo]
        : [assignedTo, { assignedTo: null }]
    }
    const createdBy = Array.isArray(ownerIds)
      ? { createdBy: { in: ownerIds } }
      : { createdBy: ownerIds }
    return [assignedTo, createdBy]
  }

  const orConditions: any[] = ownershipConditions(userId)

  const applyOwnershipConditions = () => {
    // Prisma's `OR` is a single object key. Spreading the ownership filter over
    // a search query would replace its existing `OR` and silently discard the
    // search predicates. Preserve both as an explicit conjunction.
    if (Object.prototype.hasOwnProperty.call(baseWhere, "OR")) {
      return { AND: [baseWhere, { OR: orConditions }] }
    }
    return { ...baseWhere, OR: orConditions }
  }

  if (rules.length === 0) {
    return applyOwnershipConditions()
  }

  for (const rule of rules) {
    if (rule.ruleType === "all") {
      return baseWhere // Full access for everyone
    }
    if (rule.ruleType === "role" && rule.targetRole === role) {
      if (rule.sourceRole) {
        const sourceUsers = await prisma.user.findMany({
          where: { organizationId: orgId, role: rule.sourceRole },
          select: { id: true },
        })
        const sourceIds = sourceUsers.map((u: any) => u.id)
        orConditions.push({ OR: ownershipConditions(sourceIds) })
      }
    }
  }

  return applyOwnershipConditions()
}
