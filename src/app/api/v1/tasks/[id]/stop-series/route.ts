import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Stop a recurring task series — Roadmap #22 follow-up.
 *
 * Architect P0 fix: a previous version had the UI PATCH the parent with
 * `recurrenceRule: null`, but child instances kept their inherited rule
 * (the spawn helper copies it). Completing one of those children would
 * then respawn the series indefinitely — "Stop" didn't stop.
 *
 * This endpoint clears the rule on the parent AND every child in a
 * single transaction so the series is truly killed. Existing children
 * stay (their work isn't deleted), they just lose their ability to
 * generate further instances when they complete.
 *
 * Permission: same as task PATCH (tasks:write). The endpoint is scoped
 * to the calling org via the existing requireAuth flow + the WHERE
 * clauses below.
 */
export const POST = withRlsAuth("tasks", "write", async (_req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    // The "parent" can be either the task the user clicked OR a child
    // pointing at the actual original. Treat both cases uniformly: find
    // the effective root, then clear it + every descendant.
    const target = await prisma.task.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, title: true, recurrenceParentId: true, recurrenceRule: true },
    })
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!target.recurrenceRule && !target.recurrenceParentId) {
      return NextResponse.json({ error: "Task is not part of a recurring series" }, { status: 400 })
    }
    const rootId = target.recurrenceParentId ?? target.id

    // Atomic two-update wipe — both the root and all its children lose
    // the rule together. The PATCH spawn-trigger on completion checks
    // `task.recurrenceRule`, so once cleared, no more spawns happen
    // regardless of which instance completes next.
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rootResult = await tx.task.updateMany({
        where: { id: rootId, organizationId: orgId },
        data: { recurrenceRule: null },
      })
      const childrenResult = await tx.task.updateMany({
        where: { recurrenceParentId: rootId, organizationId: orgId },
        data: { recurrenceRule: null },
      })
      return { rootCleared: rootResult.count, childrenCleared: childrenResult.count }
    })

    // logAudit's 6th arg expects `{oldValue?, newValue?}`; wrap the
    // counters in `newValue` so they're discoverable in the audit log
    // (architect P2 — was being silently dropped as a stray top-level).
    logAudit(orgId, "stop_series", "task", rootId, target.title, { newValue: result })
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    console.error("[tasks stop-series]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
