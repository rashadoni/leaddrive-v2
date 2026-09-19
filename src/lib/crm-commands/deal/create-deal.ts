import type { Deal } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { getFieldPermissions } from "@/lib/field-filter"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { trackContactEvent } from "@/lib/contact-events"
import { sendSlackNotification, formatDealNotification } from "@/lib/slack"
import { decimalToNumber } from "@/lib/prisma-decimal"
import type { CrmCommandActorContext } from "../actor-context"
import { validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { createDealCommandSchema, type CreateDealCommandInput } from "../schemas/deal"

export type CreatedDealEntity = Omit<Deal, "valueAmount"> & {
  valueAmount: number
  company: { id: string; name: string } | null
  campaign: { id: string; name: string } | null
}

export interface DealDuplicateCandidate {
  id: string
  name: string
  companyId: string | null
  contactId: string | null
  stage: string
  valueAmount: number
  currency: string
}

export interface CreateDealCommandResult {
  entity: CreatedDealEntity
  warnings: Array<{
    code: "POSSIBLE_DUPLICATE"
    candidates: DealDuplicateCandidate[]
  }>
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid deal"
}

async function findDuplicateCandidates(
  organizationId: string,
  input: CreateDealCommandInput,
): Promise<DealDuplicateCandidate[]> {
  const candidates = await prisma.deal.findMany({
    where: {
      organizationId,
      name: { equals: input.name, mode: "insensitive" },
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.contactId ? { contactId: input.contactId } : {}),
    },
    select: {
      id: true,
      name: true,
      companyId: true,
      contactId: true,
      stage: true,
      valueAmount: true,
      currency: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  })
  return candidates.map((candidate) => ({
    ...candidate,
    valueAmount: decimalToNumber(candidate.valueAmount),
  }))
}

export async function createDealCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
): Promise<CreateDealCommandResult> {
  const parsed = createDealCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))

  const { organizationId: orgId, role, userId } = actor
  const fieldPermissions = await getFieldPermissions(orgId, role, "deal")
  const input = requireWritableFields(
    parsed.data as Record<string, unknown>,
    fieldPermissions,
    role,
  ) as CreateDealCommandInput

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: orgId },
      select: { id: true },
    })
    if (!contact) throw validationError("Invalid contactId")
  }
  if (input.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId, organizationId: orgId },
      select: { id: true },
    })
    if (!company) throw validationError("Invalid companyId")
  }
  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, organizationId: orgId },
      select: { id: true },
    })
    if (!campaign) throw validationError("Invalid campaignId")
  }
  if (input.assignedTo) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assignedTo, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!assignee) throw validationError("Assignee must be an active member of this organization")
  }

  let pipelineId = input.pipelineId ?? null
  if (pipelineId) {
    const selectedPipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId: orgId, isActive: true },
      select: { id: true },
    })
    if (!selectedPipeline) throw validationError("Invalid pipelineId")
  } else {
    const defaultPipeline = await prisma.pipeline.findFirst({
      where: { organizationId: orgId, isDefault: true, isActive: true },
      select: { id: true },
    })
    pipelineId = defaultPipeline?.id ?? null
  }

  const stage = input.stage ?? "LEAD"
  let probability = input.probability
  if (pipelineId) {
    const pipelineStage = await prisma.pipelineStage.findFirst({
      where: {
        organizationId: orgId,
        pipelineId,
        name: stage,
        isActive: true,
      },
      select: { id: true, probability: true },
    })
    if (!pipelineStage) throw validationError("Invalid stage for pipeline")
    probability ??= pipelineStage.probability
  } else if (input.stage) {
    throw validationError("A pipeline is required when stage is provided")
  }

  const duplicateCandidates = await findDuplicateCandidates(orgId, input)
  const deal = await prisma.deal.create({
    data: {
      organizationId: orgId,
      name: input.name,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      campaignId: input.campaignId ?? null,
      pipelineId,
      stage,
      valueAmount: input.valueAmount ?? 0,
      currency: input.currency || DEFAULT_CURRENCY,
      probability: probability ?? 10,
      expectedClose: input.expectedClose ? new Date(input.expectedClose) : null,
      assignedTo: input.assignedTo || userId,
      notes: input.notes,
      tags: input.tags ?? [],
    },
    include: {
      company: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
    },
  })

  const dealValue = decimalToNumber(deal.valueAmount)
  const entity = { ...deal, valueAmount: dealValue }
  logAudit(orgId, "create", "deal", deal.id, deal.name)
  executeWorkflows(orgId, "deal", "created", deal).catch(() => {})
  createNotification({
    organizationId: orgId,
    type: "success",
    title: "Новая сделка",
    message: `Создана сделка «${deal.name}»${dealValue ? ` на ${dealValue} ${deal.currency}` : ""}`,
    entityType: "deal",
    entityId: deal.id,
  }).catch(() => {})
  fireWebhooks(orgId, "deal.created", {
    id: deal.id,
    name: deal.name,
    valueAmount: dealValue,
    stage: deal.stage,
  }).catch(() => {})
  if (deal.contactId) {
    trackContactEvent(orgId, deal.contactId, "deal_created", {
      dealId: deal.id,
      name: deal.name,
    }).catch(() => {})
  }
  prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "slack", isActive: true },
  }).then((configs) => {
    const message = formatDealNotification({ name: deal.name, value: dealValue, stage: deal.stage })
    for (const config of configs) {
      if (config.webhookUrl) sendSlackNotification(config.webhookUrl, message).catch(() => {})
    }
  }).catch(() => {})

  return {
    entity,
    warnings: duplicateCandidates.length > 0
      ? [{ code: "POSSIBLE_DUPLICATE", candidates: duplicateCandidates }]
      : [],
  }
}
