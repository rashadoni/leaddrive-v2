import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createStepSchema = z.object({
  title: z.string().trim().min(1).max(300).refine(
    (value) => !/[<>{}\u0000-\u001F\u007F]/.test(value),
    "Use a plain next-step title without markup or template characters",
  ),
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
})

const taskMutationSchema = z.object({
  taskId: z.string().min(1),
})

const updateStepSchema = taskMutationSchema.extend({
  status: z.enum(["pending", "completed"]).default("completed"),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId, relatedType: "deal", relatedId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
    return NextResponse.json({ success: true, data: tasks })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = createStepSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        title: parsed.data.title,
        relatedType: "deal",
        relatedId: id,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        assignedTo: parsed.data.assignedTo || null,
        status: "pending",
      },
    })
    return NextResponse.json({ success: true, data: task })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = updateStepSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const result = await prisma.task.updateMany({
      where: {
        id: parsed.data.taskId,
        organizationId: orgId,
        relatedType: "deal",
        relatedId: id,
      },
      data: {
        status: parsed.data.status,
        completedAt: parsed.data.status === "completed" ? new Date() : null,
      },
    })
    if (result.count === 0) return NextResponse.json({ error: "Next step not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = taskMutationSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const result = await prisma.task.deleteMany({
      where: {
        id: parsed.data.taskId,
        organizationId: orgId,
        relatedType: "deal",
        relatedId: id,
      },
    })
    if (result.count === 0) return NextResponse.json({ error: "Next step not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
