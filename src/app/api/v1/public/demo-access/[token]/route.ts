import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getDemoModules } from "@/lib/demo-center/catalog"
import {
  DEMO_SOURCE_CHANNELS,
  getDemoJourneyScenario,
  type DemoProspectIdentity,
  type DemoSourceChannel,
} from "@/lib/demo-center/journey"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { demoCallStatus } from "@/lib/demo-center/demo-call"
import { demoLiveCallState } from "@/lib/demo-center/phone-verification"
import {
  anonymizedClientMetadata,
  demoSessionCookieName,
  demoVerificationCookieName,
  maskEmail,
  maskPhone,
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
      include: {
        request: {
          select: { company: true, email: true, name: true, jobTitle: true, phone: true, source: true },
        },
      },
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

    // A grant issued for a scenario opens the guided journey; one issued
    // before scenarios existed keeps opening the module player it was made
    // for. The manifest is resolved from the grant, never from the URL.
    const scenario = grant.scenarioId ? getDemoJourneyScenario(grant.scenarioId) : null
    const scenarioPayload = scenario
      ? { scenarioId: scenario.scenarioId, scenarioVersion: scenario.version }
      : null
    const identity: DemoProspectIdentity | null = scenario
      ? {
          name: grant.request.name,
          company: grant.request.company,
          jobTitle: grant.request.jobTitle,
          // The player never receives the raw contact details it displays.
          emailMasked: maskEmail(grant.request.email),
          phoneMasked: grant.request.phone ? maskPhone(grant.request.phone) : null,
          sourceChannel: sourceChannelOf(grant.request.source),
        }
      : null
    if (state !== "active") {
      if (isLifecycleProbe) {
        return NextResponse.json({ success: true, state }, { headers: noStoreHeaders() })
      }
      return NextResponse.json({
        success: true,
        state,
        company: grant.request.company,
        recipient: maskEmail(grant.request.email),
        ...(scenario
          ? { scenario: { ...scenarioPayload, title: scenario.title, summary: scenario.summary, sections: scenario.sections.length } }
          : { modules: publicModules }),
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

    // Booleans only: whether a live call is on, whether the request's own
    // number can be used without retyping, whether a phone is already proven.
    const liveCall = scenario
      ? {
          ...(await demoLiveCallState(grant, grant.request.phone)),
          // One call per demo: a reload during or after it resumes watching
          // that call instead of offering a new one.
          callPlaced: grant.liveCallEnabled ? (await demoCallStatus(grant)).phase !== "none" : false,
        }
      : null

    return NextResponse.json({
      success: true,
      state,
      serverNow: now,
      company: grant.request.company,
      recipient: maskEmail(grant.request.email),
      watermark: grant.watermark,
      ...(scenario ? { scenario: scenarioPayload, identity, liveCall } : { modules: selectedModules }),
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

/** The request's stored source, narrowed to a channel the scenario draws. */
function sourceChannelOf(value: string | null | undefined): DemoSourceChannel {
  const candidate = (value ?? "").toLowerCase()
  return (DEMO_SOURCE_CHANNELS as readonly string[]).includes(candidate)
    ? (candidate as DemoSourceChannel)
    : "website"
}
