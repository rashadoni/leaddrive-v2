import { redirectToAttendanceTab, type AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

/** Former page; now Personnel → timesheet → branches. */
export default async function AttendanceBranchesReportRedirect({ searchParams }: { searchParams: AttendanceSearchParams }) {
  return redirectToAttendanceTab("timesheet", "branches", searchParams)
}
