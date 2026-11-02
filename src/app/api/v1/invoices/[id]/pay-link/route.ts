/**
 * The link a manager copies from the invoice card and sends to the customer:
 * the public invoice page, with a «Pay» button when the organization takes
 * card payments and the invoice can be paid by card.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  ensureInvoiceViewToken,
  invoicePageUrl,
  onlinePaymentAvailability,
} from "@/lib/payments/kapitalbank/invoice-checkout"

export const GET = withRlsAuth("invoices", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { status: true, currency: true, balanceDue: true, documentLanguage: true },
    })
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const availability = await onlinePaymentAvailability(orgId, invoice)
    const token = await ensureInvoiceViewToken(orgId, id)
    if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      success: true,
      data: {
        url: invoicePageUrl(token, invoice.documentLanguage),
        onlinePayment: availability.available
          ? { available: true, amount: availability.amount, currency: availability.currency }
          : { available: false, reason: availability.reason },
      },
    })
  } catch (e) {
    console.error("[invoices/pay-link]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
