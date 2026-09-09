import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskReviewSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { isMtmTaskManager, mtmTaskScopeWhere, mtmTaskVersionConflict } from "@/lib/mtm/task-access"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !isMtmTaskManager(actor)) {
    return NextResponse.json({ error: "Manager review is required", code: "MTM_TASK_REVIEW_DENIED" }, { status: 403 })
  }

  const parsed = parseBody(TaskReviewSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const reason = body.reason ?? body.comment ?? null

  try {
    const task = await prisma.mtmTask.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
    })
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (task.version !== body.expectedVersion) return NextResponse.json(mtmTaskVersionConflict(task), { status: 409 })
    if (task.status !== "COMPLETED") {
      return NextResponse.json({ error: "Only a completed task can be reviewed", code: "MTM_TASK_NOT_REVIEWABLE", status: task.status }, { status: 409 })
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
      return NextResponse.json({ error: "Task completion was already reviewed", code: "MTM_TASK_ALREADY_REVIEWED" }, { status: 409 })
    }

    const occurredAt = new Date()
    const nextStatus = body.action === "RETURN" ? "IN_PROGRESS" : "COMPLETED"
    const completionCycle = task.completedAt?.toISOString() ?? occurredAt.toISOString()
    await prisma.$transaction(async (tx) => {
      const updated = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: task.agentId,
          status: "COMPLETED",
          version: body.expectedVersion,
          deletedAt: null,
        },
        data: {
          ...(body.action === "RETURN"
            ? { status: "IN_PROGRESS" as const, completedAt: null, returnReason: reason }
            : task.completedAt ? {} : { completedAt: occurredAt }),
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
          toStatus: nextStatus,
          evidence: {
            kind: "MTM_TASK_REVIEW",
            action: body.action,
            completionCycle,
            completionVersion: body.expectedVersion,
            actorAgentId: actor.agentId,
            actorRole: actor.role,
            actorName: auth.name,
            priorCompletionEvidencePreserved: true,
          } as Prisma.InputJsonValue,
        },
      })
      if (body.action === "RETURN") {
        await tx.mtmNotification.create({
          data: {
            organizationId: auth.orgId,
            agentId: task.agentId,
            title: "Task returned for rework",
            body: reason ?? "Task returned for rework",
            type: "warning",
            metadata: { taskId: id, reason, completionCycle },
          },
        })
      }
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: task.agentId,
      action: "TASK_UPDATE",
      entity: "task",
      entityId: id,
      metadataKind: body.action === "RETURN" ? "task_return" : "task_review_accept",
      oldData: { status: task.status, version: task.version, result: task.result, completedAt: task.completedAt },
      newData: { action: body.action, status: nextStatus, version: body.expectedVersion + 1, reason },
      req,
    }).catch((error) => console.warn("[MTM/tasks/[id]/review POST] audit failed", error))

    return NextResponse.json({
      success: true,
      data: { id, action: body.action, status: nextStatus, version: body.expectedVersion + 1, returnReason: body.action === "RETURN" ? reason : task.returnReason },
    })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      const current = await prisma.mtmTask.findFirst({
        where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
      }).catch(() => null)
      return NextResponse.json(mtmTaskVersionConflict(current), { status: 409 })
    }
    console.error("[MTM/tasks/[id]/review POST]", error)
    return NextResponse.json({ error: "Failed to review task" }, { status: 500 })
  }
})
