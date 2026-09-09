import { Prisma, type PrismaClient } from "@prisma/client"

export const CUSTOMER_STAGES = [
  "interested",
  "potential",
  "marketing_contacted",
  "sales_contacted",
  "unable_to_contact",
  "sold",
  "not_sold",
  "no_result",
] as const

export type CustomerStage = (typeof CUSTOMER_STAGES)[number]
export type CustomerStageSource = "agent" | "lead" | "ai" | "system" | "backfill"

export const LEAD_REPORTED_CUSTOMER_STAGES = [
  "sales_contacted",
  "interested",
  "potential",
  "unable_to_contact",
  "sold",
  "not_sold",
  "no_result",
] as const
export type LeadReportedCustomerStage = (typeof LEAD_REPORTED_CUSTOMER_STAGES)[number]

const STAGE_SET = new Set<string>(CUSTOMER_STAGES)
const LEAD_STAGE_SET = new Set<string>(LEAD_REPORTED_CUSTOMER_STAGES)
const AI_STAGE_SET = new Set<string>(["interested", "potential", "no_result"])
const TASK_STAGE_LABEL: Record<CustomerStage, string> = {
  interested: "Maraqlanan izləyici",
  potential: "Potensial izləyici",
  marketing_contacted: "Marketinq əlaqə saxladı",
  sales_contacted: "Satış əlaqə saxladı",
  unable_to_contact: "Satış əlaqə saxlaya bilmədi",
  sold: "Satıldı",
  not_sold: "Satılmadı",
  no_result: "Nəticəsiz",
}

export function normalizeCustomerStage(value: unknown): CustomerStage | null {
  const stage = String(value ?? "").trim().toLowerCase()
  return STAGE_SET.has(stage) ? stage as CustomerStage : null
}

export function normalizeLeadReportedCustomerStage(value: unknown): LeadReportedCustomerStage | null {
  const stage = String(value ?? "").trim().toLowerCase()
  return LEAD_STAGE_SET.has(stage) ? stage as LeadReportedCustomerStage : null
}

const TERMINAL_SALES_STAGES = new Set<LeadReportedCustomerStage>(["sold", "not_sold", "no_result"])
const PRIMARY_STAGE_PRIORITY: LeadReportedCustomerStage[] = [
  "sold",
  "not_sold",
  "no_result",
  "unable_to_contact",
  "potential",
  "interested",
  "sales_contacted",
]

export function normalizeLeadReportedCustomerStages(value: unknown): LeadReportedCustomerStage[] {
  if (!Array.isArray(value)) return []
  return LEAD_REPORTED_CUSTOMER_STAGES.filter((stage) => value.includes(stage))
}

export function validateLeadReportedCustomerStages(stages: LeadReportedCustomerStage[]): boolean {
  if (stages.length === 0) return false
  const selected = new Set(stages)
  if (selected.has("sales_contacted") && selected.has("unable_to_contact")) return false
  return stages.filter((stage) => TERMINAL_SALES_STAGES.has(stage)).length <= 1
}

export function primaryLeadReportedCustomerStage(
  stages: LeadReportedCustomerStage[],
): LeadReportedCustomerStage {
  const primary = PRIMARY_STAGE_PRIORITY.find((stage) => stages.includes(stage))
  if (!primary) throw new Error("call-outcome-required")
  return primary
}

export function isAiCustomerStage(value: unknown): value is "interested" | "potential" | "no_result" {
  return AI_STAGE_SET.has(String(value ?? "").trim().toLowerCase())
}

export function conversationHasPhone(value: {
  contactPhone?: string | null
  metadata?: unknown
}): boolean {
  if (value.contactPhone?.trim()) return true
  const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
    ? value.metadata as Record<string, unknown>
    : {}
  return ["contactPhone", "phone", "waPhone"].some((key) => {
    const phone = metadata[key]
    return typeof phone === "string" && /\d{7,}/.test(phone.replace(/\D/g, ""))
  })
}

type StageDb = Pick<PrismaClient, "$transaction">

type ApplyStageInput = {
  organizationId: string
  conversationId: string
  stage: CustomerStage
  source: CustomerStageSource
  changedBy?: string | null
  attributedTo?: string | null
  confidence?: number | null
  reason?: string | null
  allowAiOverwrite?: boolean
}

async function applyCustomerStage(
  tx: Prisma.TransactionClient,
  input: ApplyStageInput,
): Promise<{ changed: boolean; previous: string | null }> {
  const confidence = input.confidence == null
    ? null
    : Math.max(0, Math.min(1, input.confidence))
  const reason = input.reason?.trim().slice(0, 2000) || null

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.organizationId}:${input.conversationId}:customer-stage`}))`
  const current = await tx.socialConversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: {
      customerStage: true,
      customerStageSource: true,
      customerStageReason: true,
      metadata: true,
    },
  })
  if (!current) throw new Error("conversation-not-found")
  if (
    input.source === "ai"
    && !input.allowAiOverwrite
    && current.customerStage != null
    && current.customerStageSource !== "ai"
  ) {
    return { changed: false, previous: current.customerStage }
  }
  if (
    current.customerStage === input.stage
    && current.customerStageSource === input.source
    && current.customerStageReason === reason
  ) {
    return { changed: false, previous: current.customerStage }
  }

  await tx.socialConversation.update({
    where: { id: input.conversationId },
    data: {
      customerStage: input.stage,
      customerStageSource: input.source,
      customerStageConfidence: confidence,
      customerStageReason: reason,
      customerStageUpdatedAt: new Date(),
      customerStageUpdatedBy: input.attributedTo ?? input.changedBy ?? null,
      ...(input.source === "ai" ? {
        aiSuggestedCustomerStage: input.stage,
        aiCustomerStageConfidence: confidence,
        aiCustomerStageReason: reason,
        aiCustomerStageSuggestedAt: new Date(),
      } : {}),
    },
  })
  await tx.inboxCustomerStageEvent.create({
    data: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      fromStage: current.customerStage,
      toStage: input.stage,
      source: input.source,
      confidence,
      reason,
      changedBy: input.changedBy ?? null,
    },
  })
  const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
    ? current.metadata as Record<string, unknown>
    : {}
  const qualificationTaskId = typeof metadata.qualificationTaskId === "string" ? metadata.qualificationTaskId : null
  if (qualificationTaskId) {
    const task = await tx.task.findFirst({
      where: { id: qualificationTaskId, organizationId: input.organizationId },
      select: { id: true, customFields: true },
    })
    if (task) {
      const customFields = task.customFields && typeof task.customFields === "object" && !Array.isArray(task.customFields)
        ? task.customFields as Record<string, unknown>
        : {}
      await tx.task.update({
        where: { id: task.id },
        data: {
          customFields: {
            ...customFields,
            inboxCustomerStatus: TASK_STAGE_LABEL[input.stage],
          } as Prisma.InputJsonValue,
        },
      })
    }
  }
  return { changed: true, previous: current.customerStage }
}

export async function setCustomerStage(
  db: StageDb,
  input: {
    organizationId: string
    conversationId: string
    stage: CustomerStage
    source: CustomerStageSource
    changedBy?: string | null
    confidence?: number | null
    reason?: string | null
    allowAiOverwrite?: boolean
  },
): Promise<{ changed: boolean; previous: string | null }> {
  return db.$transaction((tx: Prisma.TransactionClient) => applyCustomerStage(tx, input))
}

export async function markMarketingContacted(
  db: StageDb,
  input: {
    organizationId: string
    conversationId: string
    changedBy?: string | null
    reason?: string | null
  },
): Promise<boolean> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.organizationId}:${input.conversationId}:customer-stage`}))`
    const current = await tx.socialConversation.findFirst({
      where: { id: input.conversationId, organizationId: input.organizationId },
      select: { customerStage: true, customerStageSource: true },
    })
    if (!current) return false
    if (current.customerStage === "marketing_contacted") return false
    if (current.customerStage != null && !["ai", "backfill"].includes(current.customerStageSource ?? "")) return false
    const result = await applyCustomerStage(tx, {
      ...input,
      stage: "marketing_contacted",
      source: "agent",
      reason: input.reason?.trim().slice(0, 2000) || "Marketing agent sent an inbox reply",
    })
    return result.changed
  })
}

export async function setLeadReportedCustomerStages(
  db: StageDb,
  input: {
    organizationId: string
    leadId: string
    stages: LeadReportedCustomerStage[]
    changedBy?: string | null
    canOverrideAssignee?: boolean
    reason?: string | null
  },
): Promise<{ conversationsUpdated: number }> {
  const stages = normalizeLeadReportedCustomerStages(input.stages)
  if (!validateLeadReportedCustomerStages(stages)) throw new Error("conflicting-call-outcomes")
  const primaryStage = primaryLeadReportedCustomerStage(stages)
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.organizationId}:${input.leadId}:lead-customer-stage`}))`
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, organizationId: input.organizationId },
      select: { id: true, phone: true, phoneWhatsApp: true, assignedTo: true },
    })
    if (!lead) throw new Error("lead-not-found")
    if (
      !input.canOverrideAssignee
      && (!input.changedBy || lead.assignedTo !== input.changedBy)
    ) {
      throw new Error("sales-assignee-required")
    }
    if (stages.includes("potential") && !lead.phone?.trim() && !lead.phoneWhatsApp?.trim()) {
      throw new Error("phone-required")
    }

    const reason = input.reason?.trim().slice(0, 2000) || null
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        customerStage: primaryStage,
        salesCallOutcomes: stages,
        customerStageReason: reason,
        customerStageUpdatedAt: new Date(),
        customerStageUpdatedBy: input.changedBy ?? null,
      },
    })
    const conversations = await tx.socialConversation.findMany({
      where: {
        organizationId: input.organizationId,
        OR: [
          { metadata: { path: ["qualificationLeadId"], equals: input.leadId } },
          { messages: { some: { organizationId: input.organizationId, leadId: input.leadId } } },
        ],
      },
      select: { id: true },
    })
    let conversationsUpdated = 0
    for (const conversation of conversations) {
      await tx.socialConversation.update({
        where: { id: conversation.id },
        data: { salesCallOutcomes: stages },
      })
      const result = await applyCustomerStage(tx, {
        organizationId: input.organizationId,
        conversationId: conversation.id,
        stage: primaryStage,
        source: "lead",
        changedBy: input.changedBy ?? null,
        attributedTo: lead.assignedTo,
        reason: reason || "Lead qualification updated from lead card",
      })
      if (result.changed) conversationsUpdated++
    }
    return { conversationsUpdated }
  })
}

export async function setLeadReportedCustomerStage(
  db: StageDb,
  input: {
    organizationId: string
    leadId: string
    stage: LeadReportedCustomerStage
    changedBy?: string | null
    canOverrideAssignee?: boolean
    reason?: string | null
  },
): Promise<{ conversationsUpdated: number }> {
  return setLeadReportedCustomerStages(db, {
    ...input,
    stages: [input.stage],
  })
}
