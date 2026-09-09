import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { verifyOtp } from "@/lib/sms"
import { runWithRlsBypass } from "@/lib/rls-context"
import { createTwoFactorNonce } from "@/lib/two-factor-nonce"

const schema = z.object({
  code: z.string().regex(/^\d{4,8}$/, "Code must be 4-8 digits"),
})

/**
 * POST /api/v1/auth/verify-sms-2fa
 *
 * Called from the login page when session.user.twoFactorMethod === "sms".
 * The SMS code was sent during authorize() using the user's verifiedPhone.
 *
 * On success: generate a twoFactorNonce the client can push via
 * session.update({ twoFactorNonce }) to clear needs2fa in the JWT callback.
 * This mirrors the existing TOTP verify-2fa flow for consistency.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = (session.user as any).id
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, smsAuthEnabled: true, verifiedPhone: true },
  })
  if (!user || !user.smsAuthEnabled || !user.verifiedPhone) {
    return NextResponse.json({ error: "SMS 2FA not enabled" }, { status: 400 })
  }

  const ok = await verifyOtp(user.verifiedPhone, parsed.data.code, "2fa", user.id)
  if (!ok.success) {
    const status = ok.error === "Too many attempts" ? 429 : 400
    return NextResponse.json({ error: ok.error || "Invalid code" }, { status })
  }

  const twoFactorNonce = createTwoFactorNonce()
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorNonce },
  })

  return NextResponse.json({ success: true, data: { verified: true, twoFactorNonce } })
  })
}
