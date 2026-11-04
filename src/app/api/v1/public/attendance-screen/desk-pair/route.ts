import { NextRequest } from "next/server"
import { pairAttendanceDeskScreen } from "@/lib/mtm/attendance-desk-screen"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { screenJson, screenRateLimited, setScreenCookie } from "@/lib/mtm/attendance-branch-screen-http"

export const dynamic = "force-dynamic"

// The desk asks every few seconds while its pairing QR waits for the phone.
// A token is 256 random bits the browser made: there is nothing to guess.
const DESK_PAIR_IP_LIMIT = { maxRequests: 120, windowSeconds: 60 }

/**
 * POST /api/v1/public/attendance-screen/desk-pair — the employee's computer
 * shows a pairing QR and asks with its token until the employee's phone has
 * confirmed it (`attendance-desk-screen.ts`). Not yet confirmed, expired or
 * wrong are one answer.
 */
export async function POST(req: NextRequest) {
  const limit = await consumePublicRateLimit("mtm-attendance-desk-pair:ip", clientIp(req), DESK_PAIR_IP_LIMIT)
  if (limit.unavailable) return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  if (!limit.allowed) return screenRateLimited(limit.retryAfterSeconds)
  const body = await readJsonRequestWithinLimit(req, 256)
  const token = body.ok && body.value && typeof body.value === "object" ? (body.value as { token?: unknown }).token : undefined
  try {
    const paired = await pairAttendanceDeskScreen(token)
    if (!paired) return screenJson({ success: true, state: "WAITING" })
    return setScreenCookie(screenJson({ success: true, state: "PAIRED" }), paired.secret)
  } catch {
    return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  }
}
