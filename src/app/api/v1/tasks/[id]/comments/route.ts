import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { openTaskFor } from "@/lib/tasks/task-access"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { addTaskCommentCommand } from "@/lib/crm-commands/task/task-work"
import { crmCommandErrorResponse } from "@/lib/crm-commands/rest-response"

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
 * The same command writes a message dictated to the voice assistant.
 */
export const POST = withRlsAuth("tasks", "read", async (req, auth, { params }: Ctx) => {
  const { id: taskId } = await params
  const actor = createRestActorContext({ organizationId: auth.orgId, userId: auth.userId, role: auth.role })
  try {
    const { entity } = await addTaskCommentCommand(actor, taskId, await req.json().catch(() => null))
    return NextResponse.json({ success: true, data: entity }, { status: 201 })
  } catch (error) {
    return crmCommandErrorResponse(error)
  }
})
