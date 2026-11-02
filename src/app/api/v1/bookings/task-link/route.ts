import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { taskMeetingReference } from "@/lib/booking/task-reference"

export const GET = withRlsAuth("bookings", "read", async (req, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  const taskId = z.string().trim().min(1).max(64).safeParse(req.nextUrl.searchParams.get("taskId"))
  if (!taskId.success) return NextResponse.json({ code: "INVALID_TASK_ID" }, { status: 400 })
  return NextResponse.json({ success: true, data: await taskMeetingReference(access, taskId.data) }, {
    headers: { "Cache-Control": "private, no-store" },
  })
})
