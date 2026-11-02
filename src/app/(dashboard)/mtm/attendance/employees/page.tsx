import { redirectToAttendanceTab, type AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

/** Former page; now Personnel → people → employees. */
export default async function AttendanceEmployeesRedirect({ searchParams }: { searchParams: AttendanceSearchParams }) {
  return redirectToAttendanceTab("people", "employees", searchParams)
}
