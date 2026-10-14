import { getTranslations } from "next-intl/server"
import { MtmAttendanceTabs, attendanceTab } from "@/components/mtm/attendance-tabs"
import { MtmAttendanceReportWorkspace, type AttendanceReportForm } from "@/components/mtm/attendance-report-workspace"
import { MtmAttendanceBranchReport } from "@/components/mtm/attendance-branch-report"
import { MtmAttendanceDecisionJournal } from "@/components/mtm/attendance-decision-journal"
import { MtmAttendanceMonths } from "@/components/mtm/attendance-months"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

const TABS = ["month", "days", "late", "absence", "overtime", "journal", "branches", "decisions", "months"] as const
const FORMS: Partial<Record<(typeof TABS)[number], AttendanceReportForm>> = {
  month: "MONTH", days: "DAY", late: "LATE_EARLY", absence: "ABSENCES", overtime: "OVERTIME", journal: "JOURNAL",
}
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function PersonnelTimesheetPage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const t = await getTranslations("personnel")
  const params = await searchParams
  const tab = attendanceTab(params.tab, TABS)
  const tabs = <MtmAttendanceTabs base="/mtm/attendance/timesheet" active={tab} label={t("timesheetTabs")} tabs={TABS.map(key => ({ key, label: t(`tabs.${key}`) }))} />
  const form = FORMS[tab]
  // A new key per tab and deep link: each opens with its own period and filter.
  if (form) return <MtmAttendanceReportWorkspace key={`${tab}:${first(params.date) ?? ""}:${first(params.employeeId) ?? ""}`} layout="timesheet" initialForm={form}
    initialDate={first(params.date)} initialEmployeeId={first(params.employeeId)} tabs={tabs} />
  return <div className="space-y-6">
    {/* The tab content brings its own page heading. */}
    <p className="text-2xl font-bold tracking-tight">{t("timesheetTitle")}</p>
    {tabs}
    {tab === "branches" ? <MtmAttendanceBranchReport /> : tab === "decisions" ? <MtmAttendanceDecisionJournal /> : <MtmAttendanceMonths />}
  </div>
}
