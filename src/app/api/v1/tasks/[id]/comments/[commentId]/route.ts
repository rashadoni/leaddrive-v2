import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { openTaskFor } from "@/lib/tasks/task-access"

/**
 * One message of a task: its author changes or removes it (Ulviyya, 2026-11-12:
 * «komentdə yazılan mətn redaktə olmur… həmdə silmək olmur»; the owner: «Да,
 * делай» to the mockup). Only the author — or the organization's admin — may;
 * everyone else's messages stay as written. A system line (the task's own
 * history) is nobody's to change. The file names a message carries («📎 …»)
 * are part of its text, so an edit keeps them unless the author removes them.
 */
type Ctx = { params: Promise<{ id: string; commentId: string }> }
const editSchema = z.object({ content: z.string().trim().min(1).max(10_000) })

async function ownComment(auth: { orgId: string; userId: string | null; role: string }, taskId: string, commentId: string) {
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId })
  if (!task) return { error: NextResponse.json({ error: "Task not found" }, { status: 404 }) }
  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, taskId, organizationId: auth.orgId },
    select: { id: true, userId: true, isSystem: true },
  })
  if (!comment) return { error: NextResponse.json({ error: "Message not found" }, { status: 404 }) }
  const admin = auth.role === "admin" || auth.role === "superadmin"
  if (comment.isSystem || !(admin || (!!auth.userId && comment.userId === auth.userId))) {
    return { error: NextResponse.json({ error: "Forbidden", message: "Only its author may change a message" }, { status: 403 }) }
  }
  return { comment }
}

export const PATCH = withRlsAuth("tasks", "read", async (req, auth, { params }: Ctx) => {
  const { id: taskId, commentId } = await params
  const parsed = editSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const found = await ownComment(auth, taskId, commentId)
  if (found.error) return found.error
  const updated = await prisma.taskComment.update({
    where: { id: commentId },
    data: { content: parsed.data.content, editedAt: new Date() },
    select: { id: true, content: true, editedAt: true },
  })
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRlsAuth("tasks", "read", async (_req, auth, { params }: Ctx) => {
  const { id: taskId, commentId } = await params
  const found = await ownComment(auth, taskId, commentId)
  if (found.error) return found.error
  await prisma.taskComment.deleteMany({ where: { id: commentId, taskId, organizationId: auth.orgId } })
  return NextResponse.json({ success: true })
})
