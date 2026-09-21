import { NextRequest, NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import type { Role } from "@/lib/permissions"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"
import { getFieldPermissions, filterEntityFields, filterWritableFields } from "@/lib/field-filter"
import { updateTaskCommand } from "@/lib/crm-commands/task/update-task"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { resolveRelated } from "@/lib/resolve-related"
import { recalcProjectCompletion } from "@/lib/project-rollup"

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

  const existing = await prisma.task.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const role = authResult.role || "admin"
  const body = await req.json()
  // REST keeps its historical contract: fields the role may not write are
  // dropped, not refused. The command itself is the single implementation
  // shared with voice receipts (roadmap C1.13).
  const fieldPerms = await getFieldPermissions(orgId, role, "task")
  const filteredBody = filterWritableFields(body, fieldPerms, role)

  try {
    const result = await updateTaskCommand(createRestActorContext({
      organizationId: orgId,
      userId: authResult.userId,
      role: authResult.role,
      requestId: req.headers.get("x-request-id"),
    }), id, filteredBody)
    return NextResponse.json({ success: true, data: result.entity })
  } catch (error) {
    if (error instanceof CrmCommandError) {
      if (error.status === 403) {
        return NextResponse.json({ error: "Forbidden", message: error.message }, { status: 403 })
      }
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
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
