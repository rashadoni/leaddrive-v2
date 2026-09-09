import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskDuplicateSchema } from "@/lib/mtm-validators"

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

/**
 * Manager duplicate-to-date. A stable source key and transaction advisory lock
 * make retries exactly-once, including across concurrent requests. A deleted
 * duplicate remains a tombstone and is never silently recreated. Every copy is
 * a one-off task: recurrence and visit execution context are deliberately reset.
 */
export const POST = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
  if (forbidden) return forbidden

  const { id } = await params
  const parsed = TaskDuplicateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid duplicate request" }, { status: 400 })
  }
  const body = parsed.data
  const targetDueDate = new Date(body.targetDueDate)
  const targetScheduledStartAt = body.targetScheduledStartAt ? new Date(body.targetScheduledStartAt) : null
  if (targetScheduledStartAt && targetScheduledStartAt > targetDueDate) {
    return NextResponse.json({ error: "targetScheduledStartAt must not follow targetDueDate", code: "MTM_TASK_TIME_RANGE_INVALID" }, { status: 400 })
  }

  const scope = await resolveAgentScope(prisma, {
    organizationId: auth.orgId,
    agentId: auth.agentId,
    role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
  })
  const source = await prisma.mtmTask.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    select: { id: true, agentId: true, version: true },
  })
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (scope.agentIds !== null && !scope.agentIds.includes(source.agentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
  }

  const sourceKey = duplicateSourceKey(auth.orgId, id, body.idempotencyKey)
  const occurredAt = new Date()
  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-task-duplicate:${auth.orgId}:${sourceKey}`}, 0))`

      // Raw SQL intentionally bypasses any soft-delete extension. A deleted
      // idempotent result is a permanent tombstone for this operation key.
      const existingRows = await tx.$queryRaw<RawDuplicate[]>`
        SELECT "id", "agentId", "copiedFromId", "dueDate", "scheduledStartAt", "deletedAt", "title", "status", "priority", "version"
        FROM "mtm_tasks"
        WHERE "organizationId" = ${auth.orgId}
          AND "sourceKey" = ${sourceKey}
        LIMIT 1
      `
      const existing = existingRows[0]
      if (existing) {
        if (scope.agentIds !== null && !scope.agentIds.includes(existing.agentId)) {
          throw new Error("MTM_TASK_DUPLICATE_SCOPE_DENIED")
        }
        if (!isSameDuplicateRequest(existing, id, targetDueDate, targetScheduledStartAt)) {
          throw new Error("MTM_TASK_IDEMPOTENCY_MISMATCH")
        }
        if (existing.deletedAt) throw new Error("MTM_TASK_DUPLICATE_TOMBSTONED")
        return { ...existing, idempotent: true }
      }

      const pinned = await tx.mtmTask.findFirst({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: source.agentId,
          version: body.expectedVersion,
          deletedAt: null,
        },
      })
      if (!pinned) throw new Error("MTM_TASK_VERSION_CONFLICT")
      const fenced = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: source.agentId,
          version: body.expectedVersion,
          deletedAt: null,
        },
        data: { version: { increment: 0 } },
      })
      if (fenced.count !== 1) throw new Error("MTM_TASK_VERSION_CONFLICT")

      const task = await tx.mtmTask.create({
        data: {
          organizationId: auth.orgId,
          agentId: pinned.agentId,
          customerId: pinned.customerId,
          visitId: null,
          taskGroupDictionaryId: pinned.taskGroupDictionaryId,
          taskGroupCode: pinned.taskGroupCode,
          sourceKey,
          title: pinned.title,
          description: pinned.description,
          status: "PENDING",
          priority: pinned.priority,
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
          agentId: pinned.agentId,
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
            actorAgentId: auth.agentId,
            expectedVersion: body.expectedVersion,
            source: "MOBILE_MANAGER_ROUTE",
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
      }).catch((error) => console.warn("[MTM/mobile/tasks/[id]/duplicate POST] audit failed", error))
    }

    return NextResponse.json({ success: true, data: created }, { status: created.idempotent ? 200 : 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_DUPLICATE_SCOPE_DENIED") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      return NextResponse.json({ error: "Task changed concurrently", code: error.message }, { status: 409 })
    }
    if (error instanceof Error && (error.message === "MTM_TASK_IDEMPOTENCY_MISMATCH" || error.message === "MTM_TASK_DUPLICATE_TOMBSTONED")) {
      return NextResponse.json({ error: "Duplicate replay conflicts with the original request", code: error.message }, { status: 409 })
    }
    console.error("[MTM/mobile/tasks/[id]/duplicate POST]", error)
    return NextResponse.json({ error: "Failed to duplicate task" }, { status: 500 })
  }
})
