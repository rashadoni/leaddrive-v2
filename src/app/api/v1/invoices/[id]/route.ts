import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { calculateItemTotal, calculateInvoiceTotals, calculateBalance } from "@/lib/invoice-calculations"
import { decimalToNumber, normalizeInvoiceRow, normalizeInvoiceItemRow, normalizeInvoicePaymentRow } from "@/lib/prisma-decimal"
import {
  invoiceDiscountError,
  nonNegativeFinancialAmountSchema,
  normalizeTaxRate,
  taxRateSchema,
} from "@/lib/validation/numeric"

const itemSchema = z.object({
  id: z.string().optional(),
  productId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.number().min(0.01).default(1),
  unitPrice: z.number().min(0).default(0),
  discount: z.number().min(0).max(100).default(0),
  taxRate: taxRateSchema.optional().nullable(),
  sortOrder: z.number().int().default(0),
})

const updateSchema = z.object({
  title: z.string().optional(),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  contractId: z.string().optional().nullable(),
  status: z.string().optional(),
  currency: z.string().optional(),
  discountType: z.enum(["percentage", "fixed"]).optional(),
  // Was `min(0).max(100)` for both. That capped a FIXED discount at 100, so a
  // legitimate 500-unit discount was rejected outright; and it let taxRate reach
  // 100, which this codebase reads as a multiplier (0.18 = 18%), i.e. a 10 000%
  // tax that inflates the total by 101x. The type-dependent discount rule moves
  // to invoiceDiscountError, applied on the EFFECTIVE values below.
  discountValue: nonNegativeFinancialAmountSchema.optional(),
  taxRate: taxRateSchema.optional(),
  includeVat: z.boolean().optional(),
  voen: z.string().optional().nullable(),
  sellerVoen: z.string().optional().nullable(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional(),
  paymentTermsDays: z.number().optional().nullable(),
  recipientEmail: z.string().optional().nullable(),
  recipientName: z.string().optional().nullable(),
  billingAddress: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  footerNote: z.string().optional().nullable(),
  signerName: z.string().optional().nullable(),
  signerTitle: z.string().optional().nullable(),
  contractNumber: z.string().optional().nullable(),
  contractDate: z.string().optional().nullable(),
  documentLanguage: z.string().optional(),
  items: z.array(itemSchema).optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        payments: { where: { organizationId: orgId }, orderBy: { paymentDate: "desc" } },
        company: { select: { id: true, name: true, address: true, email: true, phone: true } },
        contact: { select: { id: true, fullName: true, email: true, phone: true } },
        deal: { select: { id: true, name: true } },
        contract: { select: { id: true, title: true, contractNumber: true } },
      },
    })

    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const normalized = normalizeInvoiceRow(invoice)
    return NextResponse.json({
      success: true,
      data: {
        ...normalized,
        items: invoice.items.map(normalizeInvoiceItemRow),
        payments: invoice.payments.map(normalizeInvoicePaymentRow),
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const existing = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: { payments: { where: { organizationId: orgId } } },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Prevent modifying paid invoices (only status change allowed)
    if (existing.status === "paid" && parsed.data.status !== "paid") {
      return NextResponse.json({ error: "Cannot modify a paid invoice" }, { status: 400 })
    }

    const d = parsed.data
    const { items, issueDate, dueDate, ...rest } = d

    // Effective values, resolved BEFORE anything is written. These three fields
    // reach the row through `...rest` whether or not `items` is present, so a
    // check that lives inside `if (items)` is simply skipped by a PUT that omits
    // them — the row then stores a discount that its own totals do not describe.
    const discountType = (d.discountType || existing.discountType) as "percentage" | "fixed"
    // decimalToNumber, as for paidAmount below: existing.discountValue is a
    // Prisma Decimal, and invoiceDiscountError's Number.isFinite() is false for
    // one, so an omitted discountValue would otherwise 400 every PUT.
    const discountValue = d.discountValue ?? decimalToNumber(existing.discountValue)
    // Normalized, not just validated: 43 live invoices store taxRate as 18
    // rather than 0.18, and recomputing one of those raw bills it at 1800%.
    const taxRate = normalizeTaxRate(d.taxRate ?? existing.taxRate)
    const includeVat = d.includeVat ?? existing.includeVat

    // The money the discount is measured against. Needed for the subtotal check,
    // and it is the current row's subtotal when the request sends no new items.
    const effectiveSubtotal = items
      ? items.reduce((sum, item) => sum + calculateItemTotal(item), 0)
      : decimalToNumber(existing.subtotal)

    const discountProblem = invoiceDiscountError(discountType, discountValue, effectiveSubtotal)
    if (discountProblem) {
      return NextResponse.json({ error: discountProblem }, { status: 400 })
    }

    const updateData: Record<string, unknown> = { ...rest }
    // A change to any of the three re-prices the invoice, so the stored totals
    // must be recomputed even when the caller sent no items — otherwise the row
    // keeps totals describing the previous discount.
    const repricing =
      d.discountType !== undefined || d.discountValue !== undefined ||
      d.taxRate !== undefined || d.includeVat !== undefined
    if (issueDate) updateData.issueDate = new Date(issueDate)
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null

    if (items || repricing) {
      if (items) {
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } })
        const itemsData = items.map((item, idx) => ({
          invoiceId: id,
          productId: item.productId || undefined,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          total: calculateItemTotal(item),
          sortOrder: item.sortOrder || idx,
        }))
        await prisma.invoiceItem.createMany({ data: itemsData })
      }

      // Reprice against the items that will actually be stored: the request's,
      // or the ones already on the row when this is a discount-only change.
      const pricedItems = items ?? (await prisma.invoiceItem.findMany({
        where: { invoiceId: id },
        select: { quantity: true, unitPrice: true, discount: true, taxRate: true },
      })).map((it: { quantity: unknown; unitPrice: unknown; discount: unknown; taxRate: number | null }) => ({
        quantity: decimalToNumber(it.quantity),
        unitPrice: decimalToNumber(it.unitPrice),
        discount: decimalToNumber(it.discount),
        taxRate: it.taxRate,
      }))

      const totals = calculateInvoiceTotals(pricedItems, discountType, discountValue, taxRate, includeVat)
      // Persist the normalized rate so the row stops disagreeing with its own
      // taxAmount, rather than leaving 18 in place to be re-read next time.
      updateData.taxRate = taxRate
      updateData.subtotal = totals.subtotal
      updateData.discountAmount = totals.discountAmount
      updateData.taxAmount = totals.taxAmount
      updateData.totalAmount = totals.totalAmount
      updateData.balanceDue = calculateBalance(totals.totalAmount, decimalToNumber(existing.paidAmount))
    }

    await prisma.invoice.updateMany({
      where: { id, organizationId: orgId },
      data: updateData,
    })
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        company: { select: { id: true, name: true } },
      },
    })

    const normalizedPut = normalizeInvoiceRow(invoice!)
    return NextResponse.json({
      success: true,
      data: {
        ...normalizedPut,
        items: invoice!.items.map(normalizeInvoiceItemRow),
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    await prisma.invoice.deleteMany({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
