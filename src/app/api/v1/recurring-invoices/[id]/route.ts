import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { percentageSchema, taxRateSchema } from "@/lib/validation/numeric"

// This route used to be raw mass-assignment — `const { items, startDate,
// endDate, ...rest } = body` straight into `recurringInvoice.update`. Every
// bound the create route applies was therefore optional in practice, on a table
// the generator cron turns into real invoices
// (src/app/api/v1/recurring-invoices/generate/route.ts reads taxRate and
// maxOccurrences from the row). Mirrors createSchema; `.strict()` so a field
// added to create cannot silently arrive here unvalidated.
const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.number().finite().min(0.01).default(1),
  unitPrice: z.number().finite().min(0).default(0),
  discount: percentageSchema.default(0),
  sortOrder: z.number().int().default(0),
}).strict()

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  titleTemplate: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  contractId: z.string().optional().nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
  intervalCount: z.number().finite().int().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  maxOccurrences: z.number().finite().int().min(1).max(10000).optional().nullable(),
  currency: z.string().max(10).optional(),
  taxRate: taxRateSchema.optional(),
  includeVat: z.boolean().optional(),
  voen: z.string().optional().nullable(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  recipientEmail: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  items: z.array(itemSchema).optional(),
}).strict()

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true, invoices: { where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 20 } },
    })
    if (!recurring) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: recurring })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const existing = await prisma.recurringInvoice.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { items, startDate, endDate, ...rest } = parsed.data

    const updateData: Record<string, unknown> = { ...rest }
    if (startDate) updateData.startDate = new Date(startDate)
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null

    if (items) {
      await prisma.recurringInvoiceItem.deleteMany({ where: { recurringInvoiceId: id } })
      await prisma.recurringInvoiceItem.createMany({
        data: items.map((item, idx) => ({
          recurringInvoiceId: id,
          productId: item.productId || undefined,
          name: item.name,
          description: item.description ?? undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          sortOrder: item.sortOrder || idx,
        })),
      })
    }

    const recurring = await prisma.recurringInvoice.update({
      where: { id },
      data: updateData,
      include: { items: true },
    })

    return NextResponse.json({ success: true, data: recurring })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    await prisma.recurringInvoice.deleteMany({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
