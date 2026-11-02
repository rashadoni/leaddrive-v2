/**
 * Recording a payment against a customer invoice — the one write path for a
 * payment a person enters (POST /api/v1/invoices/[id]/payments) and for a
 * card payment the bank confirms (src/lib/payments/kapitalbank/invoice-checkout.ts).
 *
 * Inside the caller's transaction: lock the invoice row, add the payment, move
 * paidAmount / balanceDue / status, write the payment-registry row and finish
 * an active reminder chain once nothing is owed. After commit:
 * `afterInvoicePaymentRecorded` sends the "paid" notice and the loyalty /
 * profile refreshes, none of which may fail the payment.
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { calculateBalance } from "@/lib/invoice-calculations"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { createNotification } from "@/lib/notifications"
import { applyAutoEarn } from "@/lib/loyalty"

export interface RecordInvoicePaymentInput {
  orgId: string
  invoiceId: string
  amount: number
  /** Defaults to the invoice's currency; any other currency is refused. */
  currency?: string
  paymentMethod: string
  paymentDate: Date
  reference?: string | null
  notes?: string | null
  createdBy?: string | null
}

type InvoiceRow = NonNullable<Awaited<ReturnType<typeof prisma.invoice.findFirst>>>
type PaymentRow = Awaited<ReturnType<typeof prisma.invoicePayment.create>>

export type RecordInvoicePaymentOutcome =
  | { kind: "not_found" }
  | { kind: "currency_mismatch" }
  | { kind: "created"; invoice: InvoiceRow; payment: PaymentRow; newBalanceDue: number }

export async function recordInvoicePaymentInTx(
  tx: Prisma.TransactionClient,
  input: RecordInvoicePaymentInput,
): Promise<RecordInvoicePaymentOutcome> {
  const { orgId, invoiceId: id } = input
  // Serialize every add/remove operation on this invoice. The lock is
  // acquired before reading paidAmount, so two concurrent payments cannot
  // both derive their update from the same stale balance.
  await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`

  const invoice = await tx.invoice.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!invoice) return { kind: "not_found" }
  const invoiceCurrency = invoice.currency.toUpperCase()
  const paymentCurrency = input.currency?.toUpperCase() ?? invoiceCurrency
  if (paymentCurrency !== invoiceCurrency) {
    // FX conversion is not implemented here. Never apply a nominal amount
    // from one currency directly to an invoice denominated in another.
    return { kind: "currency_mismatch" }
  }

  const payment = await tx.invoicePayment.create({
    data: {
      organizationId: orgId,
      invoiceId: id,
      amount: input.amount,
      currency: paymentCurrency,
      paymentMethod: input.paymentMethod,
      paymentDate: input.paymentDate,
      reference: input.reference,
      notes: input.notes,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    },
  })

  const newPaidAmount = decimalToNumber(invoice.paidAmount) + input.amount
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
      amount: input.amount,
      currency: paymentCurrency,
      counterpartyName: invoice.recipientName || "Unknown",
      counterpartyId: invoice.companyId,
      sourceType: "invoice_payment",
      sourceId: payment.id,
      invoiceId: id,
      category: "revenue",
      paymentDate: input.paymentDate,
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

  return { kind: "created", invoice, payment, newBalanceDue }
}

/**
 * Best-effort follow-ups once the payment has committed. Runs under the same
 * tenant scope as the transaction.
 */
export function afterInvoicePaymentRecorded(orgId: string, invoice: InvoiceRow, newBalanceDue: number): void {
  if (newBalanceDue > 0) return

  // Org-wide (userId: "") so Finance-team members with access see it.
  // Org-wide = in-app only (no per-recipient push target).
  createNotification({
    organizationId: orgId,
    userId: "",
    type: "success",
    title: "Invoice paid",
    message: `Invoice ${invoice.invoiceNumber} paid`,
    entityType: "invoice",
    entityId: invoice.id,
    kind: "invoice.paid",
  }).catch(() => {})

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
    // must never fail the payment.
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
