import { NextRequest, NextResponse } from "next/server"
import { clientIp } from "@/lib/request-ip"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  approveWorkforceTimesheet,
  WorkforceTimesheetApprovalRequestSchema,
} from "@/lib/workforce/timesheet-approval-service"

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
 * POST /api/v1/workforce/timesheet/approvals
 *
 * This is deliberately session-only: an API-key creator is not a human
 * approval actor. The server reconstructs the full recorded period rather
 * than accepting rows or hashes from the browser.
 */
export const POST = withWorkforceSessionAuth("write", async (req: NextRequest, auth) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return workforceScopeDenied()

  const parsed = WorkforceTimesheetApprovalRequestSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid timesheet approval" }, { status: 400 })
  }

  try {
    const result = await approveWorkforceTimesheet({
      organizationId: auth.orgId,
      userId: auth.userId,
      actor,
      input: parsed.data,
      audit: requestAuditContext(req),
    })
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.kind === "forbidden") return workforceScopeDenied()
    if (result.kind === "conflict") {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 409 })
    }
    return NextResponse.json({ success: true, idempotent: result.idempotent, data: result.data }, { status: 201 })
  } catch (error) {
    console.error("[workforce/timesheet approvals POST]", error)
    return NextResponse.json({ error: "Failed to approve Workforce timesheet" }, { status: 500 })
  }
})
