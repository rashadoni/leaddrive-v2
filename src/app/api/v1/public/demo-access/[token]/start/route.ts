import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import {
  anonymizedClientMetadata,
  cookieSecurityOptions,
  demoSessionCookieName,
  demoVerificationCookieName,
  secureHashMatches,
} from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

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

    const existingSession = request.cookies.get(demoSessionCookieName(token))?.value
    const verifiedCredential = request.cookies.get(demoVerificationCookieName(token))?.value
    if (grant.status === "ACTIVE") {
      const resumableCredential = [existingSession, verifiedCredential]
        .find((credential) => secureHashMatches(credential, grant.sessionHash))
      if (!resumableCredential || !grant.sessionExpiresAt) {
        return NextResponse.json({ success: false, error: "Demo artıq başqa brauzerdə başladılıb" }, { status: 409, headers: noStoreHeaders() })
      }
      return activeResponse(token, resumableCredential, grant.sessionExpiresAt, true)
    }

    if (
      grant.status !== "OTP_VERIFIED"
      || !verifiedCredential
      || !grant.verificationHash
      || !grant.verificationExpiresAt
      || grant.verificationExpiresAt <= now
      || !secureHashMatches(verifiedCredential, grant.verificationHash)
    ) {
      return NextResponse.json({ success: false, error: "E-poçt təsdiqini yeniləyin" }, { status: 401, headers: noStoreHeaders() })
    }

    const sessionExpiresAt = new Date(now.getTime() + grant.sessionDurationMinutes * 60_000)
    // Reuse the already-random verification credential as the session secret.
    // If the HTTP response is lost after commit, the browser still has that
    // credential and a retry can safely recover the same session cookie.
    const claimed = await prisma.$transaction(async (tx) => {
      const updated = await tx.demoGrant.updateMany({
        where: {
          id: grant.id,
          status: "OTP_VERIFIED",
          sessionStartedAt: null,
          verificationHash: grant.verificationHash,
          verificationExpiresAt: { gt: now },
          linkExpiresAt: { gt: now },
        },
        data: {
          status: "ACTIVE",
          sessionHash: grant.verificationHash,
          sessionStartedAt: now,
          sessionLastSeenAt: now,
          sessionExpiresAt,
          verificationHash: null,
          verificationExpiresAt: null,
        },
      })
      if (!updated.count) return false
      await tx.demoAccessEvent.create({
        data: { grantId: grant.id, eventType: "SESSION_STARTED", metadata: anonymizedClientMetadata(request) },
      })
      return true
    })

    if (!claimed) {
      const latest = await prisma.demoGrant.findUnique({ where: { id: grant.id } })
      if (
        latest?.status === "ACTIVE"
        && latest.sessionExpiresAt
        && secureHashMatches(verifiedCredential, latest.sessionHash)
      ) {
        return activeResponse(token, verifiedCredential, latest.sessionExpiresAt, true)
      }
      return NextResponse.json({ success: false, error: "Demo artıq başladılıb" }, { status: 409, headers: noStoreHeaders() })
    }

    return activeResponse(token, verifiedCredential, sessionExpiresAt, false)
  })
}

function activeResponse(token: string, credential: string, sessionExpiresAt: Date, resumed: boolean) {
  const response = NextResponse.json(
    { success: true, state: "active", resumed, sessionExpiresAt },
    { headers: noStoreHeaders() },
  )
  response.cookies.set(
    demoSessionCookieName(token),
    credential,
    cookieSecurityOptions(Math.max(0, Math.ceil((sessionExpiresAt.getTime() - Date.now()) / 1_000))),
  )
  response.cookies.set(demoVerificationCookieName(token), "", cookieSecurityOptions(0))
  return response
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
