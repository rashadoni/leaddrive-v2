import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { activeMembers, openTaskFor } from "@/lib/tasks/task-access"
import { follow } from "@/lib/tasks/task-notify"

type Ctx = { params: Promise<{ id: string }> }
const bodySchema = z.strictObject({ userId: z.string().min(1).max(64).optional() })

/**
 * POST /api/v1/tasks/[id]/followers — follow the task (yourself by default;
 * someone else needs the right to edit tasks). DELETE ?userId= — stop.
 * Anyone who may open the task may follow it.
 */
export const POST = withRlsAuth("tasks", "read", async (req, auth, { params }: Ctx) => {
  const { id } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const target = parsed.data.userId ?? auth.userId
  if (!target) return NextResponse.json({ error: "Nobody to follow with" }, { status: 400 })
  if (target !== auth.userId && auth.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if ((await activeMembers(prisma, auth.orgId, [target])).length === 0) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 400 })
  }
  await follow(prisma, auth.orgId, id, [target])
  return NextResponse.json({ success: true })
})

export const DELETE = withRlsAuth("tasks", "read", async (req, auth, { params }: Ctx) => {
  const { id } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const target = new URL(req.url).searchParams.get("userId") || auth.userId
  if (!target) return NextResponse.json({ error: "Nobody to unfollow" }, { status: 400 })
  if (target !== auth.userId && auth.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  await prisma.taskFollower.deleteMany({ where: { organizationId: auth.orgId, taskId: id, userId: target } })
  return NextResponse.json({ success: true })
})
