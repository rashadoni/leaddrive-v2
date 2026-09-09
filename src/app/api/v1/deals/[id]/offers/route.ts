import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { DEFAULT_CURRENCY } from "@/lib/constants"

const itemSchema = z.object({
  productId: z.string().nullable().optional(),
  name: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.number().min(0).default(0),
  discount: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().default(0),
})

const createOfferSchema = z.object({
  type: z.enum(["commercial", "invoice", "equipment", "services"]).default("commercial"),
  title: z.string().min(1),
  currency: z.string().default(DEFAULT_CURRENCY),
  companyId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  voen: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  contractNumber: z.string().nullable().optional(),
  includeVat: z.boolean().default(false),
  discount: z.number().min(0).default(0),
  validUntil: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).default([]),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const offers = await prisma.offer.findMany({
      where: { dealId: id, organizationId: orgId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: offers })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = createOfferSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    // Generate offer number
    const count = await prisma.offer.count({ where: { organizationId: orgId } })
    const year = new Date().getFullYear()
    const offerNumber = `OFF-${year}-${String(count + 1).padStart(3, "0")}`

    const { items, validUntil, ...offerData } = parsed.data

    // Calculate item totals
    const itemsWithTotals = items.map((item, idx) => {
      const subtotal = item.quantity * item.unitPrice
      const discountAmount = subtotal * (item.discount / 100)
      return { ...item, total: subtotal - discountAmount, sortOrder: item.sortOrder || idx }
    })

    const totalAmount = itemsWithTotals.reduce((sum, i) => sum + i.total, 0)

    const offer = await prisma.offer.create({
      data: {
        organizationId: orgId,
        dealId: id,
        offerNumber,
        ...offerData,
        validUntil: validUntil ? new Date(validUntil) : null,
        totalAmount,
        items: { create: itemsWithTotals },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    })

    return NextResponse.json({ success: true, data: offer })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
