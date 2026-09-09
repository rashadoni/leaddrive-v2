import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { prisma } from "@/lib/prisma"
import { getCurrencySymbol } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { parseOptionalDateRange } from "@/lib/finance/date-range"

type InvoiceRow = { id: string; invoiceNumber: string | null; totalAmount: unknown; balanceDue: unknown; dueDate: Date | null; issueDate: Date | null; status: string; companyId: string | null }
type BillRow = { id: string; totalAmount: unknown; balanceDue: unknown; dueDate: Date | null; issueDate: Date | null; status: string; category: string | null; vendorName: string | null }
type CashFlowRow = { month: number; entryType: string; amount: number }
type SalesForecastRow = { month: number; amount: number | null }
type FundRow = { currentBalance: unknown }

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const EXPENSE_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"]

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
  // E-4: Date range filter (shared parser handles all validation + UTC normalisation)
  const rangeResult = parseOptionalDateRange(req)
  if (rangeResult.errorResponse) return rangeResult.errorResponse

  let year: number
  let dateRangeFilter: { gte: Date; lte: Date } | undefined
  let startMonth: number
  let endMonth: number

  if (rangeResult.hasDateRange) {
    dateRangeFilter = rangeResult.dateRangeFilter
    year = rangeResult.year
    startMonth = rangeResult.startMonth
    endMonth = rangeResult.endMonth
  } else {
    year = parseInt(req.nextUrl.searchParams.get("year") || new Date().getFullYear().toString())
    startMonth = 1
    endMonth = 12
  }

  const dateFromStr = req.nextUrl.searchParams.get("dateFrom")
  const dateToStr = req.nextUrl.searchParams.get("dateTo")
  const hasDateRange = rangeResult.hasDateRange

  const now = new Date()
  const currentMonth = now.getMonth() + 1

  // Auto-update overdue statuses on dashboard load
  await Promise.all([
    prisma.bill.updateMany({
      where: { organizationId: orgId, dueDate: { lt: now }, status: { in: ["pending", "partially_paid"] }, balanceDue: { gt: 0 } },
      data: { status: "overdue" },
    }),
    prisma.invoice.updateMany({
      where: { organizationId: orgId, dueDate: { lt: now }, status: { in: ["sent", "viewed", "partially_paid"] }, balanceDue: { gt: 0 } },
      data: { status: "overdue" },
    }),
  ])

  // Run all queries in parallel
  const [
    invoices,
    bills,
    cashFlowEntries,
    salesForecasts,
    funds,
  ] = await Promise.all([
    // Invoices — ALL statuses, not just the unpaid ones. A/R still uses only the
    // unpaid subset (filtered below), but revenue now comes from what has
    // actually been collected, so paid invoices must be in the set too.
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { notIn: ["draft", "cancelled"] },
        ...(dateRangeFilter ? { issueDate: dateRangeFilter } : { issueDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) } }),
      },
      select: { id: true, invoiceNumber: true, totalAmount: true, balanceDue: true, dueDate: true, issueDate: true, status: true, companyId: true },
    }),
    // Bills — same reasoning: A/P from the unpaid subset, expenses from what
    // has been paid. `category` drives the expense breakdown.
    prisma.bill.findMany({
      where: {
        organizationId: orgId,
        status: { notIn: ["draft", "cancelled"] },
        ...(dateRangeFilter ? { issueDate: dateRangeFilter } : { issueDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) } }),
      },
      select: { id: true, totalAmount: true, balanceDue: true, dueDate: true, issueDate: true, status: true, category: true, vendorName: true },
    }),
    // Cash flow (optionally scoped to month range)
    prisma.cashFlowEntry.findMany({
      where: {
        organizationId: orgId,
        year,
        ...(hasDateRange && { month: { gte: startMonth, lte: endMonth } }),
      },
      select: { month: true, entryType: true, amount: true },
    }),
    // Sales forecast for revenue trend (optionally scoped to month range)
    prisma.salesForecast.findMany({
      where: {
        organizationId: orgId,
        year,
        ...(hasDateRange && { month: { gte: startMonth, lte: endMonth } }),
      },
      select: { month: true, amount: true },
    }),
    // Funds total
    prisma.fund.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { currentBalance: true },
    }),
  ])

  // === KPIs ===

  // Plan/fact used to come from the budgeting module's budget_lines and
  // budget_actuals. That module was removed, so those tables can no longer be
  // written to — leaving them wired up here would freeze the dashboard at
  // whatever was last entered and show zeros for every future year. Every figure
  // below now comes from a source the product still maintains:
  //
  //   revenue plan  ← sales forecast   (/settings/sales-forecast, still live)
  //   revenue fact  ← invoices collected  (totalAmount − balanceDue)
  //   expense fact  ← bills paid          (totalAmount − balanceDue)
  //   expense plan  ← no live source; reported as null rather than a fake 0
  //
  // "Collected/paid", not "issued": an unpaid invoice is A/R, and counting it as
  // revenue would double-count it against the A/R KPI right next to it.
  const inRange = (d: Date | null): boolean => {
    if (!d) return false
    if (dateRangeFilter) return d >= dateRangeFilter.gte && d <= dateRangeFilter.lte
    return d.getUTCFullYear() === year
  }
  const collected = (row: { totalAmount: unknown; balanceDue: unknown }): number =>
    decimalToNumber(row.totalAmount) - decimalToNumber(row.balanceDue)

  const invoiceRows = invoices as InvoiceRow[]
  const billRows = bills as BillRow[]

  // Revenue plan vs fact
  const revenuePlan = (salesForecasts as SalesForecastRow[])
    .reduce((s: number, f: SalesForecastRow) => s + (f.amount || 0), 0)
  const revenueFact = invoiceRows
    .filter((i) => inRange(i.issueDate))
    .reduce((s: number, i: InvoiceRow) => s + collected(i), 0)

  // Expense fact. There is no expense PLAN any more — the budgeting module was
  // the only thing that produced one.
  const expensePlan: number | null = null
  const expenseFact = billRows
    .filter((b) => inRange(b.issueDate))
    .reduce((s: number, b: BillRow) => s + collected(b), 0)

  // Net profit
  const netProfit = revenueFact - expenseFact

  // Cash balance
  const totalInflows = (cashFlowEntries as CashFlowRow[]).filter((e: CashFlowRow) => e.entryType === "inflow").reduce((s: number, e: CashFlowRow) => s + e.amount, 0)
  const totalOutflows = (cashFlowEntries as CashFlowRow[]).filter((e: CashFlowRow) => e.entryType === "outflow").reduce((s: number, e: CashFlowRow) => s + e.amount, 0)
  const cashBalance = totalInflows - totalOutflows

  // A/R — balanceDue is Decimal(18,4) after migration; decimalToNumber() prevents += string-concat.
  // The query now returns PAID invoices too (revenue needs them), and a paid one
  // carries balanceDue 0 — harmless in the sums, but it would sail through the
  // "due date has passed" test and inflate overdueCount. Nothing is overdue once
  // it is settled, so both filters require an outstanding balance.
  const outstanding = (row: { balanceDue: unknown }): boolean => decimalToNumber(row.balanceDue) > 0
  const arTotal = invoiceRows.reduce((s: number, i: InvoiceRow) => s + decimalToNumber(i.balanceDue), 0)
  const overdueInvoices = invoiceRows.filter((i: InvoiceRow) => outstanding(i) && (i.status === "overdue" || (i.dueDate && new Date(i.dueDate) < now)))
  const arOverdue = overdueInvoices.reduce((s: number, i: InvoiceRow) => s + decimalToNumber(i.balanceDue), 0)

  // A/P — same reasoning as A/R above.
  const apTotal = billRows.reduce((s: number, b: BillRow) => s + decimalToNumber(b.balanceDue), 0)
  const overdueBills = billRows.filter((b: BillRow) => outstanding(b) && (b.status === "overdue" || (b.dueDate && new Date(b.dueDate) < now)))
  const apOverdue = overdueBills.reduce((s: number, b: BillRow) => s + decimalToNumber(b.balanceDue), 0)

  // === Revenue Trend (months in range — 1..12 for full year, startMonth..endMonth for custom range) ===
  const revenueTrend = []
  for (let m = startMonth; m <= endMonth; m++) {
    const monthRevenue = invoiceRows
      .filter((i) => inRange(i.issueDate) && i.issueDate!.getUTCMonth() + 1 === m)
      .reduce((s: number, i: InvoiceRow) => s + collected(i), 0)
    const monthExpense = billRows
      .filter((b) => inRange(b.issueDate) && b.issueDate!.getUTCMonth() + 1 === m)
      .reduce((s: number, b: BillRow) => s + collected(b), 0)
    // Fallback to sales forecast for revenue when nothing was collected that month
    const forecastRevenue = (salesForecasts as SalesForecastRow[])
      .filter((f: SalesForecastRow) => f.month === m)
      .reduce((s: number, f: SalesForecastRow) => s + (f.amount || 0), 0)

    revenueTrend.push({
      month: m,
      year,
      label: MONTH_NAMES[m - 1],
      revenue: monthRevenue || forecastRevenue,
      expenses: monthExpense,
      net: (monthRevenue || forecastRevenue) - monthExpense,
    })
  }

  // === Expense Breakdown ===
  // Was budget_actuals.category; now the vendor bill's own category, falling
  // back to the vendor name so an uncategorised bill is still attributable
  // rather than collapsing into one giant "Other" slice.
  const categoryMap: Record<string, number> = {}
  billRows
    .filter((b) => inRange(b.issueDate))
    .forEach((b: BillRow) => {
      const cat = b.category || b.vendorName || "Other"
      categoryMap[cat] = (categoryMap[cat] || 0) + collected(b)
    })
  const sortedCategories = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const otherAmount = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(6)
    .reduce((s, [, v]) => s + v, 0)
  const totalExp = expenseFact || 1
  const expenseBreakdown = sortedCategories.map(([category, amount], i) => ({
    category,
    amount,
    pct: Math.round((amount / totalExp) * 100),
    color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
    isOther: false,
  }))
  if (otherAmount > 0) {
    // `category` is kept as an English fallback; the UI renders the localized
    // "Other" label when `isOther` is set (see finance-dashboard.tsx).
    expenseBreakdown.push({ category: "Other", isOther: true, amount: otherAmount, pct: Math.round((otherAmount / totalExp) * 100), color: "#94a3b8" })
  }

  // === A/R Aging (by days past due date) ===
  const agingBuckets = [
    { label: "Current", amount: 0, count: 0 },
    { label: "1-30 days", amount: 0, count: 0 },
    { label: "31-60 days", amount: 0, count: 0 },
    { label: "61-90 days", amount: 0, count: 0 },
    { label: "90+", amount: 0, count: 0 },
  ]
  ;(invoices as InvoiceRow[]).forEach((inv: InvoiceRow) => {
    if (!inv.dueDate) return
    const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000)
    const bucket = daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4
    agingBuckets[bucket].amount += decimalToNumber(inv.balanceDue)
    agingBuckets[bucket].count += 1
  })

  // === Alerts ===
  // `message` is kept as an English fallback; the UI renders `messageKey` + `params`
  // through next-intl (see finance-alerts.tsx). `params` carry pre-formatted strings.
  const cur = getCurrencySymbol()
  const alerts: any[] = []
  if (overdueInvoices.length > 0) {
    alerts.push({
      id: "ar-overdue",
      type: "overdue_invoice",
      severity: overdueInvoices.length > 5 ? "critical" : "warning",
      message: `${overdueInvoices.length} overdue invoice(s) — ${fmt(arOverdue)} ${cur}`,
      messageKey: "alertMsg.overdueInvoices",
      params: { count: overdueInvoices.length, amount: `${fmt(arOverdue)} ${cur}` },
      link: "/finance?tab=receivables",
      amount: arOverdue,
    })
  }
  if (cashBalance < 0) {
    alerts.push({
      id: "low-cash",
      type: "low_cash",
      severity: "critical",
      message: `Negative cash balance: ${fmt(cashBalance)} ${cur}`,
      messageKey: "alertMsg.negativeCash",
      params: { amount: `${fmt(cashBalance)} ${cur}` },
      link: "/finance",
      amount: cashBalance,
    })
  }
  if (overdueBills.length > 0) {
    alerts.push({
      id: "ap-overdue",
      type: "upcoming_payment",
      severity: "warning",
      message: `${overdueBills.length} overdue payment(s) — ${fmt(apOverdue)} ${cur}`,
      messageKey: "alertMsg.overduePayments",
      params: { count: overdueBills.length, amount: `${fmt(apOverdue)} ${cur}` },
      link: "/finance?tab=payables",
      amount: apOverdue,
    })
  }
  // Fund coverage alert
  const totalFundBalance = (funds as FundRow[]).reduce(
    (sum: number, fund: FundRow) => sum + decimalToNumber(fund.currentBalance),
    0,
  )
  if (totalFundBalance > 0 && cashBalance < totalFundBalance) {
    const coverage = Math.round((cashBalance / totalFundBalance) * 100)
    alerts.push({
      id: "fund-coverage",
      type: "low_cash",
      severity: coverage < 50 ? "critical" : "warning",
      message: `Funds covered at ${coverage}% — reserved ${fmt(totalFundBalance)} ${cur}, available ${fmt(cashBalance)} ${cur}`,
      messageKey: "alertMsg.fundCoverage",
      params: { pct: coverage, reserved: `${fmt(totalFundBalance)} ${cur}`, available: `${fmt(cashBalance)} ${cur}` },
      link: "/finance?tab=funds",
      amount: totalFundBalance - cashBalance,
    })
  }

  const safeDiv = (a: number, b: number) => (b === 0 ? 0 : Math.round(((a - b) / b) * 100))

  return NextResponse.json({
    data: {
      kpis: {
        revenue: { label: "Revenue", plan: revenuePlan, fact: revenueFact, variance: revenueFact - revenuePlan, variancePct: safeDiv(revenueFact, revenuePlan) },
        // plan/variance are null, not 0: there is no expense plan any more, and a
        // 0 would render as "you planned nothing and spent everything".
        expenses: { label: "Expenses", plan: expensePlan, fact: expenseFact, variance: null, variancePct: null },
        netProfit: { fact: netProfit, prevMonth: 0, changePct: 0 },
        cashBalance: { current: cashBalance, projected: cashBalance + totalInflows * 0.1 },
        arTotal: { amount: arTotal, overdueAmount: arOverdue, overdueCount: overdueInvoices.length },
        apTotal: { amount: apTotal, overdueAmount: apOverdue, overdueCount: overdueBills.length },
      },
      revenueTrend,
      expenseBreakdown,
      arAging: agingBuckets,
      alerts,
      year,
      dateFrom: dateFromStr ?? null,
      dateTo: dateToStr ?? null,
    },
  })
  })
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
