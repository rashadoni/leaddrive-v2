import { canRead } from "@/lib/permissions"
import { logAudit, prisma } from "@/lib/prisma"
import {
  DEFAULT_LIMIT,
  HARD_LIMIT,
  READ_COLUMNS,
  type ReadResultData,
  type ReadResultRow,
} from "@/lib/ai/read-tools"
import type { ToolResult } from "@/lib/ai/tool-executor"
import {
  buildVoiceTaskWhere,
  isVoiceTaskScopeUnavailable,
  type VoiceTaskScopeContext,
} from "./task-scope"

function clampLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), HARD_LIMIT)
    : DEFAULT_LIMIT
}

/** Voice-only task list: canonical task/board scope without changing chat search. */
export async function executeVoiceTaskList(
  input: Record<string, unknown>,
  orgId: string,
  context: VoiceTaskScopeContext,
): Promise<ToolResult> {
  if (!canRead(context.role, "tasks")) {
    return { success: false, error: "This CRM list is not permitted for your role." }
  }

  const assignedTo = typeof input.assignedTo === "string"
    ? input.assignedTo === "me" ? context.userId : input.assignedTo
    : ""
  const status = typeof input.status === "string" ? input.status : ""

  try {
    const where = await buildVoiceTaskWhere(orgId, context, {
      assignedTo,
      statusParts: status ? [status] : [],
    })
    const take = clampLimit(input.limit)
    const [records, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take,
        select: { id: true, title: true, status: true, priority: true, dueDate: true },
      }),
      prisma.task.count({ where }),
    ])
    const rows: ReadResultRow[] = records.map((task: {
      id: string
      title: string
      status: string
      priority: string
      dueDate: Date | null
    }) => ({
      id: task.id,
      href: `/tasks/${task.id}`,
      cells: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate?.toISOString() ?? null,
      },
    }))
    const data: ReadResultData = {
      entityType: "task",
      columns: READ_COLUMNS.task,
      rows,
      total,
      returned: rows.length,
      truncated: total > rows.length,
      listHref: "/tasks",
    }
    void logAudit(orgId, "ai_read", "list_tasks", "", `AI read: task (${rows.length} rows)`)
    return { success: true, data }
  } catch (error) {
    if (isVoiceTaskScopeUnavailable(error)) {
      return { success: false, error: "ACCESS_SCOPE_UNAVAILABLE" }
    }
    return { success: false, error: "Read failed" }
  }
}
