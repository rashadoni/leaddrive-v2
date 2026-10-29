import { NextRequest } from "next/server"
import { pairAttendanceBranchScreen } from "@/lib/mtm/attendance-branch-screen-store"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { screenJson, screenRateLimited, setScreenCookie } from "@/lib/mtm/attendance-branch-screen-http"

export const dynamic = "force-dynamic"

// A code is 8 characters of 31 and lives ten minutes; ten tries a quarter of
// an hour per address leaves guessing one hopeless, and a typo or two harmless.
const PAIR_IP_LIMIT = { maxRequests: 10, windowSeconds: 15 * 60 }

/**
 * POST /api/v1/public/attendance-screen/pair — the tablet at the branch types
 * the code an administrator got in Personnel → Settings → QR. No sign-in: the
 * code is the credential, once. Every refusal is the same answer.
 */
export async function POST(req: NextRequest) {
  const limit = await consumePublicRateLimit("mtm-attendance-screen-pair:ip", clientIp(req), PAIR_IP_LIMIT)
  if (limit.unavailable) return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  if (!limit.allowed) return screenRateLimited(limit.retryAfterSeconds)
  const body = await readJsonRequestWithinLimit(req, 256)
  const code = body.ok && body.value && typeof body.value === "object" ? (body.value as { code?: unknown }).code : undefined
  try {
    const paired = await pairAttendanceBranchScreen(code)
    if (!paired) return screenJson({ success: false, state: "CODE_REFUSED" }, 400)
    return setScreenCookie(screenJson({ success: true, state: "PAIRED" }), paired.secret)
  } catch {
    return screenJson({ success: false, state: "UNAVAILABLE" }, 503)
  }
}
