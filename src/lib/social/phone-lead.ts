import { prisma, logAudit } from "@/lib/prisma"
import { matchInboundLeadId } from "@/lib/inbound-lead-match"
import { CONVERTED_STATUS } from "@/lib/social/mention-status"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { deliverSocialLeadToWhatsAppGroup } from "@/lib/social/whatsapp-group-delivery"
import { extractPhoneNumber } from "@/lib/inbox/customer-phone"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"

export interface ProcessSocialPhoneLeadInput {
  organizationId: string
  mentionId: string
  platform: string
  phone: string
  authorName?: string | null
  authorHandle?: string | null
  text: string
  url?: string | null
}

export type ProcessSocialPhoneLeadResult =
  | { status: "lead_created"; leadId: string }
  | { status: "duplicate_linked"; leadId: string }
  | { status: "already_linked"; leadId: string | null }

type PhoneLeadStatus = Extract<ProcessSocialPhoneLeadResult["status"], "lead_created" | "duplicate_linked">

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function withPhoneLeadMetadata(
  sourceMetadata: unknown,
  input: ProcessSocialPhoneLeadInput,
  leadId: string,
  status: PhoneLeadStatus,
): Record<string, unknown> {
  const metadata = asRecord(sourceMetadata)
  return {
    ...metadata,
    phoneLead: {
      ...asRecord(metadata.phoneLead),
      phone: input.phone,
      normalizedPhone: input.phone,
      leadId,
      status,
      processedAt: new Date().toISOString(),
    },
  }
}

function mentionContactName(input: ProcessSocialPhoneLeadInput): string {
  return (
    input.authorName?.trim() ||
    (input.authorHandle ? `@${input.authorHandle.replace(/^@/, "")}` : "") ||
    `${input.platform} lead`
  ).slice(0, 200)
}

function mentionNotes(input: ProcessSocialPhoneLeadInput): string {
  return [
    `Platform: ${input.platform}`,
    input.authorHandle ? `Handle: @${input.authorHandle.replace(/^@/, "")}` : null,
    `Phone: ${input.phone}`,
    input.url ? `URL: ${input.url}` : null,
    "",
    "Content:",
    input.text,
  ].filter(Boolean).join("\n")
}

async function linkMentionToLead(
  input: ProcessSocialPhoneLeadInput,
  leadId: string,
  phoneLeadStatus: PhoneLeadStatus,
): Promise<boolean> {
  const mention = await prisma.socialMention.findFirst({
    where: { id: input.mentionId, organizationId: input.organizationId, leadId: null },
    select: { sourceMetadata: true },
  })
  if (!mention) return false

  const claim = await prisma.socialMention.updateMany({
    where: { id: input.mentionId, organizationId: input.organizationId, leadId: null },
    data: {
      leadId,
      status: CONVERTED_STATUS.leadId,
      handledAt: new Date(),
      sourceMetadata: withPhoneLeadMetadata(mention.sourceMetadata, input, leadId, phoneLeadStatus),
    },
  })
  return claim.count > 0
}

export async function processSocialPhoneLead(input: ProcessSocialPhoneLeadInput): Promise<ProcessSocialPhoneLeadResult> {
  if (!extractPhoneNumber(input.phone)) {
    throw new Error("phone-required")
  }
  const existingLeadId = await matchInboundLeadId(input.organizationId, { phone: input.phone })
  if (existingLeadId) {
    const linked = await linkMentionToLead(input, existingLeadId, "duplicate_linked")
    if (linked) {
      await prisma.activity.create({
        data: {
          organizationId: input.organizationId,
          type: "note",
          subject: "Social phone lead duplicate",
          description: mentionNotes(input),
          relatedType: "lead",
          relatedId: existingLeadId,
          completedAt: new Date(),
        },
      }).catch(() => {})
      return { status: "duplicate_linked", leadId: existingLeadId }
    }
    const mention = await prisma.socialMention.findUnique({
      where: { id: input.mentionId },
      select: { leadId: true },
    })
    return { status: "already_linked", leadId: mention?.leadId ?? null }
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: input.organizationId,
      contactName: mentionContactName(input),
      companyName: null,
      email: null,
      phone: input.phone,
      phoneWhatsApp: input.phone,
      telegramHandle: null,
      source: `social:${input.platform}`,
      status: "new",
      priority: "medium",
      notes: mentionNotes(input),
      assignedTo: null,
    },
  })

  const linked = await linkMentionToLead(input, lead.id, "lead_created")
  if (!linked) {
    await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {})
    const mention = await prisma.socialMention.findUnique({
      where: { id: input.mentionId },
      select: { leadId: true },
    })
    return { status: "already_linked", leadId: mention?.leadId ?? null }
  }

  // A phone number in hand is the strongest thing this lead has; score it
  // now so the salesperson sees that rather than an uncalculated zero.
  await scoreLeadNow(input.organizationId, lead.id)
  logAudit(input.organizationId, "create", "lead", lead.id, lead.contactName)
  executeWorkflows(input.organizationId, "lead", "created", lead).catch(() => {})
  refreshProfileForSource(prisma, input.organizationId, "lead", lead.id).catch((e) =>
    console.error("[social-phone-lead] profile refresh failed", e),
  )
  createNotification({
    organizationId: input.organizationId,
    type: "info",
    title: "Новый лид",
    message: `Создан лид «${lead.contactName}» из ${input.platform}`,
    entityType: "lead",
    entityId: lead.id,
  }).catch(() => {})
  fireWebhooks(input.organizationId, "lead.created", {
    id: lead.id,
    contactName: lead.contactName,
    companyName: lead.companyName,
  }).catch(() => {})
  deliverSocialLeadToWhatsAppGroup({
    organizationId: input.organizationId,
    leadId: lead.id,
    mentionId: input.mentionId,
    payload: {
      name: lead.contactName,
      username: input.authorHandle || null,
      phone: input.phone,
      messageText: input.text,
      videoLink: input.url || null,
      date: new Date().toISOString(),
      campaign: null,
    },
  }).catch((e) => console.error("[social-phone-lead] whatsapp group dry-run failed", e))

  return { status: "lead_created", leadId: lead.id }
}
