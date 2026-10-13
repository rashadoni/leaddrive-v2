import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"

export const GET = withMtmAttendanceAuth("read", async (_req, auth) => {
  return NextResponse.json({ success: true, data: { canManageRules: auth.role === "admin" || auth.role === "superadmin" } })
})
