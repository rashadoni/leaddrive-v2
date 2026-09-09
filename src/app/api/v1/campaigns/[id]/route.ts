import { NextResponse } from "next/server"
import { z } from "zod"
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
    return NextResponse.json({ success: true, data: campaign })
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
    const result = await prisma.campaign.updateMany({
      where: { id, organizationId: orgId },
      data: {
        ...parsed.data,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
      },
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
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
    const result = await prisma.campaign.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
