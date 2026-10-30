import { NextRequest } from "next/server"
import { issueAttendanceScreenQr } from "@/lib/mtm/attendance-branch-screen-store"
import { BRANCH_SCREEN_COOKIE, parseBranchScreenFix } from "@/lib/mtm/attendance-branch-screen-security"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { clearScreenCookie, screenJson, screenRateLimited } from "@/lib/mtm/attendance-branch-screen-http"

export const dynamic = "force-dynamic"

// The screen asks once a minute (and on wake); a few screens behind one
// office address fit, a script does not.
const QR_IP_LIMIT = { maxRequests: 60, windowSeconds: 60 }

/** POST /api/v1/public/attendance-screen/qr — the paired screen's current code. POST: never cached, never prefetched. */
export async function POST(req: NextRequest) {
  const limit = await consumePublicRateLimit("mtm-attendance-screen-qr:ip", clientIp(req), QR_IP_LIMIT)
  if (limit.unavailable) return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  if (!limit.allowed) return screenRateLimited(limit.retryAfterSeconds)
  try {
    // The body carries the screen's own position; a missing or malformed one is "cannot tell".
    const body = await req.json().catch(() => null)
    const shown = await issueAttendanceScreenQr(req.cookies.get(BRANCH_SCREEN_COOKIE)?.value, parseBranchScreenFix(body))
    if (shown.state === "UNPAIRED") return clearScreenCookie(screenJson({ success: true, data: shown }))
    return screenJson({ success: true, data: shown })
  } catch {
    return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  }
}
