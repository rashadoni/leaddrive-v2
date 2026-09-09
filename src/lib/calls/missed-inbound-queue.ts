import { Prisma } from "@prisma/client"

import { accessibleCallWhere } from "@/lib/calls/access"
import {
  MISSED_INBOUND_SOURCE_FIELD,
  MISSED_INBOUND_TASK_FIELD,
  missedInboundCallEvidenceWhere,
  missedInboundTaskId,
} from "@/lib/calls/missed-inbound-reconciliation"
import { CLOSED_STATUSES } from "@/lib/tasks/status"

export const MISSED_INBOUND_QUEUE_LIMIT = 50
const MISSED_INBOUND_CANDIDATE_PAGE_SIZE = 100
const MISSED_INBOUND_MAX_SCAN_ROWS = 500

const CLOSED_TASK_STATUSES = [...CLOSED_STATUSES]

export type MissedInboundQueueAuth = {
  orgId: string
  userId: string
  role: Parameters<typeof accessibleCallWhere>[0]
}

export type MissedInboundQueueItem = {
  taskId: string
  status: string
  missedAt: string
  leadId: string
}

type MissedInboundQueueClient = Pick<Prisma.TransactionClient, "task" | "callLog"> & {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>
}

type QueueTaskRow = {
  id: string
  status: string
  customFields: Prisma.JsonValue | null
}

type ClaimQueueTaskRow = QueueTaskRow & {
  assignedTo: string | null
}

type QueueCallRow = {
  id: string
  leadId: string | null
  endedAt: Date | null
}

type ValidQueueTask = QueueTaskRow & { callId: string }

export class MissedInboundQueueError extends Error {
  constructor(
    public readonly code: "not_found" | "already_claimed",
  ) {
    super(code)
    this.name = "MissedInboundQueueError"
  }
}

class MissedInboundQueueScanLimitError extends Error {
  constructor() {
    super("missed_inbound_queue_scan_limit")
    this.name = "MissedInboundQueueScanLimitError"
  }
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, Prisma.JsonValue>
}

function validQueueTask(task: QueueTaskRow): ValidQueueTask | null {
  const fields = jsonObject(task.customFields)
  const callId = fields?.[MISSED_INBOUND_TASK_FIELD]
  if (typeof callId !== "string" || callId.length === 0) return null
  if (fields?.[MISSED_INBOUND_SOURCE_FIELD] !== "asterisk") return null
  if (task.id !== missedInboundTaskId(callId)) return null
  return { ...task, callId }
}

export async function listMissedInboundQueue(
  client: MissedInboundQueueClient,
  auth: MissedInboundQueueAuth,
): Promise<MissedInboundQueueItem[]> {
  const findTaskPage = (
    cursor: string | undefined,
    take: number,
  ): Promise<QueueTaskRow[]> => client.task.findMany({
    where: {
      organizationId: auth.orgId,
      assignedTo: null,
      deletedAt: null,
      divisionId: null,
      status: { notIn: CLOSED_TASK_STATUSES },
      AND: [
        {
          customFields: {
            path: [MISSED_INBOUND_SOURCE_FIELD],
            equals: "asterisk",
          },
        },
        {
          customFields: {
            path: [MISSED_INBOUND_TASK_FIELD],
            not: Prisma.DbNull,
          },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      customFields: true,
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take,
  }) as Promise<QueueTaskRow[]>

  const items: MissedInboundQueueItem[] = []
  let cursor: string | undefined
  let scannedRows = 0

  while (
    items.length < MISSED_INBOUND_QUEUE_LIMIT
    && scannedRows < MISSED_INBOUND_MAX_SCAN_ROWS
  ) {
    const take = Math.min(
      MISSED_INBOUND_CANDIDATE_PAGE_SIZE,
      MISSED_INBOUND_MAX_SCAN_ROWS - scannedRows,
    )
    const taskRows = await findTaskPage(cursor, take)
    if (taskRows.length === 0) return items

    scannedRows += taskRows.length
    const lastTask = taskRows.at(-1)
    if (!lastTask) return items
    cursor = lastTask.id

    const tasks = taskRows.flatMap((task) => {
      const valid = validQueueTask(task)
      return valid ? [valid] : []
    })
    if (tasks.length > 0) {
      const calls = await client.callLog.findMany({
        where: {
          organizationId: auth.orgId,
          id: { in: tasks.map((task) => task.callId) },
          leadId: { not: null },
          AND: [
            missedInboundCallEvidenceWhere(),
            accessibleCallWhere(auth.role, auth.userId),
          ],
        },
        select: { id: true, leadId: true, endedAt: true },
      }) as QueueCallRow[]

      const callsById = new Map(calls.map((call) => [call.id, call]))
      for (const task of tasks) {
        const call = callsById.get(task.callId)
        if (!call?.leadId || !call.endedAt) continue
        items.push({
          taskId: task.id,
          status: task.status,
          missedAt: call.endedAt.toISOString(),
          leadId: call.leadId,
        })
        if (items.length === MISSED_INBOUND_QUEUE_LIMIT) return items
      }
    }

    if (taskRows.length < take) return items
  }

  if (cursor && (await findTaskPage(cursor, 1)).length > 0) {
    throw new MissedInboundQueueScanLimitError()
  }
  return items
}

export async function claimMissedInboundQueueTask(
  client: MissedInboundQueueClient,
  auth: MissedInboundQueueAuth,
  taskId: string,
): Promise<{ taskId: string; leadId: string }> {
  return client.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        organizationId: auth.orgId,
        deletedAt: null,
        divisionId: null,
        status: { notIn: CLOSED_TASK_STATUSES },
      },
      select: { id: true, status: true, assignedTo: true, customFields: true },
    }) as ClaimQueueTaskRow | null

    const validTask = task ? validQueueTask(task) : null
    if (!task || !validTask) throw new MissedInboundQueueError("not_found")
    if (task.assignedTo !== null) {
      throw new MissedInboundQueueError("already_claimed")
    }

    const call = await tx.callLog.findFirst({
      where: {
        id: validTask.callId,
        organizationId: auth.orgId,
        leadId: { not: null },
        AND: [
          missedInboundCallEvidenceWhere(),
          accessibleCallWhere(auth.role, auth.userId),
        ],
      },
      select: { id: true, leadId: true },
    })
    if (!call?.leadId) throw new MissedInboundQueueError("not_found")

    const claimed = await tx.task.updateMany({
      where: {
        id: taskId,
        organizationId: auth.orgId,
        assignedTo: null,
        deletedAt: null,
        divisionId: null,
        status: { notIn: CLOSED_TASK_STATUSES },
        AND: [
          {
            customFields: {
              path: [MISSED_INBOUND_TASK_FIELD],
              equals: validTask.callId,
            },
          },
          {
            customFields: {
              path: [MISSED_INBOUND_SOURCE_FIELD],
              equals: "asterisk",
            },
          },
        ],
      },
      data: { assignedTo: auth.userId },
    })
    if (claimed.count !== 1) {
      throw new MissedInboundQueueError("already_claimed")
    }

    await tx.taskActivity.create({
      data: {
        organizationId: auth.orgId,
        taskId,
        userId: auth.userId,
        action: "assignee_changed",
        oldValue: null,
        newValue: auth.userId,
        metadata: { source: "missed_inbound_queue" },
      },
    })

    return { taskId, leadId: call.leadId }
  })
}
