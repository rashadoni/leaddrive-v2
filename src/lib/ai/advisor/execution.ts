import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { z } from "zod"

type AdvisorExecutionPayload = {
  priority?: unknown
  daysSinceActivity?: unknown
  advisor?: {
    severity?: unknown
    risk?: unknown
  }
}

type AdvisorShadowActionAuditInput = {
  id: string
  featureName: string
  actionType: string
  entityType: string
  entityId: string
  riskLevel: string | null
  approved: boolean | null
  executionStatus: string | null
  reviewedBy?: string | null
  payload?: unknown
}

type AdvisorShadowActionExecutionInput = {
  id: string
  organizationId: string
  featureName: string
  actionType: string
  entityType: string
  entityId: string
  riskLevel: string | null
  payload?: unknown
}

type AdvisorEditableActionInput = {
  featureName: string
  actionType: string
  entityType: string
  entityId: string
  payload?: unknown
}

type AdvisorPayloadValidationResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string }

const compactString = z.string().trim().min(1).max(500)
const longString = z.string().trim().min(1).max(4000)
const optionalCompactString = z.string().trim().max(500).nullable().optional()

const advisorPayloadBaseSchema = {
  relatedType: compactString.optional(),
  relatedId: compactString.optional(),
  advisor: z.unknown().optional(),
}

const createTaskPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  title: compactString,
  description: longString,
  assignedTo: optionalCompactString,
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
}).passthrough()

const assignTaskPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  assignedTo: compactString,
  title: optionalCompactString,
  description: z.string().trim().max(4000).optional(),
}).passthrough()

const alertPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  title: compactString,
  description: longString.optional(),
  message: longString.optional(),
  priority: z.enum(["low", "medium", "high", "urgent", "critical"]).optional(),
}).refine((payload) => payload.description || payload.message, {
  message: "description or message is required",
}).passthrough()

const notePayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  subject: compactString,
  description: longString.optional(),
  body: longString.optional(),
}).refine((payload) => payload.description || payload.body, {
  message: "description or body is required",
}).passthrough()

const followupPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  subject: compactString,
  body: longString,
}).passthrough()

const taskMessagePayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  title: compactString,
  description: longString.optional(),
  message: longString.optional(),
}).refine((payload) => payload.description || payload.message, {
  message: "description or message is required",
}).passthrough()

const budgetPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  title: compactString,
  description: longString.optional(),
  reasoning: longString.optional(),
}).refine((payload) => payload.description || payload.reasoning, {
  message: "description or reasoning is required",
}).passthrough()

const assignedTaskPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  title: compactString,
  description: longString,
  assignedTo: optionalCompactString,
}).passthrough()

const assignedMessageTaskPayloadSchema = z.object({
  ...advisorPayloadBaseSchema,
  title: compactString,
  description: longString.optional(),
  message: longString.optional(),
  assignedTo: optionalCompactString,
}).refine((payload) => payload.description || payload.message, {
  message: "description or message is required",
}).passthrough()

const advisorActionPayloadSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  create_task: createTaskPayloadSchema,
  create_followup_task: createTaskPayloadSchema,
  quote_reminder: createTaskPayloadSchema,
  unblock_task: createTaskPayloadSchema,
  escalate_overdue_task: createTaskPayloadSchema,
  bill_payment_escalation: createTaskPayloadSchema,
  missed_visit_task: createTaskPayloadSchema,
  coaching_task: createTaskPayloadSchema,
  assign_task: assignTaskPayloadSchema,
  assign_owner: assignTaskPayloadSchema,
  assign_ticket_owner: assignTaskPayloadSchema,
  create_alert: alertPayloadSchema,
  stage_alert: alertPayloadSchema,
  priority_update: alertPayloadSchema,
  create_note: notePayloadSchema,
  update_health_note: notePayloadSchema,
  draft_followup: followupPayloadSchema,
  invoice_reminder: taskMessagePayloadSchema,
  flag_route_issue: taskMessagePayloadSchema,
  route_issue: taskMessagePayloadSchema,
  suggest_budget_change: budgetPayloadSchema,
  contract_review: assignedTaskPayloadSchema,
  approval_escalation: assignedTaskPayloadSchema,
  signature_reminder: assignedTaskPayloadSchema,
  campaign_review: assignedTaskPayloadSchema,
  segment_review_task: assignedTaskPayloadSchema,
  support_escalation: assignedMessageTaskPayloadSchema,
  kpi_plan_review: assignedTaskPayloadSchema,
}

const advisorExecutorAliases: Record<string, string> = {
  create_followup_task: "create_task",
  quote_reminder: "create_task",
  unblock_task: "create_task",
  escalate_overdue_task: "create_task",
  bill_payment_escalation: "create_task",
  missed_visit_task: "create_task",
  coaching_task: "create_task",
  stage_alert: "create_alert",
  update_health_note: "create_note",
  route_issue: "flag_route_issue",
  approval_escalation: "contract_review",
  signature_reminder: "contract_review",
  segment_review_task: "campaign_review",
}

function advisorExecutorActionType(actionType: string): string {
  return advisorExecutorAliases[actionType] || actionType
}

export function advisorTaskPriority(riskLevel: string | null | undefined, payload: AdvisorExecutionPayload): "low" | "medium" | "high" | "urgent" {
  if (payload.priority === "low" || payload.priority === "medium" || payload.priority === "high" || payload.priority === "urgent") {
    return payload.priority
  }

  const severity = typeof payload.advisor?.severity === "string" ? payload.advisor.severity : ""
  const advisorRisk = typeof payload.advisor?.risk === "string" ? payload.advisor.risk : ""
  const daysSinceActivity = typeof payload.daysSinceActivity === "number" ? payload.daysSinceActivity : 0

  if (severity === "critical" || riskLevel === "dangerous") return "urgent"
  if (severity === "high" || advisorRisk === "high" || riskLevel === "high" || daysSinceActivity > 14) return "high"
  if (riskLevel === "low" || advisorRisk === "low") return "low"
  return "medium"
}

export function advisorAlertNotificationType(riskLevel: string | null | undefined, payload: AdvisorExecutionPayload): "info" | "warning" {
  const severity = typeof payload.advisor?.severity === "string" ? payload.advisor.severity : ""
  const advisorRisk = typeof payload.advisor?.risk === "string" ? payload.advisor.risk : ""
  if (severity === "critical" || severity === "high" || riskLevel === "high" || riskLevel === "dangerous" || advisorRisk === "high") {
    return "warning"
  }
  return "info"
}

export function advisorTicketPriority(riskLevel: string | null | undefined, payload: AdvisorExecutionPayload): "low" | "medium" | "high" | "urgent" | "critical" {
  if (payload.priority === "low" || payload.priority === "medium" || payload.priority === "high" || payload.priority === "urgent" || payload.priority === "critical") {
    return payload.priority
  }

  const severity = typeof payload.advisor?.severity === "string" ? payload.advisor.severity : ""
  const advisorRisk = typeof payload.advisor?.risk === "string" ? payload.advisor.risk : ""
  if (severity === "critical" || riskLevel === "dangerous") return "critical"
  if (severity === "high" || advisorRisk === "high" || riskLevel === "high") return "urgent"
  if (riskLevel === "low" || advisorRisk === "low") return "medium"
  return "high"
}

export async function executeAdvisorShadowAction(action: AdvisorShadowActionExecutionInput, now: Date): Promise<boolean> {
  if (!isAdvisorShadowAction(action)) return false

  const payload = isAdvisorEditablePayload(action.payload) ? action.payload : {}
  const target = advisorActionTarget(payload, action)
  const title = payloadString(payload.title, "Advisor action")
  const description = payloadString(payload.description || payload.message || payload.body || payload.reasoning, "Advisor recommended this follow-up.")
  const executorType = advisorExecutorActionType(action.actionType)

  switch (executorType) {
    case "create_task":
    case "invoice_reminder":
    case "flag_route_issue":
    case "contract_review":
    case "campaign_review":
    case "kpi_plan_review": {
      await createAdvisorTask({
        organizationId: action.organizationId,
        title,
        description,
        assignedTo: payloadStringOrNull(payload.assignedTo),
        dueDate: new Date(now.getTime() + dueDaysForAdvisorAction(executorType) * 86_400_000),
        priority: advisorTaskPriority(action.riskLevel, payload),
        relatedType: target.entityType,
        relatedId: target.entityId,
        now,
      })
      return true
    }
    case "support_escalation": {
      await createAdvisorTask({
        organizationId: action.organizationId,
        title,
        description,
        assignedTo: await findAdvisorTaskOwner(action.organizationId, ["admin", "manager", "support"], payloadStringOrNull(payload.assignedTo)),
        dueDate: new Date(now.getTime() + 86_400_000),
        priority: advisorTaskPriority(action.riskLevel || "high", payload),
        relatedType: target.entityType,
        relatedId: target.entityId,
        now,
      })
      const recipients = await prisma.user.findMany({
        where: {
          organizationId: action.organizationId,
          role: { in: ["admin", "manager", "support"] },
          isActive: true,
        },
        select: { id: true },
        take: 5,
      })
      for (const recipient of recipients) {
        await createNotification({
          organizationId: action.organizationId,
          userId: recipient.id,
          type: "warning",
          title,
          message: description,
          entityType: target.entityType,
          entityId: target.entityId,
        })
      }
      return true
    }
    case "assign_task": {
      const assignedTo = payloadStringOrNull(payload.assignedTo)
      if (!assignedTo) throw new Error("assignedTo is required for assign_task")
      await prisma.task.updateMany({
        where: { id: target.entityId, organizationId: action.organizationId },
        data: { assignedTo },
      })
      return true
    }
    case "assign_owner": {
      const assignedTo = payloadStringOrNull(payload.assignedTo)
      if (!assignedTo) throw new Error("assignedTo is required for assign_owner")
      const updated = await updateAdvisorOwnerAssignment(action.organizationId, target.entityType, target.entityId, assignedTo)
      if (!updated) {
        await createAdvisorTask({
          organizationId: action.organizationId,
          title: payloadString(payload.title, `Assign owner for ${target.entityType}`),
          description,
          assignedTo,
          dueDate: new Date(now.getTime() + 86_400_000),
          priority: advisorTaskPriority(action.riskLevel, payload),
          relatedType: target.entityType,
          relatedId: target.entityId,
          now,
        })
      }
      return true
    }
    case "assign_ticket_owner": {
      const assignedTo = payloadStringOrNull(payload.assignedTo)
      if (!assignedTo) throw new Error("assignedTo is required for assign_ticket_owner")
      await prisma.ticket.updateMany({
        where: { id: target.entityId, organizationId: action.organizationId },
        data: { assignedTo },
      })
      return true
    }
    case "priority_update": {
      await prisma.ticket.updateMany({
        where: { id: target.entityId, organizationId: action.organizationId },
        data: { priority: advisorTicketPriority(action.riskLevel, payload) },
      })
      const recipients = await prisma.user.findMany({
        where: {
          organizationId: action.organizationId,
          role: { in: ["admin", "manager", "support"] },
          isActive: true,
        },
        select: { id: true },
        take: 5,
      })
      for (const recipient of recipients) {
        await createNotification({
          organizationId: action.organizationId,
          userId: recipient.id,
          type: advisorAlertNotificationType(action.riskLevel, payload),
          title,
          message: description,
          entityType: target.entityType,
          entityId: target.entityId,
        })
      }
      return true
    }
    case "create_alert": {
      const recipients = await prisma.user.findMany({
        where: {
          organizationId: action.organizationId,
          role: { in: ["admin", "manager", "sales", "support"] },
          isActive: true,
        },
        select: { id: true },
        take: 5,
      })
      for (const recipient of recipients) {
        await createNotification({
          organizationId: action.organizationId,
          userId: recipient.id,
          type: advisorAlertNotificationType(action.riskLevel, payload),
          title,
          message: description,
          entityType: target.entityType,
          entityId: target.entityId,
        })
      }
      return true
    }
    case "create_note": {
      await createAdvisorNote({
        organizationId: action.organizationId,
        subject: payloadString(payload.subject, "Advisor note"),
        description,
        relatedType: target.entityType,
        relatedId: target.entityId,
        now,
      })
      return true
    }
    case "draft_followup": {
      await createAdvisorTask({
        organizationId: action.organizationId,
        title: `Draft follow-up: ${payloadString(payload.subject, action.entityId).slice(0, 160)}`,
        description: `Subject: ${payloadString(payload.subject, "")}\n\nDraft:\n${payloadString(payload.body, "")}`,
        assignedTo: await findAdvisorTaskOwner(action.organizationId, ["admin", "manager", "sales"], payloadStringOrNull(payload.assignedTo)),
        dueDate: new Date(now.getTime() + 86_400_000),
        priority: "medium",
        relatedType: target.entityType,
        relatedId: target.entityId,
        now,
      })
      return true
    }
    case "suggest_budget_change": {
      await createAdvisorTask({
        organizationId: action.organizationId,
        title: payloadString(payload.title, "Review campaign budget").slice(0, 180),
        description,
        assignedTo: await findAdvisorTaskOwner(action.organizationId, ["admin", "manager", "marketing"], payloadStringOrNull(payload.assignedTo)),
        dueDate: new Date(now.getTime() + 2 * 86_400_000),
        priority: "medium",
        relatedType: target.entityType,
        relatedId: target.entityId,
        now,
      })
      return true
    }
    default:
      throw new Error(`Unsupported Advisor action type: ${action.actionType}`)
  }
}

export function isAdvisorEditablePayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function validateAdvisorEditedPayload(action: AdvisorEditableActionInput, editedPayload: unknown): AdvisorPayloadValidationResult {
  if (!isAdvisorEditablePayload(editedPayload)) {
    return { ok: false, error: "editedPayload must be an object" }
  }
  if (!isAdvisorShadowAction(action)) {
    return { ok: true, payload: editedPayload }
  }

  const schema = advisorActionPayloadSchemas[action.actionType]
  if (!schema) {
    return { ok: false, error: `Unsupported Advisor action type: ${action.actionType}` }
  }

  const parsed = schema.safeParse(editedPayload)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Invalid Advisor action payload" }
  }

  const originalTarget = advisorActionTarget(action.payload, action)
  const editedTarget = advisorActionTarget(parsed.data, action)
  if (editedTarget.entityType !== originalTarget.entityType || editedTarget.entityId !== originalTarget.entityId) {
    return { ok: false, error: "Advisor action target cannot be changed" }
  }

  return { ok: true, payload: parsed.data }
}

function isAdvisorShadowAction(action: AdvisorEditableActionInput): boolean {
  if (action.featureName === "advisor_signal" || action.featureName === "advisor_signals") return true
  const payload = action.payload
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && "advisor" in payload)
}

function payloadString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function payloadStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function dueDaysForAdvisorAction(actionType: string): number {
  if (actionType === "draft_followup" || actionType === "invoice_reminder") return 1
  if (actionType === "flag_route_issue") return 1
  return 2
}

async function findAdvisorTaskOwner(organizationId: string, roles: string[], explicitOwner?: string | null): Promise<string | null> {
  if (explicitOwner) return explicitOwner
  const owners = await prisma.user.findMany({
    where: { organizationId, role: { in: roles }, isActive: true },
    select: { id: true },
    take: 1,
  })
  return owners[0]?.id || null
}

async function updateAdvisorOwnerAssignment(organizationId: string, entityType: string, entityId: string, assignedTo: string): Promise<boolean> {
  switch (entityType) {
    case "deal":
      await prisma.deal.updateMany({
        where: { id: entityId, organizationId },
        data: { assignedTo },
      })
      return true
    case "lead":
      await prisma.lead.updateMany({
        where: { id: entityId, organizationId },
        data: { assignedTo },
      })
      return true
    case "task":
      await prisma.task.updateMany({
        where: { id: entityId, organizationId },
        data: { assignedTo },
      })
      return true
    case "ticket":
      await prisma.ticket.updateMany({
        where: { id: entityId, organizationId },
        data: { assignedTo },
      })
      return true
    default:
      return false
  }
}

async function createAdvisorTask(input: {
  organizationId: string
  title: string
  description: string
  assignedTo?: string | null
  dueDate: Date
  priority: "low" | "medium" | "high" | "urgent"
  relatedType: string
  relatedId: string
  now: Date
}) {
  const existing = await prisma.task.findFirst({
    where: {
      organizationId: input.organizationId,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      title: input.title,
      createdAt: { gte: new Date(input.now.getTime() - 7 * 86_400_000) },
    },
  })
  if (existing) return
  await prisma.task.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      assignedTo: input.assignedTo || null,
      dueDate: input.dueDate,
      priority: input.priority,
      status: "pending",
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      createdBy: null,
    },
  })
}

async function createAdvisorNote(input: {
  organizationId: string
  subject: string
  description: string
  relatedType: string
  relatedId: string
  now: Date
}) {
  const subject = input.subject.slice(0, 200)
  const existing = await prisma.activity.findFirst({
    where: {
      organizationId: input.organizationId,
      type: "note",
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      subject,
      createdAt: { gte: new Date(input.now.getTime() - 7 * 86_400_000) },
    },
  })
  if (existing) return
  await prisma.activity.create({
    data: {
      organizationId: input.organizationId,
      type: "note",
      subject,
      description: input.description,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      createdBy: null,
    },
  })
}

function advisorActionTarget(payload: unknown, fallback: Pick<AdvisorEditableActionInput, "entityType" | "entityId">) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    return {
      entityType: typeof record.relatedType === "string" && record.relatedType.trim() ? record.relatedType.trim() : fallback.entityType,
      entityId: typeof record.relatedId === "string" && record.relatedId.trim() ? record.relatedId.trim() : fallback.entityId,
    }
  }
  return { entityType: fallback.entityType, entityId: fallback.entityId }
}

export function advisorShadowActionAuditName(action: Pick<AdvisorShadowActionAuditInput, "actionType" | "entityId" | "payload">) {
  const payload = action.payload
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const advisor = record.advisor
    if (advisor && typeof advisor === "object" && !Array.isArray(advisor)) {
      const title = (advisor as Record<string, unknown>).title
      if (typeof title === "string" && title.trim()) return title
    }
    for (const key of ["title", "subject", "leadName", "dealName", "ticketNumber", "invoiceNumber"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value
    }
  }
  return `${action.actionType}:${action.entityId}`
}

export function advisorShadowExecutionAuditValue(
  action: AdvisorShadowActionAuditInput,
  executionStatus: "executing" | "executed" | "failed",
  extras: Record<string, unknown> = {},
) {
  return {
    shadowActionId: action.id,
    featureName: action.featureName,
    actionType: action.actionType,
    target: { entityType: action.entityType, entityId: action.entityId },
    riskLevel: action.riskLevel,
    approved: action.approved,
    previousExecutionStatus: action.executionStatus,
    executionStatus,
    reviewerId: action.reviewedBy || "system",
    ...extras,
  }
}

export async function claimAdvisorShadowActionForExecution(action: {
  id: string
  organizationId: string
  approved: boolean | null
  executedAt: Date | null
  executionStatus: string | null
}): Promise<boolean> {
  if (action.approved !== true || action.executedAt) return false

  const claimed = await prisma.aiShadowAction.updateMany({
    where: {
      id: action.id,
      organizationId: action.organizationId,
      approved: true,
      executedAt: null,
      executionStatus: { in: ["queued", "approved", "pending"] },
    },
    data: {
      executionStatus: "executing",
      failureReason: null,
    },
  })

  return claimed.count === 1
}
