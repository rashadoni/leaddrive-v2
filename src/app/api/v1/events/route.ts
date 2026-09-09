import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.string().default("conference"),
  status: z.string().default("planned"),
  startDate: z.string(),
  endDate: z.string().optional(),
  location: z.string().optional(),
  isOnline: z.boolean().default(false),
  meetingUrl: z.string().optional(),
  budget: z.number().min(0).max(999999999).default(0),
  expectedRevenue: z.number().min(0).max(999999999).default(0),
  maxParticipants: z.number().int().min(1).max(100000).optional(),
  responsibleId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  // Link the event to a campaign so its public register hook emits event_registered touchpoints
  // (C9 attribution). Mirrors the forms campaignId wiring; org-validated below.
  campaignId: z.string().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const status = searchParams.get("status") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "Invalid page or limit" }, { status: 400 })
  }

  const where: any = { organizationId: orgId }
  if (search) where.name = { contains: search, mode: "insensitive" }
  if (status) where.status = status

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: { _count: { select: { participants: true } } },
      orderBy: { startDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count({ where }),
  ])

  return NextResponse.json({ success: true, data: { events, total, page, limit } })
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Org-validate the campaign link (a cross-org campaignId must not attach).
  if (parsed.data.campaignId) {
    const camp = await prisma.campaign.findFirst({ where: { id: parsed.data.campaignId, organizationId: orgId }, select: { id: true } })
    if (!camp) return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 })
  }

  const event = await prisma.event.create({
    data: {
      ...parsed.data,
      organizationId: orgId,
      startDate: new Date(parsed.data.startDate),
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    },
  })

  return NextResponse.json({ success: true, data: event }, { status: 201 })
})
