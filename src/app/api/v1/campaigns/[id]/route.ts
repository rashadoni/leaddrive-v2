import { NextResponse } from "next/server"
import { z } from "zod"
import { getWhatsAppCampaignProgress } from "@/lib/campaigns/whatsapp-dispatch"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { nonNegativeCountSchema, nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const updateCampaignSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(["email", "sms", "whatsapp", "telegram"]).optional(),
  status: z.string().optional(),
  subject: z.string().optional(),
  templateId: z.string().optional(),
  segmentId: z.string().optional(),
  recipientMode: z.enum(["all", "contacts", "leads", "segment", "source", "manual"]).optional(),
  recipientIds: z.array(z.string()).optional(),
  recipientSource: z.string().optional(),
  scheduledAt: z.string().optional(),
  totalRecipients: nonNegativeCountSchema.optional(),
  budget: nonNegativeFinancialAmountSchema.optional(),
  flowData: z.any().optional(),
  isAbTest: z.boolean().optional(),
  abTestType: z.string().optional(),
  testPercentage: z.number().int().min(10).max(50).optional(),
  testDurationHours: z.number().int().min(1).max(48).optional(),
  winnerCriteria: z.enum(["open_rate", "click_rate"]).optional(),
})

export const GET = withRlsAuth("campaigns", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const whatsappDelivery = campaign.type === "whatsapp" ? await getWhatsAppCampaignProgress(orgId, id) : undefined
    return NextResponse.json({ success: true, data: { ...campaign, whatsappDelivery } })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRlsAuth("campaigns", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateCampaignSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const current = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const isWhatsApp = current.type === "whatsapp"
    const cancelling = isWhatsApp && current.status === "sending" && parsed.data.status === "cancelled" && Object.keys(parsed.data).length === 1
    if (isWhatsApp && !["draft", "scheduled"].includes(current.status) && !cancelling) {
      return NextResponse.json({ error: "Started WhatsApp campaigns cannot be edited or resent. Create a new campaign." }, { status: 409 })
    }
    if (isWhatsApp && parsed.data.status && !["draft", "scheduled", "cancelled"].includes(parsed.data.status)) {
      return NextResponse.json({ error: "Use the send action to start a campaign." }, { status: 422 })
    }
    const result = await prisma.campaign.updateMany({
      where: { id, organizationId: orgId, ...(isWhatsApp ? { type: "whatsapp", status: current.status } : {}) },
      data: {
        ...parsed.data,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
      },
    })
    if (result.count === 0) return NextResponse.json({ error: "Campaign changed. Refresh and try again." }, { status: 409 })
    if (cancelling) await prisma.whatsAppCampaignDelivery.updateMany({
      where: { organizationId: orgId, campaignId: id, status: "pending" },
      data: { status: "skipped", errorCode: "campaign_cancelled" },
    })
    const updated = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("campaigns", "delete", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const current = await prisma.campaign.findFirst({ where: { id, organizationId: orgId }, select: { type: true, status: true } })
    if (current?.type === "whatsapp" && !["draft", "scheduled"].includes(current.status)) {
      return NextResponse.json({ error: "Keep the delivery history of started WhatsApp campaigns. Cancel a running campaign to stop pending messages." }, { status: 409 })
    }
    const result = await prisma.campaign.deleteMany({ where: { id, organizationId: orgId,
      ...(current?.type === "whatsapp" ? { status: { in: ["draft", "scheduled"] } } : {}),
    } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
