import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { invoiceStats } from "@/lib/invoices/stats"
import { withRls } from "@/lib/with-rls"

type StatsRow = {
  status: string
  totalAmount: unknown
  paidAmount: unknown
  balanceDue: unknown
  currency: string
  issueDate: Date | null
  createdAt: Date
}

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const invoices: StatsRow[] = await prisma.invoice.findMany({
      where: { organizationId: orgId },
      select: { status: true, totalAmount: true, paidAmount: true, balanceDue: true, currency: true, createdAt: true, issueDate: true },
    })

    // Money per currency, never one sum across currencies: src/lib/invoices/stats.ts.
    const stats = invoiceStats(
      invoices.map((inv) => ({
        status: inv.status,
        // Decimal(18,4) columns become numbers before any arithmetic.
        totalAmount: decimalToNumber(inv.totalAmount),
        paidAmount: decimalToNumber(inv.paidAmount),
        balanceDue: decimalToNumber(inv.balanceDue),
        currency: inv.currency,
        issueDate: inv.issueDate,
        createdAt: inv.createdAt,
      })),
      new Date(),
      DEFAULT_CURRENCY,
    )

    return NextResponse.json({ success: true, data: stats })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
