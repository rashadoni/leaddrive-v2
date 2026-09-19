import type { Prisma, Task } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { getFieldPermissions } from "@/lib/field-filter"
import { resolveRelated } from "@/lib/resolve-related"
import { validateRequiredCustomFields } from "@/lib/custom-fields-validation"
import { recalcProjectCompletion } from "@/lib/project-rollup"
import { parseRecurrenceRule } from "@/lib/recurrence/parse"
import { generateTaskKey } from "@/lib/tasks/task-key"
import {
  canCreateTask,
  canMoveToStatus,
  type KanbanStatus,
  type BoardPermissionFlags,
} from "@/lib/tasks/board-permission"
import {
  resolveEffectiveBoardPermission,
  isHierarchyConstraintViolation,
} from "@/lib/tasks/board-hierarchy"
import { isValidTaskType, isValidEventType } from "@/lib/tasks/task-types"
import type { CrmCommandActorContext } from "../actor-context"
import { forbiddenError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { createTaskCommandSchema, type CreateTaskCommandInput } from "../schemas/task"

export interface CreateTaskCommandResult {
  entity: Task
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid task"
}

function isTaskKeyRace(error: unknown): boolean {
  const candidate = error as { code?: string; meta?: { target?: unknown } }
  if (candidate?.code !== "P2002") return false
  const target = candidate.meta?.target
  return !Array.isArray(target) || target.includes("taskKey")
}

export async function createTaskCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
): Promise<CreateTaskCommandResult> {
  const parsed = createTaskCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))

  const { organizationId: orgId, userId, role } = actor
  const fieldPermissions = await getFieldPermissions(orgId, role, "task")
  const input = requireWritableFields(
    parsed.data as Record<string, unknown>,
    fieldPermissions,
    role,
  ) as CreateTaskCommandInput

  const requiredFieldError = await validateRequiredCustomFields(
    orgId,
    "task",
    input.customFields ?? {},
  )
  if (requiredFieldError) throw validationError(requiredFieldError)

  if (!(await isValidTaskType(orgId, input.type))) {
    throw validationError("Invalid task type")
  }
  if (!(await isValidEventType(orgId, input.eventType))) {
    throw validationError("Invalid event type")
  }

  if (input.assignedTo) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assignedTo, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!assignee) throw validationError("Assignee must be an active member of this organization")
  }

  if (input.relatedType && input.relatedId) {
    const related = await resolveRelated(orgId, input.relatedType, input.relatedId)
    if (!related) throw validationError("Related record not found")
  }

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: orgId },
      select: { id: true },
    })
    if (!project) throw validationError("Project not found")
  }

  let divisionKey: string | null = null
  if (input.divisionId) {
    const division = await prisma.division.findFirst({
      where: { id: input.divisionId, organizationId: orgId },
      select: {
        id: true,
        key: true,
        headUserId: true,
        isDepartment: true,
        parentDivisionId: true,
        parent: { select: { id: true, headUserId: true } },
      },
    })
    if (!division) throw validationError("Division not found")
    if (division.isDepartment) {
      throw validationError("Cannot create tasks on a department — pick one of its sections")
    }

    const [sectionRow, departmentRow] = userId
      ? await Promise.all([
          prisma.boardPermission.findUnique({
            where: { userId_divisionId: { userId, divisionId: division.id } },
          }),
          division.parentDivisionId
            ? prisma.boardPermission.findUnique({
                where: { userId_divisionId: { userId, divisionId: division.parentDivisionId } },
              })
            : Promise.resolve(null),
        ])
      : [null, null]
    const permission = resolveEffectiveBoardPermission(
      sectionRow as BoardPermissionFlags | null,
      departmentRow as BoardPermissionFlags | null,
    )
    const isDivisionHead = Boolean(
      userId && (division.headUserId === userId || division.parent?.headUserId === userId),
    )
    const access = { role, perm: permission, isOwnDivision: isDivisionHead, isDivisionHead }
    if (!canCreateTask(access)) {
      throw forbiddenError("No permission to create tasks on this board")
    }

    const createStatus = input.status || "pending"
    if (
      !["backlog", "todo", "pending"].includes(createStatus)
      && !canMoveToStatus(access, createStatus as KanbanStatus, "backlog")
    ) {
      throw forbiddenError(`No permission to create a task in status "${createStatus}"`)
    }
    divisionKey = division.key
  }

  if (input.recurrenceRule && !parseRecurrenceRule(input.recurrenceRule)) {
    throw validationError(
      "Unknown recurrenceRule — expected daily/weekly/monthly/yearly or every:N:day|week|month",
    )
  }

  const collaboratorIds = [...new Set(input.collaboratorIds ?? [])]
    .filter((id) => id !== input.assignedTo)
  if (collaboratorIds.length > 0) {
    const memberCount = await prisma.user.count({
      where: { id: { in: collaboratorIds }, organizationId: orgId },
    })
    if (memberCount !== collaboratorIds.length) {
      throw validationError("collaboratorIds must be members of this organization")
    }
  }

  const baseData = {
    organizationId: orgId,
    title: input.title,
    description: input.description,
    status: input.status || "pending",
    priority: input.priority || "medium",
    type: input.type || "task",
    eventType: input.eventType || null,
    category: input.category ?? null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    assignedTo: input.assignedTo,
    divisionId: input.divisionId ?? null,
    estimatedHours: input.estimatedHours ?? null,
    estimatedPrice: input.estimatedPrice ?? null,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    projectId: input.projectId ?? null,
    createdBy: userId,
    customFields: input.customFields ?? {},
    recurrenceRule: input.recurrenceRule || null,
    recurrenceEndAt: input.recurrenceEndAt ? new Date(input.recurrenceEndAt) : null,
    recurrenceCount: input.recurrenceCount ?? null,
  }

  let task: Task | null = null
  const maxKeyRetries = 3
  try {
    for (let attempt = 0; attempt < maxKeyRetries; attempt += 1) {
      const taskKey = divisionKey ? await generateTaskKey(prisma, orgId, divisionKey) : null
      try {
        task = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const created = await tx.task.create({ data: { ...baseData, taskKey } })
          if (collaboratorIds.length > 0) {
            await tx.taskCollaborator.createMany({
              data: collaboratorIds.map((collaboratorId) => ({
                organizationId: orgId,
                taskId: created.id,
                userId: collaboratorId,
              })),
              skipDuplicates: true,
            })
          }
          await tx.taskActivity.create({
            data: {
              organizationId: orgId,
              taskId: created.id,
              userId,
              action: "created",
              newValue: created.status,
            },
          })
          return created
        })
        break
      } catch (error) {
        if (taskKey && isTaskKeyRace(error) && attempt < maxKeyRetries - 1) continue
        throw error
      }
    }
  } catch (error) {
    if (isHierarchyConstraintViolation(error)) {
      throw validationError("Cannot create tasks on a department — pick one of its sections")
    }
    throw error
  }
  if (!task) throw new Error("Task creation did not produce a record")

  logAudit(orgId, "create", "task", task.id, task.title)
  if (task.projectId) {
    recalcProjectCompletion(task.projectId, orgId).catch((error) =>
      console.error("[createTaskCommand] rollup failed", error),
    )
  }
  executeWorkflows(orgId, "task", "created", task).catch(() => {})
  const urgent = task.priority === "urgent" || task.priority === "critical"
  createNotification({
    organizationId: orgId,
    userId: task.assignedTo || "",
    type: urgent ? "warning" : "info",
    title: "New Task",
    message: `Task created: "${task.title}"${urgent ? ` (${String(task.priority).toUpperCase()})` : ""}`,
    entityType: "task",
    entityId: task.id,
    push: true,
    kind: "task.created",
    email: Boolean(task.assignedTo) && task.assignedTo !== userId,
  }).catch(() => {})

  return { entity: task }
}
