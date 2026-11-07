import type { Prisma } from "@prisma/client"
import { createNotification } from "@/lib/notifications"

/**
 * Who hears about a message on a task (Bordio's «Following»): everyone
 * @-mentioned (kind task.mentioned) and every follower (kind task.comment) —
 * never the author, never twice. In-app plus push; no e-mail per message.
 */
export async function notifyTaskMessage(
  db: Pick<Prisma.TransactionClient, "taskFollower">,
  args: { organizationId: string; taskId: string; taskLabel: string; authorId: string | null; authorName: string; mentions: readonly string[]; text: string },
): Promise<number> {
  const { organizationId, taskId, taskLabel, authorId, authorName, mentions, text } = args
  const followers = await db.taskFollower.findMany({ where: { organizationId, taskId }, select: { userId: true } })
  const preview = text.length > 160 ? `${text.slice(0, 157)}…` : text
  const sent = new Set<string>(authorId ? [authorId] : [])
  const jobs: Promise<unknown>[] = []
  for (const userId of mentions) {
    if (sent.has(userId)) continue
    sent.add(userId)
    jobs.push(createNotification({
      organizationId, userId, type: "info", title: `${authorName} sizi qeyd etdi: ${taskLabel}`, message: preview,
      entityType: "task", entityId: taskId, push: true, kind: "task.mentioned",
    }))
  }
  for (const { userId } of followers) {
    if (sent.has(userId)) continue
    sent.add(userId)
    jobs.push(createNotification({
      organizationId, userId, type: "info", title: `${authorName}: ${taskLabel}`, message: preview,
      entityType: "task", entityId: taskId, push: true, kind: "task.comment",
    }))
  }
  await Promise.allSettled(jobs)
  return jobs.length
}

/** Start following (no-op when already following). */
export async function follow(
  db: Pick<Prisma.TransactionClient, "taskFollower">,
  organizationId: string,
  taskId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return
  await db.taskFollower.createMany({ data: ids.map((userId) => ({ organizationId, taskId, userId })), skipDuplicates: true })
}
