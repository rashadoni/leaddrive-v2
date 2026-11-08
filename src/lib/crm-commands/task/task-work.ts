import type { Prisma, TaskChecklist, TaskComment, TaskTimeEntry } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { activeMembers, openTaskFor, type OpenTask } from "@/lib/tasks/task-access"
import { follow, notifyTaskMessage } from "@/lib/tasks/task-notify"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { notFoundError, validationError } from "../errors"
import {
  addTaskChecklistItemCommandSchema,
  addTaskCommentCommandSchema,
  logTaskTimeCommandSchema,
  setTaskChecklistItemDoneCommandSchema,
} from "../schemas/task"

/**
 * Работа внутри задачи одной командой на экран и голос: сообщение, подзадача,
 * отметка подзадачи, время.
 *
 * До 2026-11-08 это жило прямо в маршрутах `/api/v1/tasks/[id]/…`, и голосу
 * пришлось бы писать то же самое второй раз. Второй раз — значит, рано или
 * поздно по-другому: голосовое сообщение без подписки автора на задачу,
 * отметка подзадачи без строки «закрыл подзадачу» в ленте. Поэтому маршруты
 * экрана теперь зовут эти команды, а голос — те же самые.
 *
 * Доступ к задаче — `openTaskFor`, как у экрана: задача из чужого отдела,
 * где человек не исполнитель, не автор и не подписчик, для него не существует
 * (NOT_FOUND, а не FORBIDDEN — её существование тоже не сообщается).
 */

type Db = Prisma.TransactionClient

function firstIssue(error: { issues: Array<{ message: string }> }, fallback: string): string {
  return error.issues[0]?.message ?? fallback
}

async function requireOpenTask(db: Db | typeof prisma, actor: CrmCommandActorContext, taskId: string): Promise<OpenTask> {
  const task = await openTaskFor(db as Db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    role: actor.role,
    taskId,
  })
  if (!task) throw notFoundError("Task not found")
  return task
}

/** Выполнить `work` в переданной транзакции или в своей. */
async function inTransaction<T>(
  execution: CrmCommandExecutionContext | undefined,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  if (execution?.transaction) return work(execution.transaction)
  return prisma.$transaction((tx: Prisma.TransactionClient) => work(tx))
}

export type TaskCommentWithAuthor = TaskComment & {
  user: { id: string; name: string | null; avatar: string | null } | null
}

/**
 * Сообщение в задаче (чат Bordio). Автор и все отмеченные @ начинают следить
 * за задачей; отмеченным и подписчикам уходит уведомление — после коммита,
 * чтобы откат голосовой транзакции не оставил уведомления о несуществующем.
 */
export async function addTaskCommentCommand(
  actor: CrmCommandActorContext,
  taskId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: TaskCommentWithAuthor; task: OpenTask }> {
  const parsed = addTaskCommentCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstIssue(parsed.error, "Invalid message"))
  const orgId = actor.organizationId

  const { comment, task, mentions } = await inTransaction(execution, async (db) => {
    const task = await requireOpenTask(db, actor, taskId)
    const mentions = await activeMembers(db, orgId, parsed.data.mentions ?? [])
    const comment = await db.taskComment.create({
      data: { organizationId: orgId, taskId, userId: actor.userId || null, content: parsed.data.content, mentions },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    }) as TaskCommentWithAuthor
    await follow(db, orgId, taskId, [actor.userId, ...mentions])
    return { comment, task, mentions }
  })

  const notify = () => notifyTaskMessage(prisma, {
    organizationId: orgId,
    taskId,
    taskLabel: task.taskKey ? `${task.taskKey} ${task.title}` : task.title,
    authorId: actor.userId || null,
    authorName: comment.user?.name ?? "",
    mentions,
    text: parsed.data.content,
  })
  if (execution?.transaction) {
    // Голос: транзакция ещё не закоммичена — уведомление только после неё.
    dispatchOrDeferCommandEffects(execution, async () => { await notify() })
  } else {
    // Экран: сообщение уже записано, и ответ уходит, когда люди оповещены —
    // как было до команды. Сбой уведомления сообщения не отменяет.
    await notify().catch((error) => console.error("[task comments] notify failed", error))
  }

  return { entity: comment, task }
}

const checklistInclude = {
  assignee: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.TaskChecklistInclude

export type TaskChecklistItemWithAssignee = TaskChecklist & {
  assignee: { id: string; name: string | null; avatar: string | null } | null
}

/** Подзадача (пункт чек-листа) — со своим исполнителем и сроком, как в Bordio. */
export async function addTaskChecklistItemCommand(
  actor: CrmCommandActorContext,
  taskId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: TaskChecklistItemWithAssignee; task: OpenTask }> {
  const parsed = addTaskChecklistItemCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstIssue(parsed.error, "Invalid subtask"))
  const orgId = actor.organizationId
  const input = parsed.data

  return inTransaction(execution, async (db) => {
    const task = await requireOpenTask(db, actor, taskId)
    if (input.assignedTo) {
      const [member] = await activeMembers(db, orgId, [input.assignedTo])
      if (member !== input.assignedTo) {
        throw validationError("assignedTo must be an active member of this organization")
      }
    }
    const maxOrder = await db.taskChecklist.aggregate({
      where: { taskId, organizationId: orgId },
      _max: { sortOrder: true },
    })
    const item = await db.taskChecklist.create({
      data: {
        organizationId: orgId,
        taskId,
        title: input.title,
        sortOrder: input.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1,
        assignedTo: input.assignedTo ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
      include: checklistInclude,
    }) as TaskChecklistItemWithAssignee
    return { entity: item, task }
  })
}

/**
 * Отметить подзадачу сделанной (или снова открытой). Переключение пишет в
 * ленту задачи «закрыл подзадачу» / «открыл снова» — та же строка, что от
 * галочки на экране. Повторная отметка того, что уже отмечено, ничего не пишет.
 */
export async function setTaskChecklistItemDoneCommand(
  actor: CrmCommandActorContext,
  taskId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: TaskChecklistItemWithAssignee; task: OpenTask; toggled: boolean }> {
  const parsed = setTaskChecklistItemDoneCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstIssue(parsed.error, "Invalid subtask"))
  const orgId = actor.organizationId
  const { checklistItemId, completed } = parsed.data

  return inTransaction(execution, async (db) => {
    const task = await requireOpenTask(db, actor, taskId)
    const existing = await db.taskChecklist.findFirst({
      where: { id: checklistItemId, taskId, organizationId: orgId },
    })
    if (!existing) throw notFoundError("Subtask not found")
    const toggled = completed !== existing.completed
    await db.taskChecklist.update({
      where: { id: existing.id },
      data: { completed, completedAt: completed ? existing.completedAt ?? new Date() : null },
    })
    if (toggled) {
      await db.taskActivity.create({
        data: {
          organizationId: orgId,
          taskId,
          userId: actor.userId || null,
          action: completed ? "subtask_completed" : "subtask_reopened",
          newValue: existing.title,
        },
      })
    }
    const item = await db.taskChecklist.findFirst({
      where: { id: existing.id, organizationId: orgId },
      include: checklistInclude,
    }) as TaskChecklistItemWithAssignee
    return { entity: item, task, toggled }
  })
}

/**
 * Записать время руками («Log time» в Bordio). Время пишет человек: запись
 * без автора не принимается — ни с экрана, ни голосом.
 */
export async function logTaskTimeCommand(
  actor: CrmCommandActorContext,
  taskId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: TaskTimeEntry; task: OpenTask }> {
  const parsed = logTaskTimeCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstIssue(parsed.error, "Invalid time entry"))
  if (!actor.userId) throw validationError("Time is written by a person")
  const userId = actor.userId
  const orgId = actor.organizationId
  const input = parsed.data

  return inTransaction(execution, async (db) => {
    const task = await requireOpenTask(db, actor, taskId)
    const at = input.date ? new Date(input.date) : new Date()
    const entry = await db.taskTimeEntry.create({
      data: {
        organizationId: orgId,
        taskId,
        userId,
        source: "manual",
        startedAt: at,
        endedAt: at,
        minutes: input.minutes,
        note: input.note || null,
      },
    })
    return { entity: entry, task }
  })
}
