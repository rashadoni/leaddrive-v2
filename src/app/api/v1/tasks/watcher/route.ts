import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isTeamAdmin } from "@/lib/tasks/board-teams"
import { TASK_WATCHER_KEY, followOpenBoardTasks, resolveTaskWatcher } from "@/lib/tasks/task-watcher"

/**
 * GET /api/v1/tasks/watcher — who follows every task on the boards. PUT — set
 * or clear it, by the admin («Komandalar və istifadəçilər»); the person named
 * starts following every open board task at once. Rules: src/lib/tasks/task-watcher.ts.
 */
const bodySchema = z.object({ userId: z.string().min(1).max(64).nullable() })

export const GET = withRlsAuth("tasks", "read", async (_req, auth) => {
  const watcher = await resolveTaskWatcher(prisma, auth.orgId)
  return NextResponse.json({ success: true, data: { watcher: watcher ? { id: watcher.id, name: watcher.name } : null, canManage: isTeamAdmin(auth.role) } })
})

export const PUT = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isTeamAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only an admin names who follows every task" }, { status: 403 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { userId } = parsed.data

  let watcher: { id: string; name: string } | null = null
  if (userId) {
    watcher = await prisma.user.findFirst({ where: { id: userId, organizationId: auth.orgId, isActive: true }, select: { id: true, name: true } })
    if (!watcher) return NextResponse.json({ error: "userId must be an active member of this organization" }, { status: 400 })
  }

  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const settings = { ...((org?.settings ?? {}) as Record<string, unknown>) }
  if (watcher) settings[TASK_WATCHER_KEY] = watcher.id
  else delete settings[TASK_WATCHER_KEY]
  await prisma.organization.update({ where: { id: auth.orgId }, data: { settings: settings as object } })
  // From now on she hears about the tasks already running too, not only the new ones.
  const followed = watcher ? await followOpenBoardTasks(prisma, auth.orgId, watcher.id) : 0
  logAudit(auth.orgId, "update", "task_watcher", auth.orgId, watcher?.name ?? "—", { userId: auth.userId, newValue: { followed } })

  return NextResponse.json({ success: true, data: { watcher, followed, canManage: true } })
})
