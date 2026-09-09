import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { deliverSocialLeadToWhatsAppGroup, type SocialLeadWhatsAppPayload } from "@/lib/social/whatsapp-group-delivery"

type RouteCtx = { params: Promise<{ id: string }> }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

export const POST = withSocialMonitoringMutationFence("social", "write", async (_req: NextRequest, auth, { params }: RouteCtx) => {
  const { id } = await params

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      organizationId: true,
      platform: true,
      authorName: true,
      authorHandle: true,
      text: true,
      url: true,
      sourceMetadata: true,
      matchedTerm: true,
      leadId: true,
      whatsappGroupStatus: true,
      publishedAt: true,
      createdAt: true,
    },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (mention.whatsappGroupStatus !== "failed") {
    return NextResponse.json({ error: "Only failed WhatsApp group deliveries can be retried" }, { status: 409 })
  }
  if (!mention.leadId) {
    return NextResponse.json({ error: "Mention is not linked to a lead" }, { status: 409 })
  }

  const lead = await prisma.lead.findFirst({
    where: { id: mention.leadId, organizationId: auth.orgId },
    select: { id: true, contactName: true, phone: true, phoneWhatsApp: true },
  })
  if (!lead) return NextResponse.json({ error: "Linked lead not found" }, { status: 409 })

  const phone = firstString(lead.phoneWhatsApp, lead.phone)
  if (!phone) return NextResponse.json({ error: "Linked lead has no phone number" }, { status: 409 })

  const metadata = asRecord(mention.sourceMetadata)
  const payload: SocialLeadWhatsAppPayload = {
    name: firstString(lead.contactName, mention.authorName, mention.authorHandle) || `${mention.platform} lead`,
    username: mention.authorHandle || null,
    phone,
    messageText: mention.text,
    videoLink: mention.url || null,
    date: (mention.publishedAt || mention.createdAt).toISOString(),
    campaign: firstString(metadata.campaignName, metadata.campaign, metadata.campaign_id, mention.matchedTerm),
  }

  const result = await deliverSocialLeadToWhatsAppGroup({
    organizationId: auth.orgId,
    leadId: lead.id,
    mentionId: mention.id,
    payload,
  })

  return NextResponse.json({ success: true, data: result })
})
