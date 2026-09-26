import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { resolveRelated } from "@/lib/resolve-related"
import { buildTaskListWhere, parseTaskListFilters } from "@/lib/tasks/list-query"
import type { Role } from "@/lib/permissions"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { createTaskCommand } from "@/lib/crm-commands/task/create-task"

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
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const actor = createRestActorContext({
      organizationId: orgId,
      userId: session?.userId,
      role: session?.role as Role | undefined,
      requestId: req.headers.get("x-request-id"),
    })
    const result = await createTaskCommand(actor, body)
    return NextResponse.json({ success: true, data: result.entity }, { status: 201 })
  } catch (error) {
    if (error instanceof CrmCommandError) {
      if (error.status === 403) {
        return NextResponse.json(
          { error: "Forbidden", message: error.message, code: error.code },
          { status: error.status },
        )
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[Tasks POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
