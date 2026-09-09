import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { generateInvoiceNumber } from "@/lib/invoice-number"
import crypto from "crypto"
import { normalizeInvoiceRow, normalizeInvoiceItemRow } from "@/lib/prisma-decimal"

export const POST = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const original = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true },
    })
    if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const invoiceNumber = await generateInvoiceNumber(orgId)

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: original.organizationId,
        invoiceNumber,
        title: original.title,
        status: "draft",
        dealId: original.dealId,
        companyId: original.companyId,
        contactId: original.contactId,
        contractId: original.contractId,
        offerId: original.offerId,
        currency: original.currency,
        discountType: original.discountType,
        discountValue: original.discountValue,
        discountAmount: original.discountAmount,
        taxRate: original.taxRate,
        taxAmount: original.taxAmount,
        subtotal: original.subtotal,
        totalAmount: original.totalAmount,
        paidAmount: 0,
        balanceDue: original.totalAmount,
        includeVat: original.includeVat,
        voen: original.voen,
        sellerVoen: original.sellerVoen,
        issueDate: new Date(),
        paymentTerms: original.paymentTerms,
        paymentTermsDays: original.paymentTermsDays,
        recipientEmail: original.recipientEmail,
        recipientName: original.recipientName,
        billingAddress: original.billingAddress,
        notes: original.notes,
        termsAndConditions: original.termsAndConditions,
        footerNote: original.footerNote,
        viewToken: crypto.randomUUID(),
        items: {
          create: original.items.map((oi: any) => ({
            productId: oi.productId || undefined,
            name: oi.name,
            description: oi.description,
            quantity: oi.quantity,
            unitPrice: oi.unitPrice,
            discount: oi.discount,
            taxRate: oi.taxRate,
            total: oi.total,
            sortOrder: oi.sortOrder,
          })),
        },
      },
      include: { items: true },
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
