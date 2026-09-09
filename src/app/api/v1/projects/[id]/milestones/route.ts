import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { type AuthResult } from "@/lib/api-auth"
import { withRlsAuth } from "@/lib/with-rls"

const createMilestoneSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  color: z.string().optional(),
  sortOrder: z.number().optional(),
})

const updateMilestoneSchema = createMilestoneSchema.partial().extend({
  status: z.enum(["pending", "in_progress", "completed", "overdue"]).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export const GET = withRlsAuth(undefined, undefined, async (_req: NextRequest, auth: AuthResult, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params

  try {
    const milestones = await prisma.projectMilestone.findMany({
      where: { projectId, organizationId: orgId },
      orderBy: { sortOrder: "asc" },
      include: {
        tasks: {
          select: { id: true, status: true },
        },
      },
    })

    const data = milestones.map((m: typeof milestones[number]) => ({
      ...m,
      _count: { tasks: m.tasks.length },
      _taskBreakdown: {
        todo: m.tasks.filter((t: { status: string }) => t.status === "todo").length,
        in_progress: m.tasks.filter((t: { status: string }) => t.status === "in_progress").length,
        review: m.tasks.filter((t: { status: string }) => t.status === "review").length,
        done: m.tasks.filter((t: { status: string }) => t.status === "done").length,
        cancelled: m.tasks.filter((t: { status: string }) => t.status === "cancelled").length,
      },
    }))

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth(undefined, undefined, async (req: NextRequest, auth: AuthResult, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const body = await req.json()
  const parsed = createMilestoneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const milestone = await prisma.projectMilestone.create({
      data: {
        organizationId: orgId,
        projectId,
        ...parsed.data,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      },
    })
    return NextResponse.json({ success: true, data: milestone }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth(undefined, undefined, async (req: NextRequest, auth: AuthResult, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const body = await req.json()
  const { milestoneId, ...rest } = body

  if (!milestoneId) {
    return NextResponse.json({ error: "milestoneId required" }, { status: 400 })
  }

  const parsed = updateMilestoneSchema.safeParse(rest)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const data: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.dueDate !== undefined) {
      data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null
    }
    if (parsed.data.status === "completed") {
      data.completedAt = new Date()
    }

    const milestone = await prisma.projectMilestone.update({
      where: { id: milestoneId, projectId, organizationId: orgId },
      data,
    })
    return NextResponse.json({ success: true, data: milestone })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth(undefined, undefined, async (req: NextRequest, auth: AuthResult, props: RouteParams) => {
  const orgId = auth.orgId

  const { id: projectId } = await props.params
  const { searchParams } = new URL(req.url)
  const milestoneId = searchParams.get("milestoneId")

  if (!milestoneId) {
    return NextResponse.json({ error: "milestoneId required" }, { status: 400 })
  }

  try {
    await prisma.projectMilestone.delete({
      where: { id: milestoneId, projectId, organizationId: orgId },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
