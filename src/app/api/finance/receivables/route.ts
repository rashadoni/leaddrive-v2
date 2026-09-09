import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { parseOptionalDateRange } from "@/lib/finance/date-range"
import { runWithTenant } from "@/lib/rls-context"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
  const now = new Date()

  // E-4.4: optional date range filter
  const rangeResult = parseOptionalDateRange(req)
  if (rangeResult.errorResponse) return rangeResult.errorResponse
  const issueDateFilter = rangeResult.hasDateRange ? rangeResult.dateRangeFilter : undefined

  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
      ...(issueDateFilter && { issueDate: issueDateFilter }),
    },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      balanceDue: true,
      dueDate: true,
      status: true,
      companyId: true,
      company: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: "asc" },
  })

  // Aging buckets (days overdue past due date)
  const aging = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1-30 days", amount: 0, count: 0 },
    { label: "31-60 days", amount: 0, count: 0 },
    { label: "61-90 days", amount: 0, count: 0 },
    { label: "90+", amount: 0, count: 0 },
  ]

  const companyMap: Record<string, { companyName: string; companyId: string; amount: number; overdueAmount: number; invoiceCount: number }> = {}
  const overdueList: any[] = []

  let total = 0
  let overdueTotal = 0
  let overdueCount = 0

  invoices.forEach((inv: typeof invoices[number]) => {
    // balanceDue is Decimal(18,4) after migration — decimalToNumber() prevents += string-concat
    const balance = decimalToNumber(inv.balanceDue)
    total += balance

    // Aging — based on days past due date
    if (inv.dueDate) {
      const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000)

      if (daysOverdue <= 0) {
        // Not yet due — current
        aging[0].amount += balance
        aging[0].count += 1
      } else {
        // Past due — distribute into overdue buckets
        const bucket = daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4
        aging[bucket].amount += balance
        aging[bucket].count += 1

        if (balance > 0) {
          overdueTotal += balance
          overdueCount += 1
          overdueList.push({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            companyName: inv.company?.name || "Unknown",
            totalAmount: decimalToNumber(inv.totalAmount),
            balanceDue: balance,
            dueDate: inv.dueDate,
            daysOverdue,
          })
        }
      }
    }

    // By company
    const cId = inv.companyId || "unknown"
    const cName = inv.company?.name || "Unknown"
    if (!companyMap[cId]) {
      companyMap[cId] = { companyName: cName, companyId: cId, amount: 0, overdueAmount: 0, invoiceCount: 0 }
    }
    companyMap[cId].amount += balance
    companyMap[cId].invoiceCount += 1
    if (inv.dueDate && new Date(inv.dueDate) < now) {
      companyMap[cId].overdueAmount += balance
    }
  })

  const topDebtors = Object.values(companyMap)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)

  return NextResponse.json({
    data: {
      total,
      overdueTotal,
      overdueCount,
      aging,
      topDebtors,
      overdueInvoices: overdueList.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 20),
    },
  })
  })
}
