import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  correctWorkforceTimeDirectly,
  WorkforceDirectTimeCorrectionSchema,
} from "@/lib/workforce/direct-time-correction"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { requireWorkforceDirectTimeCorrectionRateLimit } from "@/lib/workforce/direct-time-correction-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type RouteContext = { params: Promise<{ id: string }> }

function workforceScopeDenied() {
  return NextResponse.json({ error: "Forbidden", code: "WORKFORCE_SCOPE_DENIED" }, { status: 403 })
}

function requestAuditContext(req: NextRequest) {
  const ipAddress = clientIp(req)
  return {
    ipAddress: ipAddress === "unknown" ? null : ipAddress,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  }
}

/**
 * POST /api/v1/workforce/workdays/:id/corrections
 *
 * A direct correction is an accountable human action. Integration keys must
 * not use this route to impersonate a supervisor or append its audit record.
 */
export const POST = withWorkforceSessionAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return mfaDenied

  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = WorkforceDirectTimeCorrectionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid time correction" }, { status: 400 })
  }
  const rateLimited = await requireWorkforceDirectTimeCorrectionRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    const actor = await resolveWorkforceActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
    })
    if (!actor) return workforceScopeDenied()

    const result = await correctWorkforceTimeDirectly({
      organizationId: auth.orgId,
      userId: auth.userId,
      actor,
      workdayId: id,
      input: parsed.data,
      audit: requestAuditContext(req),
    })
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.kind === "forbidden") return workforceScopeDenied()
    if (result.kind === "conflict") {
      return NextResponse.json({
        error: "Unable to apply Workforce time correction.",
        code: result.code,
        ...(result.currentWorkday ? { data: { workday: result.currentWorkday } } : {}),
      }, { status: 409, headers: workforceSensitiveResponseHeaders })
    }
    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: result.data,
    }, { headers: workforceSensitiveResponseHeaders })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "review-workday-correction" })
    return NextResponse.json({ error: "Failed to correct Workforce time" }, { status: 500 })
  }
})
