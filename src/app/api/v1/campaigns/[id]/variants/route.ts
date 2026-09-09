import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createVariantSchema = z.object({
  name: z.string().min(1).max(255),
  subject: z.string().optional(),
  templateId: z.string().optional(),
  htmlBody: z.string().optional(),
  designJson: z.any().optional(),
  percentage: z.number().int().min(1).max(100).optional(),
})

export const GET = withRlsAuth("campaigns", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  // Verify campaign belongs to org
  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 })

  const variants = await prisma.campaignVariant.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json({ success: true, data: variants })
})

export const POST = withRlsAuth("campaigns", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 })

  const body = await req.json()
  const parsed = createVariantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const variant = await prisma.campaignVariant.create({
    data: {
      campaignId: id,
      ...parsed.data,
    },
  })

  return NextResponse.json({ success: true, data: variant }, { status: 201 })
})
