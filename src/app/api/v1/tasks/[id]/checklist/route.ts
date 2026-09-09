import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createItemSchema = z.object({
  title: z.string().min(1).max(500),
  sortOrder: z.number().int().optional(),
})

const updateItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(500).optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const reorderSchema = z.array(z.object({
  id: z.string(),
  sortOrder: z.number().int(),
}))

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: taskId } = await params

  const task = await prisma.task.findFirst({ where: { id: taskId, organizationId: orgId }, select: { id: true } })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const items = await prisma.taskChecklist.findMany({
    where: { taskId, organizationId: orgId },
    orderBy: { sortOrder: "asc" },
  })
  return NextResponse.json({ success: true, data: items })
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: taskId } = await params

  const task = await prisma.task.findFirst({ where: { id: taskId, organizationId: orgId }, select: { id: true } })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const body = await req.json()
  const parsed = createItemSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Auto-determine sort order if not provided
  const maxOrder = await prisma.taskChecklist.aggregate({
    where: { taskId },
    _max: { sortOrder: true },
  })

  const item = await prisma.taskChecklist.create({
    data: {
      organizationId: orgId,
      taskId,
      title: parsed.data.title,
      sortOrder: parsed.data.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1,
    },
  })
  return NextResponse.json({ success: true, data: item }, { status: 201 })
})

export const PATCH = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: taskId } = await params

  const body = await req.json()

  // Reorder mode: array of { id, sortOrder }
  if (Array.isArray(body)) {
    const parsed = reorderSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid reorder data" }, { status: 400 })

    await prisma.$transaction(
      parsed.data.map(item =>
        prisma.taskChecklist.updateMany({
          where: { id: item.id, taskId, organizationId: orgId },
          data: { sortOrder: item.sortOrder },
        })
      )
    )
    return NextResponse.json({ success: true })
  }

  // Single item update
  const parsed = updateItemSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const { id: itemId, ...updateData } = parsed.data
  await prisma.taskChecklist.updateMany({
    where: { id: itemId, taskId, organizationId: orgId },
    data: updateData,
  })
  return NextResponse.json({ success: true })
})

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id: taskId } = await params

  const { searchParams } = new URL(req.url)
  const itemId = searchParams.get("itemId")
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 })

  await prisma.taskChecklist.deleteMany({
    where: { id: itemId, taskId, organizationId: orgId },
  })
  return NextResponse.json({ success: true })
})
