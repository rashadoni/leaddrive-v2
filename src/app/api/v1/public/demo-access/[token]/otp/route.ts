import bcrypt from "bcryptjs"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { sendDemoOtpEmail } from "@/lib/demo-center/email"
import {
  anonymizedClientMetadata,
  DEMO_MAX_OTP_ATTEMPTS,
  DEMO_MAX_OTP_SENDS,
  DEMO_OTP_RESEND_COOLDOWN_MS,
  DEMO_OTP_TTL_MS,
  generateDemoOtp,
} from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

const OTP_ELIGIBLE_STATUSES = ["SENT", "OTP_SENT", "OTP_VERIFIED"]

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({
      where: { tokenHash: hashOneTimeToken(token) },
      include: { request: { select: { email: true, name: true } } },
    })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo linkinin müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    if (!OTP_ELIGIBLE_STATUSES.includes(grant.status)) {
      return NextResponse.json({ success: false, error: "Bu demo üçün yeni kod göndərilə bilməz" }, { status: 409, headers: noStoreHeaders() })
    }
    if (grant.otpAttempts >= DEMO_MAX_OTP_ATTEMPTS) {
      return NextResponse.json(
        { success: false, error: "Təsdiq cəhdləri bitib. Demo sahibindən yeni link istəyin." },
        { status: 429, headers: noStoreHeaders() },
      )
    }
    if (grant.otpSendCount >= DEMO_MAX_OTP_SENDS) {
      return NextResponse.json(
        { success: false, error: "Kod göndərmə limiti bitib. Demo sahibindən yeni link istəyin." },
        { status: 429, headers: noStoreHeaders() },
      )
    }

    if (grant.otpSentAt && now.getTime() - grant.otpSentAt.getTime() < DEMO_OTP_RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((DEMO_OTP_RESEND_COOLDOWN_MS - (now.getTime() - grant.otpSentAt.getTime())) / 1_000)
      return NextResponse.json(
        { success: false, error: "Yeni kod göndərməzdən əvvəl gözləyin", retryAfter },
        { status: 429, headers: { ...noStoreHeaders(), "Retry-After": String(retryAfter) } },
      )
    }

    const code = generateDemoOtp()
    const otpHash = await bcrypt.hash(code, 8)
    const otpExpiresAt = new Date(now.getTime() + DEMO_OTP_TTL_MS)
    const claimed = await prisma.demoGrant.updateMany({
      where: {
        id: grant.id,
        status: { in: OTP_ELIGIBLE_STATUSES },
        otpAttempts: { lt: DEMO_MAX_OTP_ATTEMPTS },
        otpSendCount: { lt: DEMO_MAX_OTP_SENDS },
        OR: [{ otpSentAt: null }, { otpSentAt: { lte: new Date(now.getTime() - DEMO_OTP_RESEND_COOLDOWN_MS) } }],
      },
      data: {
        status: "OTP_SENT",
        otpHash,
        otpExpiresAt,
        otpSentAt: now,
        otpSendCount: { increment: 1 },
        verificationHash: null,
        verificationExpiresAt: null,
      },
    })
    if (!claimed.count) {
      return NextResponse.json({ success: false, error: "Kod artıq göndərilib. Bir dəqiqə gözləyin." }, { status: 409, headers: noStoreHeaders() })
    }

    const delivery = await sendDemoOtpEmail({ to: grant.request.email, name: grant.request.name, code })
    if (!delivery.success) {
      await prisma.demoGrant.updateMany({
        where: { id: grant.id, status: "OTP_SENT", otpHash },
        data: { status: "SENT", otpHash: null, otpExpiresAt: null },
      })
      return NextResponse.json(
        { success: false, error: "Kodu göndərə bilmədik. Bir qədər sonra yenidən cəhd edin." },
        { status: 502, headers: noStoreHeaders() },
      )
    }

    await prisma.demoAccessEvent.create({
      data: { grantId: grant.id, eventType: "OTP_SENT", metadata: anonymizedClientMetadata(request) },
    })
    return NextResponse.json({ success: true, expiresInSeconds: DEMO_OTP_TTL_MS / 1_000 }, { headers: noStoreHeaders() })
  })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
