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
import { demoEventSchema } from "@/lib/demo-center/validation"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!validRawDemoToken(token)) return unavailable()
  const parsed = demoEventSchema.safeParse(await request.json().catch(() => ({})))
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

function unavailable() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
