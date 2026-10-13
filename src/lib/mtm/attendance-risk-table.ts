import { ATTENDANCE_RISK_MESSAGES, type AttendanceRiskItem, type AttendanceRiskReport } from "@/lib/mtm/attendance-risk-contract"
import type { AttendanceTable, AttendanceText } from "@/lib/mtm/attendance-table"
export function attendanceRiskDetail(item: AttendanceRiskItem, t: AttendanceText) {
  const lines: string[] = []
  if (item.kind === "SHARED_INSTALLATION") {
    if (item.relatedNames.length) lines.push(t("riskRelated", { names: item.relatedNames.join(", ") }))
    if (item.relatedNamesRestricted) lines.push(t("riskRestrictedNames"))
    lines.push(item.usualName ? t("riskUsual", { name: item.usualName, days: item.usualDays ?? 0, total: item.observedDays ?? 0 }) : t("riskUsualUnknown"))
  }
  if (item.kind === "OUTSIDE_BRANCH") {
    if (item.branchName) lines.push(item.branchName)
    if (item.distanceMeters !== null) lines.push(t("riskDistance", { meters: Math.round(item.distanceMeters) }))
  }
  if (item.deltaSeconds !== null) lines.push(t("riskDelta", { seconds: Math.round(Math.abs(item.deltaSeconds)) }))
  if (item.kind === "MOCK_LOCATION") lines.push(t("riskMockHint"))
  if (item.kind === "NEW_INSTALLATION") lines.push(t("riskNewHint"))
  return lines.join("\n")
}
export function buildAttendanceRiskTable(report: AttendanceRiskReport, locale: "az" | "ru" | "en", t: AttendanceText): AttendanceTable {
  const columns = ["journalEmployee", "riskMark", "riskFinding", "riskTimes", "journalStatus", "riskDecision"]
  return { title: t("riskTitle"), columns: columns.map(key => ({ key, label: t(key) })),
    rows: report.items.map(item => {
      const instant = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: item.timezone, dateStyle: "medium", timeStyle: "medium" }).format(new Date(value))
      return { key: item.id, cells: [item.employeeName + (item.teamName ? `\n${item.teamName}` : ""), `${item.workDate}\n${t(item.action === "START" ? "riskStart" : "riskFinish")}`,
        `${t(ATTENDANCE_RISK_MESSAGES[item.kind])}\n${attendanceRiskDetail(item, t)}`,
        `${t("riskClaimed")}: ${instant(item.claimedAt)}\n${t("riskReceived")}: ${instant(item.serverReceivedAt)}\n${item.timezone}`,
        t(item.dismissal ? "riskDismissed" : "riskOpen"), item.dismissal ? `${item.dismissal.byName ?? "—"}\n${instant(item.dismissal.at)}\n${item.dismissal.reason}` : "—"] }
    }), details: [t("riskDescription"), t("reportPeriod", { from: report.snapshot.query.from, to: report.snapshot.query.to }), t("riskEvidenceHint")],
    totals: [t("riskCounts", { open: report.items.filter(item => !item.dismissal).length, dismissed: report.items.filter(item => item.dismissal).length })] }
}
