/**
 * CLM Slice 7b — Contract Analytics XLSX Export.
 *
 * GET /api/v1/contract-analytics/export?from=&to=
 *
 * Auth: requireAuth(contracts, "read") + org-scoped.
 * Calls computeContractAnalytics (shared helper) to avoid data drift vs. the
 * analytics dashboard. Builds an ExcelJS workbook with 5 sheets:
 *
 *   1. Summary         — KPI rows (no float: totalValue is the decimal string)
 *   2. By Type         — count + totalValue per contract type (live)
 *   3. Expiry Cohorts  — quarter, count, value
 *   4. Approval Funnel — status, count
 *   5. Deviation Risk  — severity, count
 *
 * Money is rendered as the decimal string from computeContractAnalytics —
 * never converted through Number() inside this file.
 *
 * Filename: contract-analytics-<from>-<to>.xlsx (or contract-analytics.xlsx
 * when no date range is supplied).
 */
import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { withRlsAuth } from "@/lib/with-rls"
import { computeContractAnalytics } from "@/lib/contract-lifecycle/analytics"

function parseOptionalDate(v: string | null): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

export const GET = withRlsAuth("contracts", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const fromStr = searchParams.get("from") ?? ""
  const toStr = searchParams.get("to") ?? ""
  const from = parseOptionalDate(fromStr || null)
  const to = parseOptionalDate(toStr || null)

  try {
    const data = await computeContractAnalytics(orgId, { from, to })

    const wb = new ExcelJS.Workbook()
    wb.creator = "LeadDrive CLM"
    wb.created = new Date()

    // ─── Sheet 1: Summary ─────────────────────────────────────────────────────
    const wsSummary = wb.addWorksheet("Summary")
    wsSummary.columns = [
      { header: "Metric", key: "metric", width: 30 },
      { header: "Value", key: "value", width: 22 },
    ]
    wsSummary.getRow(1).font = { bold: true }

    const s = data.summary
    const summaryRows = [
      ["Live contracts", s.liveCount],
      ["Total value", s.totalValue],           // decimal string — no float
      ["MRR", s.mrr],
      ["Avg cycle time (days)", s.avgCycleTimeDays ?? "—"],
      ["Renewal rate (%)", s.renewalRate ?? "—"],
      ["Expiring soon (30d)", s.expiringSoon],
      ["Open deviations", s.openDeviations],
      ["Renewed (period)", s.renewedCount],
      ["Expired (period)", s.expiredCount],
      ["Generated at", data.generatedAt],
    ]
    for (const [metric, value] of summaryRows) {
      wsSummary.addRow({ metric, value })
    }

    // ─── Sheet 2: By Type ─────────────────────────────────────────────────────
    const wsByType = wb.addWorksheet("By Type")
    wsByType.columns = [
      { header: "Type", key: "type", width: 24 },
      { header: "Count", key: "count", width: 12 },
      { header: "Total Value", key: "totalValue", width: 22 },
    ]
    wsByType.getRow(1).font = { bold: true }
    for (const row of data.byType) {
      wsByType.addRow({ type: row.type, count: row.count, totalValue: row.totalValue })
    }
    if (data.byType.length === 0) {
      wsByType.addRow({ type: "No live contracts", count: "", totalValue: "" })
    }

    // ─── Sheet 3: Expiry Cohorts ──────────────────────────────────────────────
    const wsCohorts = wb.addWorksheet("Expiry Cohorts")
    wsCohorts.columns = [
      { header: "Quarter", key: "period", width: 14 },
      { header: "Count", key: "count", width: 12 },
      { header: "Value", key: "value", width: 22 },
    ]
    wsCohorts.getRow(1).font = { bold: true }
    for (const row of data.cohorts) {
      // value is already a number (cents/100 arithmetic, not a Decimal)
      wsCohorts.addRow({ period: row.period, count: row.count, value: row.value })
    }
    if (data.cohorts.length === 0) {
      wsCohorts.addRow({ period: "No expiring contracts (12mo)", count: "", value: "" })
    }

    // ─── Sheet 4: Approval Funnel ─────────────────────────────────────────────
    const wsFunnel = wb.addWorksheet("Approval Funnel")
    wsFunnel.columns = [
      { header: "Status", key: "status", width: 22 },
      { header: "Count", key: "count", width: 12 },
    ]
    wsFunnel.getRow(1).font = { bold: true }
    for (const row of data.approvalFlow) {
      wsFunnel.addRow({ status: row.status, count: row.count })
    }
    if (data.approvalFlow.length === 0) {
      wsFunnel.addRow({ status: "No contracts", count: "" })
    }

    // ─── Sheet 5: Deviation Risk ──────────────────────────────────────────────
    const wsDeviation = wb.addWorksheet("Deviation Risk")
    wsDeviation.columns = [
      { header: "Severity", key: "severity", width: 16 },
      { header: "Open flags", key: "count", width: 14 },
    ]
    wsDeviation.getRow(1).font = { bold: true }
    for (const row of data.deviationRisk) {
      wsDeviation.addRow({ severity: row.severity, count: row.count })
    }

    // ─── Build filename ────────────────────────────────────────────────────────
    const rangeSuffix =
      fromStr && toStr
        ? `-${fromStr}-${toStr}`
        : fromStr
          ? `-from-${fromStr}`
          : toStr
            ? `-to-${toStr}`
            : ""
    const filename = `contract-analytics${rangeSuffix}.xlsx`

    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error("[contract-analytics/export] GET error:", err)
    return NextResponse.json(
      { error: "Failed to generate analytics export" },
      { status: 500 },
    )
  }
})
