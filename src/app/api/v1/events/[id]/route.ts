import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import {
  nonNegativeCountSchema,
  nonNegativeFinancialAmountSchema,
} from "@/lib/validation/numeric"

const updateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().optional(),
  isOnline: z.boolean().optional(),
  meetingUrl: z.string().optional(),
  // Mirrors the bounds POST already applies (src/app/api/v1/events/route.ts).
  // Until 2026-08-28 this schema left all seven bare, so `POST {budget: 0}`
  // followed by `PUT {budget: -999999999999}` walked straight past the fix.
  budget: nonNegativeFinancialAmountSchema.optional(),
  actualCost: nonNegativeFinancialAmountSchema.optional(),
  expectedRevenue: nonNegativeFinancialAmountSchema.optional(),
  actualRevenue: nonNegativeFinancialAmountSchema.optional(),
  maxParticipants: z.number().finite().int().min(1).max(100000).optional(),
  registeredCount: nonNegativeCountSchema.optional(),
  attendedCount: nonNegativeCountSchema.optional(),
  responsibleId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Link/unlink the event's campaign (null clears it). Powers event_registered touchpoints; org-validated below.
  campaignId: z.string().nullable().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const event = await prisma.event.findFirst({
    where: { id, organizationId: orgId },
    include: { participants: { orderBy: { registeredAt: "desc" } } },
  })
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: event })
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Org-validate a non-null campaign link (a cross-org campaignId must not attach; null just clears).
  if (parsed.data.campaignId) {
    const camp = await prisma.campaign.findFirst({ where: { id: parsed.data.campaignId, organizationId: orgId }, select: { id: true } })
    if (!camp) return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 })
  }

  const data: any = { ...parsed.data }
  if (data.startDate) data.startDate = new Date(data.startDate)
  if (data.endDate) data.endDate = new Date(data.endDate)

  const result = await prisma.event.updateMany({
    where: { id, organizationId: orgId },
    data,
  })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.event.findFirst({ where: { id, organizationId: orgId } })
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const result = await prisma.event.deleteMany({ where: { id, organizationId: orgId } })
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { deleted: id } })
})
