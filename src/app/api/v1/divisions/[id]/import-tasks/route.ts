import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { generateTaskKey } from "@/lib/tasks/task-key"
import type { Role } from "@/lib/permissions"
import { withRlsAuth } from "@/lib/with-rls"

function isBoardAdmin(role: Role) {
  return isAdminRole(role) || role === "manager"
}

// Safety cap for the one-shot transaction. An org with more orphan tasks than
// this would need a second click (response says how many remain).
const MAX_PER_RUN = 1000

/**
 * POST /api/v1/divisions/[id]/import-tasks — move every "loose" task (no board)
 * into THIS board, assigning each a sequential taskKey (PREFIX-N) if it lacks
 * one. Admin/manager only, org-scoped. Atomic ($transaction): a failure rolls
 * back wholesale, so a retry is safe (already-moved tasks are no longer orphans).
 *
 * NOTE: moved tasks become board-isolated — only this board's members (+ admins)
 * will see them afterward. That is the intended consolidation behaviour.
 */
export const POST = withRlsAuth("tasks", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!isBoardAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins/managers can import tasks into a board" }, { status: 403 })
  }
  const { id } = await params

  const division = await prisma.division.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, key: true, name: true },
  })
  if (!division) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    // Loose tasks = belong to this org, sit on no board, not soft-deleted.
    // Oldest first so the assigned keys read in creation order.
    const orphans = await prisma.task.findMany({
      where: { organizationId: auth.orgId, divisionId: null, deletedAt: null },
      select: { id: true, taskKey: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_RUN + 1,
    })
    const hasMore = orphans.length > MAX_PER_RUN
    const batch = hasMore ? orphans.slice(0, MAX_PER_RUN) : orphans
    if (batch.length === 0) {
      return NextResponse.json({ success: true, data: { moved: 0, hasMore: false } })
    }

    // Next sequential number for this board's prefix (computed once over the
    // MAX, including soft-deleted, exactly like the create path).
    const firstKey = await generateTaskKey(prisma, auth.orgId, division.key)
    let nextN = Number(firstKey.slice(division.key.length + 1)) // strip "PREFIX-"

    const ops = batch.map((task: { id: string; taskKey: string | null }) => {
      const data: { divisionId: string; taskKey?: string } = { divisionId: division.id }
      if (!task.taskKey) {
        data.taskKey = `${division.key}-${nextN}`
        nextN += 1
      }
      return prisma.task.update({ where: { id: task.id }, data })
    })
    await prisma.$transaction(ops)

    logAudit(auth.orgId, "import", "division", division.id, division.name, { newValue: { moved: batch.length } })
    return NextResponse.json({ success: true, data: { moved: batch.length, hasMore } })
  } catch (e) {
    console.error("[divisions import-tasks]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
