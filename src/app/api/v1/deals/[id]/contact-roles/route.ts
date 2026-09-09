import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const addRoleSchema = z.object({
  contactId: z.string().min(1),
  role: z.string().default("contact_person"),
  influence: z.string().default("Medium"),
  decisionFactor: z.string().default("Ease of Use"),
  loyalty: z.string().default("Neutral"),
  isPrimary: z.boolean().default(false),
  cashbackType: z.enum(["percent", "fixed"]).nullable().optional(),
  cashbackValue: z.number().min(0).max(999999).nullable().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    // Verify deal belongs to this org first
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const roles = await prisma.dealContactRole.findMany({
      where: { dealId: id, deal: { organizationId: orgId } },
      orderBy: { createdAt: "asc" },
    })

    const contactIds = roles.map((r: any) => r.contactId)
    const contacts = contactIds.length > 0
      ? await prisma.contact.findMany({
          where: { id: { in: contactIds }, organizationId: orgId },
          select: { id: true, fullName: true, position: true, email: true, phone: true },
        })
      : []
    const contactMap = Object.fromEntries(contacts.map((c: any) => [c.id, c]))

    const enriched = roles.map((r: any) => ({
      ...r,
      contact: contactMap[r.contactId] || { id: r.contactId, fullName: "Unknown", position: null, email: null, phone: null },
    }))

    return NextResponse.json({ success: true, data: enriched })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = addRoleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const role = await prisma.dealContactRole.upsert({
      where: { dealId_contactId: { dealId: id, contactId: parsed.data.contactId } },
      create: { dealId: id, ...parsed.data },
      update: { role: parsed.data.role, influence: parsed.data.influence, decisionFactor: parsed.data.decisionFactor, loyalty: parsed.data.loyalty, isPrimary: parsed.data.isPrimary, cashbackType: parsed.data.cashbackType ?? null, cashbackValue: parsed.data.cashbackValue ?? null },
    })

    return NextResponse.json({ success: true, data: role })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const updateRoleSchema = z.object({
  contactId: z.string().min(1),
  role: z.string().optional(),
  influence: z.string().optional(),
  decisionFactor: z.string().optional(),
  loyalty: z.string().optional(),
  isPrimary: z.boolean().optional(),
  cashbackType: z.enum(["percent", "fixed"]).nullable().optional(),
  cashbackValue: z.number().min(0).max(999999).nullable().optional(),
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateRoleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const existing = await prisma.dealContactRole.findUnique({
      where: { dealId_contactId: { dealId: id, contactId: parsed.data.contactId } },
    })
    if (!existing) return NextResponse.json({ error: "Contact role not found" }, { status: 404 })

    const { contactId, ...updateData } = parsed.data
    const updated = await prisma.dealContactRole.update({
      where: { dealId_contactId: { dealId: id, contactId } },
      data: updateData,
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const { contactId } = await req.json()
    if (!contactId) return NextResponse.json({ error: "contactId required" }, { status: 400 })

    // Verify deal belongs to this org
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    await prisma.dealContactRole.deleteMany({ where: { dealId: id, contactId } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
