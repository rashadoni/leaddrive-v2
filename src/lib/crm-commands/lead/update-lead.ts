import type { Lead } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireFieldPermissions } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { fireWebhooks } from "@/lib/webhooks"
import { createNotification } from "@/lib/notifications"
import {
  normalizeLeadReportedCustomerStages,
  setLeadReportedCustomerStages,
} from "@/lib/inbox/customer-stage"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { CrmCommandError, notFoundError, staleWriteError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { updateLeadCommandSchema, type UpdateLeadCommandInput } from "../schemas/lead"

const VOICE_UPDATE_FIELDS = new Set([
  "contactName",
  "companyName",
  "email",
  "phone",
  "phoneWhatsApp",
  "telegramHandle",
  "sourceDetail",
  "interest",
  "brand",
  "category",
  "status",
  "priority",
  "estimatedValue",
  "notes",
  "assignedTo",
  "pipelineId",
])

export interface UpdateLeadCommandResult {
  entity: Lead
  meta: { inboxConversationsUpdated: number }
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid lead update"
}

function enforceVoiceContract(input: UpdateLeadCommandInput): void {
  if (!input.expectedUpdatedAt) {
    throw validationError("expectedUpdatedAt is required for voice updates")
  }
  const forbiddenFields = Object.keys(input).filter((field) =>
    field !== "expectedUpdatedAt" && !VOICE_UPDATE_FIELDS.has(field),
  )
  if (forbiddenFields.length > 0) {
    throw new CrmCommandError(
      "FORBIDDEN_FIELD",
      `Fields are not available to voice updates: ${forbiddenFields.join(", ")}`,
      403,
      { fields: forbiddenFields },
    )
  }
  if (input.priority && !["low", "medium", "high"].includes(input.priority)) {
    throw validationError("Invalid lead priority")
  }
  // A voice caller may move a lead along its status, but not to `converted`.
  // That word promises a deal, and only convertLeadToDealCommand creates one
  // — in the same transaction that claims the lead. Allowing the shortcut
  // would leave converted leads with nothing to show for it.
  if (input.status !== undefined) {
    if (input.status === "converted") {
      throw new CrmCommandError(
        "CONVERSION_REQUIRES_COMMAND",
        "Converting a lead must go through the lead conversion action",
        403,
      )
    }
    if (!["new", "contacted", "qualified", "lost"].includes(input.status)) {
      throw validationError("Invalid lead status")
    }
  }
}

function qualificationError(error: unknown): never {
  if (!(error instanceof Error)) throw error
  if (error.message === "phone-required") {
    throw new CrmCommandError(
      "VALIDATION_FAILED",
      "Phone number is required for the potential customer stage",
      400,
      { publicCode: "phone_required" },
    )
  }
  if (error.message === "lead-not-found") throw notFoundError("Not found")
  if (error.message === "sales-assignee-required") {
    throw new CrmCommandError(
      "FORBIDDEN",
      "Only the assigned salesperson can update the lead qualification",
      403,
      { publicCode: "sales_assignee_required" },
    )
  }
  if (error.message === "conflicting-call-outcomes") {
    throw new CrmCommandError(
      "VALIDATION_FAILED",
      "Choose at least one compatible qualification signal",
      400,
      { publicCode: "conflicting_call_outcomes" },
    )
  }
  throw error
}

export async function updateLeadCommand(
  actor: CrmCommandActorContext,
  leadId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<UpdateLeadCommandResult> {
  const parsed = updateLeadCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))
  if (actor.source === "voice") enforceVoiceContract(parsed.data)

  const { organizationId: orgId, userId, role } = actor
  const db = execution?.transaction ?? prisma
  const { expectedUpdatedAt, ...requestedData } = parsed.data
  const fieldPermissions = await requireFieldPermissions(orgId, role, "lead")
  const input = requireWritableFields(
    requestedData as Record<string, unknown>,
    fieldPermissions,
    role,
  ) as Omit<UpdateLeadCommandInput, "expectedUpdatedAt">

  const visibleWhere = await applyRecordFilter(orgId, userId ?? "", role, "lead", {
    id: leadId,
    organizationId: orgId,
  })
  const visibleLead = await db.lead.findFirst({
    where: visibleWhere,
    select: { id: true, updatedAt: true },
  })
  if (!visibleLead) throw notFoundError("Not found")

  const expectedDate = expectedUpdatedAt ? new Date(expectedUpdatedAt) : null
  if (
    expectedDate
    && (!(visibleLead.updatedAt instanceof Date)
      || visibleLead.updatedAt.getTime() !== expectedDate.getTime())
  ) {
    throw staleWriteError()
  }

  if (input.assignedTo) {
    const assignee = await db.user.findFirst({
      where: { id: input.assignedTo, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!assignee) throw validationError("Assignee must be an active member of this organization")
  }
  if (input.pipelineId) {
    const pipeline = await db.pipeline.findFirst({
      where: { id: input.pipelineId, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!pipeline) throw validationError("Invalid pipelineId")
  }

  const requestedOutcomes = input.salesCallOutcomes
    ?? (input.customerStage ? [input.customerStage] : undefined)
  if (requestedOutcomes !== undefined) {
    requireWritableFields(
      { customerStage: requestedOutcomes[0] },
      fieldPermissions,
      role,
    )
  }

  const regularWritableData = { ...input }
  delete regularWritableData.customerStage
  delete regularWritableData.salesCallOutcomes
  delete regularWritableData.customerStageReason

  let updatedCount = 0
  if (Object.keys(regularWritableData).length > 0) {
    const mutationWhere = expectedDate
      ? { AND: [visibleWhere, { updatedAt: expectedDate }] }
      : visibleWhere
    const result = await db.lead.updateMany({
      where: mutationWhere,
      data: regularWritableData,
    })
    updatedCount = result.count
    if (result.count === 0) {
      if (expectedDate) throw staleWriteError()
      throw notFoundError("Not found")
    }
  }

  let conversationsUpdated = 0
  if (requestedOutcomes) {
    if (execution?.transaction) {
      throw new TypeError("Transactional voice updates cannot mutate lead qualification stages")
    }
    try {
      const stageResult = await setLeadReportedCustomerStages(prisma, {
        organizationId: orgId,
        leadId,
        stages: normalizeLeadReportedCustomerStages(requestedOutcomes),
        changedBy: userId ?? "",
        canOverrideAssignee: ["admin", "manager", "superadmin"].includes(role),
        reason: input.customerStageReason,
      })
      conversationsUpdated = stageResult.conversationsUpdated
      updatedCount = 1
    } catch (error) {
      qualificationError(error)
    }
  }
  if (updatedCount === 0) throw validationError("No writable fields")

  const updated = await db.lead.findFirst({ where: { id: leadId, organizationId: orgId } })
  if (!updated) throw notFoundError("Not found")

  const dispatchEffects = () => {
    logAudit(orgId, "update", "lead", leadId, updated.contactName, {
      newValue: input,
      userId: userId ?? undefined,
    })
    const triggerEvent = input.status ? "status_changed" : "updated"
    executeWorkflows(orgId, "lead", triggerEvent, updated).catch(() => {})

    if (
      Object.prototype.hasOwnProperty.call(regularWritableData, "assignedTo")
      && updated.assignedTo
      && updated.assignedTo !== userId
    ) {
      createNotification({
        organizationId: orgId,
        userId: updated.assignedTo,
        type: "info",
        title: "Вам назначен лид",
        message: `«${updated.contactName}»${updated.companyName ? ` (${updated.companyName})` : ""}`,
        entityType: "lead",
        entityId: leadId,
        push: true,
        email: true,
      }).catch(() => {})
    }

    if (input.status) {
      createNotification({
        organizationId: orgId,
        type: input.status === "converted" ? "success" : input.status === "lost" ? "warning" : "info",
        title: input.status === "converted" ? "Лид конвертирован!" : "Смена статуса лида",
        message: `Лид «${updated.contactName}»: статус → ${input.status}`,
        entityType: "lead",
        entityId: leadId,
      }).catch(() => {})
    }
    fireWebhooks(orgId, "lead.updated", {
      id: updated.id,
      contactName: updated.contactName,
    }).catch(() => {})
  }
  if (execution?.transaction) {
    dispatchOrDeferCommandEffects(execution, async () => {
      await scoreLeadNow(orgId, leadId)
      dispatchEffects()
    })
  } else {
    await scoreLeadNow(orgId, leadId)
    dispatchEffects()
  }

  return {
    entity: updated,
    meta: { inboxConversationsUpdated: conversationsUpdated },
  }
}
