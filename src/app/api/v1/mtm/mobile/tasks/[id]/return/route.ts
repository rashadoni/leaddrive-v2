import { Prisma } from "@prisma/client"
import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Manager review/return (SWM-14). A manager sends a COMPLETED task back to the
 * assignee for rework. The completion result/evidence stays append-only while
 * the core is explicitly reopened for a new completion cycle.
 */
const ReturnSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  expectedVersion: z.number().int().min(1),
})

export const POST = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
  if (forbidden) return forbidden

  const { id } = await params
  const parsed = ReturnSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "A return reason is required" }, { status: 400 })
  }
  const { reason, expectedVersion } = parsed.data

  const scope = await resolveAgentScope(prisma, {
    organizationId: auth.orgId,
    agentId: auth.agentId,
    role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
  })

  const task = await prisma.mtmTask.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    select: {
      id: true,
      agentId: true,
      title: true,
      status: true,
      result: true,
      completedAt: true,
      returnReason: true,
      version: true,
    },
  })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (scope.agentIds !== null && !scope.agentIds.includes(task.agentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
  }
  if (task.version !== expectedVersion) {
    return NextResponse.json({ error: "Task changed concurrently", code: "MTM_TASK_VERSION_CONFLICT", task }, { status: 409 })
  }
  if (task.status !== "COMPLETED") {
    return NextResponse.json({
      error: "Only a completed task can be returned",
      code: "MTM_TASK_NOT_RETURNABLE",
      status: task.status,
    }, { status: 409 })
  }
  const previousReview = task.completedAt
    ? await prisma.mtmTaskEvent.findFirst({
        where: {
          organizationId: auth.orgId,
          taskId: id,
          type: "EDITED",
          AND: [
            { evidence: { path: ["kind"], equals: "MTM_TASK_REVIEW" } },
            { evidence: { path: ["completionCycle"], equals: task.completedAt.toISOString() } },
          ],
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      })
    : null
  if (previousReview) {
    return NextResponse.json({
      error: "Task completion was already reviewed",
      code: "MTM_TASK_ALREADY_REVIEWED",
    }, { status: 409 })
  }

  const occurredAt = new Date()
  const completionCycle = task.completedAt?.toISOString() ?? occurredAt.toISOString()
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: task.agentId,
          status: "COMPLETED",
          version: expectedVersion,
          deletedAt: null,
        },
        data: {
          status: "IN_PROGRESS",
          completedAt: null,
          returnReason: reason,
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) throw new Error("MTM_TASK_VERSION_CONFLICT")

      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: id,
          agentId: task.agentId,
          type: "EDITED",
          occurredAt,
          comment: reason,
          fromStatus: "COMPLETED",
          toStatus: "IN_PROGRESS",
          evidence: {
            kind: "MTM_TASK_REVIEW",
            action: "RETURN",
            completionCycle,
            completionVersion: expectedVersion,
            actorAgentId: auth.agentId,
            source: "MOBILE_MANAGER_ROUTE",
            priorCompletionEvidencePreserved: true,
          } as Prisma.InputJsonValue,
        },
      })

      await tx.mtmNotification.create({
        data: {
          organizationId: auth.orgId,
          agentId: task.agentId,
          title: "Task returned for rework",
          body: reason,
          type: "warning",
          metadata: { taskId: id, reason, completionCycle },
        },
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      return NextResponse.json({ error: "Task changed concurrently", code: error.message }, { status: 409 })
    }
    console.error("[MTM/mobile/tasks/[id]/return POST]", error)
    return NextResponse.json({ error: "Failed to return task" }, { status: 500 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: task.agentId,
    action: "TASK_UPDATE",
    entity: "task",
    entityId: id,
    metadataKind: "task_return",
    oldData: {
      status: task.status,
      result: task.result,
      completedAt: task.completedAt,
      returnReason: task.returnReason,
      version: task.version,
    },
    newData: { status: "IN_PROGRESS", returnReason: reason, version: expectedVersion + 1 },
    req,
  }).catch((error) => console.warn("[MTM/mobile/tasks/[id]/return POST] audit failed", error))

  return NextResponse.json({
    success: true,
    data: { id, status: "IN_PROGRESS", returnReason: reason, version: expectedVersion + 1 },
  })
})
