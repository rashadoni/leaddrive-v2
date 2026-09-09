import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskDuplicateSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { isMtmTaskManager, mtmTaskScopeWhere, mtmTaskVersionConflict } from "@/lib/mtm/task-access"

type RouteContext = { params: Promise<{ id: string }> }
type RawDuplicate = {
  id: string
  agentId: string
  copiedFromId: string | null
  dueDate: Date | null
  scheduledStartAt: Date | null
  deletedAt: Date | null
  title: string
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE"
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
  version: number
}

function duplicateSourceKey(organizationId: string, taskId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`${organizationId}\0${taskId}\0${idempotencyKey}`).digest("hex")
  return `task-duplicate:${taskId}:${digest}`
}

function isSameDuplicateRequest(
  existing: { copiedFromId: string | null; dueDate: Date | null; scheduledStartAt: Date | null },
  sourceId: string,
  targetDueDate: Date,
  targetScheduledStartAt: Date | null,
): boolean {
  return existing.copiedFromId === sourceId
    && existing.dueDate?.getTime() === targetDueDate.getTime()
    && (existing.scheduledStartAt?.getTime() ?? null) === (targetScheduledStartAt?.getTime() ?? null)
}

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !isMtmTaskManager(actor)) {
    return NextResponse.json({ error: "Manager task access is required", code: "MTM_TASK_DUPLICATE_DENIED" }, { status: 403 })
  }

  const parsed = parseBody(TaskDuplicateSchema, await req.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const targetDueDate = new Date(body.targetDueDate)
  const targetScheduledStartAt = body.targetScheduledStartAt ? new Date(body.targetScheduledStartAt) : null
  if (targetScheduledStartAt && targetScheduledStartAt > targetDueDate) {
    return NextResponse.json({ error: "targetScheduledStartAt must not follow targetDueDate", code: "MTM_TASK_TIME_RANGE_INVALID" }, { status: 400 })
  }
  const sourceKey = duplicateSourceKey(auth.orgId, id, body.idempotencyKey)

  try {
    const source = await prisma.mtmTask.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
    })
    if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const replay = await prisma.mtmTask.findFirst({
      where: { organizationId: auth.orgId, sourceKey },
      select: {
        id: true,
        agentId: true,
        copiedFromId: true,
        dueDate: true,
        scheduledStartAt: true,
        deletedAt: true,
        title: true,
        status: true,
        priority: true,
        version: true,
      },
    })
    if (replay) {
      if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(replay.agentId)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      if (!isSameDuplicateRequest(replay, id, targetDueDate, targetScheduledStartAt)) {
        return NextResponse.json({ error: "Idempotency key was used with different duplicate facts", code: "MTM_TASK_IDEMPOTENCY_MISMATCH" }, { status: 409 })
      }
      if (replay.deletedAt) {
        return NextResponse.json({ error: "The idempotent duplicate was deleted", code: "MTM_TASK_DUPLICATE_TOMBSTONED" }, { status: 409 })
      }
      return NextResponse.json({ success: true, data: { ...replay, idempotent: true } })
    }
    if (source.version !== body.expectedVersion) return NextResponse.json(mtmTaskVersionConflict(source), { status: 409 })

    const occurredAt = new Date()
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-task-duplicate:${auth.orgId}:${sourceKey}`}, 0))`
      // Intentionally bypass the normal soft-delete filter: a deleted
      // idempotent duplicate is a tombstone and must never be resurrected.
      const existingRows = await tx.$queryRaw<RawDuplicate[]>`
        SELECT "id", "agentId", "copiedFromId", "dueDate", "scheduledStartAt", "deletedAt", "title", "status", "priority", "version"
        FROM "mtm_tasks"
        WHERE "organizationId" = ${auth.orgId}
          AND "sourceKey" = ${sourceKey}
        LIMIT 1
      `
      const existing = existingRows[0]
      if (existing) {
        if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(existing.agentId)) {
          throw new Error("MTM_TASK_DUPLICATE_SCOPE_DENIED")
        }
        if (!isSameDuplicateRequest(existing, id, targetDueDate, targetScheduledStartAt)) throw new Error("MTM_TASK_IDEMPOTENCY_MISMATCH")
        if (existing.deletedAt) throw new Error("MTM_TASK_DUPLICATE_TOMBSTONED")
        return { ...existing, idempotent: true }
      }

      // Fence the source row after acquiring the idempotency lock. A no-op
      // CAS takes a row lock and proves that the exact reviewed source version
      // still exists before any of its facts are copied.
      const pinned = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: source.agentId,
          version: body.expectedVersion,
          deletedAt: null,
        },
        data: { version: { increment: 0 } },
      })
      if (pinned.count !== 1) throw new Error("MTM_TASK_VERSION_CONFLICT")

      const task = await tx.mtmTask.create({
        data: {
          organizationId: auth.orgId,
          agentId: source.agentId,
          customerId: source.customerId,
          visitId: null,
          taskGroupDictionaryId: source.taskGroupDictionaryId,
          taskGroupCode: source.taskGroupCode,
          sourceKey,
          title: source.title,
          description: source.description,
          status: "PENDING",
          priority: source.priority,
          scheduledStartAt: targetScheduledStartAt,
          dueDate: targetDueDate,
          recurrenceRule: null,
          recurrenceInterval: null,
          recurrenceUntil: null,
          recurrenceTimezone: null,
          recurrenceAnchorScheduledStartAt: null,
          recurrenceAnchorDueDate: null,
          recurrenceCursorScheduledStartAt: null,
          recurrenceCursorDueDate: null,
          recurrenceParentId: null,
          copiedFromId: id,
        },
      })
      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: task.id,
          agentId: source.agentId,
          type: "COPIED",
          occurredAt,
          toStatus: "PENDING",
          newDueDate: targetDueDate,
          evidence: {
            kind: "MTM_TASK_DUPLICATE",
            copiedFromId: id,
            sourceKey,
            targetScheduledStartAt: targetScheduledStartAt?.toISOString() ?? null,
            targetDueDate: targetDueDate.toISOString(),
            actorAgentId: actor.agentId,
            actorRole: actor.role,
            actorName: auth.name,
          } as Prisma.InputJsonValue,
        },
      })
      return { ...task, idempotent: false }
    })

    if (!created.idempotent) {
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: source.agentId,
        action: "TASK_CREATE",
        entity: "task",
        entityId: created.id,
        metadataKind: "task_duplicate",
        newData: { copiedFromId: id, targetScheduledStartAt, targetDueDate, sourceKey },
        req,
      }).catch((error) => console.warn("[MTM/tasks/[id]/duplicate POST] audit failed", error))
    }

    return NextResponse.json({ success: true, data: created }, { status: created.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_DUPLICATE_SCOPE_DENIED") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      const current = await prisma.mtmTask.findFirst({
        where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
      }).catch(() => null)
      return NextResponse.json(mtmTaskVersionConflict(current), { status: 409 })
    }
    if (error instanceof Error && (error.message === "MTM_TASK_IDEMPOTENCY_MISMATCH" || error.message === "MTM_TASK_DUPLICATE_TOMBSTONED")) {
      return NextResponse.json({ error: "Duplicate replay conflicts with the original request", code: error.message }, { status: 409 })
    }
    console.error("[MTM/tasks/[id]/duplicate POST]", error)
    return NextResponse.json({ error: "Failed to duplicate task" }, { status: 500 })
  }
})
