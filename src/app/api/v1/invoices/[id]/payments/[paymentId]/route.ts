import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { calculateBalance } from "@/lib/invoice-calculations"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"
import { reverseAutoEarn } from "@/lib/loyalty"

export const DELETE = withRlsAuth("invoices", "delete", async (_req, authResult, { params }: { params: Promise<{ id: string; paymentId: string }> }) => {
  const orgId = authResult.orgId
  const { id, paymentId } = await params

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Share the same invoice-row serialization boundary as payment creation.
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id} AND "organizationId" = ${orgId} FOR UPDATE`

      const invoice = await tx.invoice.findFirst({ where: { id, organizationId: orgId } })
      if (!invoice) return null
      const payment = await tx.invoicePayment.findFirst({
        where: { id: paymentId, invoiceId: id, organizationId: orgId },
      })
      if (!payment) return null

      await tx.invoicePayment.delete({ where: { id: paymentId } })
      const newPaidAmount = decimalToNumber(invoice.paidAmount) - decimalToNumber(payment.amount)
      const newBalanceDue = calculateBalance(decimalToNumber(invoice.totalAmount), newPaidAmount)
      const remainsFullyPaid = newBalanceDue <= 0
      let newStatus = remainsFullyPaid ? "paid" : invoice.status
      if (!remainsFullyPaid && newPaidAmount <= 0) {
        newStatus = "sent"
      } else if (!remainsFullyPaid) {
        newStatus = "partially_paid"
      }

      const updated = await tx.invoice.updateMany({
        where: { id, organizationId: orgId },
        data: {
          paidAmount: Math.max(0, newPaidAmount),
          balanceDue: Math.max(0, newBalanceDue),
          status: newStatus,
          paidAt: remainsFullyPaid ? (invoice.paidAt ?? new Date()) : null,
        },
      })
      if (updated.count !== 1) throw new Error("Invoice changed during payment deletion")

      return { invoice, newBalanceDue }
    })

    if (!outcome) return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    const { invoice, newBalanceDue } = outcome

    // Loyalty: if the invoice is no longer fully paid, the purchase no longer
    // stands → claw back the auto-earned redeemable points (fire-and-forget,
    // same RLS-context pattern as the earn hook; no-ops if nothing was earned
    // or already reversed; tier/lifetime are NOT reduced — system invariant).
    if (newBalanceDue > 0) {
      reverseAutoEarn(prisma, {
        orgId,
        referenceId: id,
        reason: `Reversed: invoice ${invoice.invoiceNumber ?? id} no longer fully paid (payment deleted)`,
        actorUserId: authResult.userId,
      }).catch((e) => console.error("[loyalty auto-earn] reverse on payment-delete", e))
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
