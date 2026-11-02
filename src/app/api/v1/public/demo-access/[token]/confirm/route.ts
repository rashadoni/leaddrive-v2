import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { confirmDemoRequestEmail } from "@/lib/demo-center/email-confirmation"
import { ensureDemoProspectLead } from "@/lib/demo-center/prospect-lead"
import {
  anonymizedClientMetadata,
  cookieSecurityOptions,
  demoVerificationCookieName,
  DEMO_VERIFICATION_TTL_MS,
  issueBrowserCredential,
} from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * The prospect pressed «Təsdiqlə və demonu aç» on the page the emailed link
 * opened. The link went to that one address, so pressing it there proves the
 * address — this replaces the six-digit code that used to arrive in a second
 * email (owner, 2026-10-18: «письмо подтверждение и только после нажатия на
 * ссылку… чтоб открывалось демо»).
 *
 * A button, not the link itself: mail scanners open links to inspect them,
 * and a GET that confirmed would bind the one session to the scanner. POST
 * only, and the browser that pressed it gets the verification cookie that
 * `start` turns into the session.
 *
 * `OTP_VERIFIED` keeps its historical name: it is the stored status «address
 * proven, session not started yet», whatever proved it.
 */
const CONFIRMABLE_STATUSES = ["SENT", "OTP_SENT", "OTP_VERIFIED"]

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo linkinin müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    if (!CONFIRMABLE_STATUSES.includes(grant.status)) {
      return NextResponse.json({ success: false, error: "Bu demo artıq başladılıb" }, { status: 409, headers: noStoreHeaders() })
    }

    const verification = issueBrowserCredential()
    const verificationExpiresAt = new Date(now.getTime() + DEMO_VERIFICATION_TTL_MS)
    const claimed = await prisma.demoGrant.updateMany({
      where: { id: grant.id, status: { in: CONFIRMABLE_STATUSES }, sessionStartedAt: null, linkExpiresAt: { gt: now } },
      data: {
        status: "OTP_VERIFIED",
        otpHash: null,
        otpExpiresAt: null,
        verifiedAt: grant.verifiedAt ?? now,
        verificationHash: verification.credentialHash,
        verificationExpiresAt,
      },
    })
    if (!claimed.count) {
      return NextResponse.json({ success: false, error: "Bu demo artıq başladılıb" }, { status: 409, headers: noStoreHeaders() })
    }
    await prisma.demoAccessEvent.create({
      data: { grantId: grant.id, eventType: "EMAIL_CONFIRMED", metadata: anonymizedClientMetadata(request) },
    })

    // The address is proven: the owner hears about the request now, and the
    // prospect becomes a lead in LeadDrive's own CRM. Neither throws, and
    // nothing about either reaches this response.
    await confirmDemoRequestEmail(grant.requestId, now)
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
