import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getDemoModules } from "@/lib/demo-center/catalog"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import {
  anonymizedClientMetadata,
  demoSessionCookieName,
  demoVerificationCookieName,
  maskEmail,
  secureHashMatches,
} from "@/lib/demo-center/security"
import { publicAccessState } from "@/lib/demo-center/session"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) {
    return NextResponse.json({ success: false, state: "unavailable" }, { status: 404, headers: noStoreHeaders() })
  }

  return runWithRlsBypass(async () => {
    const isLifecycleProbe = request.nextUrl.searchParams.get("probe") === "1"
    const grant = await prisma.demoGrant.findUnique({
      where: { tokenHash: hashOneTimeToken(token) },
      include: { request: { select: { company: true, email: true, name: true } } },
    })
    if (!grant) return NextResponse.json({ success: false, state: "unavailable" }, { status: 404, headers: noStoreHeaders() })

    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: true, state: "expired" }, { headers: noStoreHeaders() })
    }

    const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
    const verificationCredential = request.cookies.get(demoVerificationCookieName(token))?.value
    const hasSession = secureHashMatches(sessionCredential, grant.sessionHash)
    const hasVerification = secureHashMatches(verificationCredential, grant.verificationHash)
    const state = publicAccessState(grant, { session: hasSession, verified: hasVerification }, now)

    if (!grant.openedAt && !["ISSUING", "DELIVERY_FAILED"].includes(grant.status)) {
      const opened = await prisma.demoGrant.updateMany({
        where: { id: grant.id, openedAt: null },
        data: { openedAt: now },
      })
      if (opened.count) {
        await prisma.demoAccessEvent.create({
          data: { grantId: grant.id, eventType: "LINK_OPENED", metadata: anonymizedClientMetadata(request) },
        })
      }
    }

    const selectedModules = getDemoModules(grant.moduleIds)
    const publicModules = selectedModules.map(({ id, title, summary }) => ({ id, title, summary }))
    if (state !== "active") {
      if (isLifecycleProbe) {
        return NextResponse.json({ success: true, state }, { headers: noStoreHeaders() })
      }
      return NextResponse.json({
        success: true,
        state,
        company: grant.request.company,
        recipient: maskEmail(grant.request.email),
        modules: publicModules,
        linkExpiresAt: grant.linkExpiresAt,
        sessionDurationMinutes: grant.sessionDurationMinutes,
        inactivityMinutes: grant.inactivityMinutes,
      }, { headers: noStoreHeaders() })
    }

    // An active credential may refresh/reconnect in the same browser. Only then
    // extend the inactivity window; the absolute session deadline never moves.
    let responseLastSeenAt = grant.sessionLastSeenAt
    if (!isLifecycleProbe && (!grant.sessionLastSeenAt || now.getTime() - grant.sessionLastSeenAt.getTime() > 30_000)) {
      const touched = await prisma.demoGrant.updateMany({
        where: { id: grant.id, status: "ACTIVE", sessionHash: grant.sessionHash },
        data: { sessionLastSeenAt: now },
      })
      if (touched.count) responseLastSeenAt = now
    }

    if (isLifecycleProbe) {
      return NextResponse.json({
        success: true,
        state,
        serverNow: now,
        sessionExpiresAt: grant.sessionExpiresAt,
        idleExpiresAt: idleExpiry(grant.sessionLastSeenAt, grant.inactivityMinutes),
      }, { headers: noStoreHeaders() })
    }

    return NextResponse.json({
      success: true,
      state,
      serverNow: now,
      company: grant.request.company,
      recipient: maskEmail(grant.request.email),
      watermark: grant.watermark,
      modules: selectedModules,
      sessionStartedAt: grant.sessionStartedAt,
      sessionExpiresAt: grant.sessionExpiresAt,
      idleExpiresAt: idleExpiry(responseLastSeenAt, grant.inactivityMinutes),
      inactivityMinutes: grant.inactivityMinutes,
    }, { headers: noStoreHeaders() })
  })
}

function idleExpiry(lastSeenAt: Date | null, inactivityMinutes: number): Date | null {
  return lastSeenAt
    ? new Date(lastSeenAt.getTime() + inactivityMinutes * 60_000)
    : null
}
