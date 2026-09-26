import bcrypt from "bcryptjs"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import {
  anonymizedClientMetadata,
  cookieSecurityOptions,
  DEMO_MAX_OTP_ATTEMPTS,
  demoVerificationCookieName,
  DEMO_VERIFICATION_TTL_MS,
  issueBrowserCredential,
} from "@/lib/demo-center/security"
import { demoOtpSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { ensureDemoProspectLead } from "@/lib/demo-center/prospect-lead"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoOtpSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "6 rəqəmli kodu daxil edin" }, { status: 400, headers: noStoreHeaders() })
  }

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo linkinin müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    if (grant.status !== "OTP_SENT" || !grant.otpHash || !grant.otpExpiresAt) {
      return NextResponse.json({ success: false, error: "Əvvəlcə yeni kod istəyin" }, { status: 409, headers: noStoreHeaders() })
    }
    if (grant.otpExpiresAt <= now) {
      return NextResponse.json({ success: false, error: "Kodun müddəti bitib. Yeni kod istəyin." }, { status: 410, headers: noStoreHeaders() })
    }
    if (grant.otpAttempts >= DEMO_MAX_OTP_ATTEMPTS) {
      return NextResponse.json({ success: false, error: "Cəhd limiti bitib. Yeni kod istəyin." }, { status: 429, headers: noStoreHeaders() })
    }

    const valid = await bcrypt.compare(parsed.data.code, grant.otpHash)
    if (!valid) {
      const attempts = grant.otpAttempts + 1
      await prisma.demoGrant.updateMany({
        where: { id: grant.id, status: "OTP_SENT", otpHash: grant.otpHash, otpAttempts: { lt: DEMO_MAX_OTP_ATTEMPTS } },
        data: { otpAttempts: { increment: 1 } },
      })
      await prisma.demoAccessEvent.create({
        data: { grantId: grant.id, eventType: "DENIED", metadata: { reason: "invalid_otp", attempts } },
      })
      return NextResponse.json(
        { success: false, error: "Kod düzgün deyil", attemptsRemaining: Math.max(0, DEMO_MAX_OTP_ATTEMPTS - attempts) },
        { status: 401, headers: noStoreHeaders() },
      )
    }

    const verification = issueBrowserCredential()
    const verificationExpiresAt = new Date(now.getTime() + DEMO_VERIFICATION_TTL_MS)
    const claimed = await prisma.demoGrant.updateMany({
      where: { id: grant.id, status: "OTP_SENT", otpHash: grant.otpHash, otpAttempts: { lt: DEMO_MAX_OTP_ATTEMPTS } },
      data: {
        status: "OTP_VERIFIED",
        otpHash: null,
        otpExpiresAt: null,
        verifiedAt: now,
        verificationHash: verification.credentialHash,
        verificationExpiresAt,
      },
    })
    if (!claimed.count) {
      return NextResponse.json({ success: false, error: "Kod artıq istifadə edilib" }, { status: 409, headers: noStoreHeaders() })
    }
    await prisma.demoAccessEvent.create({
      data: { grantId: grant.id, eventType: "OTP_VERIFIED", metadata: anonymizedClientMetadata(request) },
    })

    // The email is now proven, so the prospect becomes a lead in LeadDrive's
    // own CRM. It never throws and its outcome is never shown here: the
    // prospect's demo does not depend on the sales side, and nothing about the
    // internal lead may reach this response.
    await ensureDemoProspectLead(grant.requestId, now)

    const response = NextResponse.json({ success: true, state: "verified" }, { headers: noStoreHeaders() })
    response.cookies.set(
      demoVerificationCookieName(token),
      verification.credential,
      cookieSecurityOptions(DEMO_VERIFICATION_TTL_MS / 1_000),
    )
    return response
  })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
