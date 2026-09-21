import type { Contact, Deal, Lead, Pipeline, PipelineStage, Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireFieldPermissions } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { triggerSurveysOnLeadConverted } from "@/lib/survey-triggers"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { notFoundError, staleWriteError, validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import {
  convertLeadToDealCommandSchema,
  type ConvertLeadToDealCommandInput,
} from "../schemas/lead"
import { dispatchDealCreatedEffects } from "../deal/effects"

const OMNICHANNEL_LEAD_SOURCES = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "telegram",
  "vkontakte",
  "vk",
  "whatsapp",
  "web-chat",
  "webchat",
])

type ResolvedPipeline = Pipeline & { stages: PipelineStage[] }

export interface ConvertLeadToDealCommandResult {
  company: { id: string } | null
  contact: Contact
  deal: Deal
  pipeline: { id: string; name: string } | null
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid lead conversion"
}

function isOmnichannelLeadSource(source: string | null | undefined): boolean {
  return OMNICHANNEL_LEAD_SOURCES.has(
    (source || "").trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-"),
  )
}

function requireVoiceVersion(
  actor: CrmCommandActorContext,
  input: ConvertLeadToDealCommandInput,
): void {
  if (actor.source === "voice" && !input.expectedUpdatedAt) {
    throw validationError("expectedUpdatedAt is required for voice conversion")
  }
}

function requireDealFieldsWritable(
  input: ConvertLeadToDealCommandInput,
  permissions: Record<string, string>,
  role: string,
): void {
  const requestedDealFields: Record<string, unknown> = { name: input.dealTitle }
  if (input.dealStage !== undefined) requestedDealFields.stage = input.dealStage
  if (input.dealValue !== undefined) requestedDealFields.valueAmount = input.dealValue
  if (input.pipelineId !== undefined) requestedDealFields.pipelineId = input.pipelineId
  requireWritableFields(requestedDealFields, permissions, role)
}

async function findPipeline(
  tx: Prisma.TransactionClient,
  where: Prisma.PipelineWhereInput,
): Promise<ResolvedPipeline | null> {
  return tx.pipeline.findFirst({
    where,
    include: {
      stages: {
        where: { isActive: true, isWon: false, isLost: false },
        orderBy: { sortOrder: "asc" },
      },
    },
  })
}

async function resolvePipeline(
  tx: Prisma.TransactionClient,
  orgId: string,
  lead: Lead,
  input: ConvertLeadToDealCommandInput,
): Promise<ResolvedPipeline | null> {
  const linkedInboxMessage = await tx.channelMessage.findFirst({
    where: { organizationId: orgId, leadId: lead.id },
    select: { id: true },
  })
  const isOmnichannelLead = Boolean(linkedInboxMessage) || isOmnichannelLeadSource(lead.source)

  let pipeline = isOmnichannelLead
    ? await findPipeline(tx, {
        organizationId: orgId,
        isActive: true,
        name: { equals: "SMM", mode: "insensitive" },
      })
    : null

  const selectedPipelineId = input.pipelineId || lead.pipelineId
  if (!pipeline && selectedPipelineId) {
    pipeline = await findPipeline(tx, {
      id: selectedPipelineId,
      organizationId: orgId,
      isActive: true,
    })
    if (!pipeline) throw validationError("Invalid pipelineId")
  }

  if (!pipeline) {
    pipeline = await findPipeline(tx, {
      organizationId: orgId,
      isDefault: true,
      isActive: true,
    })
  }

  return pipeline
}

function resolveConversionStage(
  pipeline: ResolvedPipeline | null,
  requestedStage: string | undefined,
): PipelineStage | null {
  if (requestedStage && pipeline) {
    const stage = pipeline.stages.find((candidate) => candidate.name === requestedStage)
    if (!stage) throw validationError("Invalid dealStage for pipeline")
    return stage
  }
  return pipeline?.stages[Math.min(1, Math.max(0, pipeline.stages.length - 1))] ?? null
}

function dispatchLeadConvertedEffects(
  organizationId: string,
  actorUserId: string | null,
  lead: Lead,
  result: ConvertLeadToDealCommandResult,
): void {
  logAudit(organizationId, "convert", "lead", lead.id, lead.contactName, {
    newValue: { status: "converted", dealId: result.deal.id, contactId: result.contact.id },
    userId: actorUserId ?? undefined,
  })
  executeWorkflows(organizationId, "lead", "status_changed", lead).catch(() => {})
  createNotification({
    organizationId,
    type: "success",
    title: "Лид конвертирован!",
    message: `Лид «${lead.contactName}» преобразован в сделку «${result.deal.name}»`,
    entityType: "lead",
    entityId: lead.id,
  }).catch(() => {})
  fireWebhooks(organizationId, "lead.converted", {
    id: lead.id,
    contactName: lead.contactName,
    dealId: result.deal.id,
    contactId: result.contact.id,
    companyId: result.company?.id ?? null,
  }).catch(() => {})
  triggerSurveysOnLeadConverted(organizationId, result.contact.id).catch((error) =>
    console.error("[convertLeadToDealCommand] survey trigger failed:", error),
  )
}

export async function convertLeadToDealCommand(
  actor: CrmCommandActorContext,
  leadId: string,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<ConvertLeadToDealCommandResult> {
  const parsed = convertLeadToDealCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))
  requireVoiceVersion(actor, parsed.data)

  const { organizationId: orgId, userId, role } = actor
  const fieldPermissions = await requireFieldPermissions(orgId, role, "deal")
  requireDealFieldsWritable(parsed.data, fieldPermissions, role)

  const visibleWhere = await applyRecordFilter(orgId, userId ?? "", role, "lead", {
    id: leadId,
    organizationId: orgId,
  })

  const executeConversion = async (tx: Prisma.TransactionClient) => {
    const lead = await tx.lead.findFirst({ where: visibleWhere })
    if (!lead) throw notFoundError("Lead not found")
    if (lead.status === "converted") throw validationError("Lead already converted")

    if (parsed.data.expectedUpdatedAt) {
      const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt)
      if (lead.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw staleWriteError()
    }

    if (lead.assignedTo) {
      const assignee = await tx.user.findFirst({
        where: { id: lead.assignedTo, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!assignee) {
        throw validationError("Lead assignee must be an active member of this organization")
      }
    }

    const pipeline = await resolvePipeline(tx, orgId, lead, parsed.data)
    const conversionStage = resolveConversionStage(pipeline, parsed.data.dealStage)
    const convertedAt = new Date()
    const claimed = await tx.lead.updateMany({
      where: {
        AND: [
          visibleWhere,
          { updatedAt: lead.updatedAt },
          { status: { not: "converted" } },
        ],
      },
      data: { status: "converted", convertedAt },
    })
    if (claimed.count !== 1) {
      const currentLead = await tx.lead.findFirst({
        where: { id: leadId, organizationId: orgId },
        select: { status: true },
      })
      if (!currentLead) throw notFoundError("Lead not found")
      if (currentLead.status === "converted") throw validationError("Lead already converted")
      throw staleWriteError()
    }

    let companyId: string | undefined
    if (lead.companyName && parsed.data.createCompany !== false) {
      const company = await tx.company.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: lead.companyName, mode: "insensitive" },
        },
        select: { id: true },
      }) ?? await tx.company.create({
        data: { organizationId: orgId, name: lead.companyName, status: "active" },
        select: { id: true },
      })
      companyId = company.id
    }

    const existingContact = lead.email || lead.phone
      ? await tx.contact.findFirst({
          where: {
            organizationId: orgId,
            OR: [
              ...(lead.email ? [{ email: { equals: lead.email, mode: "insensitive" as const } }] : []),
              ...(lead.phone ? [{ phone: lead.phone }] : []),
            ],
          },
        })
      : null
    const contact = existingContact ?? await tx.contact.create({
      data: {
        organizationId: orgId,
        fullName: lead.contactName,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        source: lead.source || undefined,
        companyId,
      },
    })
    if (existingContact && companyId && !existingContact.companyId) {
      await tx.contact.update({
        where: { id: existingContact.id },
        data: { companyId },
      })
    }

    const deal = await tx.deal.create({
      data: {
        organizationId: orgId,
        name: parsed.data.dealTitle,
        stage: conversionStage?.name || parsed.data.dealStage || "QUALIFIED",
        valueAmount: parsed.data.dealValue ?? lead.estimatedValue ?? 0,
        contactId: contact.id,
        companyId,
        pipelineId: pipeline?.id ?? null,
        probability: conversionStage?.probability ?? 25,
        customerNeed: lead.interest || lead.notes || null,
        assignedTo: lead.assignedTo || userId,
      },
    })
    const convertedLead = await tx.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
    })
    if (!convertedLead) throw notFoundError("Lead not found")

    return {
      result: {
        company: companyId ? { id: companyId } : null,
        contact,
        deal,
        pipeline: pipeline ? { id: pipeline.id, name: pipeline.name } : null,
      },
      convertedLead,
    }
  }
  const transactionResult = execution?.transaction
    ? await executeConversion(execution.transaction)
    : await prisma.$transaction(executeConversion)

  dispatchOrDeferCommandEffects(execution, () => {
    dispatchDealCreatedEffects(orgId, transactionResult.result.deal)
    dispatchLeadConvertedEffects(
      orgId,
      userId,
      transactionResult.convertedLead,
      transactionResult.result,
    )
  })
  return transactionResult.result
}
