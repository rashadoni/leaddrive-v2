import { NextResponse } from "next/server"
import { invoiceDiscountError } from "@/lib/validation/numeric"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { generateInvoiceNumber } from "@/lib/invoice-number"
import { calculateItemTotal, calculateInvoiceTotals, calculateDueDate } from "@/lib/invoice-calculations"
import crypto from "crypto"
import { normalizeInvoiceRow, normalizeInvoiceItemRow } from "@/lib/prisma-decimal"

export const POST = withRls(async (req, { orgId }) => {

  const body = await req.json()
  const offerId = body.offerId as string
  if (!offerId) return NextResponse.json({ error: "offerId required" }, { status: 400 })

  try {
    const offer = await prisma.offer.findFirst({
      where: { id: offerId, organizationId: orgId },
      include: { items: true },
    })
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 })

    const invoiceNumber = await generateInvoiceNumber(orgId)
    const items = offer.items.map((item: any) => ({
      productId: item.productId || undefined,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: calculateItemTotal({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount }),
      sortOrder: item.sortOrder,
    }))

    const taxRate = offer.includeVat ? 0.18 : 0

    // Re-validated rather than inherited: offers written before the header
    // discount was bounded can still hold an out-of-range value, and this route
    // copies it straight into the invoice's discountValue.
    const offerItems = items.map((i: any) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount }))
    const offerSubtotal = offerItems.reduce((sum: number, i: any) => sum + calculateItemTotal(i), 0)
    const offerDiscountProblem = invoiceDiscountError("percentage", Number(offer.discount) || 0, offerSubtotal)
    if (offerDiscountProblem) {
      return NextResponse.json({ error: offerDiscountProblem }, { status: 400 })
    }

    const totals = calculateInvoiceTotals(
      items.map((i: any) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount })),
      "percentage",
      offer.discount || 0,
      taxRate,
      offer.includeVat
    )

    const issueDate = new Date()
    const dueDate = calculateDueDate(issueDate, "net30")

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber,
        title: offer.title,
        offerId: offer.id,
        dealId: offer.dealId || undefined,
        companyId: offer.companyId || undefined,
        contactId: offer.contactId || undefined,
        currency: offer.currency,
        voen: offer.voen,
        includeVat: offer.includeVat,
        taxRate,
        discountType: "percentage",
        discountValue: offer.discount || 0,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        paidAmount: 0,
        balanceDue: totals.totalAmount,
        issueDate,
        dueDate,
        paymentTerms: "net30",
        recipientEmail: offer.recipientEmail,
        viewToken: crypto.randomUUID(),
        items: { create: items },
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
