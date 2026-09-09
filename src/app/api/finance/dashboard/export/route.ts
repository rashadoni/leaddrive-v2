import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { parseOptionalDateRange } from "@/lib/finance/date-range"
import ExcelJS from "exceljs"

// ── Palette ──────────────────────────────────────────────────────────────────
const TEAL = "FF0891B2"
const GREEN = "FF16A34A"
const RED = "FFDC2626"
const AMBER = "FFF59E0B"
const GRAY_HEADER = "FFF8FAFC"
const GRAY_BORDER = "FFE2E8F0"
const DARK_TEXT = "FF1E293B"

// Number format for currency columns (numeric cells — Excel can SUM/sort these)
const CURRENCY_FMT = '#,##0.00'

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

type InvoiceRow = { id: string; invoiceNumber: string | null; totalAmount: unknown; balanceDue: unknown; dueDate: Date | null; issueDate: Date | null; status: string }
type BillRow = { id: string; billNumber: string; vendorName: string; totalAmount: unknown; balanceDue: unknown; dueDate: Date | null; issueDate: Date | null; status: string; category: string | null }
type CashFlowRow = { month: number; entryType: string; amount: number }
type SalesForecastRow = { month: number; amount: number | null }

function hdrStyle(argb: string = TEAL): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: argb } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: { bottom: { style: "thin", color: { argb: argb } } },
  }
}

function totalStyle(): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, color: { argb: DARK_TEXT }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_HEADER } },
    border: { top: { style: "double", color: { argb: DARK_TEXT } }, bottom: { style: "thin", color: { argb: GRAY_BORDER } } },
  }
}

/** Format date as deterministic YYYY-MM-DD for Excel export (server-locale-independent). */
function isoDate(d: Date | null | string | undefined): string {
  if (!d) return ""
  const dt = typeof d === "string" ? new Date(d) : d
  return isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10)
}

/** Assign a numeric value with currency format to a cell, so Excel can SUM/sort it. */
function setMoney(cell: ExcelJS.Cell, value: number): void {
  cell.value = value
  cell.numFmt = CURRENCY_FMT
  cell.alignment = { horizontal: "right", vertical: "middle" }
}

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
  // Shared date range parser (same validation as dashboard + receivables)
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

  // Build a safe filename suffix (YYYY-MM-DD sliced, no colons for Windows)
  const dateFromStr = req.nextUrl.searchParams.get("dateFrom")
  const dateToStr = req.nextUrl.searchParams.get("dateTo")
  const filenameSuffix = rangeResult.hasDateRange
    ? `${dateFromStr!.slice(0, 10)}_${dateToStr!.slice(0, 10)}`
    : String(year)

  const now = new Date()

  // Parallel queries (mirrors dashboard route)
  // Mirrors the dashboard route: plan/fact used to come from the removed
  // budgeting module, so both now derive from invoices, bills and the sales
  // forecast — see the comment there for the full mapping.
  const yearRange = { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)) }
  const [invoices, bills, cashFlowEntries, salesForecasts] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { notIn: ["draft", "cancelled"] },
        issueDate: dateRangeFilter ?? yearRange,
      },
      select: { id: true, invoiceNumber: true, totalAmount: true, balanceDue: true, dueDate: true, issueDate: true, status: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.bill.findMany({
      where: {
        organizationId: orgId,
        status: { notIn: ["draft", "cancelled"] },
        issueDate: dateRangeFilter ?? yearRange,
      },
      select: { id: true, billNumber: true, vendorName: true, totalAmount: true, balanceDue: true, dueDate: true, issueDate: true, status: true, category: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.cashFlowEntry.findMany({
      where: { organizationId: orgId, year, ...(rangeResult.hasDateRange && { month: { gte: startMonth, lte: endMonth } }) },
      select: { month: true, entryType: true, amount: true },
    }),
    prisma.salesForecast.findMany({
      where: { organizationId: orgId, year, ...(rangeResult.hasDateRange && { month: { gte: startMonth, lte: endMonth } }) },
      select: { month: true, amount: true },
    }),
  ])

  const collected = (row: { totalAmount: unknown; balanceDue: unknown }): number =>
    decimalToNumber(row.totalAmount) - decimalToNumber(row.balanceDue)
  const invoiceRows = invoices as InvoiceRow[]
  const billRows = bills as BillRow[]

  // === Build workbook ===========================================================
  const wb = new ExcelJS.Workbook()
  wb.creator = "LeadDrive Finance"
  wb.created = now

  // ── Sheet 1: KPI Summary ──────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("KPI Summary")
    ws.columns = [
      { header: "Metric", key: "metric", width: 28 },
      { header: "Plan", key: "plan", width: 18 },
      { header: "Actual", key: "actual", width: 18 },
      { header: "Variance", key: "variance", width: 18 },
      { header: "Variance %", key: "variancePct", width: 16 },
    ]
    ws.getRow(1).eachCell((cell) => { cell.style = hdrStyle() })
    ws.getRow(1).height = 22

    const revPlan = (salesForecasts as SalesForecastRow[]).reduce((s, f) => s + (f.amount || 0), 0)
    const revFact = invoiceRows.reduce((s, i) => s + collected(i), 0)
    const expPlan = 0 // no expense plan exists any more — the budgeting module was its only source
    const expFact = billRows.reduce((s, b) => s + collected(b), 0)
    const netProfit = revFact - expFact
    const totalInflows = (cashFlowEntries as CashFlowRow[]).filter((e) => e.entryType === "inflow").reduce((s, e) => s + e.amount, 0)
    const totalOutflows = (cashFlowEntries as CashFlowRow[]).filter((e) => e.entryType === "outflow").reduce((s, e) => s + e.amount, 0)
    const cashBalance = totalInflows - totalOutflows
    const arTotal = (invoices as InvoiceRow[]).reduce((s, i) => s + decimalToNumber(i.balanceDue), 0)
    const apTotal = (bills as BillRow[]).reduce((s, b) => s + decimalToNumber(b.balanceDue), 0)
    const safeDiv = (a: number, b: number) => (b === 0 ? 0 : Math.round(((a - b) / b) * 100))

    const dataRows = [
      { label: "Revenue",         plan: revPlan,     actual: revFact,     variance: revFact - revPlan,     variancePct: safeDiv(revFact, revPlan) },
      { label: "Expenses",        plan: expPlan,     actual: expFact,     variance: expFact - expPlan,     variancePct: safeDiv(expFact, expPlan) },
      { label: "Net Profit",      plan: null,        actual: netProfit,   variance: null,                  variancePct: null },
      { label: "Cash Balance",    plan: null,        actual: cashBalance, variance: null,                  variancePct: null },
      { label: "A/R Outstanding", plan: null,        actual: arTotal,     variance: null,                  variancePct: null },
      { label: "A/P Outstanding", plan: null,        actual: apTotal,     variance: null,                  variancePct: null },
    ]
    dataRows.forEach(({ label, plan, actual, variance, variancePct }) => {
      const row = ws.addRow([label, null, null, null, null])
      row.getCell(1).alignment = { vertical: "middle" }
      row.getCell(1).border = { bottom: { style: "hair", color: { argb: GRAY_BORDER } } }
      if (plan !== null) setMoney(row.getCell(2), plan)
      setMoney(row.getCell(3), actual)
      if (variance !== null) setMoney(row.getCell(4), variance)
      if (variancePct !== null) {
        row.getCell(5).value = variancePct / 100
        row.getCell(5).numFmt = "+0%;-0%;0%"
        row.getCell(5).alignment = { horizontal: "center", vertical: "middle" }
      }
    })
  }

  // ── Sheet 2: Revenue Trend ────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Revenue Trend")
    ws.columns = [
      { header: "Month", key: "month", width: 14 },
      { header: "Revenue (actual)", key: "revenue", width: 22 },
      { header: "Revenue (forecast)", key: "forecast", width: 22 },
      { header: "Expenses (actual)", key: "expenses", width: 22 },
      { header: "Net", key: "net", width: 18 },
    ]
    ws.getRow(1).eachCell((cell) => { cell.style = hdrStyle() })
    ws.getRow(1).height = 22

    for (let m = startMonth; m <= endMonth; m++) {
      // Use UTC month to match the UTC day-boundary filter used when fetching rows
      const rev = invoiceRows
        .filter((i) => i.issueDate && i.issueDate.getUTCMonth() + 1 === m)
        .reduce((s, i) => s + collected(i), 0)
      const exp = billRows
        .filter((b) => b.issueDate && b.issueDate.getUTCMonth() + 1 === m)
        .reduce((s, b) => s + collected(b), 0)
      const fore = (salesForecasts as SalesForecastRow[]).filter((f) => f.month === m).reduce((s, f) => s + (f.amount || 0), 0)
      const net = (rev || fore) - exp
      const row = ws.addRow([`${MONTH_NAMES[m - 1]} ${year}`, null, null, null, null])
      setMoney(row.getCell(2), rev)
      setMoney(row.getCell(3), fore)
      setMoney(row.getCell(4), exp)
      setMoney(row.getCell(5), net)
    }
  }

  // ── Sheet 3: Expense Breakdown ────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Expense Breakdown")
    ws.columns = [
      { header: "Category", key: "category", width: 28 },
      { header: "Actual Amount", key: "amount", width: 20 },
      { header: "% of Total", key: "pct", width: 14 },
    ]
    ws.getRow(1).eachCell((cell) => { cell.style = hdrStyle(AMBER) })
    ws.getRow(1).height = 22

    const catMap: Record<string, number> = {}
    billRows.forEach((b) => {
      const cat = b.category || b.vendorName || "Other"
      catMap[cat] = (catMap[cat] || 0) + collected(b)
    })
    const grandTotal = Object.values(catMap).reduce((s, v) => s + v, 0) || 1
    Object.entries(catMap).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
      const row = ws.addRow([cat, null, null])
      setMoney(row.getCell(2), amt)
      row.getCell(3).value = amt / grandTotal
      row.getCell(3).numFmt = "0.0%"
      row.getCell(3).alignment = { horizontal: "center", vertical: "middle" }
    })
    const totalRow = ws.addRow(["TOTAL", null, null])
    totalRow.getCell(1).style = totalStyle()
    totalRow.getCell(2).style = totalStyle()
    totalRow.getCell(3).style = totalStyle()
    setMoney(totalRow.getCell(2), grandTotal)
    totalRow.getCell(3).value = 1
    totalRow.getCell(3).numFmt = "0%"
    totalRow.getCell(3).alignment = { horizontal: "center", vertical: "middle" }
  }

  // ── Sheet 4: A/R Outstanding ──────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("AR Outstanding")
    ws.columns = [
      { header: "Invoice #", key: "invoiceNumber", width: 18 },
      { header: "Total", key: "totalAmount", width: 18 },
      { header: "Balance Due", key: "balanceDue", width: 18 },
      { header: "Due Date", key: "dueDate", width: 15 },
      { header: "Status", key: "status", width: 16 },
      { header: "Days Overdue", key: "daysOverdue", width: 14 },
    ]
    ws.getRow(1).eachCell((cell) => { cell.style = hdrStyle(GREEN) })
    ws.getRow(1).height = 22
    ;(invoices as InvoiceRow[]).forEach((inv) => {
      const balance = decimalToNumber(inv.balanceDue)
      const daysOverdue = inv.dueDate ? Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000)) : 0
      const row = ws.addRow([inv.invoiceNumber || "", null, null, isoDate(inv.dueDate), inv.status, daysOverdue > 0 ? daysOverdue : ""])
      setMoney(row.getCell(2), decimalToNumber(inv.totalAmount))
      setMoney(row.getCell(3), balance)
    })
  }

  // ── Sheet 5: A/P Outstanding ──────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("AP Outstanding")
    ws.columns = [
      { header: "Bill #", key: "billNumber", width: 18 },
      { header: "Vendor", key: "vendorName", width: 24 },
      { header: "Total", key: "totalAmount", width: 18 },
      { header: "Balance Due", key: "balanceDue", width: 18 },
      { header: "Due Date", key: "dueDate", width: 15 },
      { header: "Status", key: "status", width: 16 },
    ]
    ws.getRow(1).eachCell((cell) => { cell.style = hdrStyle(RED) })
    ws.getRow(1).height = 22
    ;(bills as BillRow[]).forEach((b) => {
      const row = ws.addRow([b.billNumber, b.vendorName, null, null, isoDate(b.dueDate), b.status])
      setMoney(row.getCell(3), decimalToNumber(b.totalAmount))
      setMoney(row.getCell(4), decimalToNumber(b.balanceDue))
    })
  }

  // ── Serialize & return ────────────────────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer()

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="finance-${filenameSuffix}.xlsx"`,
    },
  })
  })
}
