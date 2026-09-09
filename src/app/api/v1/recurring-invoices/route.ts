import { NextResponse } from "next/server"
import { z } from "zod"
import { percentageSchema, taxRateSchema } from "@/lib/validation/numeric"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { DEFAULT_CURRENCY } from "@/lib/constants"

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.number().min(0.01).default(1),
  unitPrice: z.number().min(0).default(0),
  discount: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().default(0),
})

const createSchema = z.object({
  title: z.string().min(1),
  titleTemplate: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  contractId: z.string().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
  intervalCount: z.number().int().min(1).default(1),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  maxOccurrences: z.number().finite().int().min(1).max(10000).optional().nullable(),
  currency: z.string().default(DEFAULT_CURRENCY),
  // Same contract and same legacy caveat as invoices — see taxRateSchema.
  taxRate: taxRateSchema.default(0),
  includeVat: z.boolean().default(false),
  voen: z.string().optional().nullable(),
  paymentTerms: z.string().default("net30"),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  recipientEmail: z.string().optional().nullable(),
  items: z.array(itemSchema).default([]),
})

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const recurring = await prisma.recurringInvoice.findMany({
      where: { organizationId: orgId },
      include: { items: true, _count: { select: { invoices: true } } },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: recurring })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const d = parsed.data
    const startDate = new Date(d.startDate)

    const recurring = await prisma.recurringInvoice.create({
      data: {
        organizationId: orgId,
        title: d.title,
        titleTemplate: d.titleTemplate,
        companyId: d.companyId || undefined,
        contactId: d.contactId || undefined,
        dealId: d.dealId || undefined,
        contractId: d.contractId || undefined,
        frequency: d.frequency,
        intervalCount: d.intervalCount,
        startDate,
        endDate: d.endDate ? new Date(d.endDate) : undefined,
        nextRunDate: startDate,
        maxOccurrences: d.maxOccurrences,
        currency: d.currency,
        taxRate: d.taxRate,
        includeVat: d.includeVat,
        voen: d.voen,
        paymentTerms: d.paymentTerms,
        notes: d.notes,
        termsAndConditions: d.termsAndConditions,
        recipientEmail: d.recipientEmail,
        items: { create: d.items },
      },
      include: { items: true },
    })

    return NextResponse.json({ success: true, data: recurring }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
