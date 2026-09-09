import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskCommentSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmTaskScopeWhere } from "@/lib/mtm/task-access"

type RouteContext = { params: Promise<{ id: string }> }

function evidenceRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isSameCommentReplay(
  event: { taskId: string; type: string; comment: string | null; evidence: Prisma.JsonValue | null },
  input: { taskId: string; comment: string; actorAgentId: string | null; actorRole: string },
): boolean {
  const evidence = evidenceRecord(event.evidence)
  return event.taskId === input.taskId
    && event.type === "COMMENTED"
    && event.comment === input.comment
    && evidence.kind === "MTM_TASK_COMMENT"
    && evidence.actorAgentId === input.actorAgentId
    && evidence.actorRole === input.actorRole
}

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  const parsed = parseBody(TaskCommentSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const task = await prisma.mtmTask.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
      select: { id: true, agentId: true, status: true, version: true },
    })
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const replay = await prisma.mtmTaskEvent.findFirst({
      where: { organizationId: auth.orgId, clientEventId: body.clientEventId },
      select: { id: true, taskId: true, type: true, occurredAt: true, comment: true, evidence: true },
    })
    if (replay) {
      if (!isSameCommentReplay(replay, { taskId: id, comment: body.comment, actorAgentId: actor.agentId, actorRole: actor.role })) {
        return NextResponse.json({ error: "clientEventId was used with different comment facts", code: "MTM_TASK_EVENT_REPLAY_MISMATCH" }, { status: 409 })
      }
      return NextResponse.json({ success: true, data: { ...replay, idempotent: true } })
    }

    const occurredAt = new Date()
    const event = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-task-comment:${auth.orgId}:${body.clientEventId}`}, 0))`
      const existing = await tx.mtmTaskEvent.findFirst({
        where: { organizationId: auth.orgId, clientEventId: body.clientEventId },
        select: { id: true, taskId: true, type: true, occurredAt: true, comment: true, evidence: true },
      })
      if (existing) {
        if (!isSameCommentReplay(existing, { taskId: id, comment: body.comment, actorAgentId: actor.agentId, actorRole: actor.role })) {
          throw new Error("MTM_TASK_EVENT_REPLAY_MISMATCH")
        }
        return { ...existing, idempotent: true }
      }
      const pinned = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: task.agentId,
          status: task.status,
          version: task.version,
          deletedAt: null,
        },
        data: { version: { increment: 0 } },
      })
      if (pinned.count !== 1) throw new Error("MTM_TASK_SCOPE_CHANGED")
      const created = await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: id,
          agentId: task.agentId,
          clientEventId: body.clientEventId,
          type: "COMMENTED",
          occurredAt,
          comment: body.comment,
          fromStatus: task.status,
          toStatus: task.status,
          evidence: {
            kind: "MTM_TASK_COMMENT",
            actorAgentId: actor.agentId,
            actorRole: actor.role,
            actorName: auth.name,
          } as Prisma.InputJsonValue,
        },
        select: { id: true, taskId: true, type: true, occurredAt: true, comment: true, evidence: true },
      })
      return { ...created, idempotent: false }
    })

    if (!event.idempotent) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: task.agentId,
        action: "TASK_UPDATE",
        entity: "task",
        entityId: id,
        metadataKind: "task_comment",
        newData: { clientEventId: body.clientEventId, comment: body.comment },
        req,
      }).catch((error) => console.warn("[MTM/tasks/[id]/events POST] audit failed", error))
    }
    return NextResponse.json({ success: true, data: event }, { status: event.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_EVENT_REPLAY_MISMATCH") {
      return NextResponse.json({ error: "Comment replay conflicts with the original request", code: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_SCOPE_CHANGED") {
      return NextResponse.json({ error: "Task scope changed concurrently", code: error.message }, { status: 409 })
    }
    console.error("[MTM/tasks/[id]/events POST]", error)
    return NextResponse.json({ error: "Failed to add task comment" }, { status: 500 })
  }
})
