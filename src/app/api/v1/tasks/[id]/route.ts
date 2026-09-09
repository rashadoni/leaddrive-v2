import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { Prisma } from "@prisma/client"
import { canEditTasks, canMoveToStatus, type KanbanStatus, type BoardPermissionFlags } from "@/lib/tasks/board-permission"
import { resolveEffectiveBoardPermission } from "@/lib/tasks/board-hierarchy"
import type { Role } from "@/lib/permissions"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"
import { isValidTaskType, isValidEventType } from "@/lib/tasks/task-types"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { resolveRelated } from "@/lib/resolve-related"
import { validateRequiredCustomFields } from "@/lib/custom-fields-validation"
import { recalcProjectCompletion } from "@/lib/project-rollup"
import { spawnNextRecurringTask } from "@/lib/recurrence/spawn"
import { parseRecurrenceRule } from "@/lib/recurrence/parse"

const updateTaskSchema = z.object({
  title:        z.string().min(1).max(300).optional(),
  description:  z.string().max(5000).optional(),
  status:       z.enum(["backlog", "todo", "in_progress", "testing", "review", "done", "pending", "completed", "cancelled"]).optional(),
  priority:     z.enum(["low", "medium", "high", "urgent", "critical"]).optional(),
  // type validated dynamically against the org's active TaskType.name (see
  // isValidTaskType) — no longer a frozen enum (Bordio configurable types).
  type:         z.string().max(60).optional(),
  // eventType: configurable channel/source axis; validated via isValidEventType.
  eventType:    z.string().max(60).nullable().optional(),
  category:     z.enum(["Q1", "Q2", "Q3", "Q4", "yearly", "normal"]).nullable().optional(),
  estimatedHours: z.number().min(0).max(1000).nullable().optional(),
  estimatedPrice: z.number().min(0).max(100_000_000).nullable().optional(),
  dueDate:      z.string().nullable().optional(),
  assignedTo:   z.string().nullable().optional(),
  relatedType:  z.enum(["company", "contact", "deal", "lead", "ticket"]).nullable().optional(),
  relatedId:    z.string().nullable().optional(),
  projectId:    z.string().nullable().optional(),
  // Recurrence — Roadmap #22. Validated via the parser to keep the wire
  // contract symmetric with the lib. Rule is null to clear; string is
  // checked at run time against parseRecurrenceRule below.
  recurrenceRule:  z.string().nullable().optional(),
  recurrenceEndAt: z.string().nullable().optional(),
  recurrenceCount: z.number().int().min(0).max(10_000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  // Board move co-write: which BoardColumn lane the task now sits in. Validated
  // against the task's own board below; null clears it. status stays canonical
  // and a move sends status = the target column's mapsToStatus alongside this.
  boardColumnKey: z.string().max(64).nullable().optional(),
  boardPosition: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  // Co-assignees (replace-set; [] clears). Primary stays assignedTo; ids must
  // be org members (validated in the handler); the primary is filtered out.
  collaboratorIds: z.array(z.string()).max(20).optional(),
})

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const role = session?.role || "admin"
  const { id } = await params

  const task = await prisma.task.findFirst({
    where: { id, organizationId: orgId },
    include: {
      assignee: { select: { id: true, name: true, avatar: true } },
      creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, color: true } },
      collaborators: { select: { user: { select: { id: true, name: true, avatar: true } } } },
      checklist: { orderBy: { sortOrder: "asc" } },
      attachments: { orderBy: { createdAt: "desc" } },
      comments: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      },
      // Recurrence series — Roadmap #22 follow-up. If THIS task is a
      // child instance (has recurrenceParentId), include the parent so
      // the UI can show "this is instance N of an open series" with a
      // link back. If this task IS the parent (or could be), include its
      // children so the series panel can list every instance in order.
      recurrenceParent: {
        select: {
          id: true, title: true, status: true, dueDate: true,
          recurrenceRule: true, recurrenceEndAt: true, recurrenceCount: true,
        },
      },
      recurrenceChildren: {
        select: { id: true, title: true, status: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      },
    },
  })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Board isolation: a board task (has divisionId) is only readable by an admin,
  // a board member (canView), the assignee, or the reporter. taskKeys are
  // sequential (KHS-NN), so without this a non-member could enumerate another
  // department's tasks by ID. 404 (not 403) to avoid revealing existence.
  if (task.divisionId) {
    const accessible = await getAccessibleDivisionIds(prisma, orgId, session?.userId || "", role as Role)
    const onBoard = accessible === "all" || accessible.includes(task.divisionId)
    const isMine = task.assignedTo === session?.userId || task.createdBy === session?.userId
    if (!onBoard && !isMine) return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Resolve related entity name
  let relatedName = ""
  if (task.relatedType && task.relatedId) {
    try {
      const result = await resolveRelated(orgId, task.relatedType, task.relatedId)
      relatedName = result?.name ?? ""
    } catch (e) {
      console.error("[tasks GET] relatedName lookup failed", e)
    }
  }

  const fieldPerms = await getFieldPermissions(orgId, role, "task")
  const filteredTask = filterEntityFields({ ...task, relatedName }, fieldPerms, role)
  return NextResponse.json({ success: true, data: filteredTask })
})

export const PATCH = withRlsAuth("tasks", "write", async (req: NextRequest, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  const existing = await prisma.task.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const role = authResult.role || "admin"
  const body = await req.json()
  const fieldPerms = await getFieldPermissions(orgId, role, "task")
  const filteredBody = filterWritableFields(body, fieldPerms, role)
  const parsed = updateTaskSchema.safeParse(filteredBody)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

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
    let result: { name: string } | null = null
    try {
      result = await resolveRelated(orgId, nextRelatedType, nextRelatedId)
    } catch (e) {
      console.error("[tasks PATCH] relatedId lookup failed", e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    if (result === null) return NextResponse.json({ error: "Related entity not found" }, { status: 400 })
  }

  // Validate projectId belongs to this org before writing the FK. A null in
  // the patch means "unset link" and is allowed without lookup.
  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, organizationId: orgId },
      select: { id: true },
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 400 })
  }

  // Dynamic task-type check (Bordio configurable types) — replaces the old enum.
  if (!(await isValidTaskType(orgId, parsed.data.type))) {
    return NextResponse.json({ error: "Invalid task type" }, { status: 400 })
  }
  // Dynamic event-type (channel/source axis) check.
  if (!(await isValidEventType(orgId, parsed.data.eventType))) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 })
  }

  // Recurrence rule must parse — reject unknown formats up-front so the
  // PATCH doesn't silently store a rule the spawn helper can't act on.
  // Empty string / null are both treated as "clear the rule".
  if (parsed.data.recurrenceRule && !parseRecurrenceRule(parsed.data.recurrenceRule)) {
    return NextResponse.json(
      { error: "Unknown recurrenceRule — expected daily/weekly/monthly/yearly or every:N:day|week|month" },
      { status: 400 },
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
    if (!existing.divisionId) {
      return NextResponse.json({ error: "boardColumnKey requires a board task" }, { status: 400 })
    }
    const col = await prisma.boardColumn.findFirst({
      where: { organizationId: orgId, divisionId: existing.divisionId, key: parsed.data.boardColumnKey },
      select: { mapsToStatus: true },
    })
    if (!col) return NextResponse.json({ error: "Unknown board column for this board" }, { status: 400 })
    if (parsed.data.status !== undefined && parsed.data.status !== col.mapsToStatus) {
      return NextResponse.json({ error: "status does not match the target column" }, { status: 400 })
    }
    if (parsed.data.status === undefined) parsed.data.status = col.mapsToStatus as KanbanStatus
  }

  // ── Board (division) transition + edit gating ──
  // requireAuth already enforced tasks:write at the role level. For a task that
  // lives on a board, layer the per-user BoardPermission rules on top.
  const userId = authResult.userId || ""
  const newStatus = parsed.data.status
  const statusChanging = newStatus !== undefined && newStatus !== existing.status
  if (existing.divisionId) {
    const division = await prisma.division.findFirst({
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
          prisma.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: existing.divisionId } } }),
          division?.parentDivisionId
            ? prisma.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: division.parentDivisionId } } })
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
        return NextResponse.json(
          { error: "Forbidden", message: "Without edit permission only the task status can be changed" },
          { status: 403 },
        )
      }
    }
    // Spec rules #1-#4: per-action status-transition gate (done → admin/manager/
    // head; forward → per-column flag; backward → canMoveBack).
    if (statusChanging && !canMoveToStatus(access, newStatus as KanbanStatus, existing.status)) {
      return NextResponse.json(
        { error: "Forbidden", message: `No permission to move this task to "${newStatus}"` },
        { status: 403 },
      )
    }
  }

  try {
    const data: any = { ...parsed.data }
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
      const memberCount = await prisma.user.count({ where: { id: { in: collabIds }, organizationId: orgId } })
      if (memberCount !== collabIds.length) {
        return NextResponse.json({ error: "collaboratorIds must be members of this organization" }, { status: 400 })
      }
    }
    if (data.dueDate !== undefined) {
      data.dueDate = data.dueDate ? new Date(data.dueDate) : null
    }
    if (data.recurrenceEndAt !== undefined) {
      data.recurrenceEndAt = data.recurrenceEndAt ? new Date(data.recurrenceEndAt) : null
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
      if (reqError) return NextResponse.json({ error: reqError }, { status: 400 })
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

    const task = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.task.update({ where: { id }, data })
      // Co-assignee replace-set: undefined = untouched, [] = clear all.
      if (collabIds !== undefined) {
        await tx.taskCollaborator.deleteMany({ where: { taskId: id } })
        if (collabIds.length > 0) {
          await tx.taskCollaborator.createMany({
            data: collabIds.map((uid) => ({ organizationId: orgId, taskId: id, userId: uid })),
            skipDuplicates: true,
          })
        }
      }
      if (acts.length) {
        await tx.taskActivity.createMany({
          data: acts.map((a) => ({ organizationId: orgId, taskId: id, userId: userId || null, ...a })),
        })
      }
      return updated
    })
    logAudit(orgId, "update", "task", id, task.title, { newValue: parsed.data })
    const triggerEvent = parsed.data.status ? "status_changed" : "updated"
    executeWorkflows(orgId, "task", triggerEvent, task).catch(() => {})
    // Handed to somebody else. The task list will show it eventually; the
    // person now responsible should not have to discover it there.
    if (
      parsed.data.assignedTo !== undefined
      && parsed.data.assignedTo
      && parsed.data.assignedTo !== existing.assignedTo
      && parsed.data.assignedTo !== authResult.userId
    ) {
      createNotification({
        organizationId: orgId,
        userId: parsed.data.assignedTo,
        type: "info",
        title: "Вам назначена задача",
        message: task.title,
        entityType: "task",
        entityId: id,
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
        entityId: id,
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
    // spawn the next instance. Fire-and-forget; the PATCH response carries the
    // just-completed task, and the new instance shows up on the next list refetch.
    //
    // Architect P1 fix: idempotency guard on `existing.status !== "completed"`.
    // A PATCH that resends `status: "completed"` on an already-completed task
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
        console.error("[tasks PATCH] recurring spawn failed", id, err)
        // Architect P1 — surface failure to admins so the chain doesn't
        // silently break. Without this, an ops issue could go undetected
        // until someone notices the recurring task stopped reappearing.
        createNotification({
          organizationId: orgId,
          type: "error",
          title: "Recurring task spawn failed",
          message: `Could not spawn next instance of "${task.title}". Series may have broken.`,
          entityType: "task",
          entityId: id,
        }).catch(() => {})
      })
    }
    return NextResponse.json({ success: true, data: task })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("tasks", "delete", async (_req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    const existing = await prisma.task.findFirst({
      where: { id, organizationId: orgId },
      select: { title: true, projectId: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // Soft delete (spec): set deletedAt — the prisma client extension then hides
    // it from every subsequent task read. taskKey stays reserved (the
    // (org,taskKey) unique + the generator's soft-delete-inclusive MAX prevent
    // number reuse). The findFirst above is extension-filtered, so an already-
    // deleted task 404s here rather than being re-deleted.
    await prisma.task.updateMany({ where: { id, organizationId: orgId }, data: { deletedAt: new Date() } })
    logAudit(orgId, "delete", "task", id, existing?.title || "")
    // Soft-deleted tasks are hidden from reads, so a Social Monitoring "view task"
    // link would 404 — drop the back-reference (no FK → not auto-nulled).
    await clearDeletedMentionRefs(orgId, "taskId", [id])
    prisma.taskActivity
      .create({ data: { organizationId: orgId, taskId: id, userId: authResult.userId || null, action: "deleted" } })
      .catch(() => {})
    // Recalc rollup if the deleted task was contributing to a project's
    // total — fire-and-forget, the client doesn't depend on this.
    if (existing.projectId) {
      recalcProjectCompletion(existing.projectId, orgId).catch((err) =>
        console.error("[tasks DELETE] rollup failed", err),
      )
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
