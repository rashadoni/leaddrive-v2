import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { resolveRelated } from "@/lib/resolve-related"
import { validateRequiredCustomFields } from "@/lib/custom-fields-validation"
import { recalcProjectCompletion } from "@/lib/project-rollup"
import { parseRecurrenceRule } from "@/lib/recurrence/parse"
import { buildTaskListWhere, parseTaskListFilters } from "@/lib/tasks/list-query"
import { generateTaskKey } from "@/lib/tasks/task-key"
import { canCreateTask, canMoveToStatus, type KanbanStatus, type BoardPermissionFlags } from "@/lib/tasks/board-permission"
import { resolveEffectiveBoardPermission, isHierarchyConstraintViolation } from "@/lib/tasks/board-hierarchy"
import { isValidTaskType, isValidEventType } from "@/lib/tasks/task-types"
import type { Role } from "@/lib/permissions"

const createTaskSchema = z.object({
  // API allows 1..200 (CRM tasks share this route and use short titles); the
  // board "New Task" dialog enforces the spec's 3..200 client-side.
  title:        z.string().min(1).max(200),
  description:  z.string().max(5000).optional(),
  // 6 Kanban statuses + legacy (pending/completed/cancelled) for backward compat.
  status:       z.enum(["backlog", "todo", "in_progress", "testing", "review", "done", "pending", "completed", "cancelled"]).optional(),
  priority:     z.enum(["low", "medium", "high", "urgent", "critical"]).optional(),
  // type is validated dynamically against the org's active TaskType.name (see
  // isValidTaskType below) — no longer a frozen enum (Bordio configurable types).
  type:         z.string().max(60).optional(),
  // eventType: configurable channel/source axis (Bordio "Event types"), validated
  // dynamically against the org's event_types.name (see isValidEventType).
  eventType:    z.string().max(60).nullable().optional(),
  category:     z.enum(["Q1", "Q2", "Q3", "Q4", "yearly", "normal"]).nullable().optional(),
  dueDate:      z.string().optional(),
  assignedTo:   z.string().optional(),
  divisionId:   z.string().nullable().optional(),
  estimatedHours: z.number().min(0).max(1000).nullable().optional(),
  estimatedPrice: z.number().min(0).max(100_000_000).nullable().optional(),
  relatedType:  z.string().optional(),
  relatedId:    z.string().optional(),
  projectId:    z.string().nullable().optional(),
  // Recurrence (Roadmap #22). Same shape as PATCH; null/empty = none.
  recurrenceRule:  z.string().nullable().optional(),
  recurrenceEndAt: z.string().nullable().optional(),
  recurrenceCount: z.number().int().min(0).max(10_000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  // Co-assignees (replace-set). The primary stays assignedTo; ids must be
  // org members (validated in the handler); the primary is filtered out.
  collaboratorIds: z.array(z.string()).max(20).optional(),
})

export const GET = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const sp = new URL(req.url).searchParams
  const page = parseInt(sp.get("page") || "1")
  const limit = parseInt(sp.get("limit") || "50")
  // `offset` (spec) wins over page-based paging when present.
  const offsetParam = sp.get("offset")
  const offset = offsetParam !== null ? parseInt(offsetParam) : (page - 1) * limit
  if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1 || limit > 200 || isNaN(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid page or limit" }, { status: 400 })
  }

  try {
    // Filters + org/sharing/board access live in a shared builder so the list and
    // the export (GET /tasks/export) can never drift in what they expose.
    const { where, blocked } = await buildTaskListWhere(
      orgId, session?.userId || "", role as Role, parseTaskListFilters(sp),
    )
    if (blocked) return NextResponse.json({ success: true, data: { tasks: [], total: 0, page, limit } })

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ boardPosition: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
        include: {
          assignee: { select: { id: true, name: true, avatar: true } },
          creator: { select: { id: true, name: true } },
          project: { select: { id: true, name: true, color: true } },
          division: { select: { id: true, name: true, key: true, color: true } },
          checklist: { select: { completed: true } }, // for the board card progress bar (Q-tasks)
          collaborators: { select: { user: { select: { id: true, name: true, avatar: true } } } },
          _count: { select: { checklist: true, comments: true } },
        },
      }),
      prisma.task.count({ where }),
    ])

    // Resolve related entity names
    const tasksWithNames = await Promise.all(tasks.map(async (t: any) => {
      if (!t.relatedType || !t.relatedId) return t
      try {
        const result = await resolveRelated(orgId, t.relatedType, t.relatedId)
        return { ...t, relatedName: result?.name ?? "" }
      } catch { return t }
    }))

    const fieldPerms = await getFieldPermissions(orgId, role, "task")
    const filteredTasks = tasksWithNames.map((t: any) => filterEntityFields(t, fieldPerms, role))

    return NextResponse.json({ success: true, data: { tasks: filteredTasks, total, page, limit } })
  } catch (e) {
    console.error("[Tasks GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  const userId = session?.userId || ""
  const role = (session?.role || "admin") as Role

  const body = await req.json()
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Roadmap #9: server-side enforcement of CustomField.isRequired.
  const reqError = await validateRequiredCustomFields(orgId, "task", parsed.data.customFields ?? {})
  if (reqError) return NextResponse.json({ error: reqError }, { status: 400 })

  // Dynamic task-type check (Bordio configurable types) — replaces the old enum.
  if (!(await isValidTaskType(orgId, parsed.data.type))) {
    return NextResponse.json({ error: "Invalid task type" }, { status: 400 })
  }
  // Dynamic event-type (channel/source axis) check.
  if (!(await isValidEventType(orgId, parsed.data.eventType))) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 })
  }

  // Validate projectId belongs to this org before writing the FK.
  if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, organizationId: orgId },
      select: { id: true },
    })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 400 })
  }

  // Board task: validate the division belongs to this org (Codex P0 — never
  // trust a cross-tenant divisionId), check create permission, and grab the
  // key prefix for taskKey generation.
  let divisionKey: string | null = null
  if (parsed.data.divisionId) {
    const division = await prisma.division.findFirst({
      where: { id: parsed.data.divisionId, organizationId: orgId },
      select: {
        id: true, key: true, headUserId: true, isDepartment: true, parentDivisionId: true,
        parent: { select: { id: true, headUserId: true } },
      },
    })
    if (!division) return NextResponse.json({ error: "Division not found" }, { status: 400 })
    // Container-only: a department aggregates its sections' tasks but holds none
    // of its own. Tasks must be created on a section (or a standalone board).
    if (division.isDepartment) {
      return NextResponse.json(
        { error: "Cannot create tasks on a department — pick one of its sections" },
        { status: 400 },
      )
    }

    // Effective permission inherits the parent department's grant when the section
    // has no explicit row of its own; a section row (incl. canView=false) overrides.
    // Multi-tenant: both divisionId and parentDivisionId come from the org-scoped
    // `division` findFirst above (+ RLS wrapper), so these lookups can't read a
    // cross-tenant permission row even without an explicit organizationId filter.
    const [sectionRow, deptRow] = userId
      ? await Promise.all([
          prisma.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: division.id } } }),
          division.parentDivisionId
            ? prisma.boardPermission.findUnique({ where: { userId_divisionId: { userId, divisionId: division.parentDivisionId } } })
            : Promise.resolve(null),
        ])
      : [null, null]
    const perm = resolveEffectiveBoardPermission(
      sectionRow as BoardPermissionFlags | null,
      deptRow as BoardPermissionFlags | null,
    )
    // Head powers inherit too: a department head heads all its sections (the only
    // membership signal that isn't itself a BoardPermission row).
    const isDivisionHead =
      !!userId && (division.headUserId === userId || division.parent?.headUserId === userId)
    const access = { role, perm, isOwnDivision: isDivisionHead, isDivisionHead }
    if (!canCreateTask(access)) {
      return NextResponse.json(
        { error: "Forbidden", message: "No permission to create tasks on this board" },
        { status: 403 },
      )
    }
    // Creating directly in a downstream column == moving the task there on create,
    // so gate it by the same per-status rule (spec #3: `done` only via admin/
    // manager/head; in_progress/testing/review need the per-action move flag).
    // Entry columns (backlog/todo, legacy pending) need only canCreateTask.
    const createStatus = parsed.data.status || "pending"
    if (
      !["backlog", "todo", "pending"].includes(createStatus) &&
      !canMoveToStatus(access, createStatus as KanbanStatus, "backlog")
    ) {
      return NextResponse.json(
        { error: "Forbidden", message: `No permission to create a task in status "${createStatus}"` },
        { status: 403 },
      )
    }
    divisionKey = division.key
  }

  // Recurrence rule must parse (Roadmap #22). Empty/null = no recurrence.
  if (parsed.data.recurrenceRule && !parseRecurrenceRule(parsed.data.recurrenceRule)) {
    return NextResponse.json(
      { error: "Unknown recurrenceRule — expected daily/weekly/monthly/yearly or every:N:day|week|month" },
      { status: 400 },
    )
  }

  // Co-assignees: dedupe, drop the primary, and require every id to be a
  // member of THIS org (cross-tenant ids → 400, never silently dropped).
  const collaboratorIds = [...new Set(parsed.data.collaboratorIds ?? [])]
    .filter((id) => id && id !== parsed.data.assignedTo)
  if (collaboratorIds.length > 0) {
    const memberCount = await prisma.user.count({ where: { id: { in: collaboratorIds }, organizationId: orgId } })
    if (memberCount !== collaboratorIds.length) {
      return NextResponse.json({ error: "collaboratorIds must be members of this organization" }, { status: 400 })
    }
  }

  const baseData = {
    organizationId: orgId,
    title: parsed.data.title,
    description: parsed.data.description,
    status: parsed.data.status || "pending",
    priority: parsed.data.priority || "medium",
    type: parsed.data.type || "task",
    eventType: parsed.data.eventType || null, // "" → null (UI never sends "", defensive)
    category: parsed.data.category ?? null,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    assignedTo: parsed.data.assignedTo,
    divisionId: parsed.data.divisionId ?? null,
    estimatedHours: parsed.data.estimatedHours ?? null,
    estimatedPrice: parsed.data.estimatedPrice ?? null,
    relatedType: parsed.data.relatedType,
    relatedId: parsed.data.relatedId,
    projectId: parsed.data.projectId ?? null,
    createdBy: userId || null, // reporter
    customFields: parsed.data.customFields ?? {},
    recurrenceRule: parsed.data.recurrenceRule || null,
    recurrenceEndAt: parsed.data.recurrenceEndAt ? new Date(parsed.data.recurrenceEndAt) : null,
    recurrenceCount: parsed.data.recurrenceCount ?? null,
  }

  try {
    // taskKey is generated per division prefix. The (org, taskKey) unique is the
    // arbiter of the read-then-write race (Codex P1): on a P2002 collision we
    // regenerate the key and retry, capped at 3 attempts so a hot prefix can't spin.
    let task: any = null
    const MAX_KEY_RETRY = 3
    for (let attempt = 0; attempt < MAX_KEY_RETRY; attempt++) {
      const taskKey = divisionKey ? await generateTaskKey(prisma, orgId, divisionKey) : null
      try {
        task = await prisma.task.create({ data: { ...baseData, taskKey } })
        break
      } catch (e: any) {
        const taskKeyRace =
          e?.code === "P2002" &&
          (!Array.isArray(e?.meta?.target) || e.meta.target.includes("taskKey"))
        if (taskKey && taskKeyRace && attempt < MAX_KEY_RETRY - 1) continue
        throw e
      }
    }

    if (collaboratorIds.length > 0) {
      await prisma.taskCollaborator.createMany({
        data: collaboratorIds.map((uid) => ({ organizationId: orgId, taskId: task.id, userId: uid })),
        skipDuplicates: true,
      })
    }

    logAudit(orgId, "create", "task", task.id, task.title)
    // Board audit log (TaskActivity). Non-blocking.
    prisma.taskActivity
      .create({
        data: {
          organizationId: orgId,
          taskId: task.id,
          userId: userId || null,
          action: "created",
          newValue: task.status,
        },
      })
      .catch(() => {})
    // Recalc Project rollup whenever a new task lands on a project.
    if (task.projectId) {
      recalcProjectCompletion(task.projectId, orgId).catch((err) =>
        console.error("[tasks POST] rollup failed", err),
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
      // Handed work is the case the owner named: it has to arrive where the
      // person is, not only where the CRM is.
      email: Boolean(task.assignedTo) && task.assignedTo !== session?.userId,
    }).catch(() => {})
    return NextResponse.json({ success: true, data: task }, { status: 201 })
  } catch (e) {
    // Race backstop: the divisionId was a department by the time the row hit the
    // DB (the pre-check above handles the common case). Map the trigger to a 400.
    if (isHierarchyConstraintViolation(e)) {
      return NextResponse.json({ error: "Cannot create tasks on a department — pick one of its sections" }, { status: 400 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
