import type { Prisma } from "@prisma/client"

/**
 * Whose a board task is (Zeytun, 2026-11-12). Ulviyya: «özümüzdən başqa bizim
 * taskları heç kim idarə edə bilməsin… yalnız özüm edə bilim» — one of her
 * tasks was deleted from a colleague's session. The owner: delete — only the
 * one who made the task (and the admin); «И закрыть тоже» — closing too.
 *
 * On a board task (one with a `divisionId`):
 *  - change it — its fields, its column, closing it, its subtasks, its files —
 *    only its people: who made it, its assignee, its co-assignees; and the admin;
 *  - delete it — only who made it, and the admin.
 * Everyone else who sees the board reads it and writes in its feed.
 *
 * The admin is the organization's `admin` (and `superadmin`) — not a manager
 * and not the board's head: the owner named the admin alone.
 *
 * A task off any board keeps the role rules it always had.
 * The board's own grants (board-permission.ts) still apply on top: this rule
 * narrows them, it never widens them.
 */

export interface TaskPeople {
  divisionId: string | null
  createdBy: string | null
  assignedTo: string | null
  collaboratorIds: readonly string[]
}

function isAdmin(role: string): boolean {
  return role === "admin" || role === "superadmin"
}

export function isTaskPerson(userId: string | null | undefined, task: TaskPeople): boolean {
  if (!userId) return false
  return task.createdBy === userId || task.assignedTo === userId || task.collaboratorIds.includes(userId)
}

/** May change or close the task. */
export function mayManageTask(role: string, userId: string | null | undefined, task: TaskPeople): boolean {
  if (!task.divisionId || isAdmin(role)) return true
  return isTaskPerson(userId, task)
}

/** May delete the task. */
export function mayDeleteTask(role: string, userId: string | null | undefined, task: TaskPeople): boolean {
  if (!task.divisionId || isAdmin(role)) return true
  return !!userId && task.createdBy === userId
}

export const NOT_YOUR_TASK = "Only the task's author, assignee or co-assignees may change it"
export const NOT_YOUR_TASK_TO_DELETE = "Only the task's author may delete it"

type Row = { id: string; divisionId: string | null; createdBy: string | null; assignedTo: string | null }

/**
 * The rule for a task row already read: the database is asked only whether the
 * caller is a co-assignee, and only when nothing else has answered.
 */
export async function mayManageRow(
  db: Pick<Prisma.TransactionClient, "taskCollaborator">,
  organizationId: string, role: string, userId: string | null | undefined, row: Row,
): Promise<boolean> {
  const known = { ...row, collaboratorIds: [] as string[] }
  if (mayManageTask(role, userId, known) || !userId) return mayManageTask(role, userId, known)
  const collaborator = await db.taskCollaborator.findFirst({ where: { organizationId, taskId: row.id, userId }, select: { id: true } })
  return !!collaborator
}

/**
 * Ids among `taskIds` the caller may not manage (or delete). Nothing is read
 * for the admin, who may do everything.
 */
export async function refusedTaskIds(
  db: Pick<Prisma.TransactionClient, "task">,
  organizationId: string, role: string, userId: string | null | undefined, taskIds: readonly string[], kind: "manage" | "delete",
): Promise<string[]> {
  if (isAdmin(role) || taskIds.length === 0) return []
  const rows = await db.task.findMany({
    where: { organizationId, id: { in: [...new Set(taskIds)] } },
    select: {
      id: true, divisionId: true, createdBy: true, assignedTo: true,
      collaborators: userId ? { where: { userId }, select: { userId: true } } : false,
    },
  })
  const allowed = kind === "delete" ? mayDeleteTask : mayManageTask
  return rows
    .filter((row) => !allowed(role, userId, {
      divisionId: row.divisionId, createdBy: row.createdBy, assignedTo: row.assignedTo,
      collaboratorIds: ((row as { collaborators?: { userId: string }[] }).collaborators ?? []).map((c) => c.userId),
    }))
    .map((row) => row.id)
}
