import { prisma } from "@/lib/prisma"

export interface SocialLeadWhatsAppPayload {
  name: string
  username: string | null
  phone: string
  messageText: string
  videoLink: string | null
  date: string
  campaign: string | null
}

export interface SocialLeadWhatsAppDeliveryInput {
  organizationId: string
  leadId: string
  mentionId: string
  payload: SocialLeadWhatsAppPayload
}

export interface SocialLeadWhatsAppDestination {
  id: string
  name: string
}

export type SocialLeadWhatsAppDeliveryResult =
  | { status: "sent"; dryRun: true; destination: SocialLeadWhatsAppDestination; payload: SocialLeadWhatsAppPayload }
  | { status: "failed"; dryRun: true; error: string; payload: SocialLeadWhatsAppPayload }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readDestination(settings: unknown): SocialLeadWhatsAppDestination | null {
  const root = asRecord(settings)
  const nested = asRecord(root.socialLeadGroup)
  const id = nested.id ?? root.socialLeadGroupId ?? root.whatsappSocialLeadGroupId
  const name = nested.name ?? root.socialLeadGroupName ?? root.whatsappSocialLeadGroupName
  if (typeof id !== "string" || !id.trim()) return null
  return {
    id: id.trim(),
    name: typeof name === "string" && name.trim() ? name.trim() : id.trim(),
  }
}

async function writeDeliveryActivity(input: SocialLeadWhatsAppDeliveryInput, result: SocialLeadWhatsAppDeliveryResult) {
  await prisma.activity.create({
    data: {
      organizationId: input.organizationId,
      type: "note",
      subject: result.status === "sent" ? "WhatsApp group delivery dry-run" : "WhatsApp group delivery failed",
      description: JSON.stringify({
        mode: "dry-run",
        status: result.status,
        destination: "destination" in result ? result.destination : null,
        error: "error" in result ? result.error : null,
        mentionId: input.mentionId,
        payload: input.payload,
      }, null, 2),
      relatedType: "lead",
      relatedId: input.leadId,
      completedAt: new Date(),
    },
  })
}

async function writeMentionDeliveryStatus(input: SocialLeadWhatsAppDeliveryInput, result: SocialLeadWhatsAppDeliveryResult) {
  await prisma.socialMention.updateMany({
    where: { id: input.mentionId, organizationId: input.organizationId },
    data: {
      whatsappGroupStatus: result.status === "sent" ? "dry_run_sent" : "failed",
      whatsappGroupDestination: "destination" in result ? result.destination : {},
      whatsappGroupLastError: "error" in result ? result.error : null,
      whatsappGroupDeliveredAt: new Date(),
    },
  })
}

export async function deliverSocialLeadToWhatsAppGroup(
  input: SocialLeadWhatsAppDeliveryInput,
): Promise<SocialLeadWhatsAppDeliveryResult> {
  const channel = await prisma.channelConfig.findFirst({
    where: { organizationId: input.organizationId, channelType: "whatsapp", isActive: true },
    select: { settings: true },
    orderBy: { createdAt: "desc" },
  })

  const destination = readDestination(channel?.settings)
  const result: SocialLeadWhatsAppDeliveryResult = destination
    ? { status: "sent", dryRun: true, destination, payload: input.payload }
    : {
        status: "failed",
        dryRun: true,
        error: "WhatsApp group destination is not configured",
        payload: input.payload,
      }

  await writeDeliveryActivity(input, result)
  await writeMentionDeliveryStatus(input, result)
  return result
}
