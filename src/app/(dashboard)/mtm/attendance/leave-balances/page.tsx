import { redirectToAttendanceTab, type AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

/** Former page; now Personnel → settings → leave. */
export default async function AttendanceLeaveBalancesRedirect({ searchParams }: { searchParams: AttendanceSearchParams }) {
  return redirectToAttendanceTab("settings", "leave", searchParams)
}
