import type { PrismaClient } from "@prisma/client"

export const ACTIVE_LEAD_STATUSES = ["new", "contacted", "qualified"] as const

export type SalesAssignmentCandidate = {
  id: string
  name: string
  activeLeadCount: number
  recommended: boolean
}

type AssignmentDb = Pick<PrismaClient, "user" | "lead">

export function rankSalesAssignees(
  users: { id: string; name: string; email: string }[],
  loads: { assignedTo: string | null; _count: { _all: number } }[],
): SalesAssignmentCandidate[] {
  const countByUser = new Map(
    loads
      .filter((row): row is typeof row & { assignedTo: string } => Boolean(row.assignedTo))
      .map((row) => [row.assignedTo, row._count._all]),
  )
  const ranked = users
    .map((user) => ({
      id: user.id,
      name: user.name || user.email,
      activeLeadCount: countByUser.get(user.id) ?? 0,
      recommended: false,
    }))
    .sort((left, right) =>
      left.activeLeadCount - right.activeLeadCount
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id),
    )

  if (ranked[0]) ranked[0].recommended = true
  return ranked
}

export async function getSalesAssignmentCandidates(
  db: AssignmentDb,
  organizationId: string,
): Promise<SalesAssignmentCandidate[]> {
  const users = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      isAvailable: true,
      role: "sales",
    },
    select: { id: true, name: true, email: true },
  })
  if (users.length === 0) return []

  const loads = await db.lead.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId,
      assignedTo: { in: users.map((user) => user.id) },
      status: { in: [...ACTIVE_LEAD_STATUSES] },
    },
    _count: { _all: true },
  })
  return rankSalesAssignees(users, loads)
}
