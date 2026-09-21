import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getDemoModules } from "@/lib/demo-center/catalog"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import {
  anonymizedClientMetadata,
  cookieSecurityOptions,
  demoSessionCookieName,
  secureHashMatches,
} from "@/lib/demo-center/security"
import { demoEventSchema, demoJourneyReportSchema } from "@/lib/demo-center/validation"
import {
  JOURNEY_ACTIVITY_EVENT,
  JOURNEY_EVENTS_PER_GRANT,
  REPORTED_JOURNEY_EVENTS,
  acceptJourneyReport,
  getDemoJourneyScenario,
  withLiveCall,
} from "@/lib/demo-center/journey"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const body: unknown = await request.json().catch(() => ({}))
  if (body && typeof body === "object" && (body as { eventType?: unknown }).eventType === "JOURNEY") {
    return recordJourneyReport(request, token, body)
  }
  const parsed = demoEventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid event" }, { status: 400, headers: noStoreHeaders() })
  }

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo sessiyasının müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
    if (grant.status !== "ACTIVE" || !secureHashMatches(sessionCredential, grant.sessionHash)) {
      return NextResponse.json({ success: false, error: "Aktiv demo sessiyası tapılmadı" }, { status: 401, headers: noStoreHeaders() })
    }

    const moduleManifest = parsed.data.moduleId ? getDemoModules([parsed.data.moduleId])[0] : null
    if (parsed.data.moduleId && (!grant.moduleIds.includes(parsed.data.moduleId) || !moduleManifest)) {
      await prisma.demoAccessEvent.create({
        data: { grantId: grant.id, eventType: "DENIED", moduleId: parsed.data.moduleId, metadata: { reason: "module_not_granted" } },
      })
      return NextResponse.json({ success: false, error: "Bu modul sizin demo paketinizə daxil deyil" }, { status: 403, headers: noStoreHeaders() })
    }
    if (
      parsed.data.eventType === "STEP_VIEWED"
      && (!parsed.data.stepId || !moduleManifest?.steps.some((step) => step.id === parsed.data.stepId))
    ) {
      return NextResponse.json({ success: false, error: "Demo addımı tapılmadı" }, { status: 400, headers: noStoreHeaders() })
    }

    if (parsed.data.eventType === "COMPLETED") {
      const completed = await prisma.$transaction(async (tx) => {
        const updated = await tx.demoGrant.updateMany({
          where: { id: grant.id, status: "ACTIVE", sessionHash: grant.sessionHash },
          data: { status: "COMPLETED", completedAt: now, sessionLastSeenAt: now, sessionHash: null },
        })
        if (!updated.count) return false
        await tx.demoAccessEvent.create({
          data: {
            grantId: grant.id,
            eventType: "COMPLETED",
            metadata: { ...(parsed.data.metadata || {}), ...anonymizedClientMetadata(request) },
          },
        })
        return true
      })
      if (!completed) return NextResponse.json({ success: false, error: "Sessiya artıq bağlanıb" }, { status: 409, headers: noStoreHeaders() })

      const response = NextResponse.json({ success: true, state: "completed" }, { headers: noStoreHeaders() })
      response.cookies.set(demoSessionCookieName(token), "", cookieSecurityOptions(0))
      return response
    }

    const accepted = await prisma.$transaction(async (tx) => {
      const updated = await tx.demoGrant.updateMany({
        where: { id: grant.id, status: "ACTIVE", sessionHash: grant.sessionHash },
        data: { sessionLastSeenAt: now },
      })
      if (!updated.count) return false
      if (parsed.data.metadata?.activityOnly !== true) {
        await tx.demoAccessEvent.create({
          data: {
            grantId: grant.id,
            eventType: parsed.data.eventType,
            moduleId: parsed.data.moduleId || null,
            stepId: parsed.data.stepId || null,
            metadata: { ...(parsed.data.metadata || {}), ...anonymizedClientMetadata(request) },
          },
        })
      }
      return true
    })
    if (!accepted) return NextResponse.json({ success: false, error: "Sessiya artıq bağlanıb" }, { status: 409, headers: noStoreHeaders() })
    return NextResponse.json({
      success: true,
      serverNow: now,
      sessionExpiresAt: grant.sessionExpiresAt,
      idleExpiresAt: new Date(now.getTime() + grant.inactivityMinutes * 60_000),
    }, { headers: noStoreHeaders() })
  })
}

/**
 * A guided-story session reporting its progress (src/lib/demo-center/journey/telemetry.ts).
 * Same gate as every other event — an active grant and this browser's session
 * — plus the report must name a section, step, state or clip of the scenario
 * the grant was issued with. Every accepted report, the activity ping
 * included, refreshes the session's idle clock; only the story's moves are
 * stored, and at most JOURNEY_EVENTS_PER_GRANT of them.
 */
async function recordJourneyReport(request: NextRequest, token: string, body: unknown) {
  const parsed = demoJourneyReportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid event" }, { status: 400, headers: noStoreHeaders() })
  }
  const report = parsed.data

  return runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return unavailable()
    const now = new Date()
    if (await expireDemoGrantIfNeeded(grant, now)) {
      return NextResponse.json({ success: false, error: "Demo sessiyasının müddəti bitib" }, { status: 410, headers: noStoreHeaders() })
    }
    const sessionCredential = request.cookies.get(demoSessionCookieName(token))?.value
    if (grant.status !== "ACTIVE" || !secureHashMatches(sessionCredential, grant.sessionHash)) {
      return NextResponse.json({ success: false, error: "Aktiv demo sessiyası tapılmadı" }, { status: 401, headers: noStoreHeaders() })
    }

    const scenario = grant.scenarioId ? getDemoJourneyScenario(grant.scenarioId) : null
    if (!scenario) {
      return NextResponse.json({ success: false, error: "Bu demo hekayə ssenarisi deyil" }, { status: 400, headers: noStoreHeaders() })
    }
    const checked = acceptJourneyReport(grant.liveCallEnabled ? withLiveCall(scenario) : scenario, report)
    if (!checked.ok) {
      return NextResponse.json({ success: false, error: "Demo addımı tapılmadı" }, { status: 400, headers: noStoreHeaders() })
    }

    const accepted = await prisma.$transaction(async (tx) => {
      const updated = await tx.demoGrant.updateMany({
        where: { id: grant.id, status: "ACTIVE", sessionHash: grant.sessionHash },
        data: { sessionLastSeenAt: now },
      })
      if (!updated.count) return false
      if (report.name === JOURNEY_ACTIVITY_EVENT) return true
      const stored = await tx.demoAccessEvent.count({
        where: { grantId: grant.id, eventType: { in: [...REPORTED_JOURNEY_EVENTS] } },
      })
      if (stored < JOURNEY_EVENTS_PER_GRANT) {
        await tx.demoAccessEvent.create({
          data: { grantId: grant.id, eventType: report.name, stepId: checked.stepId, metadata: checked.metadata },
        })
      }
      return true
    })
    if (!accepted) return NextResponse.json({ success: false, error: "Sessiya artıq bağlanıb" }, { status: 409, headers: noStoreHeaders() })
    return NextResponse.json({
      success: true,
      serverNow: now,
      sessionExpiresAt: grant.sessionExpiresAt,
      idleExpiresAt: new Date(now.getTime() + grant.inactivityMinutes * 60_000),
    }, { headers: noStoreHeaders() })
  })
}

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
