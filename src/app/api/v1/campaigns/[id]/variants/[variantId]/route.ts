import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const updateVariantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  subject: z.string().optional(),
  templateId: z.string().optional(),
  htmlBody: z.string().optional(),
  designJson: z.any().optional(),
  percentage: z.number().int().min(1).max(100).optional(),
})

export const PUT = withRlsAuth("campaigns", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string; variantId: string }> }) => {
  const { id, variantId } = await params

  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 })

  const body = await req.json()
  const parsed = updateVariantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const result = await prisma.campaignVariant.updateMany({
    where: { id: variantId, campaignId: id },
    data: parsed.data,
  })
  if (result.count === 0) return NextResponse.json({ error: "Variant not found" }, { status: 404 })

  const updated = await prisma.campaignVariant.findFirst({ where: { id: variantId } })
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRlsAuth("campaigns", "delete", async (_req, { orgId }, { params }: { params: Promise<{ id: string; variantId: string }> }) => {
  const { id, variantId } = await params

  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: orgId } })
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 })

  const result = await prisma.campaignVariant.deleteMany({ where: { id: variantId, campaignId: id } })
  if (result.count === 0) return NextResponse.json({ error: "Variant not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: { deleted: variantId } })
})
