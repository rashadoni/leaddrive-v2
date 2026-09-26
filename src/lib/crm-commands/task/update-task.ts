import type { Prisma, Task } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireFieldPermissions } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { resolveRelated } from "@/lib/resolve-related"
import { validateRequiredCustomFields } from "@/lib/custom-fields-validation"
import { recalcProjectCompletion } from "@/lib/project-rollup"
import { spawnNextRecurringTask } from "@/lib/recurrence/spawn"
import { parseRecurrenceRule } from "@/lib/recurrence/parse"
import { canEditTasks, canMoveToStatus, type KanbanStatus, type BoardPermissionFlags } from "@/lib/tasks/board-permission"
import { resolveEffectiveBoardPermission } from "@/lib/tasks/board-hierarchy"
import { isValidTaskType, isValidEventType } from "@/lib/tasks/task-types"
import type { Role } from "@/lib/permissions"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { CrmCommandError, forbiddenError, notFoundError, staleWriteError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { updateTaskCommandSchema, type UpdateTaskCommandInput } from "../schemas/task"

/**
 * Update one task — the single implementation behind PATCH /api/v1/tasks/:id
 * and a confirmed voice receipt (roadmap C1.13).
 *
 * The body is the route's former handler, moved rather than rewritten: board
 * permissions, the TaskActivity rows the flow metrics read, completedAt,
 * project rollup and the next instance of a recurring task all happen for a
 * voice edit exactly as they do for a click.
 *
 * Two things differ by source, and only for voice:
 * - the field list is closed (see VOICE_UPDATE_FIELDS) and field permissions
 *   fail closed, because the receipt the user confirmed must be the whole
 *   mutation — the REST route keeps its historical "drop what you may not
 *   write" behaviour by filtering before it calls this;
 * - `expectedUpdatedAt` is mandatory, so a task that changed after the user
 *   read the receipt is refused instead of overwritten.
 */

const VOICE_UPDATE_FIELDS = new Set([
  "title",
  "description",
  "priority",
  "dueDate",
  "assignedTo",
  "status",
])

export interface UpdateTaskCommandResult {
  entity: Task
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid task update"
}

function enforceVoiceContract(input: UpdateTaskCommandInput): void {
  if (!input.expectedUpdatedAt) {
    throw validationError("expectedUpdatedAt is required for voice updates")
  }
  const forbiddenFields = Object.keys(input).filter((field) =>
    field !== "expectedUpdatedAt" && !VOICE_UPDATE_FIELDS.has(field),
  )
  if (forbiddenFields.length > 0) {
    throw new CrmCommandError(
      "FORBIDDEN_FIELD",
      `Fields are not available to voice updates: ${forbiddenFields.join(", ")}`,
      403,
      { fields: forbiddenFields },
    )
  }
}

export async function updateTaskCommand(
  actor: CrmCommandActorContext,
  taskId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<UpdateTaskCommandResult> {
  const parsedInput = updateTaskCommandSchema.safeParse(rawInput)
  if (!parsedInput.success) throw validationError(firstValidationMessage(parsedInput.error))
  const isVoice = actor.source === "voice"
  if (isVoice) enforceVoiceContract(parsedInput.data)

  const { organizationId: orgId, role } = actor
  const userId = actor.userId || ""
  const db = execution?.transaction ?? prisma
  const { expectedUpdatedAt, ...requested } = parsedInput.data
  const data0 = { ...requested }
  if (isVoice) {
    const fieldPermissions = await requireFieldPermissions(orgId, role, "task")
    requireWritableFields(data0 as Record<string, unknown>, fieldPermissions, role)
  }
  const parsed = { data: data0 }

  // Voice sees only what the user may see; REST keeps its historical org scope.
  const where = isVoice
    ? await applyRecordFilter(orgId, userId, role, "task", { id: taskId, organizationId: orgId })
    : { id: taskId, organizationId: orgId }
  const existing = await db.task.findFirst({ where })
  if (!existing) throw notFoundError("Not found")

  const expectedDate = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null
  if (expectedDate && existing.updatedAt.getTime() !== expectedDate.getTime()) {
    throw staleWriteError()
  }

  // Validate the related entity belongs to this org before writing — but ONLY
  // when the caller actually CHANGES the link. The full-form edit dialog
  // (task-form.tsx) re-sends the task's existing relatedId on every save, so
  // validating an UNCHANGED link would make ANY edit to a task whose linked
  // entity was later deleted fail with 400 "Related entity not found" — the
  // whole update blocked by a stale reference the user never touched (deleting a
  // lead/contact does NOT null out tasks pointing at it).
  //
  // We validate the link the task will END UP with (incoming value if the caller
  // sent that field, else the stored value), and only when that resulting pair
  // differs from what's stored. This (a) lets a re-sent orphaned link pass
  // untouched, and (b) still checks a partial patch that changes only relatedId —
  // validated against the existing relatedType, so a new id can't land under a
  // mismatched type.
  const { relatedType, relatedId } = parsed.data
  const nextRelatedType = relatedType !== undefined ? relatedType : existing.relatedType
  const nextRelatedId = relatedId !== undefined ? relatedId : existing.relatedId
  const relationChanged =
    nextRelatedType !== existing.relatedType || nextRelatedId !== existing.relatedId
  if (nextRelatedType && nextRelatedId && relationChanged) {
    // A lookup failure propagates: the route answers 500, as it always did.
    const result = await resolveRelated(orgId, nextRelatedType, nextRelatedId)
    if (result === null) throw validationError("Related entity not found")
  }

  // Validate projectId belongs to this org before writing the FK. A null in
  // the patch means "unset link" and is allowed without lookup.
  if (parsed.data.projectId) {
    const project = await db.project.findFirst({
      where: { id: parsed.data.projectId, organizationId: orgId },
      select: { id: true },
    })
    if (!project) throw validationError("Project not found")
  }

  // Dynamic task-type check (Bordio configurable types) — replaces the old enum.
  if (!(await isValidTaskType(orgId, parsed.data.type))) {
    throw validationError("Invalid task type")
  }
  // Dynamic event-type (channel/source axis) check.
  if (!(await isValidEventType(orgId, parsed.data.eventType))) {
    throw validationError("Invalid event type")
  }

  // Recurrence rule must parse — reject unknown formats up-front so the
  // update doesn't silently store a rule the spawn helper can't act on.
  // Empty string / null are both treated as "clear the rule".
  if (parsed.data.recurrenceRule && !parseRecurrenceRule(parsed.data.recurrenceRule)) {
    throw validationError(
      "Unknown recurrenceRule — expected daily/weekly/monthly/yearly or every:N:day|week|month",
    )
  }

  // boardColumnKey co-write must reference a real column on THIS task's board.
  // A non-null key on a non-board task is rejected; null clears the lane.
  // Moving into a column IS a move to its mapsToStatus: if the client sent a
  // status it must agree; if it sent none we DERIVE it — so the same
  // canMoveToStatus gate + side effects (completedAt, activity, recurrence)
  // always apply and a boardColumnKey-only write can never bypass the
  // move-permission check.
  if (parsed.data.boardColumnKey != null) {
    if (!existing.divisionId) throw validationError("boardColumnKey requires a board task")
    const col = await db.boardColumn.findFirst({
      where: { organizationId: orgId, divisionId: existing.divisionId, key: parsed.data.boardColumnKey },
      select: { mapsToStatus: true },
    })
    if (!col) throw validationError("Unknown board column for this board")
    if (parsed.data.status !== undefined && parsed.data.status !== col.mapsToStatus) {
      throw validationError("status does not match the target column")
    }
    if (parsed.data.status === undefined) parsed.data.status = col.mapsToStatus as KanbanStatus
  }

  // ── Board (division) transition + edit gating ──
  // The caller already enforced tasks:write at the role level. For a task that
  // lives on a board, layer the per-user BoardPermission rules on top.
  const newStatus = parsed.data.status
  const statusChanging = newStatus !== undefined && newStatus !== existing.status
  if (existing.divisionId) {
    const division = await db.division.findFirst({
      where: { id: existing.divisionId, organizationId: orgId },
      select: { headUserId: true, parentDivisionId: true, parent: { select: { headUserId: true } } },
    })
    // Effective permission inherits the parent department's grant when the section
    // has no explicit row; a section row (incl. canView=false) overrides. Head
    // powers — incl. the role-gated move-to-`done` — inherit from a department head.
    // Multi-tenant: divisionId + parentDivisionId come from the org-scoped division
    // findFirst above (+ RLS wrapper), so these lookups can't read a cross-tenant row.
    const [sectionRow, deptRow] = userId
      ? await Promise.all([
          db.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: existing.divisionId } } }),
          division?.parentDivisionId
            ? db.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: division.parentDivisionId } } })
            : Promise.resolve(null),
        ])
      : [null, null]
    const perm = resolveEffectiveBoardPermission(
      sectionRow as BoardPermissionFlags | null,
      deptRow as BoardPermissionFlags | null,
    )
    const isDivisionHead =
      !!userId && (division?.headUserId === userId || division?.parent?.headUserId === userId)
    const access = { role: role as Role, perm, isOwnDivision: isDivisionHead, isDivisionHead }

    // A lane-only reshuffle: boardColumnKey changes but the canonical status does
    // NOT (only possible once two columns map to one status — Phase 2). It's an
    // edit, not a move, so it must NOT slip through the move-only exemption below.
    const laneOnlyChange =
      parsed.data.boardColumnKey !== undefined &&
      parsed.data.boardColumnKey !== existing.boardColumnKey &&
      !statusChanging

    // Spec rule #6: without canEdit, ONLY the status field may change.
    if (!canEditTasks(access)) {
      // boardColumnKey is exempt from this gate ONLY when it rides a real status
      // change (a board MOVE, gated by canMoveToStatus below). A lane-only
      // reshuffle requires canEdit — it can't bypass the gate as a "status" move.
      // boardPosition rides along with every drag — the board sends it to place
      // the card between its neighbours. Leaving it out of this list made a
      // drop 403 for anyone without canEdit, including users whose
      // canMoveToStatus explicitly allowed the very move they attempted.
      const nonStatusKeys = Object.keys(parsed.data).filter(
        (k) => k !== "status"
          && k !== "boardPosition"
          && !(k === "boardColumnKey" && !laneOnlyChange),
      )
      if (nonStatusKeys.length > 0) {
        throw forbiddenError("Without edit permission only the task status can be changed")
      }
    }
    // Spec rules #1-#4: per-action status-transition gate (done → admin/manager/
    // head; forward → per-column flag; backward → canMoveBack).
    if (statusChanging && !canMoveToStatus(access, newStatus as KanbanStatus, existing.status)) {
      throw forbiddenError(`No permission to move this task to "${newStatus}"`)
    }
  }

  const data: Record<string, unknown> = { ...parsed.data }
  // Co-assignees are a relation, not a column — strip from the update data;
  // replace-set happens inside the transaction below. The FINAL primary
  // (incoming assignedTo if present, else existing) is filtered out, and all
  // ids must be members of THIS org (cross-tenant → 400).
  delete data.collaboratorIds
  const finalAssignee = parsed.data.assignedTo !== undefined ? parsed.data.assignedTo : existing.assignedTo
  const collabIds = parsed.data.collaboratorIds === undefined
    ? undefined
    : [...new Set(parsed.data.collaboratorIds)].filter((cid) => cid && cid !== finalAssignee)
  if (collabIds && collabIds.length > 0) {
    const memberCount = await db.user.count({ where: { id: { in: collabIds }, organizationId: orgId } })
    if (memberCount !== collabIds.length) {
      throw validationError("collaboratorIds must be members of this organization")
    }
  }
  // A voice assignee is a name the resolver turned into an id; check it is
  // still an active colleague when the receipt is executed.
  if (isVoice && parsed.data.assignedTo) {
    const assignee = await db.user.findFirst({
      where: { id: parsed.data.assignedTo, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!assignee) throw validationError("Assignee must be an active member of this organization")
  }
  if (data.dueDate !== undefined) {
    data.dueDate = data.dueDate ? new Date(data.dueDate as string) : null
  }
  if (data.recurrenceEndAt !== undefined) {
    data.recurrenceEndAt = data.recurrenceEndAt ? new Date(data.recurrenceEndAt as string) : null
  }
  if (data.recurrenceRule === "") data.recurrenceRule = null
  // completedAt: set on entering a done state, clear on leaving it — covers
  // both the Kanban "done" and the legacy "completed".
  if (newStatus !== undefined) {
    const isDone = (s: string) => s === "done" || s === "completed"
    if (isDone(newStatus) && !isDone(existing.status)) data.completedAt = new Date()
    else if (!isDone(newStatus) && isDone(existing.status)) data.completedAt = null
  }
  // customFields: MERGE with existing instead of replacing (JSONB partial-update pattern).
  // Keys with value === null in the incoming patch are DELETED from the merged result
  // (callers send null to mean "unset this custom field" — distinct from empty string).
  if (parsed.data.customFields !== undefined) {
    const existingCustomFields = (existing.customFields ?? {}) as Record<string, unknown>
    const merged: Record<string, unknown> = { ...existingCustomFields }
    for (const [k, v] of Object.entries(parsed.data.customFields)) {
      if (v === null) delete merged[k]
      else merged[k] = v
    }
    // Roadmap #9: server-side required-field check on the MERGED state.
    // Only fires when caller touched customFields — pre-existing tasks
    // with missing required fields aren't blocked from other updates.
    const reqError = await validateRequiredCustomFields(orgId, "task", merged)
    if (reqError) throw validationError(reqError)
    data.customFields = merged
  }

  // TaskActivity board audit — one row per material change. The status_changed
  // row is the flow-metric input (cycle time / CFD / aging), so it is written
  // INSIDE the same transaction as the update (§5.7): a failed write rolls the
  // update back rather than silently dropping the transition (was fire-and-forget).
  const acts: { action: string; oldValue: string | null; newValue: string | null }[] = []
  if (statusChanging) acts.push({ action: "status_changed", oldValue: existing.status, newValue: newStatus ?? null })
  if (parsed.data.assignedTo !== undefined && parsed.data.assignedTo !== existing.assignedTo)
    acts.push({ action: "assignee_changed", oldValue: existing.assignedTo, newValue: parsed.data.assignedTo ?? null })
  if (parsed.data.title !== undefined && parsed.data.title !== existing.title)
    acts.push({ action: "title_changed", oldValue: existing.title, newValue: parsed.data.title ?? null })

  const write = async (tx: Prisma.TransactionClient): Promise<Task> => {
    if (expectedDate) {
      // The lock and the write are one statement: a task edited between the
      // check above and here is refused, not overwritten.
      const locked = await tx.task.updateMany({
        where: { id: taskId, organizationId: orgId, updatedAt: expectedDate },
        data: data as Prisma.TaskUpdateManyMutationInput,
      })
      if (locked.count === 0) throw staleWriteError()
    }
    const updated = expectedDate
      ? await tx.task.findFirst({ where: { id: taskId, organizationId: orgId } })
      : await tx.task.update({ where: { id: taskId }, data: data as Prisma.TaskUncheckedUpdateInput })
    if (!updated) throw notFoundError("Not found")
    // Co-assignee replace-set: undefined = untouched, [] = clear all.
    if (collabIds !== undefined) {
      await tx.taskCollaborator.deleteMany({ where: { taskId } })
      if (collabIds.length > 0) {
        await tx.taskCollaborator.createMany({
          data: collabIds.map((uid) => ({ organizationId: orgId, taskId, userId: uid })),
          skipDuplicates: true,
        })
      }
    }
    if (acts.length) {
      await tx.taskActivity.createMany({
        data: acts.map((a) => ({ organizationId: orgId, taskId, userId: userId || null, ...a })),
      })
    }
    return updated
  }
  const task = execution?.transaction
    ? await write(execution.transaction)
    : await prisma.$transaction(write)

  const dispatchEffects = () => {
    logAudit(orgId, "update", "task", taskId, task.title, {
      newValue: parsed.data,
      userId: userId || undefined,
    })
    const triggerEvent = parsed.data.status ? "status_changed" : "updated"
    executeWorkflows(orgId, "task", triggerEvent, task).catch(() => {})
    // Handed to somebody else. The task list will show it eventually; the
    // person now responsible should not have to discover it there.
    if (
      parsed.data.assignedTo !== undefined
      && parsed.data.assignedTo
      && parsed.data.assignedTo !== existing.assignedTo
      && parsed.data.assignedTo !== actor.userId
    ) {
      createNotification({
        organizationId: orgId,
        userId: parsed.data.assignedTo,
        type: "info",
        title: "Вам назначена задача",
        message: task.title,
        entityType: "task",
        entityId: taskId,
        push: true,
        kind: "task.assigned",
        email: true,
      }).catch(() => {})
    }
    if (statusChanging && (newStatus === "done" || newStatus === "completed")) {
      createNotification({
        organizationId: orgId,
        type: "success",
        title: "Task Completed",
        message: `Task completed: "${task.title}"`,
        entityType: "task",
        entityId: taskId,
      }).catch(() => {})
    }
    // Project rollup. Triggered when:
    //   • status changed (done/undone shifts the percentage), OR
    //   • projectId changed (task moved to/from a project shifts totals on
    //     BOTH the old and new projects).
    //
    // When status changes we recalc BOTH the existing and new projectId
    // (when they differ). Otherwise a combined patch like
    // `{status: "completed", projectId: "B"}` on a task that was on
    // project A would leave A's percentage stale (one completed task no
    // longer attached). Architect P1 fix.
    //
    // Fire-and-forget — UI doesn't block on rollup. The advisory lock
    // inside `recalcProjectCompletion` serializes concurrent recalcs for
    // the same project.
    const projectsToRecalc = new Set<string>()
    const statusChanged = parsed.data.status !== undefined
    const projectChanged = parsed.data.projectId !== undefined
    if (statusChanged || projectChanged) {
      if (existing.projectId) projectsToRecalc.add(existing.projectId)
      if (task.projectId) projectsToRecalc.add(task.projectId)
    }
    for (const pid of projectsToRecalc) {
      recalcProjectCompletion(pid, orgId).catch((err) =>
        console.error("[tasks PATCH] rollup failed for project", pid, err),
      )
    }
    // Recurrence — Roadmap #22. When a recurring task enters status=completed,
    // spawn the next instance. Fire-and-forget; the response carries the
    // just-completed task, and the new instance shows up on the next list refetch.
    //
    // Architect P1 fix: idempotency guard on `existing.status !== "completed"`.
    // An update that resends `status: "completed"` on an already-completed task
    // (e.g. UI bulk-edit that sends the whole form state) should NOT spawn a
    // duplicate. The DB-level unique constraint on
    // (recurrenceParentId, dueDate) is the second line of defense for the
    // concurrent-completion race.
    if (
      (newStatus === "done" || newStatus === "completed")
      && existing.status !== "done"
      && existing.status !== "completed"
      && task.recurrenceRule
    ) {
      spawnNextRecurringTask({ task }).catch((err) => {
        console.error("[tasks PATCH] recurring spawn failed", taskId, err)
        // Architect P1 — surface failure to admins so the chain doesn't
        // silently break. Without this, an ops issue could go undetected
        // until someone notices the recurring task stopped reappearing.
        createNotification({
          organizationId: orgId,
          type: "error",
          title: "Recurring task spawn failed",
          message: `Could not spawn next instance of "${task.title}". Series may have broken.`,
          entityType: "task",
          entityId: taskId,
        }).catch(() => {})
      })
    }
  }
  if (execution?.transaction) {
    dispatchOrDeferCommandEffects(execution, dispatchEffects)
  } else {
    dispatchEffects()
  }

  return { entity: task }
}
