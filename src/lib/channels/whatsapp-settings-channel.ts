import { prisma } from "@/lib/prisma"

/** Never choose an arbitrary business number for management or automation. */
export async function selectWhatsAppSettingsChannel(organizationId: string, channelConfigId?: string | null) {
  if (channelConfigId) {
    const row = await prisma.channelConfig.findFirst({
      where: { id: channelConfigId, organizationId, channelType: "whatsapp", isActive: true },
      select: { id: true },
    })
    return row ? { id: row.id, error: null } : { id: null, error: "WhatsApp not configured" }
  }
  const rows = await prisma.channelConfig.findMany({
    where: { organizationId, channelType: "whatsapp", isActive: true },
    select: { id: true }, take: 2,
  })
  if (rows.length === 1) return { id: rows[0].id, error: null }
  return { id: null, error: rows.length ? "whatsapp_channel_required" : "WhatsApp not configured" }
}

/** An automatic reply follows the sole number that received this customer's messages. */
export async function selectWhatsAppAutomationChannel(organizationId: string, to: string, channelConfigId?: string | null) {
  if (channelConfigId) return selectWhatsAppSettingsChannel(organizationId, channelConfigId)
  const phone = to.replace(/[^0-9]/g, "")
  if (!phone) return { id: null, error: "WhatsApp recipient missing" }
  const inbound = await prisma.channelMessage.findMany({
    where: {
      organizationId, channelType: "whatsapp", direction: "inbound", channelConfigId: { not: null },
      OR: [{ from: { in: [phone, `+${phone}`] } },
        { metadata: { path: ["waPhone"], equals: phone } },
        { metadata: { path: ["waPhone"], equals: `+${phone}` } }],
    },
    select: { channelConfigId: true }, distinct: ["channelConfigId"], take: 2,
  })
  if (inbound.length > 1) return { id: null, error: "whatsapp_channel_required" }
  return selectWhatsAppSettingsChannel(organizationId, inbound[0]?.channelConfigId)
}
