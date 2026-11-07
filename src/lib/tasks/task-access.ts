import type { Prisma } from "@prisma/client"
import type { Role } from "@/lib/permissions"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"

/**
 * Who may open one task — the rule GET /api/v1/tasks/[id] applies, shared by
 * the card's own endpoints (feed, followers, time, subtasks, messages):
 * a task off any board is open to the organization; a board task to whoever
 * may see that board, its assignee, its author, its reporter, a co-assignee
 * and a follower. Anyone else gets 404 — the task does not exist for them.
 */

type Db = Pick<Prisma.TransactionClient, "task" | "division" | "boardPermission">

export interface OpenTask {
  id: string
  title: string
  taskKey: string | null
  divisionId: string | null
  assignedTo: string | null
  createdBy: string | null
  reporterId: string | null
}

export async function openTaskFor(
  db: Db,
  args: { organizationId: string; userId: string | null | undefined; role: string; taskId: string },
): Promise<OpenTask | null> {
  const { organizationId, userId, role, taskId } = args
  const task = await db.task.findFirst({
    where: { id: taskId, organizationId },
    select: {
      id: true, title: true, taskKey: true, divisionId: true, assignedTo: true, createdBy: true, reporterId: true,
      collaborators: userId ? { where: { userId }, select: { userId: true } } : false,
      followers: userId ? { where: { userId }, select: { userId: true } } : false,
    },
  })
  if (!task) return null
  const { collaborators, followers, ...open } = task as typeof task & { collaborators?: unknown[]; followers?: unknown[] }
  if (!task.divisionId) return open
  if (userId && (task.assignedTo === userId || task.createdBy === userId || task.reporterId === userId)) return open
  if ((collaborators?.length ?? 0) > 0 || (followers?.length ?? 0) > 0) return open
  const accessible = await getAccessibleDivisionIds(db as never, organizationId, userId || "", role as Role)
  return accessible === "all" || accessible.includes(task.divisionId) ? open : null
}

/** Ids among `userIds` that are active people of the organization. */
export async function activeMembers(
  db: Pick<Prisma.TransactionClient, "user">,
  organizationId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = await db.user.findMany({
    where: { organizationId, id: { in: [...new Set(userIds)] }, isActive: true },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}
