import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { sendOtp } from "@/lib/sms"
import { runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit } from "@/lib/rate-limit"

// Six resends per hour is well past "the first one didn't arrive" and well
// short of a usable cost lever. Deliberately checkRateLimit and not the
// fail-closed Redis guard: this endpoint only ever texts the caller's own
// verified number, so the abuse ceiling is the caller's own wallet, and a
// Redis blip must not leave people unable to finish a 2FA login.
const RESEND_LIMIT = { maxRequests: 6, windowMs: 60 * 60 * 1000 }

/**
 * POST /api/v1/auth/resend-sms-2fa
 *
 * Lets the user request a fresh SMS code on the verify page (e.g. if the first
 * one didn't arrive).
 *
 * This used to claim "rate-limited per-phone and per-IP by sendOtp itself".
 * It is not — `sendOtp` (src/lib/sms.ts) issues and stores a code and has never
 * had a limiter. The comment made an unbounded, billable send look guarded, so
 * the limit is now applied here where it can be seen.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = (session.user as any).id

  if (!checkRateLimit(`sms-2fa-resend:${userId}`, RESEND_LIMIT)) {
    return NextResponse.json(
      { error: "Too many codes requested. Try again later." },
      { status: 429 },
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsAuthEnabled: true, verifiedPhone: true, organizationId: true },
  })
  if (!user || !user.smsAuthEnabled || !user.verifiedPhone) {
    return NextResponse.json({ error: "SMS 2FA not enabled" }, { status: 400 })
  }

  const result = await sendOtp({
    phone: user.verifiedPhone,
    purpose: "2fa",
    organizationId: user.organizationId,
    userId,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send code" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
  })
}
