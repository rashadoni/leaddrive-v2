import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"
import { TIMESHEET_ISSUES, type TimesheetIssue } from "@/lib/mtm/attendance-timesheet-filters"
import { MtmAttendanceBranchReport } from "@/components/mtm/attendance-branch-report"
import { MtmAttendanceDecisionJournal } from "@/components/mtm/attendance-decision-journal"
import { MtmAttendanceMonths } from "@/components/mtm/attendance-months"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

// Owner, 2026-10-14: nine tabs were too many to explain to HR. The timesheet is
// one month grid; deviations are filter buttons, rarer reports sit under "More".
const VIEWS = ["branches", "decisions", "months"] as const
type View = (typeof VIEWS)[number]
/** Links into the former tabs (notifications, bookmarks, Today) keep working. */
const FORMER_TAB_FILTER: Record<string, TimesheetIssue> = { late: "late", absence: "absent", overtime: "overtime" }
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function PersonnelTimesheetPage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const t = await getTranslations("personnel")
  const params = await searchParams
  const tab = first(params.tab), date = first(params.date), employeeId = first(params.employeeId)
  const requested = first(params.view) ?? tab
  const view = VIEWS.includes(requested as View) ? requested as View : null
  if (view) return <div className="space-y-6">
    <Link href="/mtm/attendance/timesheet" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="attendance-back-to-timesheet">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />{t("timesheetTitle")}</Link>
    {view === "branches" ? <MtmAttendanceBranchReport /> : view === "decisions" ? <MtmAttendanceDecisionJournal /> : <MtmAttendanceMonths />}
  </div>
  const filter = first(params.filter)
  const initialFilter = TIMESHEET_ISSUES.includes(filter as TimesheetIssue) ? filter as TimesheetIssue
    : tab === "journal" && !employeeId ? "missing-finish" : tab ? FORMER_TAB_FILTER[tab] : undefined
  // A new key per deep link: each opens with its own month, filter and day card.
  return <MtmAttendanceReportWorkspace key={`${date ?? ""}:${employeeId ?? ""}:${initialFilter ?? ""}`} layout="timesheet" initialForm="MONTH"
    initialDate={date} initialEmployeeId={employeeId} initialFilter={initialFilter} />
}
