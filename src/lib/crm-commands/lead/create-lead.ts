import type { Lead, Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { getFieldPermissions } from "@/lib/field-filter"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { applyLeadAssignmentRules } from "@/lib/lead-assignment"
import { fireWebhooks } from "@/lib/webhooks"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { findSalesPipeline } from "@/lib/pipeline-routing"
import { azerbaijaniLocalPart } from "@/lib/inbox/customer-phone"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import { validationError } from "../errors"
import { requireWritableFields } from "../field-permissions"
import { createLeadCommandSchema, type CreateLeadCommandInput } from "../schemas/lead"

export interface LeadDuplicateCandidate {
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  phoneWhatsApp: string | null
}

export interface CreateLeadCommandResult {
  entity: Lead
  warnings: Array<{
    code: "POSSIBLE_DUPLICATE"
    candidates: LeadDuplicateCandidate[]
  }>
  assignment: {
    mode: "explicit" | "actor" | "automatic"
    status: "final" | "scheduled"
    assignedTo: string | null
  }
}

function firstValidationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid lead"
}

function phoneVariants(...values: Array<string | undefined>): string[] {
  const variants = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const digits = trimmed.replace(/\D/g, "")
    variants.add(trimmed)
    if (!digits) continue
    variants.add(digits)
    variants.add(`+${digits}`)
    const local = azerbaijaniLocalPart(digits)
    if (local) {
      variants.add(`0${local}`)
      variants.add(`994${local}`)
      variants.add(`+994${local}`)
    }
  }
  return [...variants]
}

async function findDuplicateCandidates(
  db: Pick<Prisma.TransactionClient, "lead">,
  organizationId: string,
  input: CreateLeadCommandInput,
): Promise<LeadDuplicateCandidate[]> {
  const email = input.email?.trim()
  const phones = phoneVariants(input.phone, input.phoneWhatsApp)
  const phoneDigits = phones
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean)
  const last9 = phoneDigits.find((value) => value.length >= 9)?.slice(-9)
  const or: Prisma.LeadWhereInput[] = []
  if (email) or.push({ email: { equals: email, mode: "insensitive" } })
  if (phones.length > 0) {
    or.push(
      { phone: { in: phones } },
      { phoneWhatsApp: { in: phones } },
    )
  }
  if (last9) {
    or.push(
      { phone: { contains: last9 } },
      { phoneWhatsApp: { contains: last9 } },
    )
  }
  if (or.length === 0) return []

  return db.lead.findMany({
    where: { organizationId, OR: or },
    select: {
      id: true,
      contactName: true,
      companyName: true,
      email: true,
      phone: true,
      phoneWhatsApp: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  })
}

function dispatchCreatedLeadEffects(
  actor: CrmCommandActorContext,
  lead: Lead,
  automaticAssignment: boolean,
): void {
  const { organizationId: orgId, userId } = actor
  logAudit(orgId, "create", "lead", lead.id, lead.contactName)
  if (automaticAssignment) applyLeadAssignmentRules(orgId, lead).catch(() => {})
  executeWorkflows(orgId, "lead", "created", lead).catch(() => {})
  refreshProfileForSource(prisma, orgId, "lead", lead.id).catch((error) =>
    console.error("[createLeadCommand] profile refresh failed", error),
  )
  createNotification({
    organizationId: orgId,
    type: "info",
    title: "Новый лид",
    message: `Создан лид «${lead.contactName}»${lead.companyName ? ` (${lead.companyName})` : ""}`,
    entityType: "lead",
    entityId: lead.id,
  }).catch(() => {})
  if (lead.assignedTo && lead.assignedTo !== userId) {
    createNotification({
      organizationId: orgId,
      userId: lead.assignedTo,
      type: "info",
      title: "Вам назначен лид",
      message: `«${lead.contactName}»${lead.companyName ? ` (${lead.companyName})` : ""}`,
      entityType: "lead",
      entityId: lead.id,
      push: true,
      email: true,
    }).catch(() => {})
  }
  fireWebhooks(orgId, "lead.created", {
    id: lead.id,
    contactName: lead.contactName,
    companyName: lead.companyName,
  }).catch(() => {})
}

export async function createLeadCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<CreateLeadCommandResult> {
  const parsed = createLeadCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(firstValidationMessage(parsed.error))

  const { organizationId: orgId, role, userId } = actor
  const db = execution?.transaction ?? prisma
  const fieldPermissions = await getFieldPermissions(orgId, role, "lead")
  const input = requireWritableFields(
    parsed.data as Record<string, unknown>,
    fieldPermissions,
    role,
  ) as CreateLeadCommandInput

  let assignedTo = userId
  if (input.assignedTo) {
    const seller = await db.user.findFirst({
      where: {
        id: input.assignedTo,
        organizationId: orgId,
        role: "sales",
        isActive: true,
      },
      select: { id: true },
    })
    if (!seller) {
      throw validationError("Selected seller is inactive or does not belong to this organization")
    }
    assignedTo = seller.id
  }

  const activePipelines = await db.pipeline.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, name: true, isDefault: true },
  })
  let pipelineId = input.pipelineId
  if (pipelineId && !activePipelines.some((pipeline) => pipeline.id === pipelineId)) {
    throw validationError("Invalid pipelineId")
  }
  if (!pipelineId && role === "sales") {
    pipelineId = findSalesPipeline(activePipelines)?.id
  }

  const duplicateCandidates = await findDuplicateCandidates(db, orgId, input)
  const lead = await db.lead.create({
    data: {
      organizationId: orgId,
      contactName: input.contactName,
      companyName: input.companyName,
      email: input.email || null,
      phone: input.phone,
      phoneWhatsApp: input.phoneWhatsApp,
      telegramHandle: input.telegramHandle,
      source: input.source,
      sourceDetail: input.sourceDetail,
      sourceProfileUrl: input.sourceProfileUrl || null,
      interest: input.interest,
      brand: input.brand,
      category: input.category,
      status: input.status || "new",
      priority: input.priority || "medium",
      estimatedValue: input.estimatedValue,
      notes: input.notes,
      assignedTo,
      pipelineId: pipelineId ?? null,
    },
  })

  const automaticAssignment = !input.assignedTo && role !== "sales"
  if (execution?.transaction) {
    dispatchOrDeferCommandEffects(execution, async () => {
      await scoreLeadNow(orgId, lead.id)
      dispatchCreatedLeadEffects(actor, lead, automaticAssignment)
    })
  } else {
    await scoreLeadNow(orgId, lead.id)
    dispatchCreatedLeadEffects(actor, lead, automaticAssignment)
  }

  return {
    entity: lead,
    warnings: duplicateCandidates.length > 0
      ? [{ code: "POSSIBLE_DUPLICATE", candidates: duplicateCandidates }]
      : [],
    assignment: {
      mode: input.assignedTo ? "explicit" : automaticAssignment ? "automatic" : "actor",
      status: automaticAssignment ? "scheduled" : "final",
      assignedTo: lead.assignedTo,
    },
  }
}
