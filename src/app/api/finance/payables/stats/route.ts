import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { parseOptionalDateRange } from "@/lib/finance/date-range"
import { decimalToNumber } from "@/lib/prisma-decimal"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
  const now = new Date()

  // E-4.4: optional date range filter
  const rangeResult = parseOptionalDateRange(req)
  if (rangeResult.errorResponse) return rangeResult.errorResponse
  const issueDateFilter = rangeResult.hasDateRange ? rangeResult.dateRangeFilter : undefined

  const bills = await prisma.bill.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["pending", "partially_paid", "overdue"] },
      ...(issueDateFilter && { issueDate: issueDateFilter }),
    },
    select: {
      id: true, billNumber: true, vendorName: true, vendorId: true, title: true,
      totalAmount: true, balanceDue: true, dueDate: true, status: true, category: true,
    },
    orderBy: { dueDate: "asc" },
  })

  const aging = [
    { label: "0-30 days", amount: 0, count: 0 },
    { label: "31-60 days", amount: 0, count: 0 },
    { label: "61-90 days", amount: 0, count: 0 },
    { label: "90+", amount: 0, count: 0 },
  ]

  let total = 0
  let overdueTotal = 0
  let overdueCount = 0
  const vendorMap: Record<string, { vendorName: string; vendorId?: string; amount: number; billCount: number }> = {}

  bills.forEach((bill: typeof bills[number]) => {
    // balanceDue is Decimal(18,4) — convert before += to prevent string-concat
    const balance = decimalToNumber(bill.balanceDue)
    total += balance

    if (bill.dueDate) {
      const days = Math.max(0, Math.floor((now.getTime() - new Date(bill.dueDate).getTime()) / 86400000))
      const bucket = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3
      aging[bucket].amount += balance
      aging[bucket].count += 1

      if (new Date(bill.dueDate) < now && balance > 0) {
        overdueTotal += balance
        overdueCount += 1
      }
    }

    const vKey = bill.vendorId || bill.vendorName
    if (!vendorMap[vKey]) {
      vendorMap[vKey] = { vendorName: bill.vendorName, vendorId: bill.vendorId || undefined, amount: 0, billCount: 0 }
    }
    vendorMap[vKey].amount += balance
    vendorMap[vKey].billCount += 1
  })

  const topVendors = Object.values(vendorMap).sort((a, b) => b.amount - a.amount).slice(0, 10)

  // Upcoming payments (next 7 days)
  const sevenDays = new Date(now.getTime() + 7 * 86400000)
  const upcomingPayments = bills.filter((b: typeof bills[number]) => b.dueDate && new Date(b.dueDate) >= now && new Date(b.dueDate) <= sevenDays)

  return NextResponse.json({
    data: {
      total,
      overdueTotal,
      overdueCount,
      aging,
      topVendors,
      upcomingPayments,
    },
  })
  })
}
