import { NextResponse } from "next/server"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readAttendanceHrUsers } from "@/lib/mtm/attendance-hr-access"

export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  if (auth.principalType !== "session" || (auth.role !== "admin" && auth.role !== "superadmin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const search = (new URL(req.url).searchParams.get("search") ?? "").trim()
  if (search.length > 100) return NextResponse.json({ error: "Invalid search" }, { status: 400 })
  return NextResponse.json({ success: true, data: await readAttendanceHrUsers(auth.orgId, search) }, { headers: { "Cache-Control": "private, no-store" } })
})
