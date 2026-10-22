import { prisma } from "@/lib/prisma"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { getTruthyString, isObjectRecord } from "./social-broadcast"

/** A legacy draft can infer a sender only when there is exactly one active channel. */
export async function resolveWhatsAppCampaignConfig(orgId: string, flowData: unknown) {
  const selected = isObjectRecord(flowData) ? getTruthyString(flowData.whatsappChannelConfigId) : null
  if (selected) return resolveWhatsAppConfig(orgId, { channelConfigId: selected })
  const channels = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true }, select: { id: true }, take: 2,
  })
  if (channels.length !== 1) return null
  return resolveWhatsAppConfig(orgId, { channelConfigId: channels[0].id })
}
