import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { TaskCreateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  isMtmTaskManager,
  mtmTaskCapabilities,
  mtmTaskScopeWhere,
} from "@/lib/mtm/task-access"
import { getMtmSettings } from "@/lib/mtm-settings"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import {
  activeMtmTaskGroupCatalog,
  MtmTaskGroupError,
  resolveMtmTaskGroupSelection,
} from "@/lib/mtm/task-group"

const VALID_STATUSES = new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"])
const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"])
const VALID_SORTS = new Set(["due_desc", "due_asc", "priority", "title"])

type MtmTaskListSort = "due_desc" | "due_asc" | "priority" | "title"

function taskOrderBy(sort: MtmTaskListSort): Prisma.MtmTaskOrderByWithRelationInput[] {
  if (sort === "due_asc") {
    return [
      { dueDate: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
      { title: "asc" },
      { id: "asc" },
    ]
  }
  if (sort === "priority") {
    return [
      { priority: "desc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { title: "asc" },
      { id: "asc" },
    ]
  }
  if (sort === "title") {
    return [
      { title: "asc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]
  }
  return [
    { dueDate: { sort: "desc", nulls: "last" } },
    { priority: "desc" },
    { title: "asc" },
    { id: "asc" },
  ]
}

function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  const { searchParams } = new URL(req.url)
  // Legacy Android historically calls this web path and may pass another
  // agentId. The mobile principal is always pinned to its freshly-resolved
  // agent, irrespective of the requested filter.
  const requestedAgentId = searchParams.get("agentId") || ""
  const agentId = auth.principal === "mobile" ? actor.agentId ?? "" : requestedAgentId
  const requestedStatus = searchParams.get("status") || ""
  const requestedPriority = searchParams.get("priority") || ""
  const requestedSort = searchParams.get("sort") || "due_desc"
  if (requestedStatus && !VALID_STATUSES.has(requestedStatus)) {
    return NextResponse.json({ error: "Invalid task status", code: "MTM_TASK_FILTER_INVALID" }, { status: 400 })
  }
  if (requestedPriority && !VALID_PRIORITIES.has(requestedPriority)) {
    return NextResponse.json({ error: "Invalid task priority", code: "MTM_TASK_FILTER_INVALID" }, { status: 400 })
  }
  if (!VALID_SORTS.has(requestedSort)) {
    return NextResponse.json({ error: "Invalid task sort", code: "MTM_TASK_SORT_INVALID" }, { status: 400 })
  }
  const status = VALID_STATUSES.has(requestedStatus) ? requestedStatus : ""
  const priority = VALID_PRIORITIES.has(requestedPriority) ? requestedPriority : ""
  const sort = requestedSort as MtmTaskListSort
  const teamId = searchParams.get("teamId") || ""
  const contactId = searchParams.get("contactId") || ""
  const search = searchParams.get("search")?.trim().slice(0, 100) ?? ""
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
  const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") || "50", 10) || 50))

  try {
    const scopeWhere = mtmTaskScopeWhere(actor)
    const where = {
      organizationId: auth.orgId,
      deletedAt: null,
      AND: [scopeWhere, ...(agentId ? [{ agentId }] : [])],
      ...(status ? { status: status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE" } : {}),
      ...(priority ? { priority: priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT" } : {}),
      ...(teamId ? { agent: { teamId } } : {}),
      ...(contactId ? { visit: { contactId } } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
          { customer: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      } : {}),
    }
    const agentScope = actor.scopedAgentIds === null ? {} : { id: { in: [...actor.scopedAgentIds] } }

    const [tasks, total, statusCounts, agents, teams, settings, taskGroupCatalog] = await Promise.all([
      prisma.mtmTask.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: taskOrderBy(sort),
        include: {
          agent: { select: { id: true, name: true, teamId: true, team: { select: { id: true, name: true } } } },
          customer: {
            select: { id: true, name: true, locality: true, city: true, address: true },
          },
          visit: { select: { id: true, status: true, checkInAt: true, checkOutAt: true } },
        },
      }),
      prisma.mtmTask.count({ where }),
      // C11: the page used to count statuses in the rows it happened to have
      // loaded and show them next to a server-wide "Всего: 137". Two numbers
      // from two sources side by side is how a page lies without a single
      // wrong value in it. Both come from the same filtered set now.
      prisma.mtmTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.mtmAgent.findMany({
        where: { organizationId: auth.orgId, status: "ACTIVE", ...agentScope },
        orderBy: { name: "asc" },
        select: { id: true, name: true, teamId: true, team: { select: { id: true, name: true } } },
      }),
      prisma.mtmTeam.findMany({
        where: {
          organizationId: auth.orgId,
          isActive: true,
          ...(actor.scopedAgentIds === null
            ? {}
            : { agents: { some: { id: { in: [...actor.scopedAgentIds] }, status: "ACTIVE" } } }),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getMtmSettings(auth.orgId),
      activeMtmTaskGroupCatalog(prisma, auth.orgId),
    ])

    return NextResponse.json({
      success: true,
      data: {
        tasks,
        total,
        summary: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])),
        page,
        limit,
        sort,
        filters: {
          agents,
          teams,
          taskGroups: taskGroupCatalog?.entries ?? [],
          taskGroupCatalogAvailable: Boolean(taskGroupCatalog),
        },
        timezone: settings.timezone,
        capabilities: {
          ...mtmTaskCapabilities(actor),
          // A mobile principal may list through the legacy endpoint, but may
          // only create through sync with its explicit idempotency contract.
          canCreate: auth.principal === "web"
            && (isMtmTaskManager(actor) || (actor.agentId !== null && settings.taskSelfCreate)),
          canCreateRecurring: auth.principal === "web"
            && (isMtmTaskManager(actor) || (
              actor.agentId !== null
              && settings.taskSelfCreate
              && settings.taskSelfRecurring
            )),
        },
      },
    })
  } catch (error) {
    console.error("[MTM/tasks GET]", error)
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 })
  }
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  if (auth.principal === "mobile") {
    return NextResponse.json({ error: "Use mobile sync to create tasks", code: "MTM_TASK_MOBILE_METHOD_DENIED" }, { status: 403 })
  }

  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  try {
    const parsed = parseBody(TaskCreateSchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    if (!isMtmTaskManager(actor) && actor.agentId !== body.agentId) {
      return NextResponse.json({ error: "Cannot assign another agent", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
    }
    if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(body.agentId)) {
      return NextResponse.json({ error: "Cannot assign an agent outside scope", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
    }

    const settings = await getMtmSettings(auth.orgId)
    if (actor.role === "AGENT" && !settings.taskSelfCreate) {
      return NextResponse.json({ error: "Self-created tasks are disabled", code: "MTM_TASK_SELF_CREATE_DISABLED" }, { status: 403 })
    }
    if (actor.role === "AGENT" && body.recurrenceRule && !settings.taskSelfRecurring) {
      return NextResponse.json({ error: "Recurring self-tasks are disabled", code: "MTM_TASK_SELF_RECURRENCE_DISABLED" }, { status: 403 })
    }
    const recurrenceTimezone = body.recurrenceRule
      ? body.recurrenceTimezone ?? settings.timezone
      : null
    if (recurrenceTimezone && !isValidTimezone(recurrenceTimezone)) {
      return NextResponse.json({ error: "Invalid recurrence timezone", code: "MTM_TASK_TIMEZONE_INVALID" }, { status: 400 })
    }

    const [agent, customer, visit] = await Promise.all([
      prisma.mtmAgent.findFirst({
        where: { id: body.agentId, organizationId: auth.orgId, status: "ACTIVE" },
        select: { id: true },
      }),
      body.customerId
        ? prisma.mtmCustomer.findFirst({
            where: { id: body.customerId, organizationId: auth.orgId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
      body.visitId
        ? prisma.mtmVisit.findFirst({
            where: { id: body.visitId, organizationId: auth.orgId, deletedAt: null },
            select: { id: true, agentId: true, customerId: true },
          })
        : Promise.resolve(null),
    ])
    if (!agent) return NextResponse.json({ error: "Agent not found", code: "MTM_TASK_AGENT_NOT_FOUND" }, { status: 409 })
    if (body.customerId && !customer) return NextResponse.json({ error: "Customer not found", code: "MTM_TASK_CUSTOMER_NOT_FOUND" }, { status: 409 })
    if (body.visitId && !visit) return NextResponse.json({ error: "Visit not found", code: "MTM_TASK_VISIT_NOT_FOUND" }, { status: 409 })
    if (visit && visit.agentId !== body.agentId) {
      return NextResponse.json({ error: "Visit belongs to another agent", code: "MTM_TASK_VISIT_AGENT_MISMATCH" }, { status: 409 })
    }
    if (visit && body.customerId && visit.customerId !== body.customerId) {
      return NextResponse.json({ error: "Visit belongs to another customer", code: "MTM_TASK_VISIT_CUSTOMER_MISMATCH" }, { status: 409 })
    }

    const taskGroup = await resolveMtmTaskGroupSelection(prisma, auth.orgId, body.taskGroupCode)

    const scheduledStartAt = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null
    const dueDate = body.dueDate ? new Date(body.dueDate) : null
    if (scheduledStartAt && dueDate && scheduledStartAt > dueDate) {
      return NextResponse.json({ error: "scheduledStartAt must not follow dueDate", code: "MTM_TASK_TIME_RANGE_INVALID" }, { status: 400 })
    }
    const recurrenceIdentity = dueDate ?? scheduledStartAt
    const recurrenceUntil = body.recurrenceUntil ? new Date(body.recurrenceUntil) : null
    if (
      recurrenceUntil
      && recurrenceIdentity
      && recurrenceTimezone
      && dateInputValueInTimezone(recurrenceUntil, recurrenceTimezone)
        < dateInputValueInTimezone(recurrenceIdentity, recurrenceTimezone)
    ) {
      return NextResponse.json({ error: "recurrenceUntil must not precede the task schedule", code: "MTM_TASK_RECURRENCE_RANGE_INVALID" }, { status: 400 })
    }

    const occurredAt = new Date()
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.mtmTask.create({
        data: {
          organizationId: auth.orgId,
          agentId: body.agentId,
          customerId: body.customerId ?? visit?.customerId ?? null,
          visitId: body.visitId ?? null,
          taskGroupDictionaryId: taskGroup?.dictionaryId ?? null,
          taskGroupCode: taskGroup?.code ?? null,
          title: body.title,
          description: body.description ?? null,
          priority: body.priority ?? "MEDIUM",
          scheduledStartAt,
          dueDate,
          recurrenceRule: body.recurrenceRule ?? null,
          recurrenceInterval: body.recurrenceRule ? body.recurrenceInterval ?? 1 : null,
          recurrenceUntil,
          recurrenceTimezone,
          recurrenceAnchorScheduledStartAt: body.recurrenceRule ? scheduledStartAt : null,
          recurrenceAnchorDueDate: body.recurrenceRule ? dueDate : null,
          recurrenceCursorScheduledStartAt: body.recurrenceRule ? scheduledStartAt : null,
          recurrenceCursorDueDate: body.recurrenceRule ? dueDate : null,
        },
      })
      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: created.id,
          agentId: body.agentId,
          type: "CREATED",
          occurredAt,
          toStatus: "PENDING",
          evidence: {
            kind: "MTM_TASK_CREATED",
            actorAgentId: actor.agentId,
            actorRole: actor.role,
            actorName: auth.name,
          },
        },
      })
      return created
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: body.agentId,
      action: "TASK_CREATE",
      entity: "task",
      entityId: task.id,
      metadataKind: "task_create",
      newData: {
        title: task.title,
        priority: task.priority,
        customerId: task.customerId,
        visitId: task.visitId,
        taskGroupCode: task.taskGroupCode,
        taskGroupDictionaryId: task.taskGroupDictionaryId,
        scheduledStartAt,
        dueDate,
        recurrenceRule: body.recurrenceRule ?? null,
      },
      req,
    }).catch((error) => console.warn("[MTM/tasks POST] audit failed", error))

    return NextResponse.json({ success: true, data: task }, { status: 201 })
  } catch (error) {
    if (error instanceof MtmTaskGroupError) {
      return NextResponse.json({
        error: error.code === "MTM_TASK_GROUP_CATALOG_UNAVAILABLE"
          ? "No active signed task-group dictionary is available"
          : "Task group is not present in the active signed dictionary",
        code: error.code,
      }, { status: error.code === "MTM_TASK_GROUP_NOT_FOUND" ? 400 : 409 })
    }
    console.error("[MTM/tasks POST]", error)
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
  }
})
