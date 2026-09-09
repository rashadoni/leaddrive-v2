import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { Prisma } from "@prisma/client"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Task progress reporting (SWM-14). Progress is an execution signal owned by
 * the assignee, so — unlike the manager metadata edit — this endpoint is
 * scoped to the caller's OWN task (agentId === auth.agentId) rather than
 * TEAM_DECIDE. A manager viewing the task sees the value read-only.
 */
const ProgressSchema = z.object({
  progress: z.number().int().min(0).max(100),
  expectedVersion: z.number().int().min(1).optional(),
})

export const PATCH = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  const { id } = await params
  const parsed = ProgressSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid progress" }, { status: 400 })
  }
  const { progress, expectedVersion } = parsed.data

  // Own-task scope: the assignee reports their own progress. A non-owned or
  // missing task is indistinguishable (404) so the endpoint leaks nothing.
  const task = await prisma.mtmTask.findFirst({
    where: { id, organizationId: auth.orgId, agentId: auth.agentId, deletedAt: null },
    select: { id: true, progress: true, status: true, version: true },
  })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    return NextResponse.json({ error: "Completed or cancelled task core is immutable", code: "MTM_TASK_IMMUTABLE" }, { status: 409 })
  }
  if (expectedVersion === undefined && task.progress === progress) {
    return NextResponse.json({
      success: true,
      data: { id, progress, version: task.version, idempotent: true },
    })
  }
  if (expectedVersion !== undefined && expectedVersion !== task.version) {
    return NextResponse.json({ error: "Task changed concurrently", code: "MTM_TASK_VERSION_CONFLICT", task }, { status: 409 })
  }

  const occurredAt = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.mtmTask.updateMany({
      where: {
        id,
        organizationId: auth.orgId,
        agentId: auth.agentId,
        status: task.status,
        version: expectedVersion ?? task.version,
        deletedAt: null,
      },
      data: { progress, version: { increment: 1 } },
    })
    if (result.count !== 1) return false
    await tx.mtmTaskEvent.create({
      data: {
        organizationId: auth.orgId,
        taskId: id,
        agentId: auth.agentId,
        type: "EDITED",
        occurredAt,
        fromStatus: task.status,
        toStatus: task.status,
        evidence: {
          kind: "MTM_TASK_EXECUTION",
          actorAgentId: auth.agentId,
          progress,
          expectedVersion: expectedVersion ?? task.version,
          source: "MOBILE_PROGRESS_ROUTE",
        } as Prisma.InputJsonValue,
      },
    })
    return true
  })
  if (!updated) return NextResponse.json({ error: "Task changed concurrently", code: "MTM_TASK_VERSION_CONFLICT" }, { status: 409 })

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: auth.agentId,
    action: "TASK_UPDATE",
    entity: "task",
    entityId: id,
    metadataKind: "task_progress",
    oldData: { progress: task.progress },
    newData: { progress },
    req,
  }).catch((error) => console.warn("[MTM/mobile/tasks/[id]/progress PATCH] audit failed", error))

  return NextResponse.json({ success: true, data: { id, progress, version: task.version + 1 } })
})
