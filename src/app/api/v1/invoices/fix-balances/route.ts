import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeInvoiceRow, decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"

/**
 * POST /api/v1/invoices/fix-balances
 * One-time data fix: recalculate balanceDue for all invoices based on actual payments.
 * Fixes invoices marked "paid" that still show full balanceDue.
 */
export const POST = withRls(async (_req, { orgId }) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: orgId },
      include: { payments: true },
    })

    let fixed = 0
    const fixes: { id: string; invoiceNumber: string; oldBalance: number; newBalance: number; oldStatus: string; newStatus: string }[] = []

    for (const rawInv of invoices) {
      // Normalize Decimal money columns → JS numbers before arithmetic
      const inv = normalizeInvoiceRow(rawInv)
      // InvoicePayment.amount is Decimal(18,4) — use decimalToNumber() before arithmetic
      const actualPaid = rawInv.payments.reduce((sum: number, p: { amount: unknown }) => sum + decimalToNumber(p.amount), 0)
      const correctBalance = Math.max(0, Math.round((inv.totalAmount - actualPaid) * 100) / 100)

      let correctStatus = rawInv.status
      let correctPaid = Math.round(actualPaid * 100) / 100
      let correctBalanceDue = correctBalance

      // If invoice is marked "paid" but has no payment records,
      // trust the status (paid offline) and fix the balance to 0
      if (rawInv.status === "paid" && actualPaid === 0 && inv.totalAmount > 0) {
        correctPaid = inv.totalAmount
        correctBalanceDue = 0
      } else if (actualPaid > 0 && correctBalance <= 0) {
        correctStatus = "paid"
      } else if (actualPaid > 0 && correctBalance > 0) {
        correctStatus = "partially_paid"
      }
      // Don't change draft/cancelled/refunded statuses
      if (["draft", "cancelled", "refunded"].includes(rawInv.status)) {
        correctStatus = rawInv.status
      }

      const balanceChanged = Math.abs(inv.balanceDue - correctBalanceDue) > 0.001
      const paidChanged = Math.abs(inv.paidAmount - correctPaid) > 0.001
      const statusChanged = rawInv.status !== correctStatus

      if (balanceChanged || paidChanged || statusChanged) {
        await prisma.invoice.update({
          where: { id: rawInv.id },
          data: {
            paidAmount: correctPaid,
            balanceDue: correctBalanceDue,
            status: correctStatus,
            ...(correctBalanceDue <= 0 && correctPaid > 0 ? { paidAt: rawInv.paidAt || new Date() } : {}),
          },
        })
        fixes.push({
          id: rawInv.id,
          invoiceNumber: rawInv.invoiceNumber,
          oldBalance: inv.balanceDue,
          newBalance: correctBalanceDue,
          oldStatus: rawInv.status,
          newStatus: correctStatus,
        })
        fixed++
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: invoices.length,
        fixed,
        fixes,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
