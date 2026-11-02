import { redirectToAttendanceTab, type AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

/** Former page; now Personnel → settings → qr. */
export default async function AttendanceBranchQrRedirect({ searchParams }: { searchParams: AttendanceSearchParams }) {
  return redirectToAttendanceTab("settings", "qr", searchParams)
}
