import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { verifyOtp } from "@/lib/sms"
import { withRlsSessionAuth } from "@/lib/with-rls"

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
}).strict()

/**
 * POST /api/v1/auth/sms-2fa/disable
 *
 * Turns off the SMS 2FA flag after a fresh code sent by resend-sms-2fa. Keeps
 * verifiedPhone on the record so re-enabling doesn't require changing the
 * stored number.
 *
 * Auth: verified browser session only. Pending login/setup sessions are rejected
 * by withRlsSessionAuth before this handler runs.
 */
export const POST = withRlsSessionAuth(async (req, session) => {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Verification code required" },
      { status: 400 },
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { smsAuthEnabled: true, verifiedPhone: true },
  })
  if (!user?.smsAuthEnabled || !user.verifiedPhone) {
    return NextResponse.json({ error: "SMS 2FA is not enabled" }, { status: 400 })
  }

  const verified = await verifyOtp(user.verifiedPhone, parsed.data.code, "2fa", session.userId)
  if (!verified.success) {
    const status = verified.error === "Too many attempts" ? 429 : 400
    return NextResponse.json({ error: verified.error || "Invalid code" }, { status })
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      smsAuthEnabled: false,
      twoFactorNonce: null,
      passwordChangedAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, data: { reauthenticate: true } })
})
