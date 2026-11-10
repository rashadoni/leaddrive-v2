import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { openTaskFor } from "@/lib/tasks/task-access"

type Ctx = { params: Promise<{ id: string }> }
const bodySchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  // Where the card goes inside the day (ascending). Absent: at the end of the day.
  rank: z.number().finite().optional(),
})

/**
 * PUT /api/v1/tasks/[id]/plan — the day YOU plan to work on the task, or null
 * to put it back in your waiting list («Mənim işlərim → Təqvim», 2026-11-10).
 * Each person plans their own, as in Bordio: nobody else's calendar moves,
 * nothing else on the task changes, nobody is told. Anyone who may open the
 * task may plan it for themselves.
 */
export const PUT = withRlsAuth("tasks", "read", async (req, auth, { params }: Ctx) => {
  const { id } = await params
  if (!auth.userId) return NextResponse.json({ error: "Nobody to plan for" }, { status: 400 })
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "day: yyyy-mm-dd or null" }, { status: 400 })
  const { day, rank } = parsed.data
  if (day === null) {
    await prisma.taskPlan.deleteMany({ where: { organizationId: auth.orgId, taskId: id, userId: auth.userId } })
    return NextResponse.json({ success: true, data: { day: null } })
  }
  const at = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) {
    return NextResponse.json({ error: "No such day" }, { status: 400 })
  }
  // Dropped on the day itself: under its last card, as in Bordio.
  let place = rank
  if (place === undefined) {
    const last = await prisma.taskPlan.aggregate({
      where: { organizationId: auth.orgId, userId: auth.userId, day: at, NOT: { taskId: id } },
      _max: { rank: true },
    })
    place = last._max.rank === null ? Date.now() : last._max.rank + 1_000_000
  }
  await prisma.taskPlan.upsert({
    where: { taskId_userId: { taskId: id, userId: auth.userId } },
    create: { organizationId: auth.orgId, taskId: id, userId: auth.userId, day: at, rank: place },
    update: { day: at, rank: place },
  })
  return NextResponse.json({ success: true, data: { day, rank: place } })
})
