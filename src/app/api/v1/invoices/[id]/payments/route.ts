import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { calculateBalance } from "@/lib/invoice-calculations"
import { decimalToNumber, normalizeInvoicePaymentRow } from "@/lib/prisma-decimal"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { createNotification } from "@/lib/notifications"
import { applyAutoEarn } from "@/lib/loyalty"
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
    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize every add/remove operation on this invoice. The lock is
      // acquired before reading paidAmount, so two concurrent payments cannot
      // both derive their update from the same stale balance.
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`

      const invoice = await tx.invoice.findFirst({
        where: { id, organizationId: orgId },
      })
      if (!invoice) return { kind: "not_found" as const }
      const invoiceCurrency = invoice.currency.toUpperCase()
      const paymentCurrency = d.currency ?? invoiceCurrency
      if (paymentCurrency !== invoiceCurrency) {
        // FX conversion is not implemented here. Never apply a nominal amount
        // from one currency directly to an invoice denominated in another.
        return { kind: "currency_mismatch" as const }
      }

      const payment = await tx.invoicePayment.create({
        data: {
          organizationId: orgId,
          invoiceId: id,
          amount: d.amount,
          currency: paymentCurrency,
          paymentMethod: d.paymentMethod,
          paymentDate,
          reference: d.reference,
          notes: d.notes,
        },
      })

      const newPaidAmount = decimalToNumber(invoice.paidAmount) + d.amount
      const newBalanceDue = calculateBalance(decimalToNumber(invoice.totalAmount), newPaidAmount)
      const newStatus = newBalanceDue <= 0
        ? "paid"
        : newPaidAmount > 0
          ? "partially_paid"
          : invoice.status

      const updated = await tx.invoice.updateMany({
        where: { id, organizationId: orgId },
        data: {
          paidAmount: newPaidAmount,
          balanceDue: Math.max(0, newBalanceDue),
          status: newStatus,
          ...(newBalanceDue <= 0 ? { paidAt: new Date() } : {}),
        },
      })
      if (updated.count !== 1) throw new Error("Invoice changed during payment update")

      await tx.paymentRegistryEntry.create({
        data: {
          organizationId: orgId,
          direction: "incoming",
          amount: d.amount,
          currency: paymentCurrency,
          counterpartyName: invoice.recipientName || "Unknown",
          counterpartyId: invoice.companyId,
          sourceType: "invoice_payment",
          sourceId: payment.id,
          invoiceId: id,
          category: "revenue",
          paymentDate,
          description: `Оплата по инвойсу ${invoice.invoiceNumber}`,
        },
      })

      if (newBalanceDue <= 0) {
        const activeChain = await tx.journeyEnrollment.findFirst({
          where: { invoiceId: id, organizationId: orgId, status: "active" },
        })
        if (activeChain) {
          const completed = await tx.journeyEnrollment.updateMany({
            where: { id: activeChain.id, organizationId: orgId, status: "active" },
            data: {
              status: "completed",
              completedAt: new Date(),
              processingToken: null,
              processingLeaseUntil: null,
            },
          })
          if (completed.count === 1) {
            await tx.journey.updateMany({
              where: { id: activeChain.journeyId, organizationId: orgId },
              data: { activeCount: { decrement: 1 }, completedCount: { increment: 1 } },
            })
          }
        }
      }

      return { kind: "created" as const, invoice, payment, newBalanceDue }
    })

    if (outcome.kind === "not_found") {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }
    if (outcome.kind === "currency_mismatch") {
      return NextResponse.json({ error: "Payment currency must match invoice currency" }, { status: 400 })
    }
    const { invoice, payment, newBalanceDue } = outcome

    // Phase 2a — best-effort notification when invoice becomes fully paid.
    // Org-wide (userId: "") so Finance-team members with access see it.
    // Org-wide = in-app only (no per-recipient push target).
    if (newBalanceDue <= 0) {
      createNotification({
        organizationId: orgId,
        userId: "",
        type: "success",
        title: "Invoice paid",
        message: `Invoice ${invoice.invoiceNumber} paid`,
        entityType: "invoice",
        entityId: id,
        kind: "invoice.paid",
      }).catch(() => {})
    }

    // Auto-stop communication chain when invoice is fully paid
    if (newBalanceDue <= 0) {
      // CDP: invoice fully paid → refresh the buyer's profile so totalSpent / LTV
      // reflect it immediately. Keyed by the invoice's contact (company-only
      // invoices are picked up by the hourly cron). Fire-and-forget.
      if (invoice.contactId) {
        refreshProfileForSource(prisma, orgId, "contact", invoice.contactId).catch((e) =>
          console.error("[cdp-hook] invoice-paid profile refresh failed", e),
        )
        // Loyalty auto-earn: invoice fully paid → award purchase points.
        // Opt-in per tenant (settings.loyaltyAutoEarn); no-op if disabled or
        // no active 'purchase' EarnRule. Idempotent on referenceId=invoice.id
        // (a re-fire can't double-award). Fire-and-forget — a loyalty failure
        // must never fail the payment. Tenant context is established by
        // withRlsAuth before the transaction starts.
        applyAutoEarn(prisma, {
          orgId,
          contactId: invoice.contactId,
          trigger: "purchase",
          orderAmount: decimalToNumber(invoice.totalAmount),
          currency: invoice.currency,
          referenceId: invoice.id,
          reason: `Invoice ${invoice.invoiceNumber} paid`,
          requireAutoEarnEnabled: true,
        }).catch((e) => console.error("[loyalty auto-earn] invoice-paid", e))
      }
    }

    return NextResponse.json({ success: true, data: normalizeInvoicePaymentRow(payment) }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
