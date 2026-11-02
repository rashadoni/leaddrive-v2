import { redirectToAttendanceTab, type AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

/** Former page; now Personnel → timesheet → months. */
export default async function AttendanceMonthsRedirect({ searchParams }: { searchParams: AttendanceSearchParams }) {
  return redirectToAttendanceTab("timesheet", "months", searchParams)
}
