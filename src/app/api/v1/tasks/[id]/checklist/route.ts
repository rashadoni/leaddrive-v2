import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { activeMembers, openTaskFor } from "@/lib/tasks/task-access"
import { refusedTaskIds, NOT_YOUR_TASK } from "@/lib/tasks/task-ownership"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import {
  addTaskChecklistItemCommand,
  setTaskChecklistItemDoneCommand,
} from "@/lib/crm-commands/task/task-work"
import { crmCommandErrorResponse } from "@/lib/crm-commands/rest-response"

/**
 * A task's subtasks (the checklist). Since 2026-11-07 a subtask has its own
 * assignee and deadline, like Bordio's subtasks, and ticking one off records
 * when — and writes «closed the subtask» into the task's time line.
 * Reading needs the task to be open to the caller; changing needs tasks:write.
 */
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")

const updateItemSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(500).optional(),
  completed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  assignedTo: z.string().min(1).max(64).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
})

const reorderSchema = z.array(z.object({
  id: z.string(),
  sortOrder: z.number().int(),
}))

type Ctx = { params: Promise<{ id: string }> }

/**
 * A board task's subtasks are the task's own (task-ownership.ts): its people
 * add, change and remove them. A subtask's own assignee may also tick it.
 */
async function refusal(auth: { orgId: string; userId: string | null; role: string }, taskId: string, tickOf?: string): Promise<NextResponse | null> {
  if ((await refusedTaskIds(prisma, auth.orgId, auth.role, auth.userId, [taskId], "manage")).length === 0) return null
  if (tickOf && auth.userId) {
    const item = await prisma.taskChecklist.findFirst({ where: { id: tickOf, taskId, organizationId: auth.orgId }, select: { assignedTo: true } })
    if (item?.assignedTo === auth.userId) return null
  }
  return NextResponse.json({ error: "Forbidden", message: NOT_YOUR_TASK }, { status: 403 })
}
const itemInclude = { assignee: { select: { id: true, name: true, avatar: true } } } satisfies Prisma.TaskChecklistInclude

async function checkAssignee(orgId: string, assignedTo: string | null | undefined): Promise<string | null> {
  if (!assignedTo) return null
  return (await activeMembers(prisma, orgId, [assignedTo]))[0] === assignedTo ? null : "assignedTo must be an active member of this organization"
}

export const GET = withRlsAuth("tasks", "read", async (_req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const items = await prisma.taskChecklist.findMany({
    where: { taskId, organizationId: auth.orgId },
    orderBy: { sortOrder: "asc" },
    include: itemInclude,
  })
  return NextResponse.json({ success: true, data: items })
})

/** A new subtask — the same command the voice assistant uses. */
export const POST = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const refused = await refusal(auth, taskId)
  if (refused) return refused
  const actor = createRestActorContext({ organizationId: auth.orgId, userId: auth.userId, role: auth.role })
  try {
    const { entity } = await addTaskChecklistItemCommand(actor, taskId, await req.json().catch(() => null))
    return NextResponse.json({ success: true, data: entity }, { status: 201 })
  } catch (error) {
    return crmCommandErrorResponse(error)
  }
})

export const PATCH = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const body = await req.json().catch(() => null)

  // Reorder mode: array of { id, sortOrder }
  if (Array.isArray(body)) {
    const refused = await refusal(auth, taskId)
    if (refused) return refused
    const parsed = reorderSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid reorder data" }, { status: 400 })
    await prisma.$transaction(
      parsed.data.map((item) =>
        prisma.taskChecklist.updateMany({
          where: { id: item.id, taskId, organizationId: auth.orgId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    )
    return NextResponse.json({ success: true })
  }

  const parsed = updateItemSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const plainTick = Object.keys(parsed.data).every((key) => key === "id" || key === "completed") && parsed.data.completed !== undefined
  const refused = await refusal(auth, taskId, plainTick ? parsed.data.id : undefined)
  if (refused) return refused
  const assigneeError = await checkAssignee(auth.orgId, parsed.data.assignedTo)
  if (assigneeError) return NextResponse.json({ error: assigneeError }, { status: 400 })

  // A plain tick — the one gesture voice also makes — runs the shared command,
  // so the «closed the subtask» line in the time line has one author.
  if (plainTick) {
    const actor = createRestActorContext({ organizationId: auth.orgId, userId: auth.userId, role: auth.role })
    try {
      const { entity } = await setTaskChecklistItemDoneCommand(actor, taskId, {
        checklistItemId: parsed.data.id,
        completed: parsed.data.completed,
      })
      return NextResponse.json({ success: true, data: entity })
    } catch (error) {
      return crmCommandErrorResponse(error)
    }
  }

  const { id: itemId, dueDate, completed, ...rest } = parsed.data
  const found = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.taskChecklist.findFirst({ where: { id: itemId, taskId, organizationId: auth.orgId } })
    if (!existing) return false
    const now = new Date()
    const toggled = completed !== undefined && completed !== existing.completed
    await tx.taskChecklist.update({
      where: { id: itemId },
      data: {
        ...rest,
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(completed !== undefined ? { completed, completedAt: completed ? existing.completedAt ?? now : null } : {}),
      },
    })
    if (toggled) {
      await tx.taskActivity.create({
        data: {
          organizationId: auth.orgId, taskId, userId: auth.userId || null,
          action: completed ? "subtask_completed" : "subtask_reopened", newValue: existing.title,
        },
      })
    }
    return true
  })
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const item = await prisma.taskChecklist.findFirst({ where: { id: itemId, organizationId: auth.orgId }, include: itemInclude })
  return NextResponse.json({ success: true, data: item })
})

export const DELETE = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const itemId = new URL(req.url).searchParams.get("itemId")
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 })
  const refused = await refusal(auth, taskId)
  if (refused) return refused
  await prisma.taskChecklist.deleteMany({ where: { id: itemId, taskId, organizationId: auth.orgId } })
  return NextResponse.json({ success: true })
})
