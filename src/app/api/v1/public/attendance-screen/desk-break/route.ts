import { NextRequest } from "next/server"
import { deskAttendanceBreak } from "@/lib/mtm/attendance-desk-screen"
import { BRANCH_SCREEN_COOKIE } from "@/lib/mtm/attendance-branch-screen-security"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { clearScreenCookie, screenJson, screenRateLimited } from "@/lib/mtm/attendance-branch-screen-http"

export const dynamic = "force-dynamic"

const DESK_BREAK_IP_LIMIT = { maxRequests: 30, windowSeconds: 60 }

/** POST /api/v1/public/attendance-screen/desk-break — «Перекур» / «Вернуться к работе» on the employee's own desk. */
export async function POST(req: NextRequest) {
  const limit = await consumePublicRateLimit("mtm-attendance-desk-break:ip", clientIp(req), DESK_BREAK_IP_LIMIT)
  if (limit.unavailable) return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  if (!limit.allowed) return screenRateLimited(limit.retryAfterSeconds)
  const body = await readJsonRequestWithinLimit(req, 512)
  if (!body.ok) return screenJson({ success: false, state: "INVALID" }, 400)
  try {
    const result = await deskAttendanceBreak(req.cookies.get(BRANCH_SCREEN_COOKIE)?.value, body.value)
    if (result.state === "UNPAIRED") return clearScreenCookie(screenJson({ success: true, data: result }))
    return screenJson({ success: true, data: result }, result.state === "DONE" ? 200 : 409)
  } catch (error) {
    if (error instanceof AttendanceRequestError && error.status === 400) return screenJson({ success: false, state: "INVALID" }, 400)
    return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  }
}
