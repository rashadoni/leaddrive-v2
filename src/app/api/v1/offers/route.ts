import { NextResponse } from "next/server"
import { z } from "zod"
import { percentageSchema } from "@/lib/validation/numeric"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { withRls } from "@/lib/with-rls"

const itemSchema = z.object({
  productId: z.string().nullable().optional(),
  name: z.string().min(1),
  quantity: z.number().min(0.01).default(1),
  unitPrice: z.number().min(0).default(0),
  discount: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().default(0),
})

const createOfferSchema = z.object({
  type: z.enum(["commercial", "invoice", "equipment", "services"]).default("commercial"),
  title: z.string().min(1).max(255),
  dealId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  voen: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  contractNumber: z.string().nullable().optional(),
  includeVat: z.boolean().default(false),
  // Percentage applied to the offer subtotal. Had a floor but no ceiling,
  // and invoices/from-offer copies it verbatim into an invoice's discountValue.
  discount: percentageSchema.default(0),
  currency: z.string().default(DEFAULT_CURRENCY),
  validUntil: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).default([]),
})

export const GET = withRls(async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")
  const dealId = searchParams.get("dealId")

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
      ...(status ? { status } : {}),
      ...(dealId ? { dealId } : {}),
    }

    const [offers, total] = await Promise.all([
      prisma.offer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          items: { select: { id: true } },
          deal: { select: { id: true, name: true } },
        },
      }),
      prisma.offer.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { offers, total, page, limit, search },
    })
  } catch (e) {
    console.error("[offers GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {

  const body = await req.json()
  const parsed = createOfferSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    if (parsed.data.dealId) {
      const deal = await prisma.deal.findFirst({
        where: { id: parsed.data.dealId, organizationId: orgId },
        select: { id: true },
      })
      if (!deal) return NextResponse.json({ error: "Invalid dealId" }, { status: 400 })
    }

    // Generate offer number
    const count = await prisma.offer.count({ where: { organizationId: orgId } })
    const year = new Date().getFullYear()
    const offerNumber = `OFF-${year}-${String(count + 1).padStart(3, "0")}`

    const { items, validUntil, ...offerData } = parsed.data

    // Calculate item totals
    const itemsWithTotals = items.map((item, idx) => {
      const subtotal = item.quantity * item.unitPrice
      const discountAmount = subtotal * (item.discount / 100)
      // organizationId is denormalised onto every line item: offer_items now
      // carries its own tenant_isolation policy instead of relying on callers
      // to remember the parent filter.
      return { ...item, organizationId: orgId, total: subtotal - discountAmount, sortOrder: item.sortOrder || idx }
    })

    const totalAmount = itemsWithTotals.reduce((sum, i) => sum + i.total, 0)

    const offer = await prisma.offer.create({
      data: {
        organizationId: orgId,
        offerNumber,
        ...offerData,
        validUntil: validUntil ? new Date(validUntil) : null,
        totalAmount,
        items: itemsWithTotals.length > 0 ? { create: itemsWithTotals } : undefined,
      },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        deal: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ success: true, data: offer }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
