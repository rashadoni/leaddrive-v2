import { Prisma } from "@prisma/client"
import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { getMtmSettings } from "@/lib/mtm-settings"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Manager task editing from the field app. Editing task metadata (title,
 * description, priority, due date) is a Manager/Supervisor action per SWM-14 —
 * agents execute (start/complete/result) through the sync-push lifecycle, they
 * do not re-author tasks. Every mutation is version-fenced and writes the
 * immutable task timeline in the same transaction.
 */
const TaskEditSchema = z.object({
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  recurrenceRule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).nullable().optional(),
  recurrenceInterval: z.number().int().min(1).max(365).optional(),
}).superRefine((value, ctx) => {
  if (Object.keys(value).every((key) => key === "expectedVersion")) {
    ctx.addIssue({ code: "custom", message: "No fields to update" })
  }
  if (value.recurrenceRule === null && value.recurrenceInterval !== undefined) {
    ctx.addIssue({ code: "custom", path: ["recurrenceInterval"], message: "Clearing recurrence cannot set recurrenceInterval" })
  }
})

export const PUT = withMobileRls<RouteContext>(async (req, auth, { params }) => {
  const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
  if (forbidden) return forbidden

  const { id } = await params
  const parsed = TaskEditSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid task edit" }, { status: 400 })
  }
  const body = parsed.data
  if (body.taskGroupCode !== undefined) {
    return NextResponse.json({
      error: "Task group is governed by the signed web dictionary",
      code: "MTM_TASK_GROUP_WEB_ONLY",
    }, { status: 403 })
  }

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
      description: true,
      status: true,
      priority: true,
      taskGroupDictionaryId: true,
      taskGroupCode: true,
      scheduledStartAt: true,
      dueDate: true,
      recurrenceRule: true,
      recurrenceInterval: true,
      recurrenceUntil: true,
      recurrenceTimezone: true,
      recurrenceAnchorScheduledStartAt: true,
      recurrenceAnchorDueDate: true,
      recurrenceCursorScheduledStartAt: true,
      recurrenceCursorDueDate: true,
      version: true,
    },
  })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (scope.agentIds !== null && !scope.agentIds.includes(task.agentId)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
  }
  if (task.version !== body.expectedVersion) {
    return NextResponse.json({ error: "Task changed concurrently", code: "MTM_TASK_VERSION_CONFLICT", task }, { status: 409 })
  }
  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    return NextResponse.json({ error: "Completed or cancelled task core is immutable", code: "MTM_TASK_IMMUTABLE" }, { status: 409 })
  }

  const data: Prisma.MtmTaskUpdateManyMutationInput = {}
  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description ?? null
  if (body.priority !== undefined) data.priority = body.priority
  if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null

  const effectiveScheduledStartAt = task.scheduledStartAt
  const effectiveDueDate = body.dueDate === undefined ? task.dueDate : body.dueDate ? new Date(body.dueDate) : null
  const effectiveRecurrenceRule = body.recurrenceRule === undefined ? task.recurrenceRule : body.recurrenceRule
  const effectiveRecurrenceInterval = body.recurrenceInterval === undefined
    ? task.recurrenceInterval
    : body.recurrenceInterval
  const recurrenceSettingsChanged = (
    body.recurrenceRule !== undefined && body.recurrenceRule !== task.recurrenceRule
  ) || (
    body.recurrenceInterval !== undefined && body.recurrenceInterval !== (task.recurrenceInterval ?? 1)
  )
  if (task.recurrenceRule && recurrenceSettingsChanged) {
    return NextResponse.json({
      error: "Existing recurrence series must be edited with THIS_AND_FUTURE in the web workspace",
      code: "MTM_TASK_SERIES_EDIT_UNSUPPORTED",
    }, { status: 409 })
  }
  if (effectiveScheduledStartAt && effectiveDueDate && effectiveScheduledStartAt > effectiveDueDate) {
    return NextResponse.json({ error: "scheduledStartAt must not follow dueDate", code: "MTM_TASK_TIME_RANGE_INVALID" }, { status: 400 })
  }
  if (effectiveRecurrenceRule && !effectiveScheduledStartAt && !effectiveDueDate) {
    return NextResponse.json({ error: "A recurring task requires planned start or due date", code: "MTM_TASK_RECURRENCE_DATE_REQUIRED" }, { status: 400 })
  }

  if (body.recurrenceRule !== undefined) {
    data.recurrenceRule = body.recurrenceRule
    if (body.recurrenceRule === null) {
      data.recurrenceInterval = null
      data.recurrenceUntil = null
      data.recurrenceTimezone = null
      data.recurrenceAnchorScheduledStartAt = null
      data.recurrenceAnchorDueDate = null
      data.recurrenceCursorScheduledStartAt = null
      data.recurrenceCursorDueDate = null
    }
  }
  if (!effectiveRecurrenceRule && body.recurrenceInterval !== undefined) {
    return NextResponse.json({ error: "recurrenceRule is required with recurrenceInterval", code: "MTM_TASK_RECURRENCE_RULE_REQUIRED" }, { status: 400 })
  }
  if (effectiveRecurrenceRule) {
    const settings = await getMtmSettings(auth.orgId)
    const tenantTimezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const effectiveRecurrenceTimezone = isValidTimezone(task.recurrenceTimezone)
      ? task.recurrenceTimezone
      : tenantTimezone
    const recurrenceIdentity = task.recurrenceRule
      ? task.recurrenceCursorDueDate
        ?? task.recurrenceCursorScheduledStartAt
        ?? task.dueDate
        ?? task.scheduledStartAt
      : effectiveDueDate ?? effectiveScheduledStartAt
    if (
      task.recurrenceUntil
      && recurrenceIdentity
      && dateInputValueInTimezone(recurrenceIdentity, effectiveRecurrenceTimezone)
        > dateInputValueInTimezone(task.recurrenceUntil, effectiveRecurrenceTimezone)
    ) {
      return NextResponse.json({
        error: "Task schedule cannot follow recurrence end",
        code: "MTM_TASK_RECURRENCE_RANGE_INVALID",
      }, { status: 400 })
    }

    if (body.recurrenceRule !== undefined || body.recurrenceInterval !== undefined) {
      data.recurrenceInterval = effectiveRecurrenceInterval ?? 1
    }
    if (body.recurrenceRule !== undefined || !isValidTimezone(task.recurrenceTimezone)) {
      data.recurrenceTimezone = effectiveRecurrenceTimezone
    }
    // Enabling a new series establishes both its monthly anchor and immutable
    // occurrence cursor. A due-only edit is an isolated THIS exception.
    if (body.recurrenceRule !== undefined && !task.recurrenceRule) {
      data.recurrenceAnchorScheduledStartAt = effectiveScheduledStartAt
      data.recurrenceAnchorDueDate = effectiveDueDate
      data.recurrenceCursorScheduledStartAt = effectiveScheduledStartAt
      data.recurrenceCursorDueDate = effectiveDueDate
    } else if (
      body.dueDate !== undefined
      && task.recurrenceCursorScheduledStartAt == null
      && task.recurrenceCursorDueDate == null
    ) {
      data.recurrenceCursorScheduledStartAt = task.scheduledStartAt
      data.recurrenceCursorDueDate = task.dueDate
    }
  }

  const occurredAt = new Date()
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: task.agentId,
          status: task.status,
          version: body.expectedVersion,
          deletedAt: null,
        },
        data: { ...data, version: { increment: 1 } },
      })
      if (updated.count !== 1) throw new Error("MTM_TASK_VERSION_CONFLICT")

      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: id,
          agentId: task.agentId,
          type: body.dueDate !== undefined ? "RESCHEDULED" : "EDITED",
          occurredAt,
          fromStatus: task.status,
          toStatus: task.status,
          oldDueDate: task.dueDate,
          newDueDate: body.dueDate === undefined ? task.dueDate : body.dueDate ? new Date(body.dueDate) : null,
          evidence: {
            kind: "MTM_TASK_METADATA_EDIT",
            actorAgentId: auth.agentId,
            expectedVersion: body.expectedVersion,
            source: "MOBILE_MANAGER_ROUTE",
            changedFields: Object.keys(data),
          } as Prisma.InputJsonValue,
        },
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      return NextResponse.json({ error: "Task changed concurrently", code: error.message }, { status: 409 })
    }
    console.error("[MTM/mobile/tasks/[id] PUT]", error)
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: task.agentId,
    action: "TASK_UPDATE",
    entity: "task",
    entityId: id,
    metadataKind: "task_update",
    oldData: {
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate,
      recurrenceRule: task.recurrenceRule,
      recurrenceInterval: task.recurrenceInterval,
      recurrenceUntil: task.recurrenceUntil,
      recurrenceTimezone: task.recurrenceTimezone,
      recurrenceAnchorScheduledStartAt: task.recurrenceAnchorScheduledStartAt,
      recurrenceAnchorDueDate: task.recurrenceAnchorDueDate,
      version: task.version,
    },
    newData: { ...data, version: body.expectedVersion + 1 },
    req,
  }).catch((error) => console.warn("[MTM/mobile/tasks/[id] PUT] audit failed", error))

  return NextResponse.json({ success: true, data: { id, ...data, version: body.expectedVersion + 1 } })
})
