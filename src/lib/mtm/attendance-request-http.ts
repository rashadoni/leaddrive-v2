import { NextResponse } from "next/server"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"

export const attendancePrivateHeaders = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" }
export function attendanceRequestResponse(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status, headers: attendancePrivateHeaders })
}
export function attendanceRequestFailure(error: unknown) {
  // Reasons, document names and database errors never enter logs or responses.
  const known = error instanceof AttendanceRequestError
  const code = known ? error.code : "MTM_ATTENDANCE_REQUEST_FAILED"
  return NextResponse.json({ error: code, code }, { status: known ? error.status : 500, headers: attendancePrivateHeaders })
}
