import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import { workforceAttendanceSecurityMfaSatisfied } from "@/lib/workforce/attendance-route"
import { requireWorkforceDirectTimeCorrectionRateLimit } from "@/lib/workforce/direct-time-correction-rate-limit"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"
import { closeLeftOpenWorkforceWorkday, WorkforceWorkdayCloseSchema } from "@/lib/workforce/workday-close-left-open"

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
 * POST /api/v1/workforce/workdays/:id/close
 *
 * Closes a shift another employee in the manager's scope left open for more
 * than 16 hours, at the finish the manager chose. Like the reopen it is an
 * accountable human action with a mandatory reason: integration keys cannot
 * use it, 2FA is recommended and recorded in the audit, and it shares the
 * manager time-correction rate budget.
 */
export const POST = withWorkforceSessionAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = WorkforceWorkdayCloseSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid workday close" }, { status: 400 })
  }
  const rateLimited = await requireWorkforceDirectTimeCorrectionRateLimit({
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    // Owner decision 2026-09-21: 2FA is recommended, not required, for the
    // manager's workday actions. The audit records whether it was enrolled.
    const mfaEnrolled = await workforceAttendanceSecurityMfaSatisfied(prisma, auth.orgId, auth).catch(() => null)
    const actor = await resolveWorkforceActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
    })
    const result = await closeLeftOpenWorkforceWorkday({
      organizationId: auth.orgId,
      userId: auth.userId,
      actor,
      workdayId: id,
      input: parsed.data,
      audit: { ...requestAuditContext(req), mfaEnrolled },
    })
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.kind === "forbidden") return workforceScopeDenied()
    if (result.kind === "conflict") {
      return NextResponse.json({
        error: "Unable to close Workforce workday.",
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
    logWorkforceSensitiveOperationFailure({ operation: "review-workday-close" })
    return NextResponse.json({ error: "Failed to close Workforce workday" }, { status: 500 })
  }
})
