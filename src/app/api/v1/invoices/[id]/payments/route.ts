import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { normalizeInvoicePaymentRow } from "@/lib/prisma-decimal"
import { afterInvoicePaymentRecorded, recordInvoicePaymentInTx } from "@/lib/invoices/record-invoice-payment"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const paymentSchema = z.object({
  amount: nonNegativeFinancialAmountSchema.positive(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  paymentMethod: z.enum(["bank_transfer", "cash", "card", "check", "other"]).default("bank_transfer"),
  paymentDate: z.string().max(64).refine((value) => !Number.isNaN(Date.parse(value)), "Invalid payment date").optional(),
  reference: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
}).strict()

const INVOICE_PAYMENT_BODY_LIMIT = 32 * 1024

export const GET = withRlsAuth("invoices", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const payments = await prisma.invoicePayment.findMany({
      where: { invoiceId: id, organizationId: orgId },
      orderBy: { paymentDate: "desc" },
    })
    return NextResponse.json({ success: true, data: payments.map(normalizeInvoicePaymentRow) })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("invoices", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await readJsonRequestWithinLimit(req, INVOICE_PAYMENT_BODY_LIMIT)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid JSON body" },
      { status: body.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = paymentSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const d = parsed.data
    const paymentDate = d.paymentDate ? new Date(d.paymentDate) : new Date()
    const outcome = await prisma.$transaction((tx: Prisma.TransactionClient) => recordInvoicePaymentInTx(tx, {
      orgId,
      invoiceId: id,
      amount: d.amount,
      currency: d.currency,
      paymentMethod: d.paymentMethod,
      paymentDate,
      reference: d.reference,
      notes: d.notes,
    }))

    if (outcome.kind === "not_found") {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }
    if (outcome.kind === "currency_mismatch") {
      return NextResponse.json({ error: "Payment currency must match invoice currency" }, { status: 400 })
    }
    const { invoice, payment, newBalanceDue } = outcome

    // Tenant context is established by withRlsAuth before the transaction starts.
    afterInvoicePaymentRecorded(orgId, invoice, newBalanceDue)

    return NextResponse.json({ success: true, data: normalizeInvoicePaymentRow(payment) }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
