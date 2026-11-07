import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { openTaskFor } from "@/lib/tasks/task-access"
import { buildTaskFeed, feedPersonIds } from "@/lib/tasks/task-feed"

/** GET /api/v1/tasks/[id]/feed — messages and events in one time line, plus who follows. See src/lib/tasks/task-feed.ts. */
export const GET = withRlsAuth("tasks", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const task = await openTaskFor(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, taskId: id })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const [comments, activities, followers] = await Promise.all([
    prisma.taskComment.findMany({
      where: { organizationId: auth.orgId, taskId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, content: true, isSystem: true, mentions: true, user: { select: { id: true, name: true, avatar: true } } },
    }),
    prisma.taskActivity.findMany({
      where: { organizationId: auth.orgId, taskId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, action: true, oldValue: true, newValue: true, metadata: true, user: { select: { id: true, name: true } } },
    }),
    prisma.taskFollower.findMany({
      where: { organizationId: auth.orgId, taskId: id },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { id: true, name: true, avatar: true } } },
    }),
  ])
  const personIds = feedPersonIds(activities)
  const people = personIds.length === 0 ? [] : await prisma.user.findMany({
    where: { organizationId: auth.orgId, id: { in: personIds } },
    select: { id: true, name: true },
  })
  const items = buildTaskFeed(comments, activities, new Map(people.map((p) => [p.id, p.name])))
  return NextResponse.json({
    success: true,
    data: {
      items,
      followers: followers.map((f) => f.user),
      following: followers.some((f) => f.user.id === auth.userId),
    },
  })
})
