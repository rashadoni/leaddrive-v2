import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskBulkReassignSchema } from "@/lib/mtm-validators"

/**
 * Manager bulk reassignment (SWM-14). The batch is validated in full before a
 * transaction starts, then each task is version-fenced inside one transaction.
 * Any missing, out-of-scope, terminal, or stale task aborts the whole request.
 */
export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
  if (forbidden) return forbidden

  const parsed = TaskBulkReassignSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid bulk request" }, { status: 400 })
  }
  const body = parsed.data
  if (
    Object.keys(body.expectedVersions).length !== body.taskIds.length
    || body.taskIds.some((taskId) => body.expectedVersions[taskId] === undefined)
  ) {
    return NextResponse.json({ error: "expectedVersions must cover every task", code: "MTM_TASK_VERSION_REQUIRED" }, { status: 400 })
  }

  const scope = await resolveAgentScope(prisma, {
    organizationId: auth.orgId,
    agentId: auth.agentId,
    role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
  })

  if (scope.agentIds !== null && !scope.agentIds.includes(body.agentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
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
          ...(scope.agentIds !== null ? { agentId: { in: scope.agentIds } } : {}),
        },
        orderBy: { id: "asc" },
        select: { id: true, agentId: true, visitId: true, status: true, version: true },
      }),
    ])
    if (!target) return NextResponse.json({ error: "Target agent not found", code: "MTM_AGENT_NOT_FOUND" }, { status: 404 })
    if (tasks.length !== body.taskIds.length) {
      return NextResponse.json({ error: "One or more tasks are unavailable", code: "MTM_TASK_SCOPE_DENIED" }, { status: 404 })
    }

    const terminal = tasks.find((task) => task.status === "COMPLETED" || task.status === "CANCELLED")
    if (terminal) {
      return NextResponse.json({
        error: "Completed or cancelled tasks cannot be reassigned",
        code: "MTM_TASK_IMMUTABLE",
        taskId: terminal.id,
      }, { status: 409 })
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
              actorAgentId: auth.agentId,
              expectedVersion: body.expectedVersions[task.id],
              source: "MOBILE_MANAGER_ROUTE",
              visitUnlinked: unlinksVisit,
              previousVisitId: unlinksVisit ? task.visitId : null,
              acceptanceReset: task.agentId !== body.agentId,
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
      oldData: tasks.map((task) => ({ id: task.id, agentId: task.agentId, visitId: task.visitId, version: task.version })),
      newData: { agentId: body.agentId, taskIds: body.taskIds },
      req,
    }).catch((error) => console.warn("[MTM/mobile/tasks/bulk-reassign POST] audit failed", error))

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
    console.error("[MTM/mobile/tasks/bulk-reassign POST]", error)
    return NextResponse.json({ error: "Failed to reassign tasks" }, { status: 500 })
  }
})
