import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskBulkReassignSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { isMtmTaskManager, mtmTaskIsTerminal, mtmTaskScopeWhere } from "@/lib/mtm/task-access"

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !isMtmTaskManager(actor)) {
    return NextResponse.json({ error: "Manager task access is required", code: "MTM_TASK_BULK_REASSIGN_DENIED" }, { status: 403 })
  }

  const parsed = parseBody(TaskBulkReassignSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (
    Object.keys(body.expectedVersions).length !== body.taskIds.length
    || body.taskIds.some((taskId) => body.expectedVersions[taskId] === undefined)
  ) {
    return NextResponse.json({ error: "expectedVersions must cover every task", code: "MTM_TASK_VERSION_REQUIRED" }, { status: 400 })
  }
  if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(body.agentId)) {
    return NextResponse.json({ error: "Target agent is outside scope", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
  }

  try {
    const [target, tasks] = await Promise.all([
      prisma.mtmAgent.findFirst({
        where: { id: body.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true },
      }),
      prisma.mtmTask.findMany({
        where: {
          id: { in: body.taskIds },
          organizationId: auth.orgId,
          deletedAt: null,
          ...mtmTaskScopeWhere(actor),
        },
        orderBy: { id: "asc" },
        select: { id: true, agentId: true, visitId: true, status: true, version: true },
      }),
    ])
    if (!target) return NextResponse.json({ error: "Target agent not found", code: "MTM_TASK_AGENT_NOT_FOUND" }, { status: 404 })
    if (tasks.length !== body.taskIds.length) {
      return NextResponse.json({ error: "One or more tasks are unavailable", code: "MTM_TASK_SCOPE_DENIED" }, { status: 404 })
    }
    const terminal = tasks.find((task) => mtmTaskIsTerminal(task.status))
    if (terminal) {
      return NextResponse.json({ error: "Completed or cancelled tasks cannot be reassigned", code: "MTM_TASK_IMMUTABLE", taskId: terminal.id }, { status: 409 })
    }
    const stale = tasks.find((task) => task.version !== body.expectedVersions[task.id])
    if (stale) {
      return NextResponse.json({ error: "A task changed concurrently", code: "MTM_TASK_VERSION_CONFLICT", task: stale }, { status: 409 })
    }

    const occurredAt = new Date()
    await prisma.$transaction(async (tx) => {
      for (const task of tasks) {
        const unlinksVisit = task.agentId !== body.agentId && task.visitId !== null
        const updated = await tx.mtmTask.updateMany({
          where: {
            id: task.id,
            organizationId: auth.orgId,
            agentId: task.agentId,
            status: task.status,
            version: body.expectedVersions[task.id],
            deletedAt: null,
          },
          data: {
            agentId: body.agentId,
            ...(task.agentId !== body.agentId ? { visitId: null, acceptedAt: null } : {}),
            version: { increment: 1 },
          },
        })
        if (updated.count !== 1) throw new Error("MTM_TASK_VERSION_CONFLICT")
        await tx.mtmTaskEvent.create({
          data: {
            organizationId: auth.orgId,
            taskId: task.id,
            agentId: body.agentId,
            type: "EDITED",
            occurredAt,
            fromStatus: task.status,
            toStatus: task.status,
            evidence: {
              kind: "MTM_TASK_REASSIGN",
              previousAgentId: task.agentId,
              agentId: body.agentId,
              previousVisitId: unlinksVisit ? task.visitId : null,
              visitUnlinked: unlinksVisit,
              acceptanceReset: task.agentId !== body.agentId,
              actorAgentId: actor.agentId,
              actorRole: actor.role,
              actorName: auth.name,
              expectedVersion: body.expectedVersions[task.id],
            } as Prisma.InputJsonValue,
          },
        })
      }
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: body.agentId,
      action: "TASK_UPDATE",
      entity: "task",
      entityId: null,
      metadataKind: "task_bulk_reassign",
      oldData: tasks.map((task) => ({ id: task.id, agentId: task.agentId, version: task.version })),
      newData: { agentId: body.agentId, taskIds: body.taskIds },
      req,
    }).catch((error) => console.warn("[MTM/tasks/bulk-reassign POST] audit failed", error))

    return NextResponse.json({
      success: true,
      data: {
        reassigned: tasks.length,
        agentId: body.agentId,
        tasks: tasks.map((task) => ({ id: task.id, version: task.version + 1 })),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      return NextResponse.json({ error: "A task changed concurrently", code: error.message }, { status: 409 })
    }
    console.error("[MTM/tasks/bulk-reassign POST]", error)
    return NextResponse.json({ error: "Failed to reassign tasks" }, { status: 500 })
  }
})
