import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { TaskUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import {
  canExecuteMtmTask,
  canViewMtmTask,
  isMtmTaskManager,
  mtmTaskCapabilities,
  mtmTaskIsTerminal,
  mtmTaskScopeWhere,
  mtmTaskVersionConflict,
} from "@/lib/mtm/task-access"
import { getMtmSettings } from "@/lib/mtm-settings"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { canApplyMobileTaskTransition, type MobileTaskStatus } from "@/lib/mtm/mobile-task"
import { hasMobileCapability } from "@/lib/mtm/mobile-capabilities"
import {
  lockMtmTaskRecurrenceSeriesInTransaction,
  nextMtmTaskRecurrenceOccurrence,
  previewMtmTaskRecurrence,
  spawnNextMtmTaskRecurrenceInTransaction,
} from "@/lib/mtm/task-recurrence"
import {
  MtmTaskGroupError,
  resolveMtmTaskGroupSelection,
  storedMtmTaskGroup,
} from "@/lib/mtm/task-group"

type RouteContext = { params: Promise<{ id: string }> }

const METADATA_KEYS = [
  "agentId",
  "customerId",
  "visitId",
  "taskGroupCode",
  "title",
  "description",
  "priority",
  "scheduledStartAt",
  "dueDate",
  "recurrenceRule",
  "recurrenceInterval",
  "recurrenceUntil",
  "recurrenceTimezone",
] as const
const EXECUTION_KEYS = ["status", "result", "progress"] as const

function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

function hasAny(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => value[key] !== undefined)
}

function evidenceRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function semanticTaskEventType(type: string, evidence: Record<string, unknown>): string {
  if (evidence.kind === "MTM_TASK_REVIEW") return evidence.action === "RETURN" ? "RETURNED" : "REVIEW_ACCEPTED"
  if (evidence.kind === "MTM_TASK_REASSIGN") return "REASSIGNED"
  if (evidence.kind === "MTM_TASK_EXECUTION" && typeof evidence.progress === "number") return "PROGRESS_UPDATED"
  if (evidence.kind === "MTM_TASK_DOCUMENT") return "EVIDENCE_ADDED"
  return type
}

function safeEvidenceString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null
}

export const GET = withRouteFieldRlsAuth<RouteContext>("read", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  try {
    const task = await prisma.mtmTask.findFirst({
      where: {
        id,
        organizationId: auth.orgId,
        deletedAt: null,
        ...mtmTaskScopeWhere(actor),
      },
      include: {
        agent: { select: { id: true, name: true, teamId: true, team: { select: { id: true, name: true } } } },
        customer: {
          select: {
            id: true,
            name: true,
            locality: true,
            city: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
        visit: {
          select: {
            id: true,
            status: true,
            contactId: true,
            checkInAt: true,
            checkOutAt: true,
            contact: { select: { id: true, displayName: true } },
          },
        },
        taskGroupDictionary: {
          select: {
            id: true,
            version: true,
            status: true,
            entries: true,
            entriesHash: true,
            approvalReference: true,
            signedByUserId: true,
            signedAt: true,
            activatedAt: true,
            retiredAt: true,
          },
        },
      },
    })
    if (!task || !canViewMtmTask(actor, task)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const requestedPreviewLimit = Math.min(31, Math.max(1, Number(new URL(req.url).searchParams.get("previewLimit")) || 8))
    const [timeline, documents, settings, recurrenceParent, currentCycleReviewEvent] = await Promise.all([
      prisma.mtmTaskEvent.findMany({
        where: { organizationId: auth.orgId, taskId: id },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: { agent: { select: { id: true, name: true } } },
      }),
      prisma.mtmDocument.findMany({
        where: { organizationId: auth.orgId, taskId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          clientDocumentId: true,
          title: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          uploadedByAgentId: true,
          createdAt: true,
        },
      }),
      getMtmSettings(auth.orgId),
      task.recurrenceParentId
        ? prisma.mtmTask.findFirst({
            // The recurrence FK is id-only. Re-resolve the anchor under the
            // authenticated tenant instead of following a potentially corrupt
            // cross-tenant relation.
            where: { id: task.recurrenceParentId, organizationId: auth.orgId },
            select: {
              id: true,
              scheduledStartAt: true,
              dueDate: true,
              recurrenceTimezone: true,
              recurrenceAnchorScheduledStartAt: true,
              recurrenceAnchorDueDate: true,
              recurrenceCursorScheduledStartAt: true,
              recurrenceCursorDueDate: true,
            },
          })
        : Promise.resolve(null),
      task.completedAt
        ? prisma.mtmTaskEvent.findFirst({
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
            include: { agent: { select: { id: true, name: true } } },
          })
        : Promise.resolve(null),
    ])

    const recurrenceTimezone = task.recurrenceTimezone ?? recurrenceParent?.recurrenceTimezone ?? settings.timezone
    const previewScheduledStartAt = task.recurrenceCursorScheduledStartAt ?? task.scheduledStartAt
    const previewDueDate = task.recurrenceCursorDueDate ?? task.dueDate
    const recurrencePreview = task.recurrenceRule && isValidTimezone(recurrenceTimezone) && (previewScheduledStartAt || previewDueDate)
      ? previewMtmTaskRecurrence({
          scheduledStartAt: previewScheduledStartAt,
          dueDate: previewDueDate,
          recurrenceRule: task.recurrenceRule,
          recurrenceInterval: task.recurrenceInterval ?? 1,
          recurrenceUntil: task.recurrenceUntil,
          recurrenceTimezone,
        }, {
          limit: requestedPreviewLimit,
          anchor: {
            scheduledStartAt: task.recurrenceAnchorScheduledStartAt
              ?? recurrenceParent?.recurrenceAnchorScheduledStartAt
              ?? recurrenceParent?.recurrenceCursorScheduledStartAt
              ?? recurrenceParent?.scheduledStartAt
              ?? task.recurrenceCursorScheduledStartAt
              ?? task.scheduledStartAt,
            dueDate: task.recurrenceAnchorDueDate
              ?? recurrenceParent?.recurrenceAnchorDueDate
              ?? recurrenceParent?.recurrenceCursorDueDate
              ?? recurrenceParent?.dueDate
              ?? task.recurrenceCursorDueDate
              ?? task.dueDate,
          },
        })
      : { occurrences: [], limit: requestedPreviewLimit, hasMore: false, wasLimitClamped: false }

    const actorHydrationEvents = currentCycleReviewEvent && !timeline.some((event) => event.id === currentCycleReviewEvent.id)
      ? [...timeline, currentCycleReviewEvent]
      : timeline
    const actorIds = [...new Set(actorHydrationEvents.flatMap((event) => {
      const actorAgentId = evidenceRecord(event.evidence).actorAgentId
      return typeof actorAgentId === "string" ? [actorAgentId] : []
    }))]
    const eventActors = actorIds.length > 0
      ? await prisma.mtmAgent.findMany({
          where: { organizationId: auth.orgId, id: { in: actorIds } },
          select: { id: true, name: true, role: true },
        })
      : []
    const actorsById = new Map(eventActors.map((eventActor) => [eventActor.id, eventActor]))
    const documentsById = new Map(documents.map((document) => [document.id, document]))
    const documentsByClientId = new Map(documents.map((document) => [document.clientDocumentId, document]))
    const hydrateTimelineEvent = (event: typeof timeline[number]) => {
      const evidence = evidenceRecord(event.evidence)
      const actorAgentId = typeof evidence.actorAgentId === "string" ? evidence.actorAgentId : null
      const actorRole = safeEvidenceString(evidence.actorRole, 64)
      const actorName = safeEvidenceString(evidence.actorName, 200)
      const evidenceDocumentId = safeEvidenceString(evidence.documentId, 128)
      const evidenceClientDocumentId = safeEvidenceString(evidence.clientDocumentId, 128)
      const fallbackDocumentId = evidenceDocumentId ?? evidenceClientDocumentId
      const knownDocument = (evidenceDocumentId ? documentsById.get(evidenceDocumentId) : undefined)
        ?? (evidenceClientDocumentId ? documentsByClientId.get(evidenceClientDocumentId) : undefined)
      const evidenceFileName = evidence.kind === "MTM_TASK_DOCUMENT"
        ? safeEvidenceString(evidence.fileName, 255)
        : null
      return {
        ...event,
        semanticType: semanticTaskEventType(event.type, evidence),
        document: knownDocument
          ? {
              id: knownDocument.id,
              fileName: knownDocument.fileName,
              downloadUrl: `/api/v1/mtm/tasks/${id}/documents/${knownDocument.id}/download`,
            }
          : evidenceFileName && fallbackDocumentId
            ? { id: fallbackDocumentId, fileName: evidenceFileName, downloadUrl: null }
            : null,
        // `agent` remains the task assignee stored by the immutable schema.
        // `actor` is separately hydrated from evidence and never inferred.
        actor: actorAgentId
          ? actorsById.get(actorAgentId) ?? { id: actorAgentId, name: "Unknown actor", role: "UNKNOWN" }
          : actorRole && actorRole !== "SYSTEM"
            ? { id: null, name: actorName ?? actorRole, role: actorRole }
            : { id: null, name: "System", role: "SYSTEM" },
      }
    }
    const hydratedTimeline = timeline.map(hydrateTimelineEvent)
    const hydratedCurrentCycleReview = currentCycleReviewEvent
      ? hydrateTimelineEvent(currentCycleReviewEvent)
      : null
    const latestReview = hydratedCurrentCycleReview
      ?? hydratedTimeline.find((event) => evidenceRecord(event.evidence).kind === "MTM_TASK_REVIEW")
    const currentCompletionCycle = task.completedAt?.toISOString() ?? null
    const currentCycleReview = hydratedCurrentCycleReview ?? (currentCompletionCycle
      ? hydratedTimeline.find((event) => {
          const evidence = evidenceRecord(event.evidence)
          return evidence.kind === "MTM_TASK_REVIEW" && evidence.completionCycle === currentCompletionCycle
        })
      : undefined)
    const reviewEvent = currentCycleReview ?? latestReview
    const reviewEvidence = reviewEvent ? evidenceRecord(reviewEvent.evidence) : null
    const reviewState = currentCycleReview
      ? {
          status: reviewEvidence?.action === "RETURN" ? "RETURNED" : "ACCEPTED",
          action: reviewEvidence?.action,
          occurredAt: currentCycleReview.occurredAt,
          comment: currentCycleReview.comment,
          actor: currentCycleReview.actor,
          completionCycle: currentCompletionCycle,
        }
      : task.status === "COMPLETED"
        ? { status: "PENDING", action: null, occurredAt: null, comment: null, actor: null, completionCycle: currentCompletionCycle }
        : reviewEvent
          ? {
              status: reviewEvidence?.action === "RETURN" ? "RETURNED" : "ACCEPTED",
              action: reviewEvidence?.action,
              occurredAt: reviewEvent.occurredAt,
              comment: reviewEvent.comment,
              actor: reviewEvent.actor,
              completionCycle: reviewEvidence?.completionCycle ?? null,
            }
          : { status: "UNREVIEWED", action: null, occurredAt: null, comment: null, actor: null, completionCycle: null }
    const capabilities = mtmTaskCapabilities(actor, task)

    const { taskGroupDictionary, ...taskData } = task
    const taskGroup = storedMtmTaskGroup(taskGroupDictionary, task.taskGroupCode)

    return NextResponse.json({
      success: true,
      data: {
        task: { ...taskData, taskGroup, recurrenceParent },
        timeline: hydratedTimeline,
        documents: documents.map((document) => ({
          ...document,
          downloadUrl: `/api/v1/mtm/tasks/${id}/documents/${document.id}/download`,
        })),
        recurrencePreview,
        reviewState,
        timezone: settings.timezone,
        capabilities: { ...capabilities, canReview: capabilities.canReview && !currentCycleReview },
      },
    })
  } catch (error) {
    console.error("[MTM/tasks/[id] GET]", error)
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 })
  }
})

export const PUT = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  try {
    const parsed = parseBody(TaskUpdateSchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const metadataMutation = hasAny(body, METADATA_KEYS)
    const executionMutation = hasAny(body, EXECUTION_KEYS)
    if (!metadataMutation && !executionMutation) {
      return NextResponse.json({ error: "Task update has no changes", code: "MTM_TASK_NO_CHANGES" }, { status: 400 })
    }
    if (executionMutation && body.editScope === "THIS_AND_FUTURE") {
      return NextResponse.json({ error: "Task execution always applies to this instance", code: "MTM_TASK_EXECUTION_SCOPE_INVALID" }, { status: 400 })
    }

    const task = await prisma.mtmTask.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
    })
    if (!task || !canViewMtmTask(actor, task)) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (auth.principal === "web" && body.expectedVersion === undefined) {
      return NextResponse.json({ error: "expectedVersion is required", code: "MTM_TASK_VERSION_REQUIRED" }, { status: 400 })
    }
    if (body.expectedVersion !== undefined && body.expectedVersion !== task.version) {
      return NextResponse.json(mtmTaskVersionConflict(task), { status: 409 })
    }
    const expectedVersion = body.expectedVersion ?? task.version

    if (auth.principal === "mobile") {
      // Legacy Android is intentionally limited to self execution. Its old
      // payload has no expectedVersion, so the server pins the just-read
      // version/status in the write predicate below.
      if (
        !hasMobileCapability(actor.role, "FIELD_EXECUTE")
        || metadataMutation
        || body.progress !== undefined
        || actor.agentId !== task.agentId
      ) {
        return NextResponse.json({ error: "Mobile task metadata is read-only", code: "MTM_TASK_MOBILE_METHOD_DENIED" }, { status: 403 })
      }
    } else if (metadataMutation) {
      if (!isMtmTaskManager(actor)) {
        return NextResponse.json({ error: "Task metadata is not editable", code: "MTM_TASK_EDIT_DENIED" }, { status: 403 })
      }
      if (executionMutation) {
        return NextResponse.json({ error: "Use the review workflow for manager status changes", code: "MTM_TASK_REVIEW_REQUIRED" }, { status: 409 })
      }
    } else if (!canExecuteMtmTask(actor, task)) {
      return NextResponse.json({ error: "Only the assignee can execute a task", code: "MTM_TASK_EXECUTION_DENIED" }, { status: 403 })
    }

    // A legacy Android request may time out after the server commits. Its old
    // payload has no expectedVersion, so replay exact execution facts before
    // the terminal-state gate and avoid a second event/version increment.
    if (
      auth.principal === "mobile"
      && body.expectedVersion === undefined
      && (body.status === undefined || body.status === task.status)
      && (body.result === undefined || body.result === task.result)
    ) {
      return NextResponse.json({ success: true, data: { task, idempotent: true } })
    }

    if (mtmTaskIsTerminal(task.status) && (metadataMutation || executionMutation)) {
      return NextResponse.json({ error: "Completed or cancelled task core is immutable", code: "MTM_TASK_IMMUTABLE" }, { status: 409 })
    }
    if (body.status && !canApplyMobileTaskTransition(task.status as MobileTaskStatus, body.status)) {
      return NextResponse.json({ error: "Task status transition is not allowed", code: "MTM_TASK_STATUS_CONFLICT", task }, { status: 409 })
    }

    const settings = await getMtmSettings(auth.orgId)
    const targetAgentId = body.agentId ?? task.agentId
    const targetCustomerId = body.customerId !== undefined ? body.customerId : task.customerId
    const targetVisitId = body.visitId !== undefined ? body.visitId : task.visitId
    if (actor.scopedAgentIds !== null && !actor.scopedAgentIds.includes(targetAgentId)) {
      return NextResponse.json({ error: "Target agent is outside scope", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
    }

    const [targetAgent, targetCustomer, targetVisit] = metadataMutation
      ? await Promise.all([
          prisma.mtmAgent.findFirst({
            where: { id: targetAgentId, organizationId: auth.orgId, status: "ACTIVE" },
            select: { id: true },
          }),
          targetCustomerId
            ? prisma.mtmCustomer.findFirst({
                where: { id: targetCustomerId, organizationId: auth.orgId, deletedAt: null },
                select: { id: true },
              })
            : Promise.resolve(null),
          targetVisitId
            ? prisma.mtmVisit.findFirst({
                where: { id: targetVisitId, organizationId: auth.orgId, deletedAt: null },
                select: { id: true, agentId: true, customerId: true },
              })
            : Promise.resolve(null),
        ])
      : [null, null, null]
    if (metadataMutation && !targetAgent) return NextResponse.json({ error: "Agent not found", code: "MTM_TASK_AGENT_NOT_FOUND" }, { status: 409 })
    if (metadataMutation && targetCustomerId && !targetCustomer) return NextResponse.json({ error: "Customer not found", code: "MTM_TASK_CUSTOMER_NOT_FOUND" }, { status: 409 })
    if (metadataMutation && targetVisitId && !targetVisit) return NextResponse.json({ error: "Visit not found", code: "MTM_TASK_VISIT_NOT_FOUND" }, { status: 409 })
    if (targetVisit && targetVisit.agentId !== targetAgentId) {
      return NextResponse.json({ error: "Visit belongs to another agent", code: "MTM_TASK_VISIT_AGENT_MISMATCH" }, { status: 409 })
    }
    if (targetVisit && targetCustomerId && targetVisit.customerId !== targetCustomerId) {
      return NextResponse.json({ error: "Visit belongs to another customer", code: "MTM_TASK_VISIT_CUSTOMER_MISMATCH" }, { status: 409 })
    }

    const taskGroup = body.taskGroupCode === undefined
      ? undefined
      : await resolveMtmTaskGroupSelection(prisma, auth.orgId, body.taskGroupCode)

    const data: Prisma.MtmTaskUpdateManyMutationInput = {}
    if (body.agentId !== undefined) {
      data.agentId = body.agentId
      if (body.agentId !== task.agentId) data.acceptedAt = null
    }
    if (body.customerId !== undefined) data.customerId = body.customerId
    if (body.visitId !== undefined) data.visitId = body.visitId
    if (body.taskGroupCode !== undefined) {
      data.taskGroupDictionaryId = taskGroup?.dictionaryId ?? null
      data.taskGroupCode = taskGroup?.code ?? null
    }
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.priority !== undefined) data.priority = body.priority
    if (body.scheduledStartAt !== undefined) data.scheduledStartAt = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null
    if (body.result !== undefined) data.result = body.result
    if (body.progress !== undefined) data.progress = body.progress

    const nextScheduledStartAt = body.scheduledStartAt === undefined
      ? task.scheduledStartAt
      : body.scheduledStartAt ? new Date(body.scheduledStartAt) : null
    const nextDueDate = body.dueDate === undefined ? task.dueDate : body.dueDate ? new Date(body.dueDate) : null
    let nextRecurrenceRule = body.recurrenceRule === undefined ? task.recurrenceRule : body.recurrenceRule
    let nextRecurrenceInterval = body.recurrenceInterval === undefined ? task.recurrenceInterval : body.recurrenceInterval
    let nextRecurrenceUntil = body.recurrenceUntil === undefined
      ? task.recurrenceUntil
      : body.recurrenceUntil ? new Date(body.recurrenceUntil) : null
    let nextRecurrenceTimezone = body.recurrenceTimezone === undefined
      ? task.recurrenceTimezone
      : body.recurrenceTimezone
    if (body.recurrenceRule === null) {
      nextRecurrenceRule = null
      nextRecurrenceInterval = null
      nextRecurrenceUntil = null
      nextRecurrenceTimezone = null
      data.recurrenceAnchorScheduledStartAt = null
      data.recurrenceAnchorDueDate = null
      data.recurrenceCursorScheduledStartAt = null
      data.recurrenceCursorDueDate = null
    } else if (nextRecurrenceRule) {
      nextRecurrenceInterval ??= 1
      nextRecurrenceTimezone ??= settings.timezone
    }
    if (
      !nextRecurrenceRule
      && (body.recurrenceInterval != null || body.recurrenceUntil != null || body.recurrenceTimezone != null)
    ) {
      return NextResponse.json({ error: "recurrenceRule is required with recurrence settings", code: "MTM_TASK_RECURRENCE_RULE_REQUIRED" }, { status: 400 })
    }
    if (nextScheduledStartAt && nextDueDate && nextScheduledStartAt > nextDueDate) {
      return NextResponse.json({ error: "scheduledStartAt must not follow dueDate", code: "MTM_TASK_TIME_RANGE_INVALID" }, { status: 400 })
    }
    if (nextRecurrenceRule && !nextScheduledStartAt && !nextDueDate) {
      return NextResponse.json({ error: "A recurring task requires planned start or due date", code: "MTM_TASK_RECURRENCE_DATE_REQUIRED" }, { status: 400 })
    }
    if (nextRecurrenceTimezone && !isValidTimezone(nextRecurrenceTimezone)) {
      return NextResponse.json({ error: "Invalid recurrence timezone", code: "MTM_TASK_TIMEZONE_INVALID" }, { status: 400 })
    }
    const recurrenceIdentity = body.editScope === "THIS" && task.recurrenceRule
      ? task.recurrenceCursorDueDate
        ?? task.recurrenceCursorScheduledStartAt
        ?? task.dueDate
        ?? task.scheduledStartAt
      : nextDueDate ?? nextScheduledStartAt
    // An isolated THIS edit may move the visible schedule without moving the
    // series position. Future edits must pivot from that immutable occurrence
    // identity or hidden siblings can be skipped/re-authored out of order.
    const seriesPivot = task.recurrenceCursorDueDate
      ?? task.recurrenceCursorScheduledStartAt
      ?? task.dueDate
      ?? task.scheduledStartAt
    if (
      nextRecurrenceUntil
      && recurrenceIdentity
      && nextRecurrenceTimezone
      && dateInputValueInTimezone(nextRecurrenceUntil, nextRecurrenceTimezone)
        < dateInputValueInTimezone(recurrenceIdentity, nextRecurrenceTimezone)
    ) {
      return NextResponse.json({ error: "recurrenceUntil must not precede the task schedule", code: "MTM_TASK_RECURRENCE_RANGE_INVALID" }, { status: 400 })
    }
    if (body.recurrenceRule !== undefined) data.recurrenceRule = nextRecurrenceRule
    if (body.recurrenceRule !== undefined || body.recurrenceInterval !== undefined) data.recurrenceInterval = nextRecurrenceInterval
    if (body.recurrenceRule !== undefined || body.recurrenceUntil !== undefined) data.recurrenceUntil = nextRecurrenceUntil
    if (body.recurrenceRule !== undefined || body.recurrenceTimezone !== undefined) data.recurrenceTimezone = nextRecurrenceTimezone

    const occurredAt = new Date()
    if (body.status !== undefined) {
      data.status = body.status
      if (body.status === "IN_PROGRESS" && !task.startedAt) data.startedAt = occurredAt
      if (body.status === "COMPLETED") {
        data.completedAt = occurredAt
        data.progress = 100
      }
      if (body.status === "PENDING") data.completedAt = null
    }

    const scheduledStartChanged = body.scheduledStartAt !== undefined
      && (nextScheduledStartAt?.getTime() ?? null) !== (task.scheduledStartAt?.getTime() ?? null)
    const dueDateChanged = body.dueDate !== undefined
      && (nextDueDate?.getTime() ?? null) !== (task.dueDate?.getTime() ?? null)
    const agentChanged = body.agentId !== undefined && body.agentId !== task.agentId
    const customerChanged = body.customerId !== undefined && body.customerId !== task.customerId
    const recurrenceRuleChanged = body.recurrenceRule !== undefined
      && nextRecurrenceRule !== task.recurrenceRule
    const currentEffectiveRecurrenceInterval = task.recurrenceRule ? task.recurrenceInterval ?? 1 : null
    const currentEffectiveRecurrenceTimezone = task.recurrenceRule
      ? task.recurrenceTimezone ?? settings.timezone
      : null
    const recurrenceIntervalChanged = (body.recurrenceRule !== undefined || body.recurrenceInterval !== undefined)
      && nextRecurrenceInterval !== currentEffectiveRecurrenceInterval
    const recurrenceUntilChanged = (body.recurrenceRule !== undefined || body.recurrenceUntil !== undefined)
      && (nextRecurrenceUntil?.getTime() ?? null) !== (task.recurrenceUntil?.getTime() ?? null)
    const recurrenceTimezoneChanged = (body.recurrenceRule !== undefined || body.recurrenceTimezone !== undefined)
      && nextRecurrenceTimezone !== currentEffectiveRecurrenceTimezone
    const firstCompletion = body.status === "COMPLETED" && task.status !== "COMPLETED"
    const eventType = firstCompletion
      ? "COMPLETED"
      : body.status === "IN_PROGRESS" && task.status !== "IN_PROGRESS"
        ? "STARTED"
        : body.status === "CANCELLED" && task.status !== "CANCELLED"
          ? "CANCELLED"
          : dueDateChanged || scheduledStartChanged
            ? "RESCHEDULED"
            : "EDITED"
    const scheduleMutation = scheduledStartChanged
      || dueDateChanged
      || recurrenceRuleChanged
      || recurrenceIntervalChanged
      || recurrenceTimezoneChanged
    const recurrenceSettingsMutation = recurrenceRuleChanged
      || recurrenceIntervalChanged
      || recurrenceUntilChanged
      || recurrenceTimezoneChanged
    if (body.editScope !== "THIS_AND_FUTURE" && recurrenceSettingsMutation) {
      return NextResponse.json({
        error: "Recurrence settings require THIS_AND_FUTURE",
        code: "MTM_TASK_RECURRENCE_SCOPE_INVALID",
      }, { status: 400 })
    }
    if (
      body.editScope === "THIS"
      && nextRecurrenceRule
      && (scheduledStartChanged || dueDateChanged)
      && task.recurrenceCursorScheduledStartAt === null
      && task.recurrenceCursorDueDate === null
    ) {
      // Lazily normalize a legacy series before applying an isolated schedule
      // exception. The visible timestamps may move; the recurrence cursor may not.
      data.recurrenceCursorScheduledStartAt = task.scheduledStartAt
      data.recurrenceCursorDueDate = task.dueDate
    }

    const changedIds = await prisma.$transaction(async (tx) => {
      const seriesRootId = task.recurrenceParentId ?? task.id
      if (body.editScope === "THIS_AND_FUTURE" || (firstCompletion && nextRecurrenceRule)) {
        await lockMtmTaskRecurrenceSeriesInTransaction(tx, {
          organizationId: auth.orgId,
          rootTaskId: seriesRootId,
        })
      }
      const seriesRoot = body.editScope === "THIS_AND_FUTURE" && task.recurrenceParentId
        ? await tx.mtmTask.findFirst({
            where: { id: seriesRootId, organizationId: auth.orgId },
            select: {
              scheduledStartAt: true,
              dueDate: true,
              recurrenceAnchorScheduledStartAt: true,
              recurrenceAnchorDueDate: true,
              recurrenceCursorScheduledStartAt: true,
              recurrenceCursorDueDate: true,
            },
          })
        : {
            scheduledStartAt: task.scheduledStartAt,
            dueDate: task.dueDate,
            recurrenceAnchorScheduledStartAt: task.recurrenceAnchorScheduledStartAt,
            recurrenceAnchorDueDate: task.recurrenceAnchorDueDate,
            recurrenceCursorScheduledStartAt: task.recurrenceCursorScheduledStartAt,
            recurrenceCursorDueDate: task.recurrenceCursorDueDate,
          }
      if (body.editScope === "THIS_AND_FUTURE" && task.recurrenceParentId && !seriesRoot) {
        throw new Error("MTM_TASK_RECURRENCE_ROOT_UNAVAILABLE")
      }
      const seriesCandidates = body.editScope === "THIS_AND_FUTURE"
        ? await tx.mtmTask.findMany({
            where: {
              organizationId: auth.orgId,
              deletedAt: null,
              status: { notIn: ["COMPLETED", "CANCELLED"] },
              AND: [
                {
                  OR: [
                    { id: seriesRootId },
                    { recurrenceParentId: seriesRootId },
                  ],
                },
              ],
            },
            orderBy: [{ dueDate: "asc" }, { scheduledStartAt: "asc" }],
            select: {
              id: true,
              agentId: true,
              status: true,
              version: true,
              scheduledStartAt: true,
              dueDate: true,
              recurrenceAnchorScheduledStartAt: true,
              recurrenceAnchorDueDate: true,
              recurrenceCursorScheduledStartAt: true,
              recurrenceCursorDueDate: true,
            },
          })
        : [{
            id: task.id,
            agentId: task.agentId,
            status: task.status,
            version: task.version,
            scheduledStartAt: task.scheduledStartAt,
            dueDate: task.dueDate,
            recurrenceAnchorScheduledStartAt: task.recurrenceAnchorScheduledStartAt,
            recurrenceAnchorDueDate: task.recurrenceAnchorDueDate,
            recurrenceCursorScheduledStartAt: task.recurrenceCursorScheduledStartAt,
            recurrenceCursorDueDate: task.recurrenceCursorDueDate,
          }]

      const occurrenceIdentity = (candidate: typeof seriesCandidates[number]) => (
        candidate.recurrenceCursorDueDate
        ?? candidate.recurrenceCursorScheduledStartAt
        ?? candidate.dueDate
        ?? candidate.scheduledStartAt
      )
      const allFutureCandidates = body.editScope === "THIS_AND_FUTURE"
        ? seriesCandidates.filter((candidate) => (
            candidate.id === task.id
            || !seriesPivot
            || (occurrenceIdentity(candidate)?.getTime() ?? Number.NEGATIVE_INFINITY) >= seriesPivot.getTime()
          ))
        : seriesCandidates

      // A series can become split across teams after reassignment. Never
      // silently apply THIS_AND_FUTURE to only the visible subset: that would
      // leave one logical series with divergent rules and schedules.
      if (
        body.editScope === "THIS_AND_FUTURE"
        && actor.scopedAgentIds !== null
        && allFutureCandidates.some((candidate) => !actor.scopedAgentIds?.includes(candidate.agentId))
      ) {
        throw new Error("MTM_TASK_RECURRENCE_SCOPE_CONFLICT")
      }
      const candidates = allFutureCandidates

      if (body.editScope === "THIS_AND_FUTURE" && !nextRecurrenceRule && !task.recurrenceParentId && !task.recurrenceRule) {
        throw new Error("MTM_TASK_NOT_RECURRING")
      }
      if (!candidates.some((candidate) => candidate.id === task.id)) {
        throw new Error("MTM_TASK_VERSION_CONFLICT")
      }
      const activeFuture = candidates.find((candidate) => (
        candidate.id !== task.id && candidate.status !== "PENDING" && candidate.status !== "OVERDUE"
      ))
      if (activeFuture) throw new Error(`MTM_TASK_FUTURE_IN_PROGRESS:${activeFuture.id}`)
      if (!scheduleMutation && recurrenceUntilChanged && nextRecurrenceUntil && nextRecurrenceTimezone) {
        const outsideNewEnd = candidates.find((candidate) => {
          if (candidate.id === task.id) return false
          const candidateIdentity = occurrenceIdentity(candidate)
          return candidateIdentity
            ? dateInputValueInTimezone(candidateIdentity, nextRecurrenceTimezone)
              > dateInputValueInTimezone(nextRecurrenceUntil, nextRecurrenceTimezone)
            : false
        })
        if (outsideNewEnd) throw new Error(`MTM_TASK_RECURRENCE_RANGE_CONFLICT:${outsideNewEnd.id}`)
      }

      if (body.editScope === "THIS_AND_FUTURE") {
        // Bulk reassignment also mutates rows in global id order. Acquire the
        // same row-lock order up front so a series edit starting from a later
        // occurrence cannot deadlock with [earlier, later] bulk work.
        const candidateIds = candidates.map((candidate) => candidate.id).sort()
        await tx.$queryRaw`
          SELECT "id"
          FROM "mtm_tasks"
          WHERE "organizationId" = ${auth.orgId}
            AND "id" IN (${Prisma.join(candidateIds)})
          ORDER BY "id" ASC
          FOR UPDATE
        `
      }

      const ids: string[] = []
      const orderedCandidates = [
        ...candidates.filter((candidate) => candidate.id === task.id),
        ...candidates.filter((candidate) => candidate.id !== task.id).sort((left, right) => (
          occurrenceIdentity(left)?.getTime() ?? 0
        ) - (
          occurrenceIdentity(right)?.getTime() ?? 0
        )),
      ]
      const reanchorBoth = recurrenceRuleChanged || recurrenceTimezoneChanged
      const recurrenceAnchor = {
        scheduledStartAt: reanchorBoth || scheduledStartChanged
          ? nextScheduledStartAt
          : task.recurrenceAnchorScheduledStartAt
            ?? seriesRoot?.recurrenceAnchorScheduledStartAt
            ?? seriesRoot?.recurrenceCursorScheduledStartAt
            ?? seriesRoot?.scheduledStartAt
            ?? nextScheduledStartAt,
        dueDate: reanchorBoth || dueDateChanged
          ? nextDueDate
          : task.recurrenceAnchorDueDate
            ?? seriesRoot?.recurrenceAnchorDueDate
            ?? seriesRoot?.recurrenceCursorDueDate
            ?? seriesRoot?.dueDate
            ?? nextDueDate,
      }
      let recurrenceCursor = nextRecurrenceRule && nextRecurrenceTimezone && (nextScheduledStartAt || nextDueDate)
        ? {
            scheduledStartAt: nextScheduledStartAt,
            dueDate: nextDueDate,
            recurrenceRule: nextRecurrenceRule,
            recurrenceInterval: nextRecurrenceInterval ?? 1,
            recurrenceUntil: nextRecurrenceUntil,
            recurrenceTimezone: nextRecurrenceTimezone,
          }
        : null
      for (const candidate of orderedCandidates) {
        // THIS_AND_FUTURE propagates the authoring template, never factual
        // execution or one absolute timestamp to every child. Planned times
        // are expanded per occurrence from the effective tenant-local cursor.
        let shiftedOccurrence: ReturnType<typeof nextMtmTaskRecurrenceOccurrence> = null
        if (candidate.id !== task.id && scheduleMutation && recurrenceCursor) {
          shiftedOccurrence = nextMtmTaskRecurrenceOccurrence(recurrenceCursor, recurrenceAnchor)
          if (!shiftedOccurrence) throw new Error(`MTM_TASK_RECURRENCE_RANGE_CONFLICT:${candidate.id}`)
          recurrenceCursor = {
            ...recurrenceCursor,
            scheduledStartAt: shiftedOccurrence.scheduledStartAt,
            dueDate: shiftedOccurrence.dueDate,
          }
        }
        const seriesAnchorData = body.editScope === "THIS_AND_FUTURE"
          ? nextRecurrenceRule
            ? {
                recurrenceAnchorScheduledStartAt: recurrenceAnchor.scheduledStartAt,
                recurrenceAnchorDueDate: recurrenceAnchor.dueDate,
              }
            : {
                recurrenceAnchorScheduledStartAt: null,
                recurrenceAnchorDueDate: null,
              }
          : {}
        const seriesCursorData = body.editScope === "THIS_AND_FUTURE"
          ? nextRecurrenceRule
            ? {
                recurrenceCursorScheduledStartAt: candidate.id === task.id
                  ? scheduleMutation
                    ? nextScheduledStartAt
                    : task.recurrenceCursorScheduledStartAt ?? task.scheduledStartAt
                  : shiftedOccurrence?.scheduledStartAt
                    ?? candidate.recurrenceCursorScheduledStartAt
                    ?? candidate.scheduledStartAt,
                recurrenceCursorDueDate: candidate.id === task.id
                  ? scheduleMutation
                    ? nextDueDate
                    : task.recurrenceCursorDueDate ?? task.dueDate
                  : shiftedOccurrence?.dueDate
                    ?? candidate.recurrenceCursorDueDate
                    ?? candidate.dueDate,
              }
            : {
                recurrenceCursorScheduledStartAt: null,
                recurrenceCursorDueDate: null,
              }
          : {}
        const candidateData: Prisma.MtmTaskUpdateManyMutationInput = candidate.id === task.id
          ? { ...data, ...seriesAnchorData, ...seriesCursorData }
          : {
              ...seriesAnchorData,
              ...seriesCursorData,
              ...(agentChanged ? { agentId: body.agentId } : {}),
              ...(agentChanged ? { acceptedAt: null } : {}),
              ...(customerChanged ? { customerId: body.customerId } : {}),
              ...(agentChanged || customerChanged ? { visitId: null } : {}),
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.priority !== undefined ? { priority: body.priority } : {}),
              ...(body.taskGroupCode !== undefined
                ? {
                    taskGroupDictionaryId: taskGroup?.dictionaryId ?? null,
                    taskGroupCode: taskGroup?.code ?? null,
                  }
                : {}),
              ...(recurrenceSettingsMutation
                ? {
                    recurrenceRule: nextRecurrenceRule,
                    recurrenceInterval: nextRecurrenceRule ? nextRecurrenceInterval : null,
                    recurrenceUntil: nextRecurrenceRule ? nextRecurrenceUntil : null,
                    recurrenceTimezone: nextRecurrenceRule ? nextRecurrenceTimezone : null,
                  }
                : {}),
              ...(shiftedOccurrence
                ? {
                    scheduledStartAt: shiftedOccurrence.scheduledStartAt,
                    dueDate: shiftedOccurrence.dueDate,
                  }
                : {}),
            }
        const updated = await tx.mtmTask.updateMany({
          where: {
            id: candidate.id,
            organizationId: auth.orgId,
            agentId: candidate.agentId,
            status: candidate.status,
            version: candidate.id === task.id ? expectedVersion : candidate.version,
            deletedAt: null,
          },
          data: { ...candidateData, version: { increment: 1 } },
        })
        if (updated.count !== 1) throw new Error("MTM_TASK_VERSION_CONFLICT")
        await tx.mtmTaskEvent.create({
          data: {
            organizationId: auth.orgId,
            taskId: candidate.id,
            agentId: body.agentId ?? candidate.agentId,
            type: candidate.id === task.id ? eventType : shiftedOccurrence ? "RESCHEDULED" : "EDITED",
            occurredAt,
            fromStatus: candidate.status,
            toStatus: body.status ?? candidate.status,
            oldDueDate: candidate.dueDate,
            newDueDate: candidate.id === task.id
              ? body.dueDate === undefined ? candidate.dueDate : nextDueDate
              : shiftedOccurrence?.dueDate ?? candidate.dueDate,
            evidence: {
              kind: metadataMutation ? "MTM_TASK_METADATA_EDIT" : "MTM_TASK_EXECUTION",
              editScope: body.editScope,
              actorAgentId: actor.agentId,
              actorRole: actor.role,
              actorName: auth.name,
              visitUnlinked: candidate.id !== task.id && (agentChanged || customerChanged),
              acceptanceReset: agentChanged,
              progress: body.progress,
              expectedVersion: candidate.id === task.id ? expectedVersion : candidate.version,
            } as Prisma.InputJsonValue,
          },
        })
        ids.push(candidate.id)
      }
      if (firstCompletion) {
        await spawnNextMtmTaskRecurrenceInTransaction(tx, {
          organizationId: auth.orgId,
          sourceTask: {
            id: task.id,
            agentId: targetAgentId,
            customerId: targetCustomerId,
            taskGroupDictionaryId: body.taskGroupCode === undefined
              ? task.taskGroupDictionaryId
              : taskGroup?.dictionaryId ?? null,
            taskGroupCode: body.taskGroupCode === undefined
              ? task.taskGroupCode
              : taskGroup?.code ?? null,
            title: body.title ?? task.title,
            description: body.description === undefined ? task.description : body.description,
            priority: body.priority ?? task.priority,
            scheduledStartAt: nextScheduledStartAt,
            dueDate: nextDueDate,
            recurrenceRule: nextRecurrenceRule,
            recurrenceInterval: nextRecurrenceInterval,
            recurrenceUntil: nextRecurrenceUntil,
            recurrenceTimezone: nextRecurrenceTimezone,
            recurrenceAnchorScheduledStartAt: body.editScope === "THIS_AND_FUTURE" && nextRecurrenceRule
              ? recurrenceAnchor.scheduledStartAt
              : task.recurrenceAnchorScheduledStartAt,
            recurrenceAnchorDueDate: body.editScope === "THIS_AND_FUTURE" && nextRecurrenceRule
              ? recurrenceAnchor.dueDate
              : task.recurrenceAnchorDueDate,
            recurrenceCursorScheduledStartAt: body.editScope === "THIS_AND_FUTURE" && scheduleMutation
              ? nextScheduledStartAt
              : task.recurrenceCursorScheduledStartAt ?? task.scheduledStartAt,
            recurrenceCursorDueDate: body.editScope === "THIS_AND_FUTURE" && scheduleMutation
              ? nextDueDate
              : task.recurrenceCursorDueDate ?? task.dueDate,
            recurrenceParentId: task.recurrenceParentId,
          },
          tenantTimezone: settings.timezone,
          occurredAt,
        })
      }
      return ids
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: body.agentId ?? task.agentId,
      action: firstCompletion ? "TASK_COMPLETE" : "TASK_UPDATE",
      entity: "task",
      entityId: id,
      metadataKind: firstCompletion ? "task_complete" : "task_update",
      oldData: task,
      newData: { ...data, editScope: body.editScope, changedIds },
      req,
    }).catch((error) => console.warn("[MTM/tasks/[id] PUT] audit failed", error))

    return NextResponse.json({
      success: true,
      data: {
        id,
        version: expectedVersion + 1,
        changedIds,
        futureSchedulesPreserved: body.editScope === "THIS_AND_FUTURE" && scheduleMutation && !nextRecurrenceRule,
        futureSchedulesRecalculated: body.editScope === "THIS_AND_FUTURE" && scheduleMutation && Boolean(nextRecurrenceRule),
        ...data,
      },
    })
  } catch (error) {
    if (error instanceof MtmTaskGroupError) {
      return NextResponse.json({
        error: error.code === "MTM_TASK_GROUP_CATALOG_UNAVAILABLE"
          ? "No active signed task-group dictionary is available"
          : "Task group is not present in the active signed dictionary",
        code: error.code,
      }, { status: error.code === "MTM_TASK_GROUP_NOT_FOUND" ? 400 : 409 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_VERSION_CONFLICT") {
      const current = await prisma.mtmTask.findFirst({
        where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
      }).catch(() => null)
      return NextResponse.json(mtmTaskVersionConflict(current), { status: 409 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_NOT_RECURRING") {
      return NextResponse.json({ error: "THIS_AND_FUTURE requires a recurrence series", code: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_RECURRENCE_ROOT_UNAVAILABLE") {
      return NextResponse.json({ error: "The recurrence root is unavailable in this tenant", code: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_RECURRENCE_SCOPE_CONFLICT") {
      return NextResponse.json({
        error: "The future series includes assignments outside your current scope",
        code: error.message,
      }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith("MTM_TASK_FUTURE_IN_PROGRESS:")) {
      return NextResponse.json({
        error: "An in-progress future instance cannot be rewritten",
        code: "MTM_TASK_FUTURE_IN_PROGRESS",
        taskId: error.message.split(":")[1],
      }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith("MTM_TASK_RECURRENCE_RANGE_CONFLICT:")) {
      return NextResponse.json({
        error: "The recurrence end would leave an existing future instance outside the series",
        code: "MTM_TASK_RECURRENCE_RANGE_CONFLICT",
        taskId: error.message.split(":")[1],
      }, { status: 409 })
    }
    console.error("[MTM/tasks/[id] PUT]", error)
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
  }
})

export const DELETE = withRouteFieldRlsAuth<RouteContext>("delete", async (req, auth, { params }) => {
  if (auth.principal === "mobile") {
    return NextResponse.json({ error: "Mobile task deletion is forbidden", code: "MTM_TASK_MOBILE_METHOD_DENIED" }, { status: 403 })
  }

  const { id } = await params
  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  const expectedVersion = Number(new URL(req.url).searchParams.get("expectedVersion"))
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json({ error: "expectedVersion is required", code: "MTM_TASK_VERSION_REQUIRED" }, { status: 400 })
  }

  try {
    const task = await prisma.mtmTask.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
    })
    if (!task || !canViewMtmTask(actor, task)) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!isMtmTaskManager(actor)) return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_DELETE_DENIED" }, { status: 403 })
    if (mtmTaskIsTerminal(task.status)) {
      return NextResponse.json({ error: "Completed or cancelled task is immutable", code: "MTM_TASK_IMMUTABLE" }, { status: 409 })
    }
    if (task.version !== expectedVersion) return NextResponse.json(mtmTaskVersionConflict(task), { status: 409 })

    const deletedAt = new Date()
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: task.agentId,
          status: task.status,
          version: expectedVersion,
          deletedAt: null,
        },
        data: { deletedAt, version: { increment: 1 } },
      })
      if (result.count !== 1) return false
      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: id,
          agentId: task.agentId,
          type: "CANCELLED",
          occurredAt: deletedAt,
          fromStatus: task.status,
          evidence: {
            kind: "MTM_TASK_SOFT_DELETE",
            actorAgentId: actor.agentId,
            actorRole: actor.role,
            actorName: auth.name,
          } as Prisma.InputJsonValue,
        },
      })
      return true
    })
    if (!deleted) return NextResponse.json(mtmTaskVersionConflict(null), { status: 409 })
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: task.agentId,
      action: "TASK_DELETE",
      entity: "task",
      entityId: id,
      metadataKind: "task_delete",
      oldData: task,
      req,
    }).catch((error) => console.warn("[MTM/tasks/[id] DELETE] audit failed", error))

    return NextResponse.json({ success: true, data: { id, deletedAt, version: expectedVersion + 1 } })
  } catch (error) {
    console.error("[MTM/tasks/[id] DELETE]", error)
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 })
  }
})
