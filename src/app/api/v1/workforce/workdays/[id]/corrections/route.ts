import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp } from "@/lib/request-ip"
import { withWorkforceRlsAuth } from "@/lib/with-workforce-rls-auth"
import { resolveWorkforceActor } from "@/lib/workforce/actor"
import {
  correctWorkforceTimeDirectly,
  WorkforceDirectTimeCorrectionSchema,
} from "@/lib/workforce/direct-time-correction"

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

/** POST /api/v1/workforce/workdays/:id/corrections */
export const POST = withWorkforceRlsAuth<RouteContext>("write", async (req: NextRequest, auth, { params }) => {
  const actor = await resolveWorkforceActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
  })
  if (!actor) return workforceScopeDenied()

  const parsed = WorkforceDirectTimeCorrectionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid time correction" }, { status: 400 })
  }
  const { id } = await params

  try {
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
        error: result.message,
        code: result.code,
        ...(result.currentWorkday ? { data: { workday: result.currentWorkday } } : {}),
      }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      idempotent: result.idempotent,
      data: result.data,
    })
  } catch (error) {
    console.error("[workforce/workday correction POST]", error)
    return NextResponse.json({ error: "Failed to correct Workforce time" }, { status: 500 })
  }
})
