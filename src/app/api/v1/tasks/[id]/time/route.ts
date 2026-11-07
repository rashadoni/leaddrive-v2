import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { openTaskFor } from "@/lib/tasks/task-access"
import { timerMinutes } from "@/lib/tasks/task-feed"

/**
 * Time on a task — Bordio's «Start timer» and «Log time» (owner, 2026-11-07).
 *
 *   GET                         entries, total minutes, and the caller's running timer
 *   POST {action:"start"}       start a timer here; a timer running on another task stops first
 *   POST {action:"stop"}        stop the caller's timer on this task
 *   POST {action:"log", minutes, date?, note?}   write time by hand
 *   DELETE ?entryId=            remove one's own entry (an admin: anyone's)
 *
 * One running timer per person across the organization — a partial unique
 * index in the migration, not only this code.
 */
type Ctx = { params: Promise<{ id: string }> }

const postSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("stop") }),
  z.strictObject({
    action: z.literal("log"),
    minutes: z.number().int().min(1).max(24 * 60),
    date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date").optional(),
    note: z.string().trim().max(500).optional(),
  }),
])

const entrySelect = {
  id: true, source: true, startedAt: true, endedAt: true, minutes: true, note: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.TaskTimeEntrySelect

async function summary(organizationId: string, taskId: string, userId: string | null | undefined) {
  const entries = await prisma.taskTimeEntry.findMany({ where: { organizationId, taskId }, orderBy: { startedAt: "desc" }, select: entrySelect })
  const totalMinutes = entries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0)
  const running = entries.find((entry) => entry.endedAt === null && entry.user?.id === userId) ?? null
  return { entries, totalMinutes, running }
}

export const GET = withRlsAuth("tasks", "read", async (_req, auth, { params }: Ctx) => {
  const { id } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: await summary(auth.orgId, id, auth.userId) })
})

export const POST = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id } = await params
  if (!auth.userId) return NextResponse.json({ error: "Time is written by a person" }, { status: 400 })
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const userId = auth.userId
  const now = new Date()

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const running = await tx.taskTimeEntry.findFirst({ where: { organizationId: auth.orgId, userId, endedAt: null } })
    const close = async () => {
      if (!running) return
      await tx.taskTimeEntry.update({ where: { id: running.id }, data: { endedAt: now, minutes: timerMinutes(running.startedAt, now) } })
    }
    if (parsed.data.action === "start") {
      if (running?.taskId === id) return
      await close()
      await tx.taskTimeEntry.create({ data: { organizationId: auth.orgId, taskId: id, userId, source: "timer", startedAt: now } })
    } else if (parsed.data.action === "stop") {
      if (running?.taskId === id) await close()
    } else {
      const at = parsed.data.date ? new Date(parsed.data.date) : now
      await tx.taskTimeEntry.create({
        data: {
          organizationId: auth.orgId, taskId: id, userId, source: "manual",
          startedAt: at, endedAt: at, minutes: parsed.data.minutes, note: parsed.data.note || null,
        },
      })
    }
  })
  return NextResponse.json({ success: true, data: await summary(auth.orgId, id, auth.userId) })
})

export const DELETE = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const entryId = new URL(req.url).searchParams.get("entryId")
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 })
  const admin = auth.role === "admin" || auth.role === "superadmin"
  const removed = await prisma.taskTimeEntry.deleteMany({
    where: { id: entryId, organizationId: auth.orgId, taskId: id, ...(admin ? {} : { userId: auth.userId ?? "-" }) },
  })
  if (removed.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: await summary(auth.orgId, id, auth.userId) })
})
