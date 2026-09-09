import { NextResponse } from "next/server"
import { z } from "zod"
import { nonNegativeHoursSchema } from "@/lib/validation/numeric"
import { prisma } from "@/lib/prisma"
import { recalcProjectCompletion } from "@/lib/project-rollup"
import { withRlsAuth } from "@/lib/with-rls"

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "review", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  milestoneId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  estimatedHours: nonNegativeHoursSchema.optional(),
  tags: z.array(z.string()).optional(),
})

const updateTaskSchema = createTaskSchema.partial().extend({
  actualHours: nonNegativeHoursSchema.optional(),
  sortOrder: z.number().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export const GET = withRlsAuth(undefined, undefined, async (req, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const milestoneId = searchParams.get("milestoneId")
  const assignedTo = searchParams.get("assignedTo")

  try {
    const tasks = await prisma.projectTask.findMany({
      where: {
        projectId,
        organizationId: orgId,
        ...(status ? { status } : {}),
        ...(milestoneId ? { milestoneId } : {}),
        ...(assignedTo ? { assignedTo } : {}),
      },
      orderBy: { sortOrder: "asc" },
      include: {
        milestone: { select: { id: true, name: true, color: true } },
        children: { select: { id: true, title: true, status: true } },
      },
    })
    return NextResponse.json({ success: true, data: tasks })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth(undefined, undefined, async (req, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const body = await req.json()
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const task = await prisma.projectTask.create({
      data: {
        organizationId: orgId,
        projectId,
        ...parsed.data,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      },
    })
    return NextResponse.json({ success: true, data: task }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth(undefined, undefined, async (req, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const body = await req.json()
  const { taskId, ...rest } = body

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 })
  }

  const parsed = updateTaskSchema.safeParse(rest)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const data: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.dueDate !== undefined) {
      data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null
    }
    if (parsed.data.status === "done") {
      data.completedAt = new Date()
    }

    const task = await prisma.projectTask.update({
      where: { id: taskId, projectId, organizationId: orgId },
      data,
    })

    // Auto-update project completion percentage. Delegates to the shared
    // rollup helper which combines BOTH `ProjectTask` (status: "done") and
    // linked `Task` (status: "completed") so the percentage stays
    // consistent regardless of which surface the work lives on.
    await recalcProjectCompletion(projectId, orgId)

    return NextResponse.json({ success: true, data: task })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth(undefined, undefined, async (req, auth, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const { searchParams } = new URL(req.url)
  const taskId = searchParams.get("taskId")

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 })
  }

  try {
    await prisma.projectTask.delete({
      where: { id: taskId, projectId, organizationId: orgId },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
