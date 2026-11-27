/**
 * The person who follows every task on the organization's boards.
 *
 * Zeytun, 2026-11-27. Nazrin: «ümumiyyətlə mən tag olunmasam belə hamısı mənə
 * gələ bilməz? Default?»; Sabina: «tapşırığı verənin ayrı-ayrı olması lazımdır,
 * çünki dizaynerə tapşırığı SMM verir». So the head of marketing is not put in
 * «Tapşırığı verən» (that stays whoever gives the task) — she follows them all.
 * Owner: «Да, делай». It replaces the «default reporter» of 2026-11-19, which
 * no organization had turned on.
 *
 * The watcher follows every new board task and, the moment she is named, every
 * open one: a message on it reaches her (task-notify.ts), and so do a new task
 * and a finished one (create-task.ts, update-task.ts). One setting, kept in
 * `organizations.settings`; a person who left follows nothing.
 */
import type { Prisma } from "@prisma/client"

export const TASK_WATCHER_KEY = "taskWatcherId"

const FINISHED = ["done", "completed", "cancelled"]

export function readTaskWatcherId(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null
  const value = (settings as Record<string, unknown>)[TASK_WATCHER_KEY]
  return typeof value === "string" && value.trim() ? value : null
}

type Db = Pick<Prisma.TransactionClient, "organization" | "user">

/** The organization's watcher when that person still works there, else null. */
export async function resolveTaskWatcher(
  db: Db,
  organizationId: string,
): Promise<{ id: string; name: string; preferredLanguage: string | null } | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  const id = readTaskWatcherId(org?.settings)
  if (!id) return null
  return db.user.findFirst({ where: { id, organizationId, isActive: true }, select: { id: true, name: true, preferredLanguage: true } })
}

/** Makes `userId` a follower of every open task on the boards; returns how many she now follows anew. */
export async function followOpenBoardTasks(
  db: Pick<Prisma.TransactionClient, "task" | "taskFollower">,
  organizationId: string,
  userId: string,
): Promise<number> {
  const open = await db.task.findMany({
    where: { organizationId, deletedAt: null, divisionId: { not: null }, status: { notIn: FINISHED } },
    select: { id: true },
  })
  let added = 0
  for (let at = 0; at < open.length; at += 1000) {
    const result = await db.taskFollower.createMany({
      data: open.slice(at, at + 1000).map((task: { id: string }) => ({ organizationId, taskId: task.id, userId })),
      skipDuplicates: true,
    })
    added += result.count
  }
  return added
}
