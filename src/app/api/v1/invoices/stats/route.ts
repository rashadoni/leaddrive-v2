import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { normalizeInvoiceRow } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfYear = new Date(now.getFullYear(), 0, 1)

    const invoices = await prisma.invoice.findMany({
      where: { organizationId: orgId },
      select: { status: true, totalAmount: true, paidAmount: true, balanceDue: true, subtotal: true, taxAmount: true, createdAt: true, issueDate: true },
    })

    const stats = {
      totalCount: invoices.length,
      totalAmount: 0,
      subtotalAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      overdueAmount: 0,
      draftCount: 0,
      sentCount: 0,
      paidCount: 0,
      overdueCount: 0,
      partiallyPaidCount: 0,
      thisMonthCount: 0,
      thisMonthAmount: 0,
      thisYearCount: 0,
      thisYearAmount: 0,
      cancelledCount: 0,
    }

    for (const rawInv of invoices) {
      // normalizeInvoiceRow converts Decimal(18,4) columns to JS numbers
      // so += arithmetic doesn't coerce Decimal objects to NaN.
      const inv = normalizeInvoiceRow(rawInv)
      stats.totalAmount += inv.totalAmount
      stats.subtotalAmount += inv.subtotal
      stats.taxAmount += inv.taxAmount
      stats.paidAmount += inv.paidAmount
      const date = rawInv.issueDate || rawInv.createdAt
      if (date >= startOfMonth) { stats.thisMonthCount++; stats.thisMonthAmount += inv.totalAmount }
      if (date >= startOfYear) { stats.thisYearCount++; stats.thisYearAmount += inv.totalAmount }
      if (rawInv.status === "draft") stats.draftCount++
      else if (rawInv.status === "sent" || rawInv.status === "viewed") {
        stats.sentCount++
        stats.outstandingAmount += inv.balanceDue
      } else if (rawInv.status === "paid") stats.paidCount++
      else if (rawInv.status === "overdue") {
        stats.overdueCount++
        stats.overdueAmount += inv.balanceDue
        stats.outstandingAmount += inv.balanceDue
      } else if (rawInv.status === "partially_paid") {
        stats.partiallyPaidCount++
        stats.outstandingAmount += inv.balanceDue
      } else if (rawInv.status === "cancelled") stats.cancelledCount++
    }

    const avgAmount = stats.totalCount > 0 ? stats.totalAmount / stats.totalCount : 0

    return NextResponse.json({ success: true, data: {
      ...stats,
      avgAmount,
      totalInvoiced: stats.totalAmount,
      totalSubtotal: stats.subtotalAmount,
      totalTax: stats.taxAmount,
      totalPaid: stats.paidAmount,
      totalOutstanding: stats.outstandingAmount,
      totalOverdue: stats.overdueAmount,
      currency: DEFAULT_CURRENCY,
    } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
