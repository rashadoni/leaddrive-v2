import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { nonNegativeCountSchema, nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(["email", "sms", "whatsapp", "telegram"]).optional(),
  status: z.enum(["draft", "scheduled", "sending", "sent", "cancelled", "ab_testing"]).optional(),
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

export const GET = withRlsAuth("campaigns", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      ...(status ? { status } : {}),
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.campaign.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { campaigns, total, page, limit, search },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("campaigns", "write", async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createCampaignSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const campaign = await prisma.campaign.create({
      data: { organizationId: orgId, ...parsed.data },
    })
    return NextResponse.json({ success: true, data: campaign }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
