export type OperationalTaskAttention = "OVERDUE" | "RETURNED" | "ACTIVE"

export type OperationalTaskQueueStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "OVERDUE"

export type OperationalTaskQueuePriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW"

export interface OperationalTaskQueueSource {
  id: string
  status: OperationalTaskQueueStatus
  priority: OperationalTaskQueuePriority
  dueDate: Date | null
  scheduledStartAt: Date | null
  returnReason: string | null
  createdAt: Date
}

export type OperationalTaskQueueItem<T extends OperationalTaskQueueSource> = T & {
  attention: OperationalTaskAttention
}

const ATTENTION_RANK: Record<OperationalTaskAttention, number> = {
  OVERDUE: 0,
  RETURNED: 1,
  ACTIVE: 2,
}

const PRIORITY_RANK: Record<OperationalTaskQueuePriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

function attentionForTask(
  task: OperationalTaskQueueSource,
  generatedAt: Date,
): OperationalTaskAttention {
  if (
    task.status === "OVERDUE"
    || (task.dueDate !== null && task.dueDate.getTime() < generatedAt.getTime())
  ) {
    return "OVERDUE"
  }
  if (task.returnReason?.trim()) return "RETURNED"
  return "ACTIVE"
}

function nextActionAt(task: OperationalTaskQueueSource): Date {
  return task.dueDate ?? task.scheduledStartAt ?? task.createdAt
}

/**
 * Builds the current operational queue from already tenant/employee-scoped
 * task rows. Classification is evaluated against the response timestamp so
 * every consumer sees the same strict overdue boundary.
 */
export function buildOperationalTaskQueue<T extends OperationalTaskQueueSource>(
  tasks: readonly T[],
  generatedAt: Date,
): Array<OperationalTaskQueueItem<T>> {
  return tasks
    .filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED")
    .map((task) => ({
      ...task,
      attention: attentionForTask(task, generatedAt),
    }))
    .sort((left, right) => {
      return ATTENTION_RANK[left.attention] - ATTENTION_RANK[right.attention]
        || nextActionAt(left).getTime() - nextActionAt(right).getTime()
        || PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    })
}
