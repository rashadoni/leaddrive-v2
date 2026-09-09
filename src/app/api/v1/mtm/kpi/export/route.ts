import type { NextRequest } from "next/server"
import { GET as getKpi } from "../route"

function hasSpreadsheetFormulaPrefix(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    const isControl = codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
    if (isControl || character.trim() === "") continue
    return "=+-@".includes(character)
  }
  return false
}

function cell(value: unknown): string {
  let text = value == null ? "" : String(value)
  if (hasSpreadsheetFormulaPrefix(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export async function GET(req: NextRequest): Promise<Response> {
  const expectedSnapshotId = new URL(req.url).searchParams.get("snapshotId")
  const response = await getKpi(req)
  if (!response.ok) return response
  const payload = await response.json()
  if (!payload?.success || !payload.data?.report) {
    return Response.json(payload, { status: response.status })
  }
  if (!payload.data.report.formula?.authoritative) {
    return Response.json({
      error: "Official KPI export requires a complete calculation covered by a signed tenant policy",
      code: payload.data.report.formula?.authorityReason === "UNSIGNED_POLICY"
        ? "MTM_KPI_POLICY_NOT_APPROVED"
        : "MTM_KPI_CALCULATION_PARTIAL",
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
  }
  if (expectedSnapshotId && payload.data.snapshotId !== expectedSnapshotId) {
    return Response.json({
      error: "KPI facts changed after the dashboard was calculated; refresh before exporting",
      code: "MTM_KPI_SNAPSHOT_CHANGED",
      currentSnapshotId: payload.data.snapshotId,
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
  }
  const { scope, report } = payload.data
  const workforceEnabled = payload.data.contract?.workforceEnabled !== false
  const brandNameById = new Map((payload.data.brands as Array<Record<string, unknown>> | undefined ?? [])
    .flatMap((brand) => typeof brand.id === "string" && typeof brand.name === "string" ? [[brand.id, brand.name] as const] : []))
  const brandNames = (row: Record<string, unknown>) => Array.isArray(row.brandIds)
    ? row.brandIds.map((id) => typeof id === "string" ? brandNameById.get(id) ?? id : String(id)).join("|")
    : ""
  const latestAdjustment = new Map<string, Record<string, unknown>>()
  for (const adjustment of report.formula.adjustments as Array<Record<string, unknown>>) {
    latestAdjustment.set(`${adjustment.factType}:${adjustment.factId}`, adjustment)
  }
  const gpsDayRows: unknown[][] = workforceEnabled
    ? [
        ["gpsDayAgentId", "gpsDayAgentName", "date", "workdayId", "workdayState", "evidenceSource", "sourceAgentIds", "sourceAgentNames", "completedVisits", "gpsConfirmedVisits", "gpsEvidenceStates", "visitIds"],
        ...report.drilldown.gpsDays.map((row: Record<string, unknown>) => [
          row.agentId, row.agentName, row.date, row.workdayId, row.workdayState, row.evidenceSource,
          Array.isArray(row.sourceAgents) ? row.sourceAgents.map((agent: Record<string, unknown>) => agent.id).join("|") : "",
          Array.isArray(row.sourceAgents) ? row.sourceAgents.map((agent: Record<string, unknown>) => agent.name).join("|") : "",
          row.completedVisits, row.gpsConfirmedVisits,
          row.gpsEvidenceStates && typeof row.gpsEvidenceStates === "object"
            ? Object.entries(row.gpsEvidenceStates as Record<string, unknown>).map(([state, count]) => `${state}:${count}`).join("|")
            : "",
          Array.isArray(row.visitIds) ? row.visitIds.join("|") : "",
        ]),
      ]
    : [
        ["gpsDayAgentId", "gpsDayAgentName", "date", "evidenceSource", "sourceAgentIds", "sourceAgentNames", "completedVisits", "gpsConfirmedVisits", "gpsEvidenceStates", "visitIds"],
        ...report.drilldown.gpsDays.map((row: Record<string, unknown>) => [
          row.agentId, row.agentName, row.date, row.evidenceSource,
          Array.isArray(row.sourceAgents) ? row.sourceAgents.map((agent: Record<string, unknown>) => agent.id).join("|") : "",
          Array.isArray(row.sourceAgents) ? row.sourceAgents.map((agent: Record<string, unknown>) => agent.name).join("|") : "",
          row.completedVisits, row.gpsConfirmedVisits,
          row.gpsEvidenceStates && typeof row.gpsEvidenceStates === "object"
            ? Object.entries(row.gpsEvidenceStates as Record<string, unknown>).map(([state, count]) => `${state}:${count}`).join("|")
            : "",
          Array.isArray(row.visitIds) ? row.visitIds.join("|") : "",
        ]),
      ]
  const rows: unknown[][] = [
    ["formulaVersion", report.formula.version],
    ["policyCode", report.formula.policy?.code],
    ["policyVersion", report.formula.policy?.version],
    ["policyDefinitionHash", report.formula.policy?.definitionHash],
    ["policyApprovalReference", report.formula.policy?.approvalReference],
    ["policyEffectiveFrom", report.formula.policy?.effectiveFrom],
    ["policyEffectiveTo", report.formula.policy?.effectiveTo],
    ["snapshotId", payload.data.snapshotId],
    ["generatedAt", report.formula.generatedAt],
    ["from", scope.from],
    ["toExclusive", scope.toExclusive],
    ["teamId", scope.teamId],
    ["agentId", scope.agentId],
    ["visitType", scope.visitType],
    ["brandId", scope.brandId],
    ["timezone", scope.timezone],
    ["sourceUpdatedAt", report.formula.sourceUpdatedAt],
    ["sourceFreshness", report.formula.sourceFreshness],
    ["workforceEnabled", workforceEnabled],
    ["completeness", report.formula.completeness],
    ["authoritative", report.formula.authoritative],
    ["planDefinition", report.formula.planDefinition],
    ["gpsDefinition", report.formula.gpsDefinition],
    ["baselineExclusions", Array.isArray(report.formula.exclusions) ? report.formula.exclusions.join("|") : ""],
    [],
    ["metric", "numerator", "denominator", "percentage"],
    ["plan", report.plan.numerator, report.plan.denominator, report.plan.percentage],
    ["gps", report.gps.numerator, report.gps.denominator, report.gps.percentage],
    [],
    ["date", "planned", "completedPlan", "completedVisits", "gpsConfirmed", "planPercentage", "gpsPercentage"],
    ...report.trend.map((row: Record<string, unknown>) => [
      row.date, row.planned, row.completed, row.visits, row.gps, row.planPercentage, row.gpsPercentage,
    ]),
    [],
    ["cohort", "factId", "agentId", "agentName", "customerId", "customerName", "contactId", "date", "visitType", "brandIds", "brandNames", "completed", "gpsConfirmed", "gpsEvidenceState", "sourceAgentId", "sourceAgentName", "attributedAgentIds", "attributedAgentNames", "adjustable", "adjustmentAction", "adjustmentReason"],
    ...report.drilldown.planDenominator.map((row: Record<string, unknown>) => [
      "planDenominator", row.routePointId, row.agentId, row.agentName, row.customerId,
      row.customerName, row.contactId, row.date, row.visitType, Array.isArray(row.brandIds) ? row.brandIds.join("|") : "", brandNames(row),
      row.completed, "", "", row.sourceAgentId, row.sourceAgentName,
      Array.isArray(row.attributedAgentIds) ? row.attributedAgentIds.join("|") : "",
      Array.isArray(row.attributedAgents) ? row.attributedAgents.map((agent: Record<string, unknown>) => agent.name).join("|") : "", row.adjustable,
      latestAdjustment.get(`PLAN_POINT:${row.routePointId}`)?.action ?? "", latestAdjustment.get(`PLAN_POINT:${row.routePointId}`)?.reason ?? "",
    ]),
    ...report.drilldown.exclusions.planPoints.map((row: Record<string, unknown>) => [
      "planExcluded", row.routePointId, row.agentId, row.agentName, row.customerId,
      row.customerName, row.contactId, row.date, row.visitType, Array.isArray(row.brandIds) ? row.brandIds.join("|") : "", brandNames(row),
      row.completed, "", "", row.sourceAgentId, row.sourceAgentName,
      Array.isArray(row.attributedAgentIds) ? row.attributedAgentIds.join("|") : "",
      Array.isArray(row.attributedAgents) ? row.attributedAgents.map((agent: Record<string, unknown>) => agent.name).join("|") : "", row.adjustable,
      latestAdjustment.get(`PLAN_POINT:${row.routePointId}`)?.action ?? "EXCLUDE", latestAdjustment.get(`PLAN_POINT:${row.routePointId}`)?.reason ?? "",
    ]),
    ...report.drilldown.gpsDenominator.map((row: Record<string, unknown>) => [
      "gpsDenominator", row.visitId, row.agentId, row.agentName, row.customerId,
      row.customerName, row.contactId, row.date, row.visitType, Array.isArray(row.brandIds) ? row.brandIds.join("|") : "", brandNames(row),
      row.completed, row.gpsConfirmed, row.gpsEvidenceState, row.sourceAgentId, row.sourceAgentName,
      Array.isArray(row.attributedAgentIds) ? row.attributedAgentIds.join("|") : "",
      Array.isArray(row.attributedAgents) ? row.attributedAgents.map((agent: Record<string, unknown>) => agent.name).join("|") : "", row.adjustable,
      latestAdjustment.get(`GPS_VISIT:${row.visitId}`)?.action ?? "", latestAdjustment.get(`GPS_VISIT:${row.visitId}`)?.reason ?? "",
    ]),
    [],
    ...gpsDayRows,
    [],
    ["adjustmentFactType", "adjustmentFactId", "action", "reason", "createdAt", "actorAgentId", "auditId"],
    ...report.formula.adjustments.map((row: Record<string, unknown>) => [
      row.factType, row.factId, row.action, row.reason, row.createdAt, row.actorAgentId, row.auditId,
    ]),
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mtm-plan-gps-kpi-${scope.from}-${scope.toExclusive}.csv"`,
      "Cache-Control": "private, no-store",
    },
  })
}
