import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { activeMembers, openTaskFor } from "@/lib/tasks/task-access"
import { follow, notifyTaskMessage } from "@/lib/tasks/task-notify"

const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  // People @-mentioned in the message (ids, chosen in the composer).
  mentions: z.array(z.string().min(1).max(64)).max(20).optional(),
})

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/v1/tasks/[id]/comments — the task's messages, oldest first. */
export const GET = withRlsAuth("tasks", "read", async (_req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const comments = await prisma.taskComment.findMany({
    where: { taskId, organizationId: auth.orgId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  })
  return NextResponse.json({ success: true, data: comments })
})

/**
 * POST /api/v1/tasks/[id]/comments — write a message on the task (Bordio's
 * chat). The author and everyone @-mentioned start following the task; the
 * mentioned and the followers are told (src/lib/tasks/task-notify.ts).
 */
export const POST = withRlsAuth("tasks", "read", async (req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId })
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 })

  const parsed = createCommentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const mentions = await activeMembers(prisma, auth.orgId, parsed.data.mentions ?? [])

  const comment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.taskComment.create({
      data: { organizationId: auth.orgId, taskId, userId: auth.userId || null, content: parsed.data.content, mentions },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    })
    await follow(tx, auth.orgId, taskId, [auth.userId, ...mentions])
    return created
  })

  await notifyTaskMessage(prisma, {
    organizationId: auth.orgId,
    taskId,
    taskLabel: task.taskKey ? `${task.taskKey} ${task.title}` : task.title,
    authorId: auth.userId || null,
    authorName: comment.user?.name ?? auth.name ?? "",
    mentions,
    text: parsed.data.content,
  }).catch((error) => console.error("[task comments] notify failed", error))

  return NextResponse.json({ success: true, data: comment }, { status: 201 })
})
