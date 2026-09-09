import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { generateInvoiceNumber } from "@/lib/invoice-number"
import { calculateItemTotal, calculateInvoiceTotals, calculateDueDate, calculateBalance } from "@/lib/invoice-calculations"
import crypto from "crypto"
import { normalizeInvoiceRow, normalizeInvoiceItemRow } from "@/lib/prisma-decimal"
import {
  invoiceDiscountError,
  nonNegativeFinancialAmountSchema,
  normalizeTaxRate,
  taxRateSchema,
} from "@/lib/validation/numeric"

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.number().min(0.01).default(1),
  unitPrice: z.number().min(0).default(0),
  discount: z.number().min(0).max(100).default(0),
  taxRate: taxRateSchema.optional().nullable(),
  sortOrder: z.number().int().default(0),
  customFields: z.record(z.string(), z.string()).optional().nullable(),
})

const createSchema = z.object({
  title: z.string().min(1),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  contractId: z.string().optional().nullable(),
  offerId: z.string().optional().nullable(),
  status: z.string().default("draft"),
  currency: z.string().default(DEFAULT_CURRENCY),
  discountType: z.enum(["percentage", "fixed"]).default("percentage"),
  // Bounds only the type-independent part here; the percentage-vs-fixed rule
  // needs both fields and is applied by invoiceDiscountError below. Unbounded
  // until 2026-08-28: a negative discountValue made `subtotal - discountAmount`
  // ADD to the invoice, and 500 with discountType "percentage" produced a
  // negative total — both persisted straight into totalAmount and balanceDue.
  discountValue: nonNegativeFinancialAmountSchema.default(0),
  taxRate: taxRateSchema.default(0),
  includeVat: z.boolean().default(false),
  voen: z.string().optional().nullable(),
  sellerVoen: z.string().optional().nullable(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  paymentTerms: z.string().default("net30"),
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
  documentLanguage: z.string().default("az"),
  customColumns: z.array(z.object({ key: z.string(), label: z.string() })).optional().nullable(),
  items: z.array(itemSchema).default([]),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")
  const companyId = searchParams.get("companyId")
  const dealId = searchParams.get("dealId")
  const contractId = searchParams.get("contractId")
  const dateFrom = searchParams.get("dateFrom")
  const dateTo = searchParams.get("dateTo")

  try {
    const where: Record<string, unknown> = { organizationId: orgId }
    if (search) where.title = { contains: search, mode: "insensitive" }
    if (status) where.status = status
    if (companyId) where.companyId = companyId
    if (dealId) where.dealId = dealId
    if (contractId) where.contractId = contractId
    if (dateFrom || dateTo) {
      where.issueDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      }
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { company: { select: { id: true, name: true } }, items: true },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.invoice.count({ where }),
    ])

    const normalizedInvoices = invoices.map(
      (inv: Prisma.InvoiceGetPayload<{ include: { company: { select: { id: true; name: true } }; items: true } }>) => ({
        ...normalizeInvoiceRow(inv),
        items: inv.items.map(normalizeInvoiceItemRow),
      }),
    )
    return NextResponse.json({
      success: true,
      data: { invoices: normalizedInvoices, total, page, limit },
    })
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

  // The percentage-vs-fixed rule needs both fields, and the "cannot exceed the
  // invoice" rule needs the subtotal, so this sits here rather than in the
  // schema. Bounding the two forms separately is not enough on its own: a fixed
  // discount larger than the invoice still drives totalAmount negative.
  const draftSubtotal = parsed.data.items.reduce((sum, item) => sum + calculateItemTotal(item), 0)
  const discountProblem = invoiceDiscountError(
    parsed.data.discountType,
    parsed.data.discountValue,
    draftSubtotal,
  )
  if (discountProblem) {
    return NextResponse.json({ error: discountProblem }, { status: 400 })
  }

  try {
    const d = parsed.data
    const invoiceNumber = await generateInvoiceNumber(orgId)

    const itemsData = d.items.map((item, idx) => ({
      ...item,
      total: calculateItemTotal(item),
      sortOrder: item.sortOrder || idx,
    }))

    const totals = calculateInvoiceTotals(d.items, d.discountType, d.discountValue, normalizeTaxRate(d.taxRate), d.includeVat)
    const issueDate = d.issueDate ? new Date(d.issueDate) : new Date()
    const dueDate = d.dueDate ? new Date(d.dueDate) : calculateDueDate(issueDate, d.paymentTerms, d.paymentTermsDays)

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber,
        title: d.title,
        status: d.status,
        companyId: d.companyId || undefined,
        contactId: d.contactId || undefined,
        dealId: d.dealId || undefined,
        contractId: d.contractId || undefined,
        offerId: d.offerId || undefined,
        currency: d.currency,
        discountType: d.discountType,
        discountValue: d.discountValue,
        discountAmount: totals.discountAmount,
        taxRate: normalizeTaxRate(d.taxRate),
        taxAmount: totals.taxAmount,
        subtotal: totals.subtotal,
        totalAmount: totals.totalAmount,
        paidAmount: 0,
        balanceDue: totals.totalAmount,
        includeVat: d.includeVat,
        voen: d.voen,
        sellerVoen: d.sellerVoen,
        issueDate,
        dueDate,
        paymentTerms: d.paymentTerms,
        paymentTermsDays: d.paymentTermsDays,
        recipientEmail: d.recipientEmail,
        recipientName: d.recipientName,
        billingAddress: d.billingAddress,
        notes: d.notes,
        termsAndConditions: d.termsAndConditions,
        footerNote: d.footerNote,
        signerName: d.signerName,
        signerTitle: d.signerTitle,
        contractNumber: d.contractNumber,
        contractDate: d.contractDate,
        documentLanguage: d.documentLanguage,
        customColumns: d.customColumns || undefined,
        viewToken: crypto.randomUUID(),
        items: { create: itemsData },
      },
      include: { items: true, company: { select: { id: true, name: true } } },
    })

    return NextResponse.json({
      success: true,
      data: {
        ...normalizeInvoiceRow(invoice),
        items: invoice.items.map(normalizeInvoiceItemRow),
      },
    }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
